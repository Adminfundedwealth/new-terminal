import { describe, expect, it } from "vitest";
import { ExecutionService, type CanonicalTradingState, type RestartRecoveryResult } from "@/lib/executionService";
import { createBrokerRouter } from "@/lib/brokerRouter";
import { normalizeExecution } from "@/lib/executionModel";
import { normalizeOrder } from "@/lib/orderModel";

class LocalCanonicalStore {
  private state: CanonicalTradingState = { orders: [], executions: [], positions: [] };

  async load(accountId?: string, ownerUserId?: string): Promise<CanonicalTradingState> {
    return JSON.parse(JSON.stringify({
      orders: this.state.orders.filter((order) => (!accountId || order.accountId === accountId) && (!ownerUserId || order.ownerUserId === ownerUserId)),
      executions: this.state.executions.filter((execution) => (!accountId || execution.accountId === accountId) && (!ownerUserId || execution.ownerUserId === ownerUserId)),
      positions: this.state.positions.filter((position) => (!accountId || position.account_id === accountId) && (!ownerUserId || position.owner_user_id === ownerUserId)),
    }));
  }

  async save(state: CanonicalTradingState): Promise<void> {
    this.state = JSON.parse(JSON.stringify(state));
  }

  seed(state: CanonicalTradingState): void {
    this.state = JSON.parse(JSON.stringify(state));
  }

  snapshot(): CanonicalTradingState {
    return JSON.parse(JSON.stringify(this.state));
  }
}

function order(accountId: string, id: string, status: "pending" | "filled" = "pending", quantity = 2) {
  return normalizeOrder({
    id,
    accountId,
    ownerUserId: "user-1",
    clientOrderId: `${id}-client`,
    idempotencyFingerprint: `fingerprint-${id}`,
    brokerOrderId: `broker-${id}`,
    symbol: id.includes("BANK") ? "BANKNIFTY" : "NIFTY",
    exchange: "NSE",
    side: "BUY",
    quantity,
    filledQuantity: status === "filled" ? quantity : 0,
    orderType: "MARKET",
    status,
    createdAt: "2026-09-24T09:15:00.000Z",
    submittedAt: "2026-09-24T09:15:00.000Z",
    updatedAt: "2026-09-24T09:15:01.000Z",
  });
}

function execution(orderId: string, accountId: string, id: string, side: "BUY" | "SELL", price: number, quantity = 2) {
  return normalizeExecution({
    id,
    orderId,
    accountId,
    ownerUserId: "user-1",
    authUserId: "user-1",
    symbol: orderId.includes("BANK") ? "BANKNIFTY" : "NIFTY",
    side,
    quantity,
    executionPrice: price,
    executedAt: `2026-09-24T09:15:${id.endsWith("2") ? "02" : "01"}.000Z`,
    externalExecutionId: `external-${id}`,
  });
}

function service(store: LocalCanonicalStore, recoverUncertainOrder?: (order: { id: string }, context: { accountId: string; ownerUserId: string | null; reason: "restart" }) => Promise<RestartRecoveryResult> | RestartRecoveryResult) {
  return new ExecutionService(createBrokerRouter([]), {
    mode: "SIMULATED",
    authUserId: "user-1",
    canonicalState: store,
    recoverUncertainOrder: recoverUncertainOrder as any,
  });
}

