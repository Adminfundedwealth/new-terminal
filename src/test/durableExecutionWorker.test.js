import { describe, expect, it } from "vitest";
import { createExecutionWorker, createMemoryExecutionRepository, createMockProvider, SupabaseExecutionRepository, } from "../../server/execution";
describe("durable execution worker", () => {
    it("claims a pending outbox row, records submission start, and finalizes an acked fill", async () => {
        const repo = createMemoryExecutionRepository([
            {
                id: "outbox-1",
                order_id: "order-1",
                account_id: "acct-1",
                client_order_id: "C-1",
                status: "PENDING",
                attempts: 0,
                payload: {
                    id: "outbox-1",
                    order_id: "order-1",
                    account_id: "acct-1",
                    client_order_id: "C-1",
                    user_id: "user-1",
                    provider: "mock-safe",
                    symbol: "NIFTY",
                    exchange: "NSE",
                    side: "BUY",
                    quantity: 1,
                    order_type: "LIMIT",
                    price: 100,
                    product: "MIS",
                    segment: "NFO",
                    requested_at: new Date().toISOString(),
                },
                state: "pending",
                attempt_count: 0,
                available_at: new Date().toISOString(),
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            },
        ]);
        const provider = createMockProvider({
            submitOrder: async () => ({
                status: "ACK",
                brokerOrderId: "broker-1",
                executionId: "fill-1",
                fill: {
                    brokerExecutionId: "fill-1",
                    orderId: "order-1",
                    symbol: "NIFTY",
                    side: "BUY",
                    quantity: 1,
                    price: 100,
                    executedAt: new Date().toISOString(),
                },
            }),
        });
        const worker = createExecutionWorker({ repo, provider, workerId: "worker-1" });
        const result = await worker.processNext();
        expect(result.claimed).toBe(true);
        expect(result.state).toBe("FILLED");
        expect(result.outbox.state).toBe("completed");
        expect(result.outbox.provider_order_id).toBe("broker-1");
        expect(repo.rows[0].submission_state).toBe("filled");
        expect(repo.rows[0].filled_events).toHaveLength(1);
        expect(repo.rows[0].audit_entries).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: "provider_ack" }),
            expect.objectContaining({ type: "execution_fill" }),
        ]));
    });
    it("does not double-submit the same order when a worker replays a stale claim", async () => {
        const repo = createMemoryExecutionRepository([
            {
                id: "outbox-2",
                order_id: "order-2",
                account_id: "acct-2",
                client_order_id: "C-2",
                status: "PROCESSING",
                attempts: 1,
                payload: {
                    id: "outbox-2",
                    order_id: "order-2",
                    account_id: "acct-2",
                    client_order_id: "C-2",
                    user_id: "user-2",
                    provider: "mock-safe",
                    symbol: "BANKNIFTY",
                    exchange: "NSE",
                    side: "SELL",
                    quantity: 2,
                    order_type: "LIMIT",
                    price: 100,
                    requested_at: new Date().toISOString(),
                },
                state: "processing",
                attempt_count: 1,
                claimed_by: "worker-1",
                claimed_until: new Date(Date.now() + 60000).toISOString(),
                available_at: new Date().toISOString(),
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            },
        ]);
        const provider = createMockProvider({
            submitOrder: async () => ({ status: "ACK", brokerOrderId: "broker-2" }),
        });
        const worker = createExecutionWorker({ repo, provider, workerId: "worker-2" });
        const result = await worker.processNext();
        expect(result.claimed).toBe(false);
        expect(result.reason).toBe("already_in_flight");
    });
    it("recovers an accepted order after response loss and worker restart without a duplicate submission or fill", async () => {
        const repo = createMemoryExecutionRepository([
            {
                id: "outbox-restart",
                order_id: "order-restart",
                account_id: "acct-restart",
                client_order_id: "C-restart",
                status: "PENDING",
                attempts: 0,
                payload: {
                    id: "outbox-restart",
                    order_id: "order-restart",
                    account_id: "acct-restart",
                    client_order_id: "C-restart",
                    user_id: "synthetic-user",
                    provider: "mock-safe",
                    symbol: "NIFTY",
                    exchange: "NSE",
                    side: "BUY",
                    quantity: 1,
                    order_type: "MARKET",
                    requested_at: new Date().toISOString(),
                },
                state: "pending",
                attempt_count: 0,
                available_at: new Date().toISOString(),
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            },
        ]);
        let submissions = 0;
        const provider = createMockProvider({
            submitOrder: async (command) => {
                submissions += 1;
                return {
                    ok: true,
                    state: "FILLED",
                    broker_order_id: "mock-restart-order",
                    client_order_id: command.client_order_id,
                    fills: [{
                            brokerExecutionId: "mock-restart-fill",
                            brokerOrderId: "mock-restart-order",
                            localOrderId: command.order_id,
                            accountId: command.account_id,
                            symbol: command.symbol,
                            side: command.side,
                            quantity: command.quantity,
                            price: 100,
                            executedAt: "2026-10-02T09:00:00.000Z",
                            fees: 0,
                        }],
                };
            },
            afterSubmit: async () => {
                throw Object.assign(new Error("synthetic response lost"), { code: "ETIMEDOUT" });
            },
        });
        const lookupProvider = provider.getOrderStatus.bind(provider);
        let lookups = 0;
        provider.getOrderStatus = async (clientOrderId) => {
            lookups += 1;
            if (lookups === 1)
                throw Object.assign(new Error("synthetic lookup unavailable"), { code: "ECONNREFUSED" });
            return lookupProvider(clientOrderId);
        };
        const firstWorker = createExecutionWorker({ repo, provider, workerId: "worker-before-crash" });
        const firstResult = await firstWorker.processNext();
        expect(firstResult?.reason).toBe("manual_review_required");
        expect(repo.rows[0].submission_state).toBe("started");
        expect(repo.rows[0].state).toBe("PROCESSING");
        repo.rows[0].claimed_until = new Date(Date.now() - 1).toISOString();
        const restartedWorker = createExecutionWorker({ repo, provider, workerId: "worker-after-restart" });
        const recovered = await restartedWorker.processNext();
        expect(recovered?.providerResult.state).toBe("FILLED");
        expect(recovered?.status).toBe("processed");
        expect(submissions).toBe(1);
        expect(lookups).toBe(2);
        expect(repo.rows[0].filled_events).toHaveLength(1);
        expect(repo.rows[0].filled_events?.[0]).toMatchObject({ brokerExecutionId: "mock-restart-fill" });
        expect(repo.rows[0].submission_state).toBe("filled");
        expect((await restartedWorker.processNext())?.reason).toBe("no_pending_outbox");
    });
    it("retries only after provider lookup confirms not-found and the repository authorizes the retry", async () => {
        const repo = createMemoryExecutionRepository([{
                id: "outbox-safe-retry",
                order_id: "order-safe-retry",
                account_id: "acct-safe-retry",
                client_order_id: "C-safe-retry",
                payload: { id: "outbox-safe-retry", order_id: "order-safe-retry", account_id: "acct-safe-retry", client_order_id: "C-safe-retry", user_id: "synthetic-user", provider: "mock-safe", symbol: "NIFTY", exchange: "NSE", side: "BUY", quantity: 1, order_type: "MARKET", requested_at: new Date().toISOString() },
                state: "PROCESSING",
                status: "PROCESSING",
                submission_state: "started",
                attempt_count: 1,
                attempts: 1,
                claimed_by: "previous-worker",
                claimed_until: new Date(Date.now() - 1).toISOString(),
                available_at: new Date().toISOString(),
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            }]);
        let submissions = 0;
        const provider = createMockProvider({
            submitOrder: async (command) => {
                submissions += 1;
                return { ok: true, state: "ACK", broker_order_id: "mock-safe-retry-order", client_order_id: command.client_order_id };
            },
            getOrderStatus: async () => null,
        });
        const worker = createExecutionWorker(repo, provider, { workerId: "retry-worker", maxAttempts: 3 });
        const result = await worker.processNext();
        expect(result?.status).toBe("processed");
        expect(submissions).toBe(1);
        expect(repo.rows[0].retry_count).toBe(1);
    });
    it("terminally fails an expired ambiguous command after definitive not-found at the retry limit", async () => {
        const repo = createMemoryExecutionRepository([{
                id: "outbox-retry-exhausted",
                order_id: "order-retry-exhausted",
                account_id: "acct-retry-exhausted",
                client_order_id: "C-retry-exhausted",
                payload: { id: "outbox-retry-exhausted", order_id: "order-retry-exhausted", account_id: "acct-retry-exhausted", client_order_id: "C-retry-exhausted", user_id: "synthetic-user", provider: "mock-safe", symbol: "NIFTY", exchange: "NSE", side: "BUY", quantity: 1, order_type: "MARKET", requested_at: new Date().toISOString() },
                state: "PROCESSING",
                status: "PROCESSING",
                submission_state: "started",
                attempt_count: 2,
                attempts: 2,
                retry_count: 2,
                claimed_by: "previous-worker",
                claimed_until: new Date(Date.now() - 1).toISOString(),
                available_at: new Date().toISOString(),
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            }]);
        const submitOrder = vi.fn(async () => ({ ok: true, state: "ACK", broker_order_id: "unexpected", client_order_id: "C-retry-exhausted" }));
        const provider = createMockProvider({ submitOrder, getOrderStatus: async () => null });
        const worker = createExecutionWorker(repo, provider, { workerId: "retry-worker", maxAttempts: 3 });
        const result = await worker.processNext();
        expect(result?.reason).toBe("manual_review_required");
        expect(submitOrder).not.toHaveBeenCalled();
        expect(repo.rows[0].state).toBe("failed");
    });
    it("routes production persistence through service-role D4 RPCs and rejects non-mock providers", async () => {
        const calls = [];
        const repository = new SupabaseExecutionRepository({
            rpc: async (name, args) => {
                calls.push({ name, args });
                if (name === "claim_next_order_execution_outbox")
                    return { data: { claimed: true, recovery_only: false, outbox: { id: "outbox-rpc", order_id: "order-rpc", account_id: "acct-rpc", client_order_id: "C-rpc", state: "processing", attempt_count: 1, available_at: "now", created_at: "now", updated_at: "now", payload: {} } }, error: null };
                if (name === "mark_order_submission_started")
                    return { data: { should_dispatch: true }, error: null };
                return { data: { ok: true }, error: null };
            },
            from: () => ({
                select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }),
                insert: async () => ({ error: null }),
            }),
        });
        expect((await repository.claimNextPending("rpc-worker"))?.id).toBe("outbox-rpc");
        await expect(repository.markSubmissionStarted("outbox-rpc", "rpc-worker", "live-broker"))
            .rejects.toThrow("Execution provider is not permitted.");
        expect(await repository.markSubmissionStarted("outbox-rpc", "rpc-worker", "mock-safe")).toBe(true);
        await repository.markCompleted("outbox-rpc", {
            ok: true,
            state: "ACK",
            broker_order_id: "mock-order-rpc",
            client_order_id: "C-rpc",
        });
        expect(calls.map(({ name }) => name)).toEqual([
            "claim_next_order_execution_outbox",
            "mark_order_submission_started",
            "record_provider_ack",
        ]);
    });
    it("refuses to construct an execution worker with a non-mock provider", () => {
        const provider = createMockProvider();
        Object.defineProperty(provider, "providerName", { value: "dhan" });
        const repo = createMemoryExecutionRepository();
        expect(() => createExecutionWorker({ repo, provider, workerId: "safety-worker" }))
            .toThrow("Execution worker is restricted to the mock-safe provider.");
    });
    it("records immediate provider rejection without treating it as a retryable failure", async () => {
        const repo = createMemoryExecutionRepository([{
                id: "outbox-rejected",
                order_id: "order-rejected",
                account_id: "acct-rejected",
                client_order_id: "C-rejected",
                status: "PENDING",
                attempts: 0,
                payload: { id: "outbox-rejected", order_id: "order-rejected", account_id: "acct-rejected", client_order_id: "C-rejected", user_id: "synthetic-user", provider: "mock-safe", symbol: "NIFTY", exchange: "NSE", side: "BUY", quantity: 1, order_type: "MARKET", requested_at: new Date().toISOString() },
                state: "pending",
                attempt_count: 0,
                available_at: new Date().toISOString(),
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            }]);
        const provider = createMockProvider({
            submitOrder: async (command) => ({ ok: false, state: "REJECTED", broker_order_id: "mock-rejected-order", client_order_id: command.client_order_id, message: "Synthetic rejection" }),
        });
        const result = await createExecutionWorker({ repo, provider, workerId: "reject-worker" }).processNext();
        expect(result?.status).toBe("rejected");
        expect(repo.rows[0].submission_state).toBe("rejected");
    });
    it("fails closed on malformed provider state and does not resubmit", async () => {
        const repo = createMemoryExecutionRepository([{
                id: "outbox-malformed",
                order_id: "order-malformed",
                account_id: "acct-malformed",
                client_order_id: "C-malformed",
                status: "PENDING",
                attempts: 0,
                payload: { id: "outbox-malformed", order_id: "order-malformed", account_id: "acct-malformed", client_order_id: "C-malformed", user_id: "synthetic-user", provider: "mock-safe", symbol: "NIFTY", exchange: "NSE", side: "BUY", quantity: 1, order_type: "MARKET", requested_at: new Date().toISOString() },
                state: "pending",
                attempt_count: 0,
                available_at: new Date().toISOString(),
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            }]);
        const submitOrder = vi.fn(async (command) => ({ ok: true, state: "CORRUPT", broker_order_id: "mock-malformed", client_order_id: command.client_order_id }));
        const provider = createMockProvider({ submitOrder });
        const result = await createExecutionWorker({ repo, provider, workerId: "malformed-worker" }).processNext();
        expect(result?.reason).toBe("manual_review_required");
        expect(submitOrder).toHaveBeenCalledTimes(1);
        expect(repo.rows[0].submission_state).toBe("started");
    });
    it("deduplicates repeated provider fill events in the test repository", async () => {
        const repo = createMemoryExecutionRepository([{
                id: "outbox-duplicate-fill",
                order_id: "order-duplicate-fill",
                account_id: "acct-duplicate-fill",
                client_order_id: "C-duplicate-fill",
                status: "PENDING",
                attempts: 0,
                payload: {},
                state: "pending",
                attempt_count: 0,
                available_at: new Date().toISOString(),
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            }]);
        const fill = { brokerExecutionId: "fill-once", brokerOrderId: "provider-order", localOrderId: "order-duplicate-fill", accountId: "acct-duplicate-fill", symbol: "NIFTY", side: "BUY", quantity: 1, price: 100, executedAt: "2026-10-02T09:00:00.000Z" };
        const result = { ok: true, state: "FILLED", broker_order_id: "provider-order", client_order_id: "C-duplicate-fill", fills: [fill] };
        await repo.markCompleted("outbox-duplicate-fill", result);
        await repo.markCompleted("outbox-duplicate-fill", result);
        expect(repo.rows[0].filled_events).toHaveLength(1);
    });
});
