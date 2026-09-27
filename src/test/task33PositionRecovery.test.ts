import { describe, expect, it } from "vitest";
import { ExecutionService, type CanonicalTradingState, type CanonicalTradingStatePersistence, type PositionRecoveryResult } from "@/lib/executionService";
import { createBrokerRouter } from "@/lib/brokerRouter";
import type { CanonicalExecution } from "@/lib/executionModel";
import type { CanonicalOrder } from "@/lib/orderModel";
import type { CanonicalPositionRow } from "@/lib/positionPersistence";

const timestamp = (minute: number) => `2026-09-24T09:${String(minute).padStart(2, "0")}:00.000Z`;

function order(accountId: string, ownerUserId: string, symbol: string, instrumentId: string, quantity: number, id = "order-1"): CanonicalOrder {
  return {
    id,
    accountId,
    ownerUserId,
    clientOrderId: null,
    idempotencyFingerprint: null,
    brokerOrderId: null,
    instrumentId,
    symbol,
    exchange: "NSE",
    segment: "NFO",
    instrumentType: "OPTION",
    side: "BUY",
    orderType: "MARKET",
    quantity,
    filledQuantity: quantity,
    price: null,
    averageFillPrice: null,
    triggerPrice: null,
    stopLoss: null,
    takeProfit: null,
    timeInForce: "DAY",
    status: "filled",
    rejectionReason: null,
    cancellationReason: null,
    parentOrderId: null,
    replacesOrderId: null,
    createdAt: timestamp(1),
    submittedAt: timestamp(1),
    updatedAt: timestamp(1),
    cancelRequestedAt: null,
    cancelledAt: null,
    completedAt: timestamp(1),
  };
}

function execution(overrides: Partial<CanonicalExecution> = {}): CanonicalExecution {
  return {
    id: "execution-1",
    orderId: "order-1",
    accountId: "account-1",
    ownerUserId: "owner-1",
    instrumentId: "instrument-1",
    symbol: "NIFTY",
    side: "BUY",
    quantity: 5,
    executionPrice: 100,
    executedAt: timestamp(2),
    externalExecutionId: "external-1",
    fees: 0,
    taxes: 0,
    netAmount: null,
    ...overrides,
  };
}

class MemoryState implements CanonicalTradingStatePersistence {
  public saves = 0;
  constructor(public state: CanonicalTradingState) {}
  async load(accountId?: string, ownerUserId?: string): Promise<CanonicalTradingState> {
    return {
      ...this.state,
      orders: this.state.orders.filter((item) => (!accountId || item.accountId === accountId) && (!ownerUserId || item.ownerUserId === ownerUserId)),
      executions: this.state.executions.filter((item) => (!accountId || item.accountId === accountId) && (!ownerUserId || item.ownerUserId === ownerUserId)),
      positions: this.state.positions.filter((item) => (!accountId || item.account_id === accountId) && (!ownerUserId || item.owner_user_id === ownerUserId)),
    };
  }
  async save(state: CanonicalTradingState): Promise<void> {
    this.saves += 1;
    this.state = state;
  }
}

async function runRecovery(state: CanonicalTradingState, accountId?: string) {
  const persistence = new MemoryState(state);
  const service = new ExecutionService(createBrokerRouter([]), { mode: "SIMULATED", canonicalState: persistence });
  const recovered = await service.recoverFromCanonicalState(accountId);
  return { recovered, recovery: service.getLastPositionRecovery(), persistence };
}

