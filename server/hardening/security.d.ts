export interface VerifiedPrincipal {
    subject: string;
    roles?: readonly string[];
}
export type AccountAuthorization = {
    allowed: true;
} | {
    allowed: false;
    reason: "unauthenticated" | "invalid_account" | "account_forbidden";
};
export declare function authorizeAccountAccess(principal: VerifiedPrincipal | null | undefined, accountId: string, resolveOwner: (accountId: string) => Promise<string | null>): Promise<AccountAuthorization>;
export interface RateLimitDecision {
    allowed: boolean;
    remaining: number;
    resetAt: number;
}
export interface RateLimitStore {
    consume(key: string, limit: number, windowMs: number, now?: number): Promise<RateLimitDecision>;
}
export declare class InMemoryRateLimitStore implements RateLimitStore {
    private readonly maxKeys;
    private readonly entries;
    private calls;
    constructor(maxKeys?: number);
    consume(key: string, limit: number, windowMs: number, now?: number): Promise<RateLimitDecision>;
    private prune;
}
export declare function accountRateLimitKey(subject: string, accountId: string, action: string): string;
export type IdempotentCommandResult<T> = {
    status: "created" | "replayed";
    value: T;
} | {
    status: "conflict";
};
export interface CommandIdempotencyStore {
    /** Implementations must atomically bind the account/key to a canonical fingerprint and result. */
    executeOnce<T>(accountId: string, key: string, fingerprint: string, operation: () => Promise<T>): Promise<IdempotentCommandResult<T>>;
}
export declare class InMemoryCommandIdempotencyStore implements CommandIdempotencyStore {
    private readonly records;
    executeOnce<T>(accountId: string, key: string, fingerprint: string, operation: () => Promise<T>): Promise<IdempotentCommandResult<T>>;
}
