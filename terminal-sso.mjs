import { createHmac, timingSafeEqual } from "node:crypto";

const CHART_ORIGIN = "https://charts.fundedwealth.com";
const HANDOFF_TTL_SECONDS = 60;
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
  const serviceKey = env.SUPABASE_SECRET_KEY;
  if (!baseUrl || !serviceKey) {
    throw Object.assign(new Error("Terminal SSO service is not configured."), { status: 503 });
  }
  return { baseUrl, serviceKey };
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
        !Number.isFinite(payload.expiresAt) || payload.expiresAt <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
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
  } catch {
    throw Object.assign(new Error("Terminal SSO database request failed."), { status: 503 });
  }
  if (!response.ok) {
    throw Object.assign(new Error("Terminal SSO database request failed."), { status: 502 });
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

export function createTerminalSsoHandlers({ fetchImpl = fetch, env = process.env } = {}) {
  async function generate(req) {
    const sharedKey = env.SSO_API_KEY || env.SSO_SHARED_SECRET;
    if (!sharedKey) return jsonResponse(503, { error: "Terminal SSO service is not configured." });
    if (!equalSecret(req.headers["x-sso-api-key"], sharedKey)) {
      return jsonResponse(401, { error: "Unauthorized" });
    }

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
        tokenHash,
        accountId: account.id,
        ownerUserId: account.owner_user_id,
        expiresAt: Date.now() + HANDOFF_TTL_SECONDS * 1000,
      }, sharedKey);
      return jsonResponse(200, { success: true, token, expiresIn: HANDOFF_TTL_SECONDS });
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 500;
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

      const config = getSupabaseConfig(env);
      const handoff = readHandoff(token, sharedKey);
      if (!handoff) {
        return jsonResponse(401, { error: "The SSO handoff is invalid or expired." });
      }

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
        return jsonResponse(403, { error: "The terminal account is no longer active or authorized." });
      }

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

  return { generate, callback, exchange };
}
