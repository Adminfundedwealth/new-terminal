import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { createExecutionWorker, createMemoryExecutionRepository, createMockProvider } from "../../server/execution";
const { mockGetSession } = vi.hoisted(() => ({
    mockGetSession: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
    supabase: {
        auth: {
            getSession: mockGetSession,
        },
    },
    SUPABASE_CONFIGURED: true,
}));
describe("Task D5 synthetic execution certification", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.stubGlobal("fetch", vi.fn());
        vi.stubEnv("VITE_TERMINAL_OS_URL", "https://terminal.example.test");
        window.localStorage.clear();
        mockGetSession.mockResolvedValue({
            data: { session: { access_token: "customer-jwt" } },
            error: null,
        });
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });
    it("routes an authenticated customer order through the Terminal OS gateway and the D4 mock-safe execution worker", async () => {
        const { submitTerminalOrderCommand } = await import("@/lib/terminalApi");
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { replayed: false, order: { id: "d5-order-1", status: "requested" } } }), { status: 202 }));
        vi.stubGlobal("fetch", fetchMock);
        const command = {
            account_id: "11111111-1111-4111-8111-111111111111",
            client_order_id: "d5-client-order-001",
            symbol: "NIFTY",
            exchange: "NSE",
            segment: "NSE_EQ",
            side: "BUY",
            quantity: 1,
            order_type: "MARKET",
            time_in_force: "DAY",
            product: "CNC",
            is_overnight: false,
        };
        const terminalResult = await submitTerminalOrderCommand(command);
        expect(terminalResult.ok).toBe(true);
        expect(terminalResult.replayed).toBe(false);
        expect(terminalResult.order).toMatchObject({ id: "d5-order-1", status: "requested" });
        expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/terminal/orders"), expect.objectContaining({
            method: "POST",
            headers: expect.objectContaining({
                Authorization: "Bearer customer-jwt",
            }),
        }));
        const repo = createMemoryExecutionRepository([
            {
                id: "d5-outbox-1",
                order_id: "d5-order-1",
                account_id: command.account_id,
                client_order_id: command.client_order_id,
                status: "PENDING",
                state: "PENDING",
                available_at: new Date().toISOString(),
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                attempts: 0,
                payload: {
                    id: "d5-outbox-1",
                    order_id: "d5-order-1",
                    account_id: command.account_id,
                    client_order_id: command.client_order_id,
                    user_id: "synthetic-customer-user",
                    provider: "mock-safe",
                    symbol: command.symbol,
                    exchange: command.exchange,
                    segment: command.segment,
                    side: command.side,
                    quantity: command.quantity,
                    order_type: command.order_type,
                    product: command.product,
                    is_overnight: command.is_overnight,
                    requested_at: new Date().toISOString(),
                },
            },
        ]);
        const worker = createExecutionWorker({
            repo,
            provider: createMockProvider({
                submitOrder: async (executionCommand) => ({
                    ok: true,
                    state: "ACK",
                    broker_order_id: `mock-d5-${executionCommand.client_order_id}`,
                    client_order_id: executionCommand.client_order_id,
                    message: "synthetic ack",
                    fills: [{
                            brokerExecutionId: `fill-${executionCommand.client_order_id}`,
                            brokerOrderId: `mock-d5-${executionCommand.client_order_id}`,
                            localOrderId: executionCommand.order_id,
                            accountId: executionCommand.account_id,
                            symbol: executionCommand.symbol,
                            side: executionCommand.side,
                            quantity: executionCommand.quantity,
                            price: 100,
                            executedAt: new Date().toISOString(),
                            fees: 0,
                        }],
                }),
            }),
            workerId: "d5-worker",
        });
        const workerResult = await worker.processNext();
        expect(workerResult?.claimed).toBe(true);
        expect(workerResult?.providerResult.state).toBe("FILLED");
        expect(workerResult?.outbox?.submission_state).toBe("filled");
        expect(repo.rows[0].audit_entries).toEqual(expect.arrayContaining([
            expect.objectContaining({ event: "provider_ack" }),
            expect.objectContaining({ event: "execution_fill" }),
        ]));
        expect(repo.rows[0].filled_events).toHaveLength(1);
    });
    it("keeps the same client order identity for a duplicate order retry in the D5 synthetic path", async () => {
        const { submitTerminalOrderCommand } = await import("@/lib/terminalApi");
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ data: { replayed: false, order: { id: "d5-duplicate-order", status: "requested" } } }), { status: 202 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ data: { replayed: true, order: { id: "d5-duplicate-order", status: "requested" } } }), { status: 200 }));
        vi.stubGlobal("fetch", fetchMock);
        const request = {
            account_id: "11111111-1111-4111-8111-111111111111",
            client_order_id: "d5-retry-key",
            symbol: "BANKNIFTY",
            exchange: "NSE",
            segment: "NSE_EQ",
            side: "SELL",
            quantity: 2,
            order_type: "LIMIT",
            price: 101,
            time_in_force: "DAY",
            product: "CNC",
            is_overnight: false,
        };
        const first = await submitTerminalOrderCommand(request);
        expect(first.ok).toBe(true);
        const second = await submitTerminalOrderCommand({ ...request, client_order_id: "d5-retry-key" });
        expect(second.replayed).toBe(true);
        const firstBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
        const secondBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
        expect(firstBody.client_order_id).toBe("d5-retry-key");
        expect(secondBody.client_order_id).toBe("d5-retry-key");
    });
});
