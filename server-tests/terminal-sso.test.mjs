import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { Readable } from "node:stream";
import test from "node:test";
import { createTerminalSsoHandlers } from "../terminal-sso.mjs";

const secret = "test-only-shared-key";
const account = { id: "terminal-account-1", owner_user_id: "terminal-user-1", status: "active", is_active: true };
const user = { id: account.owner_user_id, email: "existing@example.test" };

function makeReplayStore() {
  const consumed = new Set();
  return {
    async consume(jti) {
      if (consumed.has(jti)) return false;
      consumed.add(jti);
      return true;
    },
  };
}

function signHandoff(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function request(body = "", headers = {}) {
  const stream = Readable.from([Buffer.from(body)]);
  stream.headers = headers;
  return stream;
}

function makeFetch() {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const path = new URL(url).pathname;
    if (path.endsWith("/trading_accounts")) {
      return Response.json([account]);
    }
    if (path.endsWith("/admin/users/terminal-user-1")) {
      return Response.json(user);
    }
    if (path.endsWith("/admin/generate_link")) {
      return Response.json({ properties: { hashed_token: "one-time-supabase-token-hash" } });
    }
    throw new Error(`Unexpected mocked request: ${path}`);
  };
  return { fetchImpl, calls };
}

async function generateToken(handlers) {
  const result = await handlers.generate(request(JSON.stringify({ accountId: "external-account-1" }), {
    "x-sso-api-key": secret,
  }));
  assert.equal(result.status, 200);
  return JSON.parse(result.body).token;
}

test("creates a one-time handoff only for the authenticated server caller", async () => {
  const { fetchImpl, calls } = makeFetch();
  const handlers = createTerminalSsoHandlers({
    fetchImpl,
    env: { SSO_API_KEY: secret, SUPABASE_URL: "https://db.example.test", SUPABASE_SERVICE_ROLE_KEY: "service-role-key" },
  });
  const denied = await handlers.generate(request(JSON.stringify({ accountId: "external-account-1" }), {
    "x-sso-api-key": "wrong",
  }));
  assert.equal(denied.status, 401);
  assert.equal(calls.length, 0);

  const generated = await handlers.generate(request(JSON.stringify({ accountId: "external-account-1" }), {
    "x-sso-api-key": secret,
  }));
  assert.equal(generated.status, 200);
  const body = JSON.parse(generated.body);
  assert.equal(body.success, true);
  assert.equal(body.expiresIn, 60);
  assert.equal(typeof body.token, "string");
  const handoff = JSON.parse(Buffer.from(body.token.split(".")[0], "base64url").toString("utf8"));
  assert.equal(handoff.iss, "fundedwealth-dashboard");
  assert.equal(handoff.aud, "fundedwealth-terminal");
  assert.match(handoff.jti, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.ok(handoff.expiresAt > Date.now());
  assert.ok(calls.some(({ url, init }) => url.includes("/auth/v1/admin/generate_link") && init.method === "POST"));
  assert.equal(calls[0].init.headers.apikey, "service-role-key");
  assert.equal(calls[0].init.headers.Authorization, "Bearer service-role-key");
});

test("rejects a mapping whose owner identity cannot be resolved", async () => {
  let generatedLink = false;
  const fetchImpl = async (url) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/trading_accounts")) return Response.json([account]);
    if (path.endsWith("/admin/users/terminal-user-1")) return Response.json({ id: "different-user", email: user.email });
    if (path.endsWith("/admin/generate_link")) generatedLink = true;
    throw new Error(`Unexpected mocked request: ${path}`);
  };
  const handlers = createTerminalSsoHandlers({
    fetchImpl,
    env: { SSO_API_KEY: secret, SUPABASE_URL: "https://db.example.test", SUPABASE_SECRET_KEY: "service-key" },
  });

  const result = await handlers.generate(request(JSON.stringify({ accountId: "external-account-1" }), {
    "x-sso-api-key": secret,
  }));

  assert.equal(result.status, 403);
  assert.equal(generatedLink, false);
});

