export async function authorizeAccountAccess(principal, accountId, resolveOwner) {
    if (!principal?.subject?.trim())
        return { allowed: false, reason: "unauthenticated" };
    if (!accountId?.trim())
        return { allowed: false, reason: "invalid_account" };
    const ownerId = await resolveOwner(accountId);
    return ownerId === principal.subject
        ? { allowed: true }
        : { allowed: false, reason: "account_forbidden" };
}
export class InMemoryRateLimitStore {
    constructor(maxKeys = 10000) {
        Object.defineProperty(this, "maxKeys", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: maxKeys
        });
        Object.defineProperty(this, "entries", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new Map()
        });
        Object.defineProperty(this, "calls", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 0
        });
        if (!Number.isInteger(maxKeys) || maxKeys < 1)
            throw new RangeError("maxKeys must be a positive integer");
    }
    async consume(key, limit, windowMs, now = Date.now()) {
        if (!key.trim() || !Number.isInteger(limit) || limit < 1 || !Number.isFinite(windowMs) || windowMs <= 0) {
            throw new TypeError("A key, positive limit, and positive window are required");
        }
        this.calls += 1;
        if (this.calls % 128 === 0 || this.entries.size >= this.maxKeys)
            this.prune(now);
        let entry = this.entries.get(key);
        if (!entry || entry.resetAt <= now) {
            if (!entry && this.entries.size >= this.maxKeys)
                return { allowed: false, remaining: 0, resetAt: now + windowMs };
            entry = { count: 0, resetAt: now + windowMs };
            this.entries.set(key, entry);
        }
        if (entry.count >= limit)
            return { allowed: false, remaining: 0, resetAt: entry.resetAt };
        entry.count += 1;
        return { allowed: true, remaining: limit - entry.count, resetAt: entry.resetAt };
    }
    prune(now) {
        for (const [key, entry] of this.entries) {
            if (entry.resetAt <= now)
                this.entries.delete(key);
        }
    }
}
export function accountRateLimitKey(subject, accountId, action) {
    if (!subject.trim() || !accountId.trim() || !action.trim())
        throw new TypeError("Authenticated rate-limit dimensions are required");
    return `${subject}:${accountId}:${action}`;
}
export class InMemoryCommandIdempotencyStore {
    constructor() {
        Object.defineProperty(this, "records", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new Map()
        });
    }
    async executeOnce(accountId, key, fingerprint, operation) {
        if (!accountId.trim() || !key.trim() || !fingerprint.trim())
            throw new TypeError("Account, idempotency key, and fingerprint are required");
        const compoundKey = `${accountId}\u0000${key}`;
        const existing = this.records.get(compoundKey);
        if (existing) {
            if (existing.fingerprint !== fingerprint)
                return { status: "conflict" };
            return { status: "replayed", value: await existing.result };
        }
        const result = Promise.resolve().then(operation);
        this.records.set(compoundKey, { fingerprint, result });
        try {
            return { status: "created", value: await result };
        }
        catch (error) {
            if (this.records.get(compoundKey)?.result === result)
                this.records.delete(compoundKey);
            throw error;
        }
    }
}
