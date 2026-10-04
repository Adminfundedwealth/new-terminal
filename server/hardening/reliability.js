export class ExecutionBoundaryError extends Error {
    constructor(category, message, requiresReconciliation = false) {
        super(message);
        Object.defineProperty(this, "category", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: category
        });
        Object.defineProperty(this, "requiresReconciliation", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: requiresReconciliation
        });
        this.name = "ExecutionBoundaryError";
    }
}
export function classifyExecutionError(error) {
    const value = error;
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
export async function withExecutionTimeout(operation, timeoutMs, label = "Execution operation") {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
        throw new RangeError("timeoutMs must be positive");
    let timer;
    try {
        return await Promise.race([
            operation,
            new Promise((_, reject) => {
                timer = setTimeout(() => {
                    reject(new ExecutionBoundaryError("timeout", `${label} timed out`, true));
                }, timeoutMs);
            }),
        ]);
    }
    finally {
        if (timer)
            clearTimeout(timer);
    }
}
export function decideRestartRecovery(input) {
    if (!input.claimExpired)
        return "wait";
    if (!Number.isInteger(input.attempts) || input.attempts < 0 || input.maxAttempts < 1)
        return "manual_review";
    if (input.submissionStarted) {
        if (input.providerLookup === "found")
            return "reconcile";
        if (input.providerLookup === "not_found" && input.attempts < input.maxAttempts)
            return "retry";
        return "manual_review";
    }
    if (input.attempts >= input.maxAttempts)
        return "manual_review";
    if (input.providerLookup === "found")
        return "reconcile";
    if (input.providerLookup === "unavailable")
        return "manual_review";
    return "retry";
}
export class InMemoryFillDeduplicator {
    constructor() {
        Object.defineProperty(this, "fills", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new Map()
        });
    }
    async applyFillOnce(accountId, executionId, fill) {
        if (!accountId.trim() || !executionId.trim())
            throw new TypeError("Account and execution identities are required");
        const key = `${accountId}\u0000${executionId}`;
        if (this.fills.has(key))
            return "duplicate";
        this.fills.set(key, fill);
        return "applied";
    }
}
