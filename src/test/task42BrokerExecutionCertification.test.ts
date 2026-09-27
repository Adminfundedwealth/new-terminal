import { describe, expect, it } from "vitest";
import { createBrokerRouter } from "@/lib/brokerRouter";
import { handleBrokerResponse, normalizeBrokerResponse } from "@/lib/brokerResponseHandler";
import { createMockBrokerRuntime } from "@/lib/brokerRuntime";
import { ExecutionService } from "@/lib/executionService";
import { cancelOrder, modifyOrder } from "@/lib/orderLifecycle";
import { normalizeOrder } from "@/lib/orderModel";
import type { RiskEvaluation } from "@/lib/riskEngine";

const allowRisk = async (): Promise<RiskEvaluation> => ({
  decision: "ALLOW",
  reason_code: null,
  reason: "certification approval",
  account_id: "acct-42",
  rule_evaluated: "task42",
  current_value: null,
  configured_limit: null,
  risk_state: "ACTIVE",
  timestamp: new Date().toISOString(),
});

const realOptions = (runtime: ReturnType<typeof createMockBrokerRuntime>) => ({
  mode: "REAL" as const,
  realOrderEnabled: true,
  authUserId: "user-42",
  brokerRuntime: runtime,
  preTradeRiskGate: allowRisk,
});

function lifecycleOrder(status: "open" | "cancelled" | "filled" = "open") {
  return normalizeOrder({
    id: "order-42",
    accountId: "acct-42",
    ownerUserId: "user-42",
    clientOrderId: "client-42",
    brokerOrderId: "broker-42",
    symbol: "NIFTY",
    exchange: "NSE",
    segment: "NFO",
    side: "BUY",
    orderType: "LIMIT",
    quantity: 10,
    filledQuantity: status === "filled" ? 10 : 0,
    price: 100,
    status,
  });
}

