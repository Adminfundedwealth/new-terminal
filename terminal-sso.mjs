import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const CHART_ORIGIN = "https://charts.fundedwealth.com";
const HANDOFF_TTL_SECONDS = 60;
const HANDOFF_ISSUER = "fundedwealth-dashboard";
const HANDOFF_AUDIENCE = "fundedwealth-terminal";
const EXCHANGE_COOKIE = "fw_sso_exchange";
const MAX_BODY_BYTES = 8192;

function jsonResponse(status, body, headers = {}) {
  return {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
    body: JSON.stringify(body),
  };
}

function equalSecret(actual, expected) {
  if (typeof actual !== "string" || typeof expected !== "string" || !expected) return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function fingerprint(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("Request body is too large."), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function getSupabaseConfig(env) {
  const baseUrl = env.SUPABASE_URL?.replace(/\/+$/, "");
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SECRET_KEY;
  if (!baseUrl || !serviceKey) {
    throw Object.assign(new Error("Terminal SSO service is not configured."), { status: 503 });
  }
  return { baseUrl, serviceKey };
}

function createRedisReplayStore(redisUrl) {
  let clientPromise;

  async function getClient() {
    if (!redisUrl) {
      throw Object.assign(new Error("Terminal SSO replay store is not configured."), { status: 503 });
    }
    if (!clientPromise) {
      clientPromise = import("redis").then(({ createClient }) => {
        const client = createClient({ url: redisUrl, socket: { connectTimeout: 5000 } });
        client.on("error", (error) => {
          console.error("[Terminal SSO] Redis replay store error", { name: error?.name ?? "Error" });
        });
        return client.connect().then(() => client);
      }).catch((error) => {
        clientPromise = undefined;
        throw Object.assign(new Error("Terminal SSO replay store is unavailable."), { status: 503, cause: error });
      });
    }
    return clientPromise;
  }

  return {
    async consume(jti, expiresAt) {
      const ttlSeconds = Math.ceil((expiresAt - Date.now()) / 1000);
      if (ttlSeconds <= 0) return false;

      const client = await getClient();
      try {
        return await client.set(`fundedwealth:sso:handoff:${jti}`, "1", {
          NX: true,
          EX: ttlSeconds,
        }) === "OK";
      } catch (error) {
        throw Object.assign(new Error("Terminal SSO replay store is unavailable."), { status: 503, cause: error });
      }
    },
  };
}

function signHandoff(payload, secret) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function readHandoff(token, secret) {
  const separator = token.lastIndexOf(".");
  if (separator < 1) return null;
  const encoded = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const expected = createHmac("sha256", secret).update(encoded).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (typeof payload.tokenHash !== "string" || !payload.tokenHash ||
        typeof payload.accountId !== "string" || !payload.accountId ||
        typeof payload.ownerUserId !== "string" || !payload.ownerUserId ||
        typeof payload.jti !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.jti) ||
        payload.iss !== HANDOFF_ISSUER || payload.aud !== HANDOFF_AUDIENCE ||
        !Number.isFinite(payload.expiresAt) || payload.expiresAt <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function safeUpstreamPath(path) {
  return path.split("?")[0].replace(
    /\/auth\/v1\/admin\/users\/[^/]+$/,
    "/auth/v1/admin/users/[id]",
  );
}

async function callSupabase(fetchImpl, config, path, init = {}) {
  let response;
  const headers = {
    apikey: config.serviceKey,
    ...(init.headers ?? {}),
  };
  if (!config.serviceKey.startsWith("sb_secret_") && !config.serviceKey.startsWith("sb_publishable_")) {
    headers.Authorization = `Bearer ${config.serviceKey}`;
  }
  try {
    response = await fetchImpl(`${config.baseUrl}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(8000),
    });
  } catch (error) {
    const causeCode = error?.cause?.code ?? error?.code;
    throw Object.assign(new Error("Terminal SSO database request failed."), {
      status: 503,
      ...(typeof causeCode === "string" && /^[A-Z0-9_]+$/.test(causeCode) ? { causeCode } : {}),
      upstreamPath: safeUpstreamPath(path),
    });
  }
  if (!response.ok) {
    throw Object.assign(new Error("Terminal SSO database request failed."), {
      status: 502,
      upstreamStatus: response.status,
      upstreamPath: safeUpstreamPath(path),
    });
  }
  const responseBody = await response.text();
  return responseBody ? JSON.parse(responseBody) : null;
}

function makeExchangeCookie(tokenHash, accountId, secret, expiresAt) {
  const payload = Buffer.from(JSON.stringify({ tokenHash, accountId, expiresAt })).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${EXCHANGE_COOKIE}=${payload}.${signature}; Path=/auth/sso/exchange; Max-Age=90; HttpOnly; Secure; SameSite=Lax`;
}

function readExchangeCookie(cookieHeader, secret) {
  const value = cookieHeader?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${EXCHANGE_COOKIE}=`))
    ?.slice(EXCHANGE_COOKIE.length + 1);
  if (!value) return null;

  const separator = value.lastIndexOf(".");
  if (separator < 1) return null;
  const payload = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  const expected = createHmac("sha256", secret).update(payload).digest();
  let actual;
  try {
    actual = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;

  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof decoded.tokenHash !== "string" || typeof decoded.accountId !== "string" ||
        !Number.isFinite(decoded.expiresAt) || decoded.expiresAt <= Date.now()) return null;
    return decoded;
  } catch {
    return null;
  }
}

async function consumeHandoff(token, secret, env, fetchImpl, replayStore) {
  const handoff = readHandoff(token, secret);
  if (!handoff) {
    throw Object.assign(new Error("The SSO handoff is invalid or expired."), { status: 401 });
  }

  const config = getSupabaseConfig(env);
  const accountQuery = new URLSearchParams({
    select: "id,owner_user_id",
    id: `eq.${handoff.accountId}`,
    owner_user_id: `eq.${handoff.ownerUserId}`,
    status: "eq.active",
    is_active: "eq.true",
    limit: "1",
  });
  const accounts = await callSupabase(fetchImpl, config, `/rest/v1/trading_accounts?${accountQuery}`);
  if (!Array.isArray(accounts) || accounts.length !== 1) {
    throw Object.assign(new Error("The terminal account is no longer active or authorized."), { status: 403 });
  }

  if (!await replayStore.consume(handoff.jti, handoff.expiresAt)) {
    throw Object.assign(new Error("The SSO handoff is invalid, expired, or already used."), { status: 401 });
  }
  return handoff;
}

export function createTerminalSsoHandlers({
  fetchImpl = fetch,
  env = process.env,
  replayStore = createRedisReplayStore(env.REDIS_URL),
} = {}) {
  async function generate(req) {
    const sharedKey = env.SSO_API_KEY || env.SSO_SHARED_SECRET;
    if (!sharedKey) {
      console.error("[Terminal SSO] SSO API key is not configured");
      return jsonResponse(503, { error: "Terminal SSO service is not configured." });
    }
    if (!equalSecret(req.headers["x-sso-api-key"], sharedKey)) {
      console.error("[Terminal SSO] SSO API key was rejected");
      return jsonResponse(401, { error: "Unauthorized" });
    }

    const startedAt = Date.now();
    try {
      const body = JSON.parse(await readBody(req));
      const externalAccountId = typeof body.accountId === "string" ? body.accountId.trim() : "";
      if (!externalAccountId || externalAccountId.length > 128) {
        return jsonResponse(400, { error: "A valid accountId is required." });
      }

      const config = getSupabaseConfig(env);
      const accountQuery = new URLSearchParams({
        select: "id,owner_user_id,status,is_active",
        external_account_id: `eq.${externalAccountId}`,
        status: "eq.active",
        is_active: "eq.true",
        limit: "2",
      });
      const accounts = await callSupabase(fetchImpl, config, `/rest/v1/trading_accounts?${accountQuery}`);
      if (!Array.isArray(accounts) || accounts.length !== 1) {
        console.warn("[Terminal SSO] Active account lookup did not return exactly one mapping", {
          matchCount: Array.isArray(accounts) ? accounts.length : null,
          accountFingerprint: fingerprint(externalAccountId),
        });
        return jsonResponse(403, { error: "No unique active terminal account matches this launch." });
      }

      const account = accounts[0];
      const userResponse = await callSupabase(
        fetchImpl,
        config,
        `/auth/v1/admin/users/${encodeURIComponent(account.owner_user_id)}`,
      );
      const user = userResponse?.user ?? userResponse?.data?.user ?? userResponse;
      if (!user || user.id !== account.owner_user_id || typeof user.email !== "string" || !user.email) {
        console.warn("[Terminal SSO] Mapped account owner identity lookup failed", {
          userFound: Boolean(user),
          ownerIdMatches: user?.id === account.owner_user_id,
          emailPresent: typeof user?.email === "string" && Boolean(user.email),
        });
        return jsonResponse(403, { error: "The mapped terminal account has no existing sign-in identity." });
      }

      const linkResponse = await callSupabase(fetchImpl, config, "/auth/v1/admin/generate_link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "magiclink",
          email: user.email,
        }),
      });
      const tokenHash = linkResponse?.properties?.hashed_token ?? linkResponse?.hashed_token;
      if (typeof tokenHash !== "string" || !tokenHash) {
        return jsonResponse(502, { error: "The terminal could not create a one-time sign-in." });
      }

      const token = signHandoff({
        jti: randomUUID(),
        iss: HANDOFF_ISSUER,
        aud: HANDOFF_AUDIENCE,
        tokenHash,
        accountId: account.id,
        ownerUserId: account.owner_user_id,
        expiresAt: Date.now() + HANDOFF_TTL_SECONDS * 1000,
      }, sharedKey);
      return jsonResponse(200, { success: true, token, expiresIn: HANDOFF_TTL_SECONDS });
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 500;
      const causeCode = error?.causeCode;
      console.error(`[Terminal SSO] Handoff generation failed ${JSON.stringify({
        status,
        durationMs: Date.now() - startedAt,
        errorName: typeof error?.name === "string" ? error.name : "UnknownError",
        ...(typeof causeCode === "string" && /^[A-Z0-9_]+$/.test(causeCode) ? { causeCode } : {}),
        ...(Number.isInteger(error?.upstreamStatus) ? { upstreamStatus: error.upstreamStatus } : {}),
        ...(typeof error?.upstreamPath === "string" ? { upstreamPath: error.upstreamPath } : {}),
      })}`);
      return jsonResponse(status, { error: status < 500 ? error.message : "Terminal SSO generation failed." });
    }
  }

  async function callback(req) {
    const sharedKey = env.SSO_API_KEY || env.SSO_SHARED_SECRET;
    if (!sharedKey) return jsonResponse(503, { error: "Terminal SSO service is not configured." });

    try {
      const contentType = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
      if (contentType !== "application/x-www-form-urlencoded") {
        return jsonResponse(415, { error: "Expected a form-encoded SSO handoff." });
      }
      const form = new URLSearchParams(await readBody(req));
      const token = form.get("token");
      if (!token || token.length > 2048) return jsonResponse(400, { error: "A valid SSO handoff is required." });

      const handoff = await consumeHandoff(token, sharedKey, env, fetchImpl, replayStore);

      const expiresAt = Date.now() + 90_000;
      return {
        status: 303,
        headers: {
          "Cache-Control": "no-store",
          "Set-Cookie": makeExchangeCookie(handoff.tokenHash, handoff.accountId, sharedKey, expiresAt),
          Location: "/auth/sso/complete",
        },
        body: "",
      };
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 500;
      return jsonResponse(status, { error: status < 500 ? error.message : "Terminal SSO callback failed." });
    }
  }

  async function browserCallback(req) {
    const corsHeaders = req.headers.origin === CHART_ORIGIN
      ? { "Access-Control-Allow-Origin": CHART_ORIGIN, "Vary": "Origin", "Cache-Control": "no-store" }
      : {};
    if (req.headers.origin !== CHART_ORIGIN) {
      return jsonResponse(403, { error: "The SSO callback origin is not allowed." });
    }

    const sharedKey = env.SSO_API_KEY || env.SSO_SHARED_SECRET;
    if (!sharedKey) {
      return jsonResponse(503, { error: "Terminal SSO service is not configured." }, corsHeaders);
    }

    try {
      const contentType = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
      if (contentType !== "application/x-www-form-urlencoded") {
        return jsonResponse(415, { error: "Expected a form-encoded SSO handoff." }, corsHeaders);
      }

      const form = new URLSearchParams(await readBody(req));
      const token = form.get("token");
      if (!token || token.length > 2048) {
        return jsonResponse(400, { error: "A valid SSO handoff is required." }, corsHeaders);
      }

      const handoff = await consumeHandoff(token, sharedKey, env, fetchImpl, replayStore);
      return jsonResponse(200, {
        tokenHash: handoff.tokenHash,
        accountId: handoff.accountId,
      }, corsHeaders);
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 500;
      return jsonResponse(status, {
        error: status < 500 ? error.message : "Terminal SSO callback failed.",
      }, corsHeaders);
    }
  }

  async function exchange(req) {
    const clearCookie = `${EXCHANGE_COOKIE}=; Path=/auth/sso/exchange; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
    const sharedKey = env.SSO_API_KEY || env.SSO_SHARED_SECRET;
    if (!sharedKey) return jsonResponse(503, { error: "Terminal SSO service is not configured." }, { "Set-Cookie": clearCookie });
    let requestOrigin = req.headers.origin;
    if (!requestOrigin && req.headers.referer) {
      try {
        requestOrigin = new URL(req.headers.referer).origin;
      } catch {
        requestOrigin = "";
      }
    }
    if (requestOrigin !== CHART_ORIGIN) {
      return jsonResponse(403, { error: "The SSO exchange origin is not allowed." }, { "Set-Cookie": clearCookie });
    }

    const payload = readExchangeCookie(req.headers.cookie, sharedKey);
    if (!payload) {
      return jsonResponse(401, { error: "The one-time SSO exchange is missing or expired." }, { "Set-Cookie": clearCookie });
    }
    return jsonResponse(200, {
      tokenHash: payload.tokenHash,
      accountId: payload.accountId,
    }, {
      "Cache-Control": "no-store",
      "Set-Cookie": clearCookie,
    });
  }

  return { generate, callback, browserCallback, exchange };
}
