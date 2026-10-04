export type ExecutionSide = "BUY" | "SELL";
export type OutboxStatus = "PENDING" | "PROCESSING" | "DONE" | "FAILED" | "REJECTED";
export type ProviderExecutionState = "ACK" | "PENDING" | "PARTIALLY_FILLED" | "FILLED" | "REJECTED" | "UNKNOWN";
export type ExecutionSubmissionState = "queued" | "started" | "acknowledged" | "filled" | "rejected" | "failed";
export interface ExecutionCommand {
    id: string;
    order_id: string;
    account_id: string;
    client_order_id: string;
    user_id: string;
    broker_id?: string;
    provider: "mock-safe";
    symbol: string;
    exchange: string;
    segment?: string;
    side: ExecutionSide;
    quantity: number;
    order_type: string;
    price?: number;
    trigger_price?: number;
    product?: string;
    is_overnight?: boolean;
    requested_at: string;
}
export interface ProviderExecutionFill {
    brokerExecutionId: string;
    brokerOrderId: string;
    localOrderId: string;
    accountId: string;
    symbol: string;
    side: ExecutionSide;
    quantity: number;
    price: number;
    executedAt: string;
    fees?: number;
}
export interface ProviderExecutionResult {
    ok: boolean;
    state: ProviderExecutionState;
    broker_order_id: string;
    client_order_id: string;
    message?: string;
    fills?: ProviderExecutionFill[];
    status?: ProviderExecutionState | string;
    brokerOrderId?: string;
    provider_state?: string;
}
export interface ExecutionOutboxRecord {
    id: string;
    order_id: string;
    account_id: string;
    client_order_id: string;
    status: OutboxStatus;
    state?: OutboxStatus | string;
    available_at: string;
    created_at: string;
    updated_at: string;
    submitted_at?: string | null;
    attempts: number;
    attempt_count?: number;
    retry_count?: number;
    payload: ExecutionCommand;
    last_error?: string | null;
    claimed_by?: string | null;
    claimed_until?: string | null;
    provider_name?: string | null;
    provider_order_id?: string | null;
    submission_state?: ExecutionSubmissionState | string;
    recovery_only?: boolean;
    filled_events?: Array<ProviderExecutionFill | Record<string, unknown>>;
    audit_entries?: Record<string, unknown>[];
}
export interface ExecutionOutboxRow extends ExecutionOutboxRecord {
    provider_order_id?: string | null;
    state?: string;
    submission_state?: string;
    filled_events?: Array<ProviderExecutionFill | Record<string, unknown>>;
    audit_entries?: Record<string, unknown>[];
}
export interface ExecutionAuditTrail {
    id: string;
    order_id: string;
    account_id: string;
    client_order_id: string;
    event: string;
    provider: string;
    status: string;
    details: Record<string, unknown>;
    created_at: string;
}
export interface ExecutionClaimScope {
    accountId: string;
    orderId: string;
}
export interface ExecutionRepository {
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
}
export interface ProviderExecutionAdapter {
    readonly providerName: string;
    readonly mode: "MOCK_SAFE";
    submitOrder(command: ExecutionCommand): Promise<ProviderExecutionResult>;
    getOrderStatus(clientOrderId: string): Promise<ProviderExecutionResult | null>;
}
export interface ExecutionWorkerResult {
    record: ExecutionOutboxRecord | null;
    providerResult: ProviderExecutionResult;
    status: "processed" | "rejected" | "failed";
    claimed?: boolean;
    state?: string;
    outbox?: ExecutionOutboxRecord | null;
    reason?: string;
}
