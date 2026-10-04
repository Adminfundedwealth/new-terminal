import { ExecutionBoundaryError } from "../hardening";
function safeNow() { return new Date().toISOString(); }
export class InMemoryExecutionRepository {
    constructor(initialRows = []) {
        Object.defineProperty(this, "rows", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        this.rows = [...initialRows];
    }
    async fetchPending(limit = 25) {
        return this.rows
            .filter((row) => {
            const state = String((row.state ?? row.status ?? "PENDING")).toUpperCase();
            return state === "PENDING";
        })
            .sort((left, right) => left.available_at.localeCompare(right.available_at))
            .slice(0, limit);
    }
    async claimNextPending(workerId, scope) {
        const row = this.rows
            .filter((candidate) => {
            if (scope && (candidate.account_id !== scope.accountId || candidate.order_id !== scope.orderId))
                return false;
            const state = String((candidate.state ?? candidate.status ?? "PENDING")).toUpperCase();
            if (state === "PENDING")
                return true;
            if (state === "PROCESSING") {
                const claimedUntil = candidate.claimed_until ? new Date(candidate.claimed_until).getTime() : 0;
                return Number.isFinite(claimedUntil) && claimedUntil <= Date.now();
            }
            return false;
        })
            .sort((left, right) => left.available_at.localeCompare(right.available_at))[0];
        if (!row)
            return null;
        const claimExpired = String(row.state ?? row.status).toUpperCase() === "PROCESSING"
            && (!row.claimed_until || new Date(row.claimed_until).getTime() <= Date.now());
        const claimed = {
            ...row,
            status: "PROCESSING",
            state: "PROCESSING",
            updated_at: safeNow(),
            attempts: Number(row.attempts ?? row.attempt_count ?? 0) + 1,
            attempt_count: Number(row.attempts ?? row.attempt_count ?? 0) + 1,
            recovery_only: claimExpired && Boolean(row.submission_state && row.submission_state !== "queued"),
            claimed_by: workerId ?? row.claimed_by ?? "worker-local",
            claimed_until: new Date(Date.now() + 60000).toISOString(),
            last_error: null,
        };
        const index = this.rows.findIndex((entry) => entry.id === claimed.id);
        if (index >= 0)
            this.rows[index] = claimed;
        return claimed;
    }
    async markSubmissionStarted(recordId, workerId, providerName) {
        const index = this.rows.findIndex((entry) => entry.id === recordId);
        if (index < 0)
            return false;
        const row = this.rows[index];
        if (row.submission_state && row.submission_state !== "queued")
            return false;
        this.rows[index] = {
            ...row,
            claimed_by: workerId,
            provider_name: providerName,
            submission_state: "started",
            submitted_at: safeNow(),
            updated_at: safeNow(),
        };
        return true;
    }
    async authorizeRetryAfterLookup(recordId, workerId, maxAttempts) {
        const index = this.rows.findIndex((entry) => entry.id === recordId);
        if (index < 0)
            return false;
        const row = this.rows[index];
        const retryCount = Number(row.retry_count ?? 0);
        if (row.claimed_by !== workerId || row.submission_state !== "started" || retryCount + 1 >= maxAttempts)
            return false;
        this.rows[index] = {
            ...row,
            retry_count: retryCount + 1,
            submitted_at: safeNow(),
            updated_at: safeNow(),
        };
        return true;
    }
    async markCompleted(recordId, result) {
        const index = this.rows.findIndex((entry) => entry.id === recordId);
        if (index < 0)
            return;
        const row = this.rows[index];
        const normalizedFills = Array.isArray(result?.fills)
            ? result.fills
            : (result?.fill ? [result.fill] : []);
        const nextState = String(result?.state ?? result.status ?? "ACK").toUpperCase();
        const existingFills = row.filled_events ?? [];
        const knownFillIds = new Set(existingFills.map((fill) => String(fill.brokerExecutionId ?? ("broker_execution_id" in fill ? fill.broker_execution_id : ""))));
        const newFills = normalizedFills
            .filter((fill) => !knownFillIds.has(String(fill?.brokerExecutionId ?? fill?.broker_execution_id ?? "")))
            .map((fill) => ({ ...fill, type: "execution_fill" }));
        this.rows[index] = {
            ...row,
            status: "DONE",
            state: "completed",
            provider_name: row.provider_name ?? "mock-safe",
            provider_order_id: row.provider_order_id ?? result.broker_order_id,
            updated_at: safeNow(),
            last_error: null,
            submission_state: nextState === "REJECTED" ? "rejected" : nextState === "FILLED" || nextState === "PARTIALLY_FILLED" || normalizedFills.length > 0 ? "filled" : "acknowledged",
            filled_events: [...existingFills, ...newFills],
        };
    }
    async markRejected(recordId, reason) {
        const index = this.rows.findIndex((entry) => entry.id === recordId);
        if (index < 0)
            return;
        const row = this.rows[index];
        this.rows[index] = {
            ...row,
            status: "REJECTED",
            state: "rejected",
            provider_order_id: row.provider_order_id ?? null,
            updated_at: safeNow(),
            last_error: reason,
            submission_state: "rejected",
        };
    }
    async markFailed(recordId, reason, _workerId) {
        const index = this.rows.findIndex((entry) => entry.id === recordId);
        if (index < 0)
            return;
        const row = this.rows[index];
        this.rows[index] = {
            ...row,
            status: "FAILED",
            state: "failed",
            updated_at: safeNow(),
            last_error: reason,
            submission_state: "failed",
        };
    }
    async appendAudit(entry) {
        const index = this.rows.findIndex((row) => row.order_id === entry.order_id);
        if (index < 0)
            return;
        const row = this.rows[index];
        const nextAudit = [...(row.audit_entries ?? []), { ...entry, type: entry.event }];
        this.rows[index] = { ...row, audit_entries: nextAudit };
    }
    async upsertOrderState(orderId, patch) {
        const index = this.rows.findIndex((row) => row.order_id === orderId);
        if (index < 0)
            return;
        const row = this.rows[index];
        this.rows[index] = {
            ...row,
            status: patch.status ?? row.status,
            state: patch.status ?? row.state ?? row.status,
            provider_order_id: patch.broker_order_id ?? row.provider_order_id ?? null,
            updated_at: patch.updated_at ?? safeNow(),
        };
    }
    seed(record) {
        this.rows.push(record);
    }
}
export function createMemoryExecutionRepository(initialRows = []) {
    return new InMemoryExecutionRepository(initialRows);
}
export class SupabaseExecutionRepository {
    constructor(serviceRoleClient, afterProviderAckCommitted) {
        Object.defineProperty(this, "serviceRoleClient", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: serviceRoleClient
        });
        Object.defineProperty(this, "afterProviderAckCommitted", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: afterProviderAckCommitted
        });
    }
    async fetchPending(limit = 25) {
        const { data, error } = await this.serviceRoleClient.from("order_execution_outbox")
            .select("*")
            .eq("state", "pending")
            .order("available_at", { ascending: true })
            .limit(limit);
        if (error)
            throw new ExecutionBoundaryError("database", "Execution persistence is unavailable.");
        return (data ?? []).map((row) => this.mapRecord(row, false));
    }
    async claimNextPending(workerId = "worker-local", scope) {
        const scoped = Boolean(scope);
        const data = await this.callRpc(scoped
            ? "claim_d6b_synthetic_order_execution_outbox"
            : "claim_next_order_execution_outbox", scoped
            ? {
                worker_name: workerId,
                account_id_value: scope?.accountId,
                order_id_value: scope?.orderId,
                lease_seconds: 15,
            }
            : {
                worker_name: workerId,
                lease_seconds: 60,
            });
        if (data?.claimed !== true || !data.outbox)
            return null;
        return this.mapRecord(data.outbox, data.recovery_only === true);
    }
    async markSubmissionStarted(recordId, workerId, providerName) {
        if (providerName !== "mock-safe")
            throw new ExecutionBoundaryError("authentication", "Execution provider is not permitted.");
        const data = await this.callRpc("mark_order_submission_started", {
            outbox_id_value: recordId,
            worker_name: workerId,
            provider_name_value: providerName,
            provider_request: { provider: providerName },
        });
        return data?.should_dispatch === true;
    }
    async authorizeRetryAfterLookup(recordId, workerId, maxAttempts) {
        const data = await this.callRpc("authorize_order_execution_retry", {
            outbox_id_value: recordId,
            worker_name: workerId,
            max_attempts: maxAttempts,
        });
        return data?.should_dispatch === true;
    }
    async markCompleted(recordId, result) {
        if (!result.broker_order_id)
            throw new ExecutionBoundaryError("validation", "Provider order identity is missing.");
        await this.callRpc("record_provider_ack", {
            outbox_id_value: recordId,
            provider_order_id_value: result.broker_order_id,
            provider_response: safeProviderResponse(result),
        });
        await this.afterProviderAckCommitted?.(recordId);
        for (const fill of result.fills ?? []) {
            await this.callRpc("record_execution_fill", {
                outbox_id_value: recordId,
                fill_payload: fill,
            });
        }
    }
    async markRejected(recordId, reason) {
        await this.callRpc("mark_order_execution_rejected", {
            outbox_id_value: recordId,
            reason: "Mock provider rejected the synthetic execution.",
            provider_response: {},
        });
        void reason;
    }
    async markFailed(recordId, reason, workerId = "worker-local") {
        await this.callRpc("mark_order_execution_failed", {
            outbox_id_value: recordId,
            worker_name: workerId,
            reason: "Synthetic execution failed after a definitive non-ambiguous outcome.",
        });
        void reason;
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
                details: entry.details,
            },
        });
        if (error)
            throw new ExecutionBoundaryError("database", "Execution audit persistence is unavailable.");
    }
    async upsertOrderState(orderId, patch) {
        // D4 RPCs own order-state transitions and apply them transactionally with execution persistence.
        void orderId;
        void patch;
    }
    async callRpc(name, args) {
        const { data, error } = await this.serviceRoleClient.rpc(name, args);
        if (error)
            throw new ExecutionBoundaryError("database", "Execution persistence is unavailable.");
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
            recovery_only: recoveryOnly,
        };
    }
}
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
            fees: fill.fees,
        })),
    };
}
