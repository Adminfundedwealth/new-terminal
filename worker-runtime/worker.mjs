// worker-runtime/entrypoint.ts
import { createServer } from "node:http";
import { hostname } from "node:os";
import { createClient } from "@supabase/supabase-js";

// server/hardening/observability.ts
var sensitiveKey = /(authorization|access.?token|refresh.?token|secret|password|credential|api.?key|provider.?request|raw.?payload)/i;
function redactText(value) {
  return value.replace(/\b(Bearer|token)\s+[A-Za-z0-9._~+\/-]+=*/gi, "$1 [REDACTED]").replace(/\b((?:access|refresh|api)[_-]?(?:token|key)|token|secret|password|credential)\s*[:=]\s*["']?[^\s,"']+/gi, "$1=[REDACTED]").slice(0, 2e3);
}
function redact(value, key = "") {
  if (sensitiveKey.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, redact(child, childKey)]));
  }
  if (typeof value === "string") return redactText(value);
  return value;
}
var StructuredLogger = class {
  constructor(write = (entry) => console.info(entry)) {
    this.write = write;
  }
  log(level, event, fields = {}) {
    const entry = {
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      level,
      event,
      fields: redact(fields)
    };
    this.write(JSON.stringify(entry));
  }
};
function recordExecutionOutcome(metrics, outcome, durationMs, errorCategory) {
  metrics.increment("execution_outcomes_total", { outcome, error_category: errorCategory ?? "none" });
  if (Number.isFinite(durationMs) && durationMs >= 0) metrics.observe("execution_duration_ms", durationMs, { outcome });
}

