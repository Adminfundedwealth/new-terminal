export type ExecutionErrorCategory = "timeout" | "network" | "authentication" | "rate_limit" | "validation" | "conflict" | "database" | "unknown";
export interface ClassifiedExecutionError {
    category: ExecutionErrorCategory;
    code: string;
    retryable: boolean;
    requiresReconciliation: boolean;
}
export declare class ExecutionBoundaryError extends Error {
    readonly category: ExecutionErrorCategory;
    readonly requiresReconciliation: boolean;
    constructor(category: ExecutionErrorCategory, message: string, requiresReconciliation?: boolean);
}
export declare function classifyExecutionError(error: unknown): ClassifiedExecutionError;
export declare function withExecutionTimeout<T>(operation: Promise<T>, timeoutMs: number, label?: string): Promise<T>;
export type RecoveryAction = "wait" | "retry" | "reconcile" | "manual_review";
export interface RecoveryInput {
    claimExpired: boolean;
    submissionStarted: boolean;
    attempts: number;
    maxAttempts: number;
    providerLookup: "not_checked" | "found" | "not_found" | "unavailable";
}
export declare function decideRestartRecovery(input: RecoveryInput): RecoveryAction;
export interface TransactionalFillDeduplicator<TFill> {
    /** Implementations must persist the unique key and effects in one database transaction. */
    applyFillOnce(accountId: string, executionId: string, fill: TFill): Promise<"applied" | "duplicate">;
}
export declare class InMemoryFillDeduplicator<TFill> implements TransactionalFillDeduplicator<TFill> {
    private readonly fills;
    applyFillOnce(accountId: string, executionId: string, fill: TFill): Promise<"applied" | "duplicate">;
}