describe("Task 33 position recovery", () => {
  it("reconstructs long, short, partial close, full close, and reversals deterministically", async () => {
    const longOrder = order("account-1", "owner-1", "NIFTY", "instrument-1", 15, "long-order");
    const shortOrder = order("account-1", "owner-1", "BANKNIFTY", "instrument-2", 10, "short-order");
    const executions = [
      execution({ id: "long-open", orderId: longOrder.id, quantity: 10, executionPrice: 100, executedAt: timestamp(2), externalExecutionId: "L-1" }),
      execution({ id: "long-add", orderId: longOrder.id, quantity: 5, executionPrice: 110, executedAt: timestamp(3), externalExecutionId: "L-2" }),
      execution({ id: "long-reverse", orderId: longOrder.id, side: "SELL", quantity: 20, executionPrice: 120, executedAt: timestamp(4), externalExecutionId: "L-3" }),
      execution({ id: "short-open", orderId: shortOrder.id, symbol: "BANKNIFTY", instrumentId: "instrument-2", side: "SELL", quantity: 10, executionPrice: 200, executedAt: timestamp(2), externalExecutionId: "S-1" }),
      execution({ id: "short-close", orderId: shortOrder.id, symbol: "BANKNIFTY", instrumentId: "instrument-2", side: "BUY", quantity: 4, executionPrice: 190, executedAt: timestamp(3), externalExecutionId: "S-2" }),
    ];
    const state: CanonicalTradingState = { orders: [longOrder, shortOrder], executions, positions: [] };
    const first = await runRecovery(state);
    const second = await runRecovery(state);

    expect(first.recovered.positions).toEqual(expect.arrayContaining([
      expect.objectContaining({ symbol: "NIFTY", side: "short", quantity: 5, average_price: 120, realized_pnl: 250.00000005 }),
      expect.objectContaining({ symbol: "BANKNIFTY", side: "short", quantity: 6, average_price: 200, realized_pnl: 40 }),
    ]));
    expect(first.recovered).toEqual(second.recovered);
    expect(first.recovery.status).toBe("MATCH");
    expect(first.persistence.saves).toBe(1);
  });

  it("recovers a weighted-average position and keeps duplicate replay idempotent", async () => {
    const firstExecution = execution({ id: "weighted-1", orderId: "order-1", quantity: 5, executionPrice: 100, externalExecutionId: "WEIGHTED-1" });
    const secondExecution = execution({ id: "weighted-2", orderId: "order-1", quantity: 3, executionPrice: 110, externalExecutionId: "WEIGHTED-2", executedAt: timestamp(3) });
    const result = await runRecovery({ orders: [order("account-1", "owner-1", "NIFTY", "instrument-1", 8)], executions: [firstExecution, secondExecution, firstExecution], positions: [] });

    expect(result.recovered.positions[0]).toMatchObject({ quantity: 8, average_price: 103.75 });
    expect(result.recovered.executions).toHaveLength(2);
    expect(result.recovery.status).toBe("MATCH");
  });

  it("recovers a full close with realized P&L and a short-to-long reversal", async () => {
    const closeOrder = order("account-1", "owner-1", "INFY", "instrument-infy", 2, "close-order");
    const reversalOrder = order("account-1", "owner-1", "TCS", "instrument-tcs", 3, "reversal-order");
    const state: CanonicalTradingState = {
      orders: [closeOrder, reversalOrder],
      executions: [
        execution({ id: "close-open", orderId: closeOrder.id, symbol: "INFY", instrumentId: "instrument-infy", quantity: 2, executionPrice: 100, externalExecutionId: "CLOSE-OPEN" }),
        execution({ id: "close-exit", orderId: closeOrder.id, symbol: "INFY", instrumentId: "instrument-infy", side: "SELL", quantity: 2, executionPrice: 125, executedAt: timestamp(3), externalExecutionId: "CLOSE-EXIT" }),
        execution({ id: "short-open", orderId: reversalOrder.id, symbol: "TCS", instrumentId: "instrument-tcs", side: "SELL", quantity: 2, executionPrice: 200, externalExecutionId: "REVERSAL-OPEN" }),
        execution({ id: "short-to-long", orderId: reversalOrder.id, symbol: "TCS", instrumentId: "instrument-tcs", side: "BUY", quantity: 5, executionPrice: 190, executedAt: timestamp(3), externalExecutionId: "REVERSAL-CLOSE" }),
      ],
      positions: [],
    };
    const persistence = new MemoryState(state);
    const service = new ExecutionService(createBrokerRouter([]), { mode: "SIMULATED", canonicalState: persistence });
    const recovered = await service.recoverFromCanonicalState();

    expect(recovered.positions).toEqual([expect.objectContaining({ symbol: "TCS", side: "long", quantity: 3, average_price: 190, realized_pnl: 20 })]);
    expect(service.getRecoveredAccountValuation("account-1", 10_000)).toMatchObject({ realizedPnl: 70, openPositionCount: 1 });
    expect(service.getLastPositionRecovery().status).toBe("MATCH");
  });

  it("rejects conflicting external execution payloads during recovery", async () => {
    const first = execution({ id: "conflict-1", externalExecutionId: "SAME", quantity: 2 });
    const conflicting = execution({ id: "conflict-2", externalExecutionId: "SAME", quantity: 3 });
    await expect(runRecovery({ orders: [order("account-1", "owner-1", "NIFTY", "instrument-1", 5)], executions: [first, conflicting], positions: [] })).rejects.toThrow(/duplicate|inconsistent|conflict/i);
  });

  it("isolates multiple trading accounts and preserves an agreeing canonical position identifier", async () => {
    const accountTwoOrder = order("account-2", "owner-2", "NIFTY", "instrument-1", 2, "account-two-order");
    const accountTwoExecution = execution({ id: "account-two-execution", orderId: accountTwoOrder.id, accountId: "account-2", ownerUserId: "owner-2", quantity: 2, executionPrice: 90 });
    const persisted: CanonicalPositionRow = {
      id: "canonical-position-2",
      account_id: "account-2",
      owner_user_id: "owner-2",
      instrument_id: "instrument-1",
      symbol: "NIFTY",
      exchange: "NSE",
      quantity: 2,
      side: "long",
      average_price: 90,
      last_price: 90,
      unrealized_pnl: 0,
      realized_pnl: 0,
      stop_loss: null,
      take_profit: null,
      position_status: "open",
      opened_at: timestamp(2),
      closed_at: null,
      updated_at: timestamp(2),
    };
    const result = await runRecovery({ orders: [accountTwoOrder], executions: [accountTwoExecution], positions: [persisted] }, "account-2");

    expect(result.recovered.positions[0].id).toBe("canonical-position-2");
    expect(result.recovery.status).toBe("MATCH");
  });

  it("flags persisted position conflicts without overwriting canonical state", async () => {
    const persisted: CanonicalPositionRow = {
      id: "canonical-position-1",
      account_id: "account-1",
      owner_user_id: "owner-1",
      instrument_id: "instrument-1",
      symbol: "NIFTY",
      exchange: "NSE",
      quantity: 99,
      side: "long",
      average_price: 999,
      last_price: 999,
      unrealized_pnl: 0,
      realized_pnl: 0,
      stop_loss: null,
      take_profit: null,
      position_status: "open",
      opened_at: timestamp(2),
      closed_at: null,
      updated_at: timestamp(2),
    };
    const state: CanonicalTradingState = { orders: [order("account-1", "owner-1", "NIFTY", "instrument-1", 5)], executions: [execution()], positions: [persisted] };
    const result = await runRecovery(state);

    expect(result.recovery).toMatchObject({ status: "MISMATCH", persistedPositionCount: 1, reconstructedPositionCount: 1 });
    expect(result.recovery.mismatches[0].reconstructed).toMatchObject({ quantity: 5, average_price: 100 });
    expect(result.persistence.saves).toBe(0);
    expect(result.persistence.state.positions[0]).toEqual(persisted);
  });
});
