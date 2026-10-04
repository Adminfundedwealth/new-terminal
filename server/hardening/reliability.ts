export type ExecutionErrorCategory =
  | "timeout"
  | "network"
  | "authentication"
  | "rate_limit"
  | "validation"
  | "conflict"
  | "database"
  | "unknown";

export interface ClassifiedExecutionError {
  category: ExecutionErrorCategory;
  code: string;
  retryable: boolean;
  requiresReconciliation: boolean;
}

export class ExecutionBoundaryError extends Error {
  constructor(
    readonly category: ExecutionErrorCategory,
    message: string,
    readonly requiresReconciliation = false,
  ) {
    super(message);
    this.name = "ExecutionBoundaryError";
  }
}

export function classifyExecutionError(error: unknown): ClassifiedExecutionError {
  const value = error as { code?: unknown; name?: unknown; status?: unknown } | null;
  const code = String(value?.code ?? value?.name ?? "UNKNOWN").toUpperCase();
  const status = Number(value?.status);

  if (error instanceof ExecutionBoundaryError) {
    return {
      category: error.category,
      code,
      retryable: error.category === "network" || error.category === "rate_limit" || error.category === "database",
      requiresReconciliation: error.requiresReconciliation || error.category === "timeout",
    };
  }
  if (status === 401 || status === 403 || code.includes("AUTH")) {
    return { category: "authentication", code, retryable: false, requiresReconciliation: false };
  }
  if (status === 429 || code.includes("RATE_LIMIT")) {
    return { category: "rate_limit", code, retryable: true, requiresReconciliation: false };
  }
  if (code.includes("TIMEOUT") || code === "ETIMEDOUT" || code === "ABORTERROR") {
    return { category: "timeout", code, retryable: false, requiresReconciliation: true };
  }
  if (["ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EPIPE", "NETWORKERROR"].includes(code)) {
    return { category: "network", code, retryable: true, requiresReconciliation: true };
  }
  if (status === 409 || code.includes("CONFLICT")) {
    return { category: "conflict", code, retryable: false, requiresReconciliation: false };
  }
  if ((status >= 400 && status < 500) || code.includes("INVALID") || code.includes("VALIDATION")) {
    return { category: "validation", code, retryable: false, requiresReconciliation: false };
  }
  if (code.startsWith("23") || code.startsWith("DB_") || code.includes("DATABASE")) {
    return { category: "database", code, retryable: true, requiresReconciliation: false };
  }
  return { category: "unknown", code, retryable: false, requiresReconciliation: true };
}

export async function withExecutionTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  label = "Execution operation",
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError("timeoutMs must be positive");

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new ExecutionBoundaryError("timeout", `${label} timed out`, true));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type RecoveryAction = "wait" | "retry" | "reconcile" | "manual_review";

export interface RecoveryInput {
  claimExpired: boolean;
  submissionStarted: boolean;
  attempts: number;
  maxAttempts: number;
  providerLookup: "not_checked" | "found" | "not_found" | "unavailable";
}

export function decideRestartRecovery(input: RecoveryInput): RecoveryAction {
  if (!input.claimExpired) return "wait";
  if (!Number.isInteger(input.attempts) || input.attempts < 0 || input.maxAttempts < 1) return "manual_review";

  if (input.submissionStarted) {
    if (input.providerLookup === "found") return "reconcile";
    if (input.providerLookup === "not_found" && input.attempts < input.maxAttempts) return "retry";
    return "manual_review";
  }

  if (input.attempts >= input.maxAttempts) return "manual_review";
  if (input.providerLookup === "found") return "reconcile";
  if (input.providerLookup === "unavailable") return "manual_review";
  return "retry";
}

export interface TransactionalFillDeduplicator<TFill> {
  /** Implementations must persist the unique key and effects in one database transaction. */
  applyFillOnce(accountId: string, executionId: string, fill: TFill): Promise<"applied" | "duplicate">;
}

export class InMemoryFillDeduplicator<TFill> implements TransactionalFillDeduplicator<TFill> {
  private readonly fills = new Map<string, TFill>();

  async applyFillOnce(accountId: string, executionId: string, fill: TFill): Promise<"applied" | "duplicate"> {
    if (!accountId.trim() || !executionId.trim()) throw new TypeError("Account and execution identities are required");
    const key = `${accountId}\u0000${executionId}`;
    if (this.fills.has(key)) return "duplicate";
    this.fills.set(key, fill);
    return "applied";
  }
}