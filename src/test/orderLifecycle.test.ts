import { describe, expect, it } from "vitest";
import { cancelAllOrders, cancelOrder, modifyOrder, type CanonicalOrderForLifecycle } from "@/lib/orderLifecycle";

const makeOrder = (overrides: Partial<CanonicalOrderForLifecycle> = {}): CanonicalOrderForLifecycle => ({
  id: "order-1",
  accountId: "acct-1",
  ownerUserId: "user-1",
  clientOrderId: "client-1",
  brokerOrderId: "broker-1",
  instrumentId: null,
  symbol: "NIFTY",
  exchange: "NSE",
  segment: "NFO",
  instrumentType: "INDEX",
  side: "BUY",
  orderType: "LIMIT",
  quantity: 50,
  filledQuantity: 0,
  price: 22000,
  averageFillPrice: null,
  triggerPrice: null,
  stopLoss: null,
  takeProfit: null,
  timeInForce: "DAY",
  status: "open",
  rejectionReason: null,
  cancellationReason: null,
  parentOrderId: null,
  replacesOrderId: null,
  createdAt: "2025-01-01T00:00:00.000Z",
  submittedAt: "2025-01-01T00:00:30.000Z",
  updatedAt: "2025-01-01T00:00:30.000Z",
  cancelRequestedAt: null,
  cancelledAt: null,
  completedAt: null,
  ...overrides,
});

describe("authoritative cancel and modify lifecycle", () => {
  it("allows cancellation for open orders with matching ownership", async () => {
    const result = await cancelOrder({
      order: makeOrder(),
      authUserId: "user-1",
      accountId: "acct-1",
      brokerAdapter: {
        cancelOrder: async () => ({ provider: "dhan", capability: "orders", state: "not_verified", message: "accepted" }),
      },
    });

    expect(result.ok).toBe(true);
    expect(result.order.status).toBe("cancel_requested");
    expect(result.order.cancelRequestedAt).not.toBeNull();
  });

  it("rejects unauthenticated and wrong-account cancellations", async () => {
    await expect(cancelOrder({ order: makeOrder(), authUserId: "user-2", accountId: "acct-1" })).resolves.toMatchObject({ ok: false });
    await expect(cancelOrder({ order: makeOrder(), authUserId: "user-1", accountId: "acct-2" })).resolves.toMatchObject({ ok: false });
  });

  it("finalizes to cancelled or failed when the broker confirms or rejects a cancellation", async () => {
    const confirmed = await cancelOrder({
      order: makeOrder({ status: "open" }),
      authUserId: "user-1",
      accountId: "acct-1",
      brokerAdapter: {
        cancelOrder: async () => ({ provider: "dhan", capability: "orders", state: "CANCELLED", message: "cancelled" }),
      },
    });

    expect(confirmed.ok).toBe(true);
    if (confirmed.ok) {
      expect(confirmed.order.status).toBe("cancelled");
      expect(confirmed.order.cancelledAt).not.toBeNull();
    }

    const rejected = await cancelOrder({
      order: makeOrder({ status: "open" }),
      authUserId: "user-1",
      accountId: "acct-1",
      brokerAdapter: {
        cancelOrder: async () => ({ provider: "dhan", capability: "orders", state: "REJECTED", message: "broker rejected cancel" }),
      },
    });

    expect(rejected.ok).toBe(false);
    if (rejected.ok === false) {
      expect(rejected.order?.status).toBe("failed");
    }
  });

  it("rejects filled orders from cancellation", async () => {
    const result = await cancelOrder({ order: makeOrder({ status: "filled", filledQuantity: 50 }), authUserId: "user-1", accountId: "acct-1" });
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.error.code).toBe("INVALID_ORDER_STATE");
      return;
    }
  });

  it("allows a validated quantity or price modification", async () => {
    const result = await modifyOrder({
      order: makeOrder(),
      authUserId: "user-1",
      accountId: "acct-1",
      updates: { quantity: 75, price: 21950 },
      brokerAdapter: {
        modifyOrder: async () => ({ provider: "dhan", capability: "orders", state: "not_verified", message: "accepted" }),
      },
      riskGate: async () => ({ decision: "ALLOW", reason_code: null, reason: "ok", account_id: "acct-1", rule_evaluated: "pre_trade_pipeline", current_value: null, configured_limit: null, risk_state: "ACTIVE", timestamp: new Date().toISOString() }),
    });

    expect(result.ok).toBe(true);
    expect(result.order.quantity).toBe(75);
    expect(result.order.price).toBe(21950);
  });

  it("rejects ownership bypass and invalid modification payloads", async () => {
    await expect(modifyOrder({ order: makeOrder(), authUserId: "user-2", accountId: "acct-1", updates: { quantity: 10 } })).resolves.toMatchObject({ ok: false });
    await expect(modifyOrder({ order: makeOrder(), authUserId: "user-1", accountId: "acct-1", updates: { symbol: "BANKNIFTY" } as any })).resolves.toMatchObject({ ok: false });
  });

  it("only cancels orders owned by the authenticated account and leaves terminal orders alone", async () => {
    const orders = [
      makeOrder({ id: "o1", accountId: "acct-1", ownerUserId: "user-1", status: "open" }),
      makeOrder({ id: "o2", accountId: "acct-2", ownerUserId: "user-2", status: "open" }),
      makeOrder({ id: "o3", accountId: "acct-1", ownerUserId: "user-1", status: "filled" }),
    ];

    const result = await cancelAllOrders({
      orders,
      authUserId: "user-1",
      accountId: "acct-1",
      brokerAdapter: {
        cancelOrder: async () => ({ provider: "dhan", capability: "orders", state: "not_verified", message: "accepted" }),
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("cancelAllOrders unexpectedly failed");
    }
    expect(result.cancelled.map((order) => order.id)).toEqual(["o1"]);
    expect(result.skipped.map((order) => order.id)).toEqual(["o2", "o3"]);
  });
});
