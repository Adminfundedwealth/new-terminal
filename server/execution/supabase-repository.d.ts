import type { ExecutionAuditTrail, ExecutionClaimScope, ExecutionOutboxRecord, ExecutionRepository, ProviderExecutionResult } from "./types";
export interface SupabaseExecutionClient {
    rpc(name: string, args?: Record<string, unknown>): PromiseLike<{
        data: unknown;
        error: unknown;
    }>;
    from(table: string): any;
}
export type ProviderAckCommittedHook = (recordId: string) => Promise<void>;
export declare class InMemoryExecutionRepository implements ExecutionRepository {
    readonly rows: ExecutionOutboxRecord[];
    constructor(initialRows?: ExecutionOutboxRecord[]);
    fetchPending(limit?: number): Promise<ExecutionOutboxRecord[]>;
    claimNextPending(workerId?: string, scope?: ExecutionClaimScope): Promise<ExecutionOutboxRecord | null>;
    markSubmissionStarted(recordId: string, workerId: string, providerName: string): Promise<boolean>;
    authorizeRetryAfterLookup(recordId: string, workerId: string, maxAttempts: number): Promise<boolean>;
    markCompleted(recordId: string, result: ProviderExecutionResult): Promise<void>;
    markRejected(recordId: string, reason: string): Promise<void>;
    markFailed(recordId: string, reason: string, _workerId?: string): Promise<void>;
    appendAudit(entry: ExecutionAuditTrail): Promise<void>;
    upsertOrderState(orderId: string, patch: Partial<{
        status: string;
        broker_order_id: string | null;
        updated_at: string;
    }>): Promise<void>;
    seed(record: ExecutionOutboxRecord): void;
}
export declare function createMemoryExecutionRepository(initialRows?: ExecutionOutboxRecord[]): InMemoryExecutionRepository;
export declare class SupabaseExecutionRepository implements ExecutionRepository {
    private readonly serviceRoleClient;
    private readonly afterProviderAckCommitted?;
    constructor(serviceRoleClient: SupabaseExecutionClient, afterProviderAckCommitted?: ProviderAckCommittedHook);
    fetchPending(limit?: number): Promise<ExecutionOutboxRecord[]>;
    claimNextPending(workerId?: string, scope?: ExecutionClaimScope): Promise<ExecutionOutboxRecord | null>;
    markSubmissionStarted(recordId: string, workerId: string, providerName: string): Promise<boolean>;
    authorizeRetryAfterLookup(recordId: string, workerId: string, maxAttempts: number): Promise<boolean>;
    markCompleted(recordId: string, result: ProviderExecutionResult): Promise<void>;
    markRejected(recordId: string, reason: string): Promise<void>;
    markFailed(recordId: string, reason: string, workerId?: string): Promise<void>;
    appendAudit(entry: ExecutionAuditTrail): Promise<void>;
    upsertOrderState(orderId: string, patch: Partial<{
        status: string;
        broker_order_id: string | null;
        updated_at: string;
    }>): Promise<void>;
    private callRpc;
    private mapRecord;
}