test("validates the signed handoff and exchanges it for an existing-user Supabase OTP", async () => {
  const { fetchImpl } = makeFetch();
  const handlers = createTerminalSsoHandlers({
    fetchImpl,
    env: { SSO_API_KEY: secret, SUPABASE_URL: "https://db.example.test", SUPABASE_SECRET_KEY: "service-key" },
    replayStore: makeReplayStore(),
  });

  const token = await generateToken(handlers);
  const callbackBody = `token=${encodeURIComponent(token)}`;
  const callback = await handlers.callback(request(callbackBody, {
    "content-type": "application/x-www-form-urlencoded",
  }));
  assert.equal(callback.status, 303);
  assert.equal(callback.headers.Location, "/auth/sso/complete");
  assert.match(callback.headers["Set-Cookie"], /HttpOnly; Secure; SameSite=Lax/);
  assert.doesNotMatch(callback.headers.Location, /token|account/i);

  const replay = await handlers.callback(request(callbackBody, {
    "content-type": "application/x-www-form-urlencoded",
  }));
  assert.equal(replay.status, 401);
  assert.equal(replay.headers["Set-Cookie"], undefined);

  const cookie = callback.headers["Set-Cookie"].split(";")[0];
  const exchange = await handlers.exchange(request("", {
    cookie,
    referer: "https://charts.fundedwealth.com/auth/sso/complete",
  }));
  assert.equal(exchange.status, 200);
  assert.deepEqual(JSON.parse(exchange.body), {
    tokenHash: "one-time-supabase-token-hash",
    accountId: account.id,
  });

  const tampered = `${token.slice(0, -1)}x`;
  const rejected = await handlers.callback(request(`token=${encodeURIComponent(tampered)}`, {
    "content-type": "application/x-www-form-urlencoded",
  }));
  assert.equal(rejected.status, 401);
});

test("browser callback is origin-bound and consumes the handoff once", async () => {
  const { fetchImpl } = makeFetch();
  const handlers = createTerminalSsoHandlers({
    fetchImpl,
    env: { SSO_API_KEY: secret, SUPABASE_URL: "https://db.example.test", SUPABASE_SECRET_KEY: "service-key" },
    replayStore: makeReplayStore(),
  });
  const token = await generateToken(handlers);
  const body = `token=${encodeURIComponent(token)}`;

  const rejectedOrigin = await handlers.browserCallback(request(body, {
    origin: "https://attacker.example",
    "content-type": "application/x-www-form-urlencoded",
  }));
  assert.equal(rejectedOrigin.status, 403);

  const callback = await handlers.browserCallback(request(body, {
    origin: "https://charts.fundedwealth.com",
    "content-type": "application/x-www-form-urlencoded",
  }));
  assert.equal(callback.status, 200);
  assert.equal(callback.headers["Access-Control-Allow-Origin"], "https://charts.fundedwealth.com");
  assert.equal(callback.headers["Cache-Control"], "no-store");
  assert.deepEqual(JSON.parse(callback.body), {
    tokenHash: "one-time-supabase-token-hash",
    accountId: account.id,
  });
  assert.equal(callback.headers["Set-Cookie"], undefined);

  const replay = await handlers.browserCallback(request(body, {
    origin: "https://charts.fundedwealth.com",
    "content-type": "application/x-www-form-urlencoded",
  }));
  assert.equal(replay.status, 401);
});

test("rejects expired handoffs before they can be consumed", async () => {
  const { fetchImpl, calls } = makeFetch();
  const handlers = createTerminalSsoHandlers({
    fetchImpl,
    env: { SSO_API_KEY: secret, SUPABASE_URL: "https://db.example.test", SUPABASE_SECRET_KEY: "service-key" },
    replayStore: makeReplayStore(),
  });
  const token = signHandoff({
    jti: "123e4567-e89b-42d3-a456-426614174000",
    iss: "fundedwealth-dashboard",
    aud: "fundedwealth-terminal",
    tokenHash: "expired-token-hash",
    accountId: account.id,
    ownerUserId: account.owner_user_id,
    expiresAt: Date.now() - 1000,
  });

  const result = await handlers.callback(request(`token=${encodeURIComponent(token)}`, {
    "content-type": "application/x-www-form-urlencoded",
  }));

  assert.equal(result.status, 401);
  assert.equal(calls.length, 0);
});

test("fails closed when the replay store is unavailable", async () => {
  const { fetchImpl } = makeFetch();
  const handlers = createTerminalSsoHandlers({
    fetchImpl,
    env: { SSO_API_KEY: secret, SUPABASE_URL: "https://db.example.test", SUPABASE_SECRET_KEY: "service-key" },
    replayStore: {
      async consume() {
        throw Object.assign(new Error("Replay store unavailable"), { status: 503 });
      },
    },
  });
  const token = await generateToken(handlers);

  const result = await handlers.callback(request(`token=${encodeURIComponent(token)}`, {
    "content-type": "application/x-www-form-urlencoded",
  }));

  assert.equal(result.status, 503);
  assert.equal(result.headers["Set-Cookie"], undefined);
});

test("rejects cross-origin OTP exchange requests", async () => {
  const handlers = createTerminalSsoHandlers({ env: { SSO_API_KEY: secret } });
  const result = await handlers.exchange(request("", {
    cookie: "fw_sso_exchange=not-a-valid-cookie",
    origin: "https://attacker.example",
  }));
  assert.equal(result.status, 403);
  assert.match(result.headers["Set-Cookie"], /Max-Age=0/);
});
