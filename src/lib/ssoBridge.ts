export const SSO_BRIDGE_BLOCKER =
  "The terminal must create a server-side Supabase session before accepting a cross-project SSO launch. Browser-only auth is not a valid bridge.";

export interface SessionCreationResult {
  supported: boolean;
  sessionId?: string;
  reason?: string;
}

export interface BridgeUserRecord {
  mainUserId: string;
  newTerminalUserId: string;
  email: string;
}

export interface BridgeAccountRecord {
  id: string;
  owner_user_id: string;
  account_code: string;
  status: string;
  is_active: boolean;
  product_id?: string;
  phase_id?: string;
  permissions?: Record<string, boolean>;
}

export interface LaunchCodeRecord {
  code: string;
  mainUserId: string;
  newTerminalUserId: string;
  accountId: string;
  requestedRoute: string;
  issuedAt: number;
  expiresAt: number;
  used: boolean;
  usedAt: number | null;
}

export interface IssueLaunchCodeInput {
  mainUserId: string;
  newTerminalUserId: string;
  accountId: string;
  requestedRoute?: string;
  ttlMs?: number;
  sessionCreator?: () => Promise<SessionCreationResult> | SessionCreationResult;
}

export interface RedeemLaunchCodeInput {
  code: string;
  mainUserId: string;
  newTerminalUserId: string;
  requestedAccountId: string;
  userResolver: () => Promise<BridgeUserRecord | null> | BridgeUserRecord | null;
  accountResolver: () => Promise<BridgeAccountRecord | null> | BridgeAccountRecord | null;
  sessionCreator: () => Promise<SessionCreationResult> | SessionCreationResult;
  now?: number;
}

const launchCodeStore = new Map<string, LaunchCodeRecord>();

function getSecureRandomString(length = 32): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && "getRandomValues" in cryptoApi) {
    const bytes = new Uint8Array(length);
    cryptoApi.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, length);
  }

  return Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

function normalizeRoute(requestedRoute?: string): string {
  const value = requestedRoute?.trim();
  if (!value || value === "/") return "/dashboard";
  return value.startsWith("/") ? value : `/dashboard${value.startsWith("?") ? "" : ""}`;
}

function asBridgeError(code: string, message: string) {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

export function issueLaunchCode(input: IssueLaunchCodeInput): LaunchCodeRecord {
  const now = Date.now();
  const ttlMs = input.ttlMs ?? 60_000;
  const code = `l${getSecureRandomString(28)}`;

  const record: LaunchCodeRecord = {
    code,
    mainUserId: input.mainUserId,
    newTerminalUserId: input.newTerminalUserId,
    accountId: input.accountId,
    requestedRoute: normalizeRoute(input.requestedRoute),
    issuedAt: now,
    expiresAt: now + ttlMs,
    used: false,
    usedAt: null,
  };

  launchCodeStore.set(code, record);

  if (input.sessionCreator) {
    const result = input.sessionCreator();
    if (result && typeof (result as Promise<SessionCreationResult>)?.then === "function") {
      // Async session creation is validated during redemption; issue-time checks are intentionally non-blocking.
      // This avoids breaking the approved browser-first flow while preserving the backend security gate.
    }
  }

  return record;
}

export async function redeemLaunchCode(input: RedeemLaunchCodeInput): Promise<{ ok: true; redeemed: true; redirectUrl: string; sessionId?: string }> {
  const now = input.now ?? Date.now();
  const record = launchCodeStore.get(input.code);

  if (!record) {
    throw asBridgeError("INVALID", "Launch code is unknown to the terminal bridge.");
  }

  if (record.expiresAt <= now) {
    record.used = true;
    record.usedAt = now;
    throw asBridgeError("EXPIRED", "Launch code has expired and cannot be used.");
  }

  if (record.used) {
    throw asBridgeError("REPLAYED", "Launch code has already been redeemed once.");
  }

  if (record.mainUserId !== input.mainUserId || record.newTerminalUserId !== input.newTerminalUserId) {
    throw asBridgeError("USER_MISMATCH", "Launch code does not belong to the supplied user identity.");
  }

  if (record.accountId !== input.requestedAccountId) {
    throw asBridgeError("ACCOUNT_NOT_AUTHORIZED", "Launch code does not authorize the requested account.");
  }

  const user = await input.userResolver();
  if (!user || user.mainUserId !== input.mainUserId || user.newTerminalUserId !== input.newTerminalUserId) {
    throw asBridgeError("USER_MISMATCH", "The mapped New Terminal user does not match the launch code.");
  }

  const account = await input.accountResolver();
  if (!account || account.id !== input.requestedAccountId) {
    throw asBridgeError("ACCOUNT_NOT_AUTHORIZED", "The requested account is missing or not assigned to the bridge user.");
  }

  const userOwnsAccount = account.owner_user_id === user.newTerminalUserId;
  const isAccountUsable = account.is_active !== false && account.status !== "inactive" && account.status !== "disabled";
  if (!userOwnsAccount || !isAccountUsable) {
    throw asBridgeError("ACCOUNT_NOT_AUTHORIZED", "The requested account is not active or not authorized for this user.");
  }

  const sessionResult = await input.sessionCreator();
  if (!sessionResult?.supported) {
    throw asBridgeError("BACKEND_SESSION_UNSUPPORTED", SSO_BRIDGE_BLOCKER);
  }

  record.used = true;
  record.usedAt = now;
  const redirectUrl = normalizeRoute(record.requestedRoute);

  return {
    ok: true,
    redeemed: true,
    redirectUrl,
    sessionId: sessionResult.sessionId,
  };
}
