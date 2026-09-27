import { describe, expect, it } from "vitest";
import { calculateDailyLoss, calculateDrawdown, type RiskRules, type RiskStateInput } from "@/lib/riskEngine";
import { PositionEngine } from "@/lib/positionEngine";
import { recoverRiskState } from "@/lib/riskRecovery";
import { ExecutionService } from "@/lib/executionService";
import { createBrokerRouter } from "@/lib/brokerRouter";
import type { CanonicalOrder } from "@/lib/orderModel";
import type { CanonicalExecution } from "@/lib/executionModel";

const rules: RiskRules = {
  daily_loss_limit: 100,
  maximum_drawdown: 200,
  drawdown_model: "static",
  max_open_positions: 3,
  max_position_quantity: 20,
};

function state(accountId = "account-34", overrides: Partial<RiskStateInput> = {}): RiskStateInput {
  return {
    status: "active",
    risk_state: "ACTIVE",
    initial_balance: 1_000,
    starting_balance: 1_000,
    current_balance: 1_000,
    current_equity: 1_000,
    daily_starting_equity: 1_000,
    realized_pnl_today: 0,
    unrealized_pnl_today: 0,
    fees_today: 0,
    daily_trade_count: 0,
    open_positions: [],
    market_data_fresh: true,
    ...overrides,
  };
}

function recovered(accountId = "account-34", balance = 1_000, setup: (engine: PositionEngine) => void = () => undefined, overrides: Partial<RiskStateInput> = {}) {
  const engine = new PositionEngine(accountId, { now: () => new Date("2026-09-24T10:00:00.000Z") });
  setup(engine);
  return recoverRiskState({ accountId, accountState: state(accountId, { current_balance: balance, ...overrides }), rules, valuation: engine.accountValuation(balance), positions: engine.riskSnapshot(), asOf: new Date("2026-09-24T10:00:00.000Z") });
}

function buy(engine: PositionEngine, accountId: string, id: string, symbol: string, quantity: number, price: number) {
  engine.applyExecution({ id, accountId, symbol, side: "BUY", quantity, price, executedAt: "2026-09-24T09:00:00.000Z" });
}