describe("Task 32 restart recovery", () => {
  it("recovers an empty canonical state", async () => {
    const store = new LocalCanonicalStore();
    const recovered = await service(store).recoverFromCanonicalState("acct-1", "user-1");
    expect(recovered).toMatchObject({ orders: [], executions: [], positions: [] });
  });

  it("completes the local create, persist, restart, reload, and replay lifecycle", async () => {
    const store = new LocalCanonicalStore();
    const firstService = service(store);
    const first = await firstService.placeOrder({
      accountId: "acct-1",
      brokerId: "dhan",
      symbol: "NIFTY",
      exchange: "NSE",
      side: "BUY",
      quantity: 1,
      orderType: "MARKET",
      idempotencyKey: "restart-lifecycle-1",
    });
    expect(store.snapshot().orders).toHaveLength(1);

    const restartedService = service(store);
    await restartedService.recoverFromCanonicalState("acct-1", "user-1");
    const replay = await restartedService.placeOrder({
      accountId: "acct-1",
      brokerId: "dhan",
      symbol: "NIFTY",
      exchange: "NSE",
      side: "BUY",
      quantity: 1,
      orderType: "MARKET",
      idempotencyKey: "restart-lifecycle-1",
    });
    expect(replay.replay).toBe(true);
    expect(replay.brokerOrderId).toBe(first.brokerOrderId);
    expect(store.snapshot().orders).toHaveLength(1);
  });

  it("reloads open and filled order lifecycle state without submitting", async () => {
    const store = new LocalCanonicalStore();
    store.seed({ orders: [order("acct-1", "open-1"), order("acct-1", "filled-1", "filled")], executions: [], positions: [] });
    const recovered = await service(store).recoverFromCanonicalState("acct-1", "user-1");
    expect(recovered.orders.map((item) => item.status)).toEqual(["pending", "filled"]);
    const second = await service(store).recoverFromCanonicalState("acct-1", "user-1");
    expect(second.orders).toEqual(recovered.orders);
  });

  it("reconstructs positions, realized and unrealized P&L deterministically", async () => {
    const buyOrder = order("acct-1", "buy-1", "filled");
    const sellOrder = { ...order("acct-1", "sell-1", "filled"), side: "SELL" as const, symbol: "NIFTY" };
    const store = new LocalCanonicalStore();
    store.seed({
      orders: [buyOrder, sellOrder],
      executions: [execution("buy-1", "acct-1", "fill-1", "BUY", 100), execution("sell-1", "acct-1", "fill-2", "SELL", 110)],
      positions: [],
    });
    const recoveredService = service(store);
    await recoveredService.recoverFromCanonicalState("acct-1", "user-1");
    expect(recoveredService.getPositions("acct-1")).toHaveLength(0);
    expect(recoveredService.getAccountValuation("acct-1", 1000).realizedPnl).toBe(20);

    store.seed({ orders: [order("acct-1", "open-1")], executions: [execution("open-1", "acct-1", "fill-3", "BUY", 100)], positions: [] });
    const openService = service(store);
    await openService.recoverFromCanonicalState("acct-1", "user-1");
    expect(openService.getPositions("acct-1")[0]).toMatchObject({ quantity: 2, averageEntryPrice: 100, unrealizedPnl: 0 });
  });

  it("does not duplicate executions or positions across repeated restart recovery", async () => {
    const store = new LocalCanonicalStore();
    store.seed({ orders: [order("acct-1", "open-1")], executions: [execution("open-1", "acct-1", "fill-1", "BUY", 100)], positions: [] });
    const recoveredService = service(store);
    await recoveredService.recoverFromCanonicalState("acct-1", "user-1");
    const first = recoveredService.getPositions("acct-1");
    await recoveredService.recoverFromCanonicalState("acct-1", "user-1");
    expect(recoveredService.getPositions("acct-1")).toEqual(first);
    expect(store.snapshot().executions).toHaveLength(1);
  });

  it("invokes the existing uncertain-state recovery contract and remains unresolved when broker state is unavailable", async () => {
    const store = new LocalCanonicalStore();
    store.seed({ orders: [order("acct-1", "uncertain-1")], executions: [], positions: [] });
    const calls: string[] = [];
    const recover = async (uncertainOrder: { id: string }): Promise<RestartRecoveryResult> => {
      calls.push(uncertainOrder.id);
      return "unresolved";
    };
    await service(store, recover).recoverFromCanonicalState("acct-1", "user-1");
    expect(calls).toEqual(["uncertain-1"]);
    expect(store.snapshot().orders[0].status).toBe("pending");
  });

  it("isolates accounts during reload", async () => {
    const store = new LocalCanonicalStore();
    store.seed({ orders: [order("acct-1", "one-1"), order("acct-2", "two-1")], executions: [execution("one-1", "acct-1", "fill-1", "BUY", 100), execution("two-1", "acct-2", "fill-2", "BUY", 200)], positions: [] });
    const recovered = await service(store).recoverFromCanonicalState("acct-1", "user-1");
    expect(recovered.orders.map((item) => item.accountId)).toEqual(["acct-1"]);
    expect(recovered.executions.map((item) => item.accountId)).toEqual(["acct-1"]);
    expect(recovered.positions.every((position) => position.account_id === "acct-1")).toBe(true);
  });
});
