export interface VerifiedPrincipal {
  subject: string;
  roles?: readonly string[];
}

export type AccountAuthorization =
  | { allowed: true }
  | { allowed: false; reason: "unauthenticated" | "invalid_account" | "account_forbidden" };

export async function authorizeAccountAccess(
  principal: VerifiedPrincipal | null | undefined,
  accountId: string,
  resolveOwner: (accountId: string) => Promise<string | null>,
): Promise<AccountAuthorization> {
  if (!principal?.subject?.trim()) return { allowed: false, reason: "unauthenticated" };
  if (!accountId?.trim()) return { allowed: false, reason: "invalid_account" };
  const ownerId = await resolveOwner(accountId);
  return ownerId === principal.subject
    ? { allowed: true }
    : { allowed: false, reason: "account_forbidden" };
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export interface RateLimitStore {
  consume(key: string, limit: number, windowMs: number, now?: number): Promise<RateLimitDecision>;
}

interface FixedWindowEntry {
  count: number;
  resetAt: number;
}

export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly entries = new Map<string, FixedWindowEntry>();
  private calls = 0;

  constructor(private readonly maxKeys = 10_000) {
    if (!Number.isInteger(maxKeys) || maxKeys < 1) throw new RangeError("maxKeys must be a positive integer");
  }

  async consume(key: string, limit: number, windowMs: number, now = Date.now()): Promise<RateLimitDecision> {
    if (!key.trim() || !Number.isInteger(limit) || limit < 1 || !Number.isFinite(windowMs) || windowMs <= 0) {
      throw new TypeError("A key, positive limit, and positive window are required");
    }

    this.calls += 1;
    if (this.calls % 128 === 0 || this.entries.size >= this.maxKeys) this.prune(now);

    let entry = this.entries.get(key);
    if (!entry || entry.resetAt <= now) {
      if (!entry && this.entries.size >= this.maxKeys) return { allowed: false, remaining: 0, resetAt: now + windowMs };
      entry = { count: 0, resetAt: now + windowMs };
      this.entries.set(key, entry);
    }

    if (entry.count >= limit) return { allowed: false, remaining: 0, resetAt: entry.resetAt };
    entry.count += 1;
    return { allowed: true, remaining: limit - entry.count, resetAt: entry.resetAt };
  }

  private prune(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.resetAt <= now) this.entries.delete(key);
    }
  }
}

export function accountRateLimitKey(subject: string, accountId: string, action: string): string {
  if (!subject.trim() || !accountId.trim() || !action.trim()) throw new TypeError("Authenticated rate-limit dimensions are required");
  return `${subject}:${accountId}:${action}`;
}

export type IdempotentCommandResult<T> =
  | { status: "created" | "replayed"; value: T }
  | { status: "conflict" };

export interface CommandIdempotencyStore {
  /** Implementations must atomically bind the account/key to a canonical fingerprint and result. */
  executeOnce<T>(accountId: string, key: string, fingerprint: string, operation: () => Promise<T>): Promise<IdempotentCommandResult<T>>;
}

export class InMemoryCommandIdempotencyStore implements CommandIdempotencyStore {
  private readonly records = new Map<string, { fingerprint: string; result: Promise<unknown> }>();

  async executeOnce<T>(accountId: string, key: string, fingerprint: string, operation: () => Promise<T>): Promise<IdempotentCommandResult<T>> {
    if (!accountId.trim() || !key.trim() || !fingerprint.trim()) throw new TypeError("Account, idempotency key, and fingerprint are required");
    const compoundKey = `${accountId}\u0000${key}`;
    const existing = this.records.get(compoundKey);
    if (existing) {
      if (existing.fingerprint !== fingerprint) return { status: "conflict" };
      return { status: "replayed", value: await existing.result as T };
    }

    const result = Promise.resolve().then(operation);
    this.records.set(compoundKey, { fingerprint, result });
    try {
      return { status: "created", value: await result };
    } catch (error) {
      if (this.records.get(compoundKey)?.result === result) this.records.delete(compoundKey);
      throw error;
    }
  }
}