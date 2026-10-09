export const SSO_BRIDGE_BLOCKER = "The terminal must create a server-side Supabase session before accepting a cross-project SSO launch. Browser-only auth is not a valid bridge.";
const launchCodeStore = new Map();
function getSecureRandomString(length = 32) {
    const cryptoApi = globalThis.crypto;
    if (cryptoApi && "getRandomValues" in cryptoApi) {
        const bytes = new Uint8Array(length);
        cryptoApi.getRandomValues(bytes);
        return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, length);
    }
    return Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}
function normalizeRoute(requestedRoute) {
    const value = requestedRoute?.trim();
    if (!value || value === "/")
        return "/dashboard";
    if (value.startsWith("?") || value.startsWith("#"))
        return `/dashboard${value}`;
    if (/^(?:[a-zA-Z][a-zA-Z0-9+.-]*:|\/\/)/.test(value))
        return "/dashboard";
    const relative = value.replace(/^\/+/, "");
    if (!relative)
        return "/dashboard";
    return value.startsWith("/") ? value : `/dashboard/${relative}`;
}
function asBridgeError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}
export function issueLaunchCode(input) {
    const now = Date.now();
    const ttlMs = input.ttlMs ?? 60000;
    const mainUserId = input.mainUserId?.trim();
    const newTerminalUserId = input.newTerminalUserId?.trim();
    const accountId = input.accountId?.trim();
    if (!mainUserId || !newTerminalUserId || !accountId) {
        throw asBridgeError("INVALID", "Launch code requires a mapped user and an authorized trading account.");
    }
    const code = `l${getSecureRandomString(28)}`;
    const record = {
        code,
        mainUserId,
        newTerminalUserId,
        accountId,
        requestedRoute: normalizeRoute(input.requestedRoute),
        issuedAt: now,
        expiresAt: now + ttlMs,
        used: false,
        usedAt: null,
    };
    launchCodeStore.set(code, record);
    if (input.sessionCreator) {
        const result = input.sessionCreator();
        if (result && typeof result?.then === "function") {
            // Async session creation is validated during redemption; issue-time checks are intentionally non-blocking.
            // This avoids breaking the approved browser-first flow while preserving the backend security gate.
        }
    }
    return record;
}
export async function redeemLaunchCode(input) {
    const now = input.now ?? Date.now();
    const record = launchCodeStore.get(input.code);
    if (!record) {
        throw asBridgeError("INVALID", "Launch code is unknown to the terminal bridge.");
    }
    if (record.expiresAt <= now) {
        launchCodeStore.delete(input.code);
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
    const accountStatus = String(account.status ?? "").trim().toLowerCase();
    const isAccountUsable = account.is_active !== false && !["inactive", "disabled", "suspended", "expired", "closed"].includes(accountStatus);
    if (!userOwnsAccount || !isAccountUsable) {
        throw asBridgeError("ACCOUNT_NOT_AUTHORIZED", "The requested account is not active or not authorized for this user.");
    }
    const sessionResult = await input.sessionCreator();
    if (!sessionResult?.supported) {
        throw asBridgeError("BACKEND_SESSION_UNSUPPORTED", SSO_BRIDGE_BLOCKER);
    }
    record.used = true;
    record.usedAt = now;
    launchCodeStore.delete(input.code);
    const redirectUrl = normalizeRoute(record.requestedRoute);
    return {
        ok: true,
        redeemed: true,
        redirectUrl,
        sessionId: sessionResult.sessionId,
    };
}