describe("Task 34 risk recovery", () => {
  it("recovers a safe account with no positions", () => {
    const result = recovered();
    expect(result.metrics).toMatchObject({ balance: 1_000, equity: 1_000, realizedPnl: 0, unrealizedPnl: 0, dailyLoss: 0, drawdown: 0 });
    expect(result.eligible).toBe(true);
  });

  it("recovers an open long and its unrealized loss", () => {
    const result = recovered("long", 1_000, (engine) => { buy(engine, "long", "long-open", "NIFTY", 2, 100); engine.valueMarketPrice({ symbol: "NIFTY", price: 90, asOf: "2026-09-24T10:00:00.000Z" }); });
    expect(result.metrics.unrealizedPnl).toBe(-20);
    expect(result.riskState.open_positions).toMatchObject([{ symbol: "NIFTY", quantity: 2, is_open: true }]);
  });

  it("recovers an open short with the correct mark-to-market sign", () => {
    const engine = new PositionEngine("short", { now: () => new Date("2026-09-24T10:00:00.000Z") });
    engine.applyExecution({ id: "short-open", accountId: "short", symbol: "BANKNIFTY", side: "SELL", quantity: 2, price: 100, executedAt: "2026-09-24T09:00:00.000Z" });
    engine.valueMarketPrice({ symbol: "BANKNIFTY", price: 110, asOf: "2026-09-24T10:00:00.000Z" });
    const result = recoverRiskState({ accountId: "short", accountState: state("short"), rules, valuation: engine.accountValuation(1_000), positions: engine.riskSnapshot() });
    expect(result.metrics.unrealizedPnl).toBe(-20);
  });

  it("recovers multiple positions and remaining position limits", () => {
    const result = recovered("multiple", 1_000, (engine) => {
      buy(engine, "multiple", "nifty", "NIFTY", 2, 100);
      buy(engine, "multiple", "infy", "INFY", 3, 100);
    });
    expect(result.riskState.open_positions).toHaveLength(2);
    expect(result.remainingLimits).toMatchObject({ openPositions: 1, positionQuantity: 15 });
  });

  it("restores realized losses from recovered executions", () => {
    const engine = new PositionEngine("realized");
    engine.applyExecution({ id: "open", accountId: "realized", symbol: "NIFTY", side: "BUY", quantity: 2, price: 100, executedAt: "2026-09-24T09:00:00.000Z" });
    engine.applyExecution({ id: "close", accountId: "realized", symbol: "NIFTY", side: "SELL", quantity: 2, price: 90, executedAt: "2026-09-24T09:30:00.000Z" });
    const result = recoverRiskState({ accountId: "realized", accountState: state("realized", { current_balance: 980 }), rules, valuation: engine.accountValuation(980), positions: engine.riskSnapshot() });
    expect(result.metrics.realizedPnl).toBe(-20);
    expect(result.metrics.equity).toBe(980);
  });

  it("restores combined realized and unrealized losses", () => {
    const result = recovered("combined", 980, (engine) => {
      buy(engine, "combined", "open", "NIFTY", 2, 100);
      engine.applyExecution({ id: "close", accountId: "combined", symbol: "NIFTY", side: "SELL", quantity: 1, price: 90, executedAt: "2026-09-24T09:30:00.000Z" });
      engine.valueMarketPrice({ symbol: "NIFTY", price: 90, asOf: "2026-09-24T10:00:00.000Z" });
    });
    expect(result.metrics).toMatchObject({ realizedPnl: -10, unrealizedPnl: -10, equity: 970, dailyLoss: 30 });
  });

  it("reconstructs daily loss and maximum drawdown after restart", () => {
    const result = recovered("loss", 850, () => undefined, { daily_starting_equity: 1_000 });
    expect(result.dailyLoss).toBe(150);
    expect(result.drawdown).toMatchObject({ amount: 150, base: 1_000 });
    expect(result.breachReasonCode).toBe("DAILY_LOSS_EXCEEDED");
  });

  it("keeps a previous drawdown breach authoritative", () => {
    const result = recovered("breached", 1_000, () => undefined, { risk_state: "BREACHED" });
    expect(result.riskState.risk_state).toBe("BREACHED");
    expect(result.eligible).toBe(false);
    expect(result.breachReasonCode).toBe("ACCOUNT_BREACHED");
  });

  it("keeps a previously blocked account blocked", () => {
    const result = recovered("locked", 1_000, () => undefined, { risk_state: "LOCKED" });
    expect(result.riskState.risk_state).toBe("LOCKED");
    expect(result.eligible).toBe(false);
  });

  it("keeps a safe account eligible and agrees with Tasks 27 calculations", () => {
    const result = recovered("agree", 950);
    expect(result.eligible).toBe(true);
    expect(result.dailyLoss).toBe(calculateDailyLoss(result.riskState));
    expect(result.drawdown).toEqual(calculateDrawdown(result.riskState, rules));
  });

  it("is deterministic and does not duplicate the same recovery event", () => {
    const first = recovered("idempotent", 800);
    const second = recovered("idempotent", 800);
    expect(second.riskState).toEqual(first.riskState);
    expect(second.riskEvent?.reference).toBe(first.riskEvent?.reference);
  });

  it("isolates recovery between multiple accounts", () => {
    const safe = recovered("safe-account", 1_000);
    const breached = recovered("breached-account", 800);
    expect(safe.accountId).not.toBe(breached.accountId);
    expect(safe.eligible).toBe(true);
    expect(breached.eligible).toBe(false);
  });

  it("reconstructs the same risk state through the actual service restart path", async () => {
    const order: CanonicalOrder = {
      id: "order-restart", accountId: "restart-account", ownerUserId: "user-34", clientOrderId: "restart-client", brokerOrderId: null, instrumentId: "nifty", symbol: "NIFTY", exchange: "NSE", segment: "NSE_FNO", instrumentType: null, side: "BUY", orderType: "MARKET", quantity: 2, filledQuantity: 2, price: 100, averageFillPrice: 100, triggerPrice: null, stopLoss: null, takeProfit: null, timeInForce: "DAY", status: "filled", rejectionReason: null, cancellationReason: null, parentOrderId: null, replacesOrderId: null, createdAt: "2026-09-24T09:00:00.000Z", submittedAt: "2026-09-24T09:00:00.000Z", updatedAt: "2026-09-24T09:00:00.000Z", cancelRequestedAt: null, cancelledAt: null, completedAt: "2026-09-24T09:00:00.000Z",
    };
    const execution: CanonicalExecution = { id: "execution-restart", orderId: order.id, accountId: order.accountId, ownerUserId: "user-34", instrumentId: "nifty", symbol: "NIFTY", side: "BUY", quantity: 2, executionPrice: 100, executedAt: "2026-09-24T09:00:00.000Z", externalExecutionId: "restart-fill", fees: 0, taxes: 0, netAmount: null };
    let persisted = { orders: [order], executions: [execution], positions: [] as never[] };
    const events: unknown[] = [];
    const service = new ExecutionService(createBrokerRouter([]), {
      riskRules: rules,
      riskState: state("restart-account", { current_balance: 1_000 }),
      canonicalState: { async load() { return persisted; }, async save(next) { persisted = next as typeof persisted; } },
      onRiskEvent: (event) => events.push(event),
    });
    await service.recoverFromCanonicalState("restart-account", "user-34");
    const before = service.getRecoveredRiskState("restart-account");
    await service.recoverFromCanonicalState("restart-account", "user-34");
    const after = service.getRecoveredRiskState("restart-account");
    expect(after).toEqual(before);
    expect(after?.riskState.open_positions).toMatchObject([{ symbol: "NIFTY", quantity: 2 }]);
    expect(events).toHaveLength(0);
  });
});