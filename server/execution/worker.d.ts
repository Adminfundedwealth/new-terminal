import type { ExecutionClaimScope, ExecutionRepository, ExecutionWorkerResult, ProviderExecutionAdapter } from "./types";
import { StructuredLogger, type ExecutionMetrics } from "../hardening";
export interface ExecutionWorkerOptions {
    maxAttempts?: number;
    providerName?: string;
    workerId?: string;
    providerTimeoutMs?: number;
    logger?: StructuredLogger;
    metrics?: ExecutionMetrics;
    claimScope?: ExecutionClaimScope;
}
export declare class ExecutionWorker {
    private readonly repository;
    private readonly provider;
    private readonly maxAttempts;
    private readonly workerId?;
    private readonly providerTimeoutMs;
    private readonly logger;
    private readonly metrics?;
    private readonly claimScope?;
    constructor(repository: ExecutionRepository, provider: ProviderExecutionAdapter, options?: ExecutionWorkerOptions);
    processNext(): Promise<ExecutionWorkerResult | null>;
    drain(limit?: number): Promise<ExecutionWorkerResult[]>;
    private normalizeProviderResponse;
    private persistProviderResult;
    private submitProviderOrder;
    private lookupProviderOrder;
    private ambiguousResult;
    private emitOutcome;
    private detectAlreadyInFlight;
    private buildAuditEntry;
}
export declare function createExecutionWorker(repositoryOrOptions: ExecutionRepository | {
    repo: ExecutionRepository;
    provider: ProviderExecutionAdapter;
    workerId?: string;
}, provider?: ProviderExecutionAdapter, options?: ExecutionWorkerOptions): ExecutionWorker;
export declare function startExecutionWorker(repository: ExecutionRepository, provider: ProviderExecutionAdapter, options?: ExecutionWorkerOptions & {
    intervalMs?: number;
}): {
    stop: () => void;
    runOnce: () => Promise<ExecutionWorkerResult | null>;
};