// server/hardening/reliability.ts
var ExecutionBoundaryError = class extends Error {
  constructor(category, message, requiresReconciliation = false) {
    super(message);
    this.category = category;
    this.requiresReconciliation = requiresReconciliation;
    this.name = "ExecutionBoundaryError";
  }
};
function classifyExecutionError(error) {
  const value = error;
  const code = String(value?.code ?? value?.name ?? "UNKNOWN").toUpperCase();
  const status = Number(value?.status);
  if (error instanceof ExecutionBoundaryError) {
    return {
      category: error.category,
      code,
      retryable: error.category === "network" || error.category === "rate_limit" || error.category === "database",
      requiresReconciliation: error.requiresReconciliation || error.category === "timeout"
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
  if (status >= 400 && status < 500 || code.includes("INVALID") || code.includes("VALIDATION")) {
    return { category: "validation", code, retryable: false, requiresReconciliation: false };
  }
  if (code.startsWith("23") || code.startsWith("DB_") || code.includes("DATABASE")) {
    return { category: "database", code, retryable: true, requiresReconciliation: false };
  }
  return { category: "unknown", code, retryable: false, requiresReconciliation: true };
}
async function withExecutionTimeout(operation, timeoutMs, label = "Execution operation") {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError("timeoutMs must be positive");
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new ExecutionBoundaryError("timeout", `${label} timed out`, true));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
function decideRestartRecovery(input) {
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

// server/execution/supabase-repository.ts
var SupabaseExecutionRepository = class {
  constructor(serviceRoleClient, afterProviderAckCommitted) {
    this.serviceRoleClient = serviceRoleClient;
    this.afterProviderAckCommitted = afterProviderAckCommitted;
  }
  async fetchPending(limit = 25) {
    const { data, error } = await this.serviceRoleClient.from("order_execution_outbox").select("*").eq("state", "pending").order("available_at", { ascending: true }).limit(limit);
    if (error) throw new ExecutionBoundaryError("database", "Execution persistence is unavailable.");
    return (data ?? []).map((row) => this.mapRecord(row, false));
  }
  async claimNextPending(workerId = "worker-local", scope) {
    const scoped = Boolean(scope);
    const data = await this.callRpc(scoped ? "claim_d6b_synthetic_order_execution_outbox" : "claim_next_order_execution_outbox", scoped ? {
      worker_name: workerId,
      account_id_value: scope?.accountId,
      order_id_value: scope?.orderId,
      lease_seconds: 15
    } : {
      worker_name: workerId,
      lease_seconds: 60
    });
    if (data?.claimed !== true || !data.outbox) return null;
    return this.mapRecord(data.outbox, data.recovery_only === true);
  }
  async markSubmissionStarted(recordId, workerId, providerName) {
    if (providerName !== "mock-safe") throw new ExecutionBoundaryError("authentication", "Execution provider is not permitted.");
    const data = await this.callRpc("mark_order_submission_started", {
      outbox_id_value: recordId,
      worker_name: workerId,
      provider_name_value: providerName,
      provider_request: { provider: providerName }
    });
    return data?.should_dispatch === true;
  }
  async authorizeRetryAfterLookup(recordId, workerId, maxAttempts) {
    const data = await this.callRpc("authorize_order_execution_retry", {
      outbox_id_value: recordId,
      worker_name: workerId,
      max_attempts: maxAttempts
    });
    return data?.should_dispatch === true;
  }
  async markCompleted(recordId, result) {
    if (!result.broker_order_id) throw new ExecutionBoundaryError("validation", "Provider order identity is missing.");
    await this.callRpc("record_provider_ack", {
      outbox_id_value: recordId,
      provider_order_id_value: result.broker_order_id,
      provider_response: safeProviderResponse(result)
    });
    await this.afterProviderAckCommitted?.(recordId);
    for (const fill of result.fills ?? []) {
      await this.callRpc("record_execution_fill", {
        outbox_id_value: recordId,
        fill_payload: fill
      });
    }
  }
  async markRejected(recordId, reason) {
    await this.callRpc("mark_order_execution_rejected", {
      outbox_id_value: recordId,
      reason: "Mock provider rejected the synthetic execution.",
      provider_response: {}
    });
  }
  async markFailed(recordId, reason, workerId = "worker-local") {
    await this.callRpc("mark_order_execution_failed", {
      outbox_id_value: recordId,
      worker_name: workerId,
      reason: "Synthetic execution failed after a definitive non-ambiguous outcome."
    });
  }
  async appendAudit(entry) {
    const { error } = await this.serviceRoleClient.from("execution_audit_log").insert({
      order_id: entry.order_id,
      account_id: entry.account_id,
      client_order_id: entry.client_order_id,
      event_type: entry.event,
      provider_name: entry.provider,
      event_key: entry.id,
      event_payload: {
        status: entry.status,
        details: entry.details
      }
    });
    if (error) throw new ExecutionBoundaryError("database", "Execution audit persistence is unavailable.");
  }
  async upsertOrderState(orderId, patch) {
  }
  async callRpc(name, args) {
    const { data, error } = await this.serviceRoleClient.rpc(name, args);
    if (error) throw new ExecutionBoundaryError("database", "Execution persistence is unavailable.");
    return data;
  }
  mapRecord(row, recoveryOnly) {
    return {
      id: row.id,
      order_id: row.order_id,
      account_id: row.account_id,
      client_order_id: row.client_order_id,
      status: String(row.state ?? "pending").toUpperCase(),
      state: row.state,
      available_at: row.available_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
      attempts: Number(row.attempt_count ?? 0),
      attempt_count: Number(row.attempt_count ?? 0),
      payload: row.payload,
      last_error: row.last_error ?? null,
      claimed_by: row.claimed_by ?? null,
      claimed_until: row.claimed_until ?? null,
      provider_name: row.provider_name ?? null,
      provider_order_id: row.provider_order_id ?? null,
      recovery_only: recoveryOnly
    };
  }
};
function safeProviderResponse(result) {
  return {
    ok: result.ok,
    state: result.state,
    broker_order_id: result.broker_order_id,
    client_order_id: result.client_order_id,
    fills: (result.fills ?? []).map((fill) => ({
      brokerExecutionId: fill.brokerExecutionId,
      brokerOrderId: fill.brokerOrderId,
      localOrderId: fill.localOrderId,
      accountId: fill.accountId,
      symbol: fill.symbol,
      side: fill.side,
      quantity: fill.quantity,
      price: fill.price,
      executedAt: fill.executedAt,
      fees: fill.fees
    }))
  };
}

// server/execution/worker.ts
var ExecutionWorker = class {
  constructor(repository2, provider2, options = {}) {
    this.repository = repository2;
    this.provider = provider2;
    if (provider2.mode !== "MOCK_SAFE" || provider2.providerName !== "mock-safe") {
      throw new Error("Execution worker is restricted to the mock-safe provider.");
    }
    this.maxAttempts = options.maxAttempts ?? 3;
    this.workerId = options.workerId ?? "worker-local";
    this.providerTimeoutMs = options.providerTimeoutMs ?? 15e3;
    this.logger = options.logger ?? new StructuredLogger();
    this.metrics = options.metrics;
    this.claimScope = options.claimScope;
  }
  maxAttempts;
  workerId;
  providerTimeoutMs;
  logger;
  metrics;
  claimScope;
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
          message: "Another worker already claimed this outbox record."
        },
        status: "failed"
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
          message: "No pending outbox records available."
        },
        status: "failed"
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
          message: "Execution worker exceeded the retry budget."
        },
        status: "failed"
      };
    }
    const command = record.payload;
    const startedAt = Date.now();
    const accountHint = record.account_id.slice(-4);
    const submissionStarted = ["started", "acknowledged", "filled"].includes(String(record.submission_state ?? "").toLowerCase()) || record.recovery_only === true;
    this.logger.log("info", "execution.attempt_started", {
      command_id: record.client_order_id,
      order_id: record.order_id,
      account_hint: accountHint,
      stage: submissionStarted ? "recovery_lookup" : "claim",
      provider: this.provider.providerName,
      attempt: Number(record.attempts ?? record.attempt_count ?? 0)
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
          providerLookup: result ? "found" : "not_found"
        });
        if (recoveryDecision === "retry" && !result) {
          const retryAuthorized = await this.repository.authorizeRetryAfterLookup(record.id, this.workerId ?? "worker-local", this.maxAttempts);
          if (retryAuthorized) {
            result = await this.submitProviderOrder(command);
            recovered = false;
          } else {
            this.emitOutcome(record, "manual_review", startedAt, "unknown", "retry_authorization_denied");
            return this.ambiguousResult(record, "Provider lookup found no order, but the retry was not durably authorized.");
          }
        } else if (!result && recoveryDecision === "manual_review" && record.recovery_only && Number(record.attempts ?? record.attempt_count ?? 0) >= this.maxAttempts) {
          await this.repository.markFailed(record.id, "Execution retry budget exhausted after provider lookup.", this.workerId);
          this.emitOutcome(record, "failed", startedAt, "unknown", "retry_budget_exhausted");
          return this.ambiguousResult(record, "Provider lookup confirmed no order and the bounded retry budget is exhausted.");
        } else if (recoveryDecision !== "reconcile" || !result) {
          this.emitOutcome(record, "manual_review", startedAt, "unknown", "provider_not_found_after_submission_marker");
          return this.ambiguousResult(record, "Provider lookup found no order after submission had started; automatic resubmission is blocked.");
        }
      } else {
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
      if (!result) result = await this.submitProviderOrder(command);
      const normalized = this.normalizeProviderResponse(command, result);
      if (!normalized.ok || normalized.state === "REJECTED") {
        await this.repository.markRejected(record.id, normalized.message ?? "Provider rejected the execution request.");
        await this.repository.upsertOrderState(record.order_id, {
          status: "REJECTED",
          broker_order_id: normalized.broker_order_id,
          updated_at: (/* @__PURE__ */ new Date()).toISOString()
        });
        await this.repository.appendAudit(this.buildAuditEntry(record, normalized, "execution_rejected"));
        this.emitOutcome(record, "rejected", startedAt, "none", recovered ? "provider_lookup_found_rejection" : "none");
        return {
          claimed: true,
          state: normalized.state,
          record,
          outbox: { ...record, state: "rejected", status: "REJECTED", provider_order_id: normalized.broker_order_id, updated_at: (/* @__PURE__ */ new Date()).toISOString() },
          providerResult: normalized,
          status: "rejected"
        };
      }
      await this.repository.markCompleted(record.id, normalized);
      await this.repository.upsertOrderState(record.order_id, {
        status: normalized.state === "FILLED" ? "FILLED" : "PENDING",
        broker_order_id: normalized.broker_order_id,
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      });
      await this.repository.appendAudit(this.buildAuditEntry(record, normalized, "provider_ack"));
      if ((normalized.fills ?? []).length > 0) {
        await this.repository.appendAudit(this.buildAuditEntry(record, {
          ...normalized,
          state: "FILLED",
          message: "Provider produced a fill event."
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
        submission_state: (normalized.fills ?? []).length > 0 || normalized.state === "FILLED" || normalized.state === "PARTIALLY_FILLED" ? "filled" : normalized.state === "ACK" ? "acknowledged" : String(normalized.state).toLowerCase(),
        filled_events: normalized.fills ?? [],
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      };
      return {
        claimed: true,
        state: normalized.state,
        record,
        outbox: finalized,
        providerResult: normalized,
        status: "processed"
      };
    } catch (error) {
      const classification = classifyExecutionError(error);
      const reason = classification.requiresReconciliation ? "Provider outcome is uncertain; reconciliation is required before retry." : "Provider execution failed.";
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
              status: normalized.state === "REJECTED" ? "rejected" : "processed"
            };
          }
        } catch {
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
        message: reason
      }, "execution_failed"));
      this.emitOutcome(record, "failed", startedAt, classification.category, "none");
      return {
        claimed: true,
        state: "UNKNOWN",
        record,
        outbox: { ...record, state: "failed", status: "FAILED", last_error: reason, updated_at: (/* @__PURE__ */ new Date()).toISOString() },
        providerResult: {
          ok: false,
          state: "UNKNOWN",
          broker_order_id: `${record.order_id}-unknown`,
          client_order_id: record.client_order_id,
          message: reason
        },
        status: "failed"
      };
    }
  }
  async drain(limit = 10) {
    const results = [];
    for (let index = 0; index < limit; index += 1) {
      const result = await this.processNext();
      if (!result || !result.claimed) break;
      results.push(result);
    }
    return results;
  }
  normalizeProviderResponse(command, result) {
    if (!result || typeof result !== "object") throw new TypeError("Malformed provider response");
    const typed = result;
    const providerState = String(typed?.state ?? typed?.status ?? "UNKNOWN").toUpperCase();
    const rawBrokerOrderId = typed?.broker_order_id ?? typed?.brokerOrderId;
    if (!["ACK", "PENDING", "PARTIALLY_FILLED", "FILLED", "REJECTED"].includes(providerState) || typeof rawBrokerOrderId !== "string" || !rawBrokerOrderId.trim() || typed?.client_order_id && typed.client_order_id !== command.client_order_id) {
      throw new TypeError("Malformed provider response");
    }
    const ok = typeof typed?.ok === "boolean" ? typed.ok : providerState !== "REJECTED";
    const brokerOrderId = rawBrokerOrderId;
    const clientOrderId = typed?.client_order_id ?? command.client_order_id;
    const fillList = Array.isArray(typed?.fills) ? typed.fills : typed?.fill ? [typed.fill] : [];
    const effectiveState = fillList.length > 0 && !["FILLED", "PARTIALLY_FILLED", "REJECTED"].includes(providerState) ? fillList.reduce((total, fill) => total + Number(fill?.quantity ?? 0), 0) >= Number(command.quantity ?? 0) ? "FILLED" : "PARTIALLY_FILLED" : providerState;
    const normalized = {
      ok,
      state: effectiveState,
      broker_order_id: brokerOrderId,
      client_order_id: clientOrderId,
      message: typed?.message ?? "Provider returned a deterministic paper response.",
      fills: fillList,
      status: effectiveState,
      brokerOrderId,
      provider_state: effectiveState
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
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      });
      return;
    }
    await this.repository.markCompleted(record.id, result);
    await this.repository.upsertOrderState(record.order_id, {
      status: result.state === "FILLED" ? "FILLED" : "PENDING",
      broker_order_id: result.broker_order_id,
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    });
    await this.repository.appendAudit(this.buildAuditEntry(record, result, "provider_ack"));
    for (const fill of result.fills ?? []) {
      await this.repository.appendAudit(this.buildAuditEntry(record, { ...result, state: "FILLED" }, "execution_fill"));
    }
    await this.repository.appendAudit(this.buildAuditEntry(record, result, "execution_accepted"));
  }
  submitProviderOrder(command) {
    return withExecutionTimeout(
      this.provider.submitOrder(command),
      this.providerTimeoutMs,
      "Provider submission"
    );
  }
  lookupProviderOrder(clientOrderId) {
    return withExecutionTimeout(
      this.provider.getOrderStatus(clientOrderId),
      this.providerTimeoutMs,
      "Provider reconciliation lookup"
    );
  }
  ambiguousResult(record, message) {
    const providerResult = {
      ok: false,
      state: "UNKNOWN",
      broker_order_id: record.provider_order_id ?? `${record.order_id}-unknown`,
      client_order_id: record.client_order_id,
      message
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
      recovery_decision: recoveryDecision
    });
    if (this.metrics) recordExecutionOutcome(this.metrics, outcome, latency, errorCategory);
  }
  detectAlreadyInFlight() {
    const repo = this.repository;
    const rows = Array.isArray(repo?.rows) ? repo.rows : [];
    return rows.some((row) => {
      const state = String(row?.state ?? row?.status ?? "PENDING").toUpperCase();
      if (state !== "PROCESSING") return false;
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
        message: result.state === "REJECTED" ? "Mock provider rejected the synthetic order." : "Provider result recorded."
      },
      created_at: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
};
function createExecutionWorker(repositoryOrOptions, provider2, options = {}) {
  if (repositoryOrOptions && typeof repositoryOrOptions === "object" && "repo" in repositoryOrOptions && "provider" in repositoryOrOptions) {
    return new ExecutionWorker(repositoryOrOptions.repo, repositoryOrOptions.provider, {
      ...options,
      workerId: repositoryOrOptions.workerId ?? options.workerId
    });
  }
  if (!provider2) {
    throw new Error("Execution worker requires a repository and provider.");
  }
  return new ExecutionWorker(repositoryOrOptions, provider2, options);
}

// worker-runtime/entrypoint.ts
var supabaseUrl = process.env.SUPABASE_URL;
var supabaseKey = process.env.SUPABASE_SECRET_KEY;
var syntheticAccountId = process.env.D6B_SYNTHETIC_ACCOUNT_ID;
var syntheticOrderId = process.env.D6B_SYNTHETIC_ORDER_ID;
var port = Number(process.env.PORT ?? 8080);
var crashAfterAck = process.env.D6B_CRASH_AFTER_ACK === "true";
var rejectSyntheticOrder = process.env.D6B_SYNTHETIC_PROVIDER_REJECT === "true";
if (!supabaseUrl || !supabaseKey || !syntheticAccountId || !syntheticOrderId) {
  throw new Error("D6B worker requires Supabase server credentials and an explicit synthetic account/order scope.");
}
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("D6B worker PORT must be a valid TCP port.");
}
var supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});
var logger = new StructuredLogger();
var pollRunning = false;
var lastPollCompletedAt = null;
var lastPollFailedAt = null;
function safeErrorCategory(error) {
  return classifyExecutionError(error).category;
}
function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}
async function checkDatabase() {
  const { data: account, error: accountError } = await supabase.from("trading_accounts").select("id, prop_firm, external_account_id").eq("id", syntheticAccountId).maybeSingle();
  if (accountError || account?.id !== syntheticAccountId || account?.prop_firm !== "D6B_TEST" || account?.external_account_id !== "D6B-SYNTHETIC-ACCOUNT") return false;
  const { data: order, error: orderError } = await supabase.from("orders").select("id, account_id, client_order_id").eq("id", syntheticOrderId).eq("account_id", syntheticAccountId).maybeSingle();
  if (orderError || order?.id !== syntheticOrderId || !order.client_order_id.startsWith("D6B-SYNTH-")) return false;
  const { data: outbox, error: outboxError } = await supabase.from("order_execution_outbox").select("id, order_id, account_id").eq("order_id", syntheticOrderId).eq("account_id", syntheticAccountId).maybeSingle();
  return !outboxError && outbox?.order_id === syntheticOrderId && outbox?.account_id === syntheticAccountId;
}
async function healthHandler(_request, response) {
  let databaseReady = false;
  try {
    databaseReady = await checkDatabase();
  } catch {
    databaseReady = false;
  }
  const loopFresh = lastPollCompletedAt !== null && Date.now() - lastPollCompletedAt < 15e3;
  const loopHealthy = loopFresh && (lastPollFailedAt === null || lastPollFailedAt < lastPollCompletedAt);
  const status = !databaseReady ? "NOT_READY" : !loopHealthy ? "DEGRADED" : "READY";
  const httpStatus = status === "NOT_READY" ? 503 : status === "DEGRADED" ? 503 : 200;
  sendJson(response, httpStatus, {
    status,
    worker: "alive",
    database: databaseReady ? "connected" : "unavailable_or_scope_mismatch",
    claim_loop: loopHealthy ? "running" : "stale_or_failed",
    last_poll_at: lastPollCompletedAt ? new Date(lastPollCompletedAt).toISOString() : null,
    provider: "mock-safe",
    scope: "single D6B_TEST order"
  });
}
var httpServer = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/healthz") {
    void healthHandler(request, response);
    return;
  }
  sendJson(response, 404, { error: "not_found" });
});
httpServer.listen(port, "0.0.0.0", () => {
  logger.log("info", "d6b.worker.started", { worker_id: hostname(), port, provider: "mock-safe" });
});
var provider = {
  providerName: "mock-safe",
  mode: "MOCK_SAFE",
  async submitOrder(command) {
    if (command.account_id !== syntheticAccountId || command.order_id !== syntheticOrderId) {
      throw Object.assign(new Error("Synthetic execution scope mismatch."), { code: "D6B_SCOPE_MISMATCH" });
    }
    const { data, error } = await supabase.rpc("d6b_mock_provider_submit", {
      command_payload: command,
      crash_after_acceptance: crashAfterAck,
      reject_order: rejectSyntheticOrder
    });
    if (error) throw Object.assign(new Error("Synthetic provider persistence failed."), { code: "DB_D6B_PROVIDER" });
    return data;
  },
  async getOrderStatus(clientOrderId) {
    const { data, error } = await supabase.rpc("d6b_mock_provider_lookup", {
      account_id_value: syntheticAccountId,
      client_order_id_value: clientOrderId
    });
    if (error) throw Object.assign(new Error("Synthetic provider lookup failed."), { code: "DB_D6B_LOOKUP" });
    return data;
  }
};
var repository = new SupabaseExecutionRepository(supabase, async (outboxId) => {
  if (!crashAfterAck) return;
  const { data, error } = await supabase.rpc("d6b_mock_provider_consume_crash", {
    outbox_id_value: outboxId
  });
  if (error) throw Object.assign(new Error("Synthetic restart control failed."), { code: "DB_D6B_CRASH_HOOK" });
  if (data === true) {
    logger.log("warn", "d6b.worker.synthetic_crash_after_ack", {
      order_id: syntheticOrderId,
      account_hint: syntheticAccountId.slice(-4),
      stage: "ack_persisted_before_fill",
      provider: "mock-safe",
      recovery_decision: "railway_restart_requested"
    });
    process.exit(75);
  }
});
var worker = createExecutionWorker(repository, provider, {
  workerId: `d6b-${hostname()}`,
  maxAttempts: 3,
  providerTimeoutMs: 1e4,
  claimScope: { accountId: syntheticAccountId, orderId: syntheticOrderId },
  logger
});
async function pollOnce() {
  if (pollRunning) return;
  pollRunning = true;
  try {
    await worker.processNext();
    lastPollCompletedAt = Date.now();
  } catch (error) {
    lastPollFailedAt = Date.now();
    logger.log("error", "d6b.worker.poll_failed", {
      account_hint: syntheticAccountId.slice(-4),
      order_hint: syntheticOrderId.slice(-4),
      stage: "claim_or_process",
      provider: "mock-safe",
      error_category: safeErrorCategory(error)
    });
  } finally {
    pollRunning = false;
  }
}
void pollOnce();
var pollTimer = setInterval(() => void pollOnce(), 1e3);
function shutdown() {
  clearInterval(pollTimer);
  httpServer.close(() => process.exit(0));
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