describe("Task 42 broker execution certification", () => {
  it("routes the selected provider and keeps provider fields at the adapter boundary", () => {
    const router = createBrokerRouter([{ brokerId: "zerodha", values: {}, addedAt: "", isActive: true }]);
    expect(router.getActiveProvider()).toBe("zerodha");
    expect(router.getAdapter()?.id).toBe("zerodha");
    expect(router.getAdapter()?.capabilities.orders).toBe("not_verified");
  });

  it.each([
    [{ ok: true, state: "ACK", brokerOrderId: "broker-42", clientOrderId: "client-42" }, "pending"],
    [{ ok: false, state: "REJECTED", brokerOrderId: "broker-43", message: "margin" }, "rejected"],
    [{ state: "timeout", message: "no response" }, "pending"],
    [{ state: "transport_error", message: "offline" }, "pending"],
  ] as const)("normalizes broker outcome %j into canonical state %s", (raw, status) => {
    const result = handleBrokerResponse(normalizeOrder({ id: "order-42", accountId: "acct-42", ownerUserId: "user-42", symbol: "NIFTY", side: "BUY", orderType: "MARKET", quantity: 1 }), raw, { accountId: "acct-42", authUserId: "user-42" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.order.status).toBe(status);
  });

  it("rejects malformed and unknown broker responses without claiming success", () => {
    expect(normalizeBrokerResponse({ ok: true }).outcome).toBe("malformed");
    expect(normalizeBrokerResponse({ state: "UNKNOWN" }).outcome).toBe("unknown");
  });

  it("enforces risk, ownership, idempotency, and canonical acknowledgement before runtime placement", async () => {
    const runtime = createMockBrokerRuntime({ orderAcks: { "client-42": { ok: true, state: "ACK", brokerOrderId: "broker-42" } } });
    const service = new ExecutionService(createBrokerRouter([]), realOptions(runtime));
    const request = { accountId: "acct-42", brokerId: "dhan" as const, symbol: "NIFTY", exchange: "NSE", side: "BUY" as const, quantity: 1, orderType: "MARKET", idempotencyKey: "client-42", authUserId: "user-42" };
    const [first, replay] = await Promise.all([service.placeOrder(request), service.placeOrder(request)]);
    expect(first.state).toBe("REAL");
    expect(replay.replay).toBe(true);
    expect(runtime.calls).toHaveLength(1);
    expect(first.canonicalOrder).toMatchObject({ clientOrderId: "client-42", brokerOrderId: "broker-42", accountId: "acct-42", side: "BUY", quantity: 1 });

    const denied = await new ExecutionService(createBrokerRouter([]), { ...realOptions(runtime), accountResolver: async (accountId) => accountId === "acct-42" ? { id: accountId, ownerUserId: "user-42", status: "ACTIVE", isActive: true, brokerProvider: "dhan", brokerAccountRef: "dhan-acct-42" } : null }).placeOrder({ ...request, accountId: "other-account", idempotencyKey: "other-client" });
    expect(denied.state).toBe("REJECTED");
    expect(denied.reasonCode).not.toBeNull();
  });

  it("ingests partial and full fills once and preserves account isolation across repeated polling", async () => {
    const runtime = createMockBrokerRuntime({
      orderAcks: { "client-42": { ok: true, state: "ACK", brokerOrderId: "broker-42" } },
      orderStatusMap: {
        "broker-42": {
          status: "PARTIALLY_FILLED",
          brokerOrderId: "broker-42",
          fills: [{ brokerExecutionId: "fill-42", brokerOrderId: "broker-42", localOrderId: "order:acct-42:client-42", accountId: "acct-42", symbol: "NIFTY", side: "BUY", quantity: 1, price: 100, executedAt: "2026-09-25T09:15:00.000Z" }],
        },
      },
    });
    const service = new ExecutionService(createBrokerRouter([]), realOptions(runtime));
    const receipt = await service.placeOrder({ accountId: "acct-42", brokerId: "dhan", symbol: "NIFTY", exchange: "NSE", side: "BUY", quantity: 2, orderType: "MARKET", idempotencyKey: "client-42", authUserId: "user-42" });
    const first = await service.syncBrokerOrder(receipt.brokerOrderId, "acct-42", "user-42");
    const second = await service.syncBrokerOrder(receipt.brokerOrderId, "acct-42", "user-42");
    expect(first.position?.quantity).toBe(1);
    expect(second.position?.quantity).toBe(1);
    expect(service.exportCanonicalState().executions).toHaveLength(1);
    expect(service.getPositions("acct-42")[0].quantity).toBe(1);
    expect(service.getPositions("other-account")).toEqual([]);
  });

  it("keeps cancellation idempotent and prevents terminal modification", async () => {
    let cancelCalls = 0;
    const cancelled = await cancelOrder({ order: lifecycleOrder(), authUserId: "user-42", accountId: "acct-42", brokerAdapter: { cancelOrder: async () => { cancelCalls += 1; return { state: "CANCELLED", message: "confirmed" }; } } });
    expect(cancelled).toMatchObject({ ok: true, order: { status: "cancelled" } });
    const replay = await cancelOrder({ order: cancelled.ok ? cancelled.order : lifecycleOrder("cancelled"), authUserId: "user-42", accountId: "acct-42", brokerAdapter: { cancelOrder: async () => { cancelCalls += 1; return { state: "CANCELLED" }; } } });
    expect(replay).toMatchObject({ ok: true, brokerOutcome: "already_requested" });
    expect(cancelCalls).toBe(1);
    const modification = await modifyOrder({ order: lifecycleOrder("filled"), authUserId: "user-42", accountId: "acct-42", updates: { price: 101 } });
    expect(modification.ok).toBe(false);
    if (!modification.ok) {
      const error = (modification as { error: { code: string } }).error;
      expect(error.code).toBe("INVALID_ORDER_STATE");
    }
  });
});