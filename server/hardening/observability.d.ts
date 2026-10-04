export type LogLevel = "debug" | "info" | "warn" | "error";
export interface StructuredLogEntry {
    timestamp: string;
    level: LogLevel;
    event: string;
    fields: Record<string, unknown>;
}
export declare class StructuredLogger {
    private readonly write;
    constructor(write?: (serializedEntry: string) => void);
    log(level: LogLevel, event: string, fields?: Record<string, unknown>): void;
}
export interface HealthProbe {
    name: string;
    check: () => Promise<void>;
    timeoutMs?: number;
}
export interface HealthCheckResult {
    status: "ok" | "degraded";
    checks: Array<{
        name: string;
        status: "ok" | "failed" | "timeout";
    }>;
}
export declare function checkReadiness(probes: readonly HealthProbe[]): Promise<HealthCheckResult>;
export interface ExecutionMetrics {
    increment(name: string, labels?: Record<string, string>): void;
    observe(name: string, value: number, labels?: Record<string, string>): void;
}
export declare function recordExecutionOutcome(metrics: ExecutionMetrics, outcome: string, durationMs: number, errorCategory?: string): void;
