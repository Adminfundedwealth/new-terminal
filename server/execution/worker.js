import { classifyExecutionError, decideRestartRecovery, recordExecutionOutcome, StructuredLogger, withExecutionTimeout, } from "../hardening";
export class ExecutionWorker {
    constructor(repository, provider, options = {}) {
        Object.defineProperty(this, "repository", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: repository
        });
        Object.defineProperty(this, "provider", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: provider
        });
        Object.defineProperty(this, "maxAttempts", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "workerId", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "providerTimeoutMs", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "logger", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "metrics", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "claimScope", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        if (provider.mode !== "MOCK_SAFE" || provider.providerName !== "mock-safe") {
            throw new Error("Execution worker is restricted to the mock-safe provider.");
        }
        this.maxAttempts = options.maxAttempts ?? 3;
        this.workerId = options.workerId ?? "worker-local";
        this.providerTimeoutMs = options.providerTimeoutMs ?? 15000;
        this.logger = options.logger ?? new StructuredLogger();
        this.metrics = options.metrics;
        this.claimScope = options.claimScope;
    }
    async processNext() {
        if (this.detectAlreadyInFlight()) {
            return {
                claimed: false,
                reason: "already_in_flight",
                record: null,
                providerResult: {
                    ok: false,
                    state: "UNKNOWN",
                    broker_order_id: "n/a",
                    client_order_id: "n/a",
                    message: "Another worker already claimed this outbox record.",
                },
                status: "failed",
            };
        }
        const record = await this.repository.claimNextPending(this.workerId, this.claimScope);
        if (!record) {
            return {
                claimed: false,
                reason: "no_pending_outbox",
                record: null,
                providerResult: {
                    ok: false,
                    state: "UNKNOWN",
                    broker_order_id: "n/a",
                    client_order_id: "n/a",
                    message: "No pending outbox records available.",
                },
                status: "failed",
            };
        }
        if (this.maxAttempts > 0 && Number(record.attempts ?? record.attempt_count ?? 0) > this.maxAttempts) {
            await this.repository.markFailed(record.id, "Execution worker exceeded the retry budget.", this.workerId);
            return {
                claimed: false,
                reason: "max_attempts_exceeded",
                record,
                providerResult: {
                    ok: false,
                    state: "UNKNOWN",
                    broker_order_id: record.provider_order_id ?? `outbox-${record.id}`,
                    client_order_id: record.client_order_id,
                    message: "Execution worker exceeded the retry budget.",
                },
                status: "failed",
            };
        }
        const command = record.payload;
        const startedAt = Date.now();
        const accountHint = record.account_id.slice(-4);
        const submissionStarted = ["started", "acknowledged", "filled"].includes(String(record.submission_state ?? "").toLowerCase())
            || record.recovery_only === true;
        this.logger.log("info", "execution.attempt_started", {
            command_id: record.client_order_id,
            order_id: record.order_id,
            account_hint: accountHint,
            stage: submissionStarted ? "recovery_lookup" : "claim",
            provider: this.provider.providerName,
            attempt: Number(record.attempts ?? record.attempt_count ?? 0),
        });
        try {
            let result = null;
            let recovered = submissionStarted;
            if (submissionStarted) {
                result = await this.lookupProviderOrder(record.client_order_id);
                const recoveryDecision = decideRestartRecovery({
                    claimExpired: record.recovery_only === true,
                    submissionStarted: true,
                    attempts: Number(record.attempts ?? record.attempt_count ?? 0),
                    maxAttempts: this.maxAttempts,
                    providerLookup: result ? "found" : "not_found",
                });
                if (recoveryDecision === "retry" && !result) {
                    const retryAuthorized = await this.repository.authorizeRetryAfterLookup(record.id, this.workerId ?? "worker-local", this.maxAttempts);
                    if (retryAuthorized) {
                        result = await this.submitProviderOrder(command);
                        recovered = false;
                    }
                    else {
                        this.emitOutcome(record, "manual_review", startedAt, "unknown", "retry_authorization_denied");
                        return this.ambiguousResult(record, "Provider lookup found no order, but the retry was not durably authorized.");
                    }
                }
                else if (!result && recoveryDecision === "manual_review" && record.recovery_only
                    && Number(record.attempts ?? record.attempt_count ?? 0) >= this.maxAttempts) {
                    await this.repository.markFailed(record.id, "Execution retry budget exhausted after provider lookup.", this.workerId);
                    this.emitOutcome(record, "failed", startedAt, "unknown", "retry_budget_exhausted");
                    return this.ambiguousResult(record, "Provider lookup confirmed no order and the bounded retry budget is exhausted.");
                }
                else if (recoveryDecision !== "reconcile" || !result) {
                    this.emitOutcome(record, "manual_review", startedAt, "unknown", "provider_not_found_after_submission_marker");
                    return this.ambiguousResult(record, "Provider lookup found no order after submission had started; automatic resubmission is blocked.");
                }
            }
            else {
                const markerCreated = await this.repository.markSubmissionStarted(record.id, this.workerId ?? "worker-local", this.provider.providerName);
                if (!markerCreated) {
                    result = await this.lookupProviderOrder(record.client_order_id);
                    if (!result) {
                        this.emitOutcome(record, "manual_review", startedAt, "unknown", "submission_marker_already_exists");
                        return this.ambiguousResult(record, "A prior submission marker exists and provider lookup found no order; automatic resubmission is blocked.");
                    }
                    recovered = true;
                }
            }
            if (!result)
                result = await this.submitProviderOrder(command);
            const normalized = this.normalizeProviderResponse(command, result);
            if (!normalized.ok || normalized.state === "REJECTED") {
                await this.repository.markRejected(record.id, normalized.message ?? "Provider rejected the execution request.");
                await this.repository.upsertOrderState(record.order_id, {
                    status: "REJECTED",
                    broker_order_id: normalized.broker_order_id,
                    updated_at: new Date().toISOString(),
                });
                await this.repository.appendAudit(this.buildAuditEntry(record, normalized, "execution_rejected"));
                this.emitOutcome(record, "rejected", startedAt, "none", recovered ? "provider_lookup_found_rejection" : "none");
                return {
                    claimed: true,
                    state: normalized.state,
                    record,
                    outbox: { ...record, state: "rejected", status: "REJECTED", provider_order_id: normalized.broker_order_id, updated_at: new Date().toISOString() },
                    providerResult: normalized,
                    status: "rejected",
                };
            }
            await this.repository.markCompleted(record.id, normalized);
            await this.repository.upsertOrderState(record.order_id, {
                status: normalized.state === "FILLED" ? "FILLED" : "PENDING",
                broker_order_id: normalized.broker_order_id,
                updated_at: new Date().toISOString(),
            });
            await this.repository.appendAudit(this.buildAuditEntry(record, normalized, "provider_ack"));
            if ((normalized.fills ?? []).length > 0) {
                await this.repository.appendAudit(this.buildAuditEntry(record, {
                    ...normalized,
                    state: "FILLED",
                    message: "Provider produced a fill event.",
                }, "execution_fill"));
            }
            await this.repository.appendAudit(this.buildAuditEntry(record, normalized, "execution_accepted"));
            this.emitOutcome(record, recovered ? "reconciled" : "accepted", startedAt, "none", recovered ? "provider_lookup_found" : "none");
            const finalized = {
                ...record,
                status: "DONE",
                state: "completed",
                provider_name: this.provider.providerName,
                provider_order_id: normalized.broker_order_id,
                submission_state: (normalized.fills ?? []).length > 0 || normalized.state === "FILLED" || normalized.state === "PARTIALLY_FILLED"
                    ? "filled"
                    : normalized.state === "ACK" ? "acknowledged" : String(normalized.state).toLowerCase(),
                filled_events: normalized.fills ?? [],
                updated_at: new Date().toISOString(),
            };
            return {
                claimed: true,
                state: normalized.state,
                record,
                outbox: finalized,
                providerResult: normalized,
                status: "processed",
            };
        }
        catch (error) {
            const classification = classifyExecutionError(error);
            const reason = classification.requiresReconciliation
                ? "Provider outcome is uncertain; reconciliation is required before retry."
                : "Provider execution failed.";
            if (classification.requiresReconciliation) {
                try {
                    const providerResult = await this.lookupProviderOrder(record.client_order_id);
                    if (providerResult) {
                        const normalized = this.normalizeProviderResponse(command, providerResult);
                        await this.persistProviderResult(record, normalized);
                        this.emitOutcome(record, "reconciled", startedAt, classification.category, "provider_lookup_found_after_error");
                        return {
                            claimed: true,
                            state: normalized.state,
                            record,
                            providerResult: normalized,
                            status: normalized.state === "REJECTED" ? "rejected" : "processed",
                        };
                    }
                }
                catch {
                    this.emitOutcome(record, "manual_review", startedAt, classification.category, "provider_lookup_unavailable");
                    return this.ambiguousResult(record, reason);
                }
                this.emitOutcome(record, "manual_review", startedAt, classification.category, "provider_lookup_not_found");
                return this.ambiguousResult(record, reason);
            }
            await this.repository.markFailed(record.id, reason, this.workerId);
            await this.repository.appendAudit(this.buildAuditEntry(record, {
                ok: false,
                state: "UNKNOWN",
                broker_order_id: `${record.order_id}-unknown`,
                client_order_id: record.client_order_id,
                message: reason,
            }, "execution_failed"));
            this.emitOutcome(record, "failed", startedAt, classification.category, "none");
            return {
                claimed: true,
                state: "UNKNOWN",
                record,
                outbox: { ...record, state: "failed", status: "FAILED", last_error: reason, updated_at: new Date().toISOString() },
                providerResult: {
                    ok: false,
                    state: "UNKNOWN",
                    broker_order_id: `${record.order_id}-unknown`,
                    client_order_id: record.client_order_id,
                    message: reason,
                },
                status: "failed",
            };
        }
    }
    async drain(limit = 10) {
        const results = [];
        for (let index = 0; index < limit; index += 1) {
            const result = await this.processNext();
            if (!result || !result.claimed)
                break;
            results.push(result);
        }
        return results;
    }
    normalizeProviderResponse(command, result) {
        if (!result || typeof result !== "object")
            throw new TypeError("Malformed provider response");
        const typed = result;
        const providerState = String(typed?.state ?? typed?.status ?? "UNKNOWN").toUpperCase();
        const rawBrokerOrderId = typed?.broker_order_id ?? typed?.brokerOrderId;
        if (!["ACK", "PENDING", "PARTIALLY_FILLED", "FILLED", "REJECTED"].includes(providerState)
            || typeof rawBrokerOrderId !== "string" || !rawBrokerOrderId.trim()
            || typed?.client_order_id && typed.client_order_id !== command.client_order_id) {
            throw new TypeError("Malformed provider response");
        }
        const ok = typeof typed?.ok === "boolean" ? typed.ok : providerState !== "REJECTED";
        const brokerOrderId = rawBrokerOrderId;
        const clientOrderId = typed?.client_order_id ?? command.client_order_id;
        const fillList = Array.isArray(typed?.fills) ? typed.fills : (typed?.fill ? [typed.fill] : []);
        const effectiveState = fillList.length > 0 && !["FILLED", "PARTIALLY_FILLED", "REJECTED"].includes(providerState)
            ? (fillList.reduce((total, fill) => total + Number(fill?.quantity ?? 0), 0) >= Number(command.quantity ?? 0) ? "FILLED" : "PARTIALLY_FILLED")
            : providerState;
        const normalized = {
            ok,
            state: effectiveState,
            broker_order_id: brokerOrderId,
            client_order_id: clientOrderId,
            message: typed?.message ?? "Provider returned a deterministic paper response.",
            fills: fillList,
            status: effectiveState,
            brokerOrderId: brokerOrderId,
            provider_state: effectiveState,
        };
        if (normalized.state === "ACK" || normalized.state === "PENDING") {
            normalized.ok = true;
        }
        if ((normalized.fills ?? []).length > 0 && normalized.state === "ACK") {
            normalized.state = "FILLED";
            normalized.status = "FILLED";
            normalized.provider_state = "FILLED";
        }
        if (normalized.state === "UNKNOWN" && !normalized.message) {
            normalized.message = "Provider returned an unknown state; safe mock execution keeps the order in a non-live status.";
        }
        return normalized;
    }
    async persistProviderResult(record, result) {
        if (!result.ok || result.state === "REJECTED") {
            await this.repository.markRejected(record.id, result.message ?? "Provider rejected the execution request.");
            await this.repository.upsertOrderState(record.order_id, {
                status: "REJECTED",
                broker_order_id: result.broker_order_id,
                updated_at: new Date().toISOString(),
            });
            return;
        }
        await this.repository.markCompleted(record.id, result);
        await this.repository.upsertOrderState(record.order_id, {
            status: result.state === "FILLED" ? "FILLED" : "PENDING",
            broker_order_id: result.broker_order_id,
            updated_at: new Date().toISOString(),
        });
        await this.repository.appendAudit(this.buildAuditEntry(record, result, "provider_ack"));
        for (const fill of result.fills ?? []) {
            await this.repository.appendAudit(this.buildAuditEntry(record, { ...result, state: "FILLED" }, "execution_fill"));
        }
        await this.repository.appendAudit(this.buildAuditEntry(record, result, "execution_accepted"));
    }
    submitProviderOrder(command) {
        return withExecutionTimeout(this.provider.submitOrder(command), this.providerTimeoutMs, "Provider submission");
    }
    lookupProviderOrder(clientOrderId) {
        return withExecutionTimeout(this.provider.getOrderStatus(clientOrderId), this.providerTimeoutMs, "Provider reconciliation lookup");
    }
    ambiguousResult(record, message) {
        const providerResult = {
            ok: false,
            state: "UNKNOWN",
            broker_order_id: record.provider_order_id ?? `${record.order_id}-unknown`,
            client_order_id: record.client_order_id,
            message,
        };
        return { claimed: true, reason: "manual_review_required", record, providerResult, status: "failed" };
    }
    emitOutcome(record, outcome, startedAt, errorCategory, recoveryDecision) {
        const latency = Date.now() - startedAt;
        this.logger.log("info", "execution.attempt_finished", {
            command_id: record.client_order_id,
            order_id: record.order_id,
            account_hint: record.account_id.slice(-4),
            stage: "finalize",
            provider: this.provider.providerName,
            attempt: Number(record.attempts ?? record.attempt_count ?? 0),
            outcome,
            latency_ms: latency,
            error_category: errorCategory,
            recovery_decision: recoveryDecision,
        });
        if (this.metrics)
            recordExecutionOutcome(this.metrics, outcome, latency, errorCategory);
    }
    detectAlreadyInFlight() {
        const repo = this.repository;
        const rows = Array.isArray(repo?.rows) ? repo.rows : [];
        return rows.some((row) => {
            const state = String(row?.state ?? row?.status ?? "PENDING").toUpperCase();
            if (state !== "PROCESSING")
                return false;
            const claimedUntil = row?.claimed_until ? new Date(row.claimed_until).getTime() : 0;
            return Number.isFinite(claimedUntil) && claimedUntil > Date.now();
        });
    }
    buildAuditEntry(record, result, event) {
        return {
            id: `audit-${record.id}-${Date.now()}`,
            order_id: record.order_id,
            account_id: record.account_id,
            client_order_id: record.client_order_id,
            event,
            provider: this.provider.providerName,
            status: result.state,
            details: {
                broker_order_id: result.broker_order_id,
                ok: result.ok,
                message: result.state === "REJECTED" ? "Mock provider rejected the synthetic order." : "Provider result recorded.",
            },
            created_at: new Date().toISOString(),
        };
    }
}
export function createExecutionWorker(repositoryOrOptions, provider, options = {}) {
    if (repositoryOrOptions && typeof repositoryOrOptions === "object" && "repo" in repositoryOrOptions && "provider" in repositoryOrOptions) {
        return new ExecutionWorker(repositoryOrOptions.repo, repositoryOrOptions.provider, {
            ...options,
            workerId: repositoryOrOptions.workerId ?? options.workerId,
        });
    }
    if (!provider) {
        throw new Error("Execution worker requires a repository and provider.");
    }
    return new ExecutionWorker(repositoryOrOptions, provider, options);
}
export function startExecutionWorker(repository, provider, options = {}) {
    const worker = createExecutionWorker(repository, provider, options);
    const intervalMs = options.intervalMs ?? 1000;
    let handle = null;
    const runOnce = () => worker.processNext();
    handle = setInterval(() => {
        void runOnce();
    }, intervalMs);
    return {
        stop: () => {
            if (handle) {
                clearInterval(handle);
                handle = null;
            }
        },
        runOnce,
    };
}
