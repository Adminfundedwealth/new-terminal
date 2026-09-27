import { describe, expect, it } from "vitest";
import {
  RiskEventLedger,
  createAccountRiskStateTransitionEvent,
  createRiskEventFromRiskEvaluation,
  type RiskEventStatus,
} from "@/lib/riskEvent";
import { evaluateRisk, type RiskRules, type RiskStateInput } from "@/lib/riskEngine";

const now = new Date("2026-09-22T10:00:00.000Z");
const rules: RiskRules = {
  trading_permission: true,
  allowed_segments: ["NSE_FNO"],
  allowed_instruments: ["NIFTY"],
  trading_hours: [{ start: "09:15", end: "15:30" }],
  overnight_allowed: false,
  daily_loss_limit: 250,
  maximum_drawdown: 1_000,
  drawdown_model: "static",
  max_open_positions: 2,
  max_position_quantity: 10,
  max_daily_trades: 5,
  risk_per_trade: 250,
  margin_requirement: 1_000,
  profit_target: 2_000,
};

function state(overrides: Partial<RiskStateInput> = {}): RiskStateInput {
  return {
    status: "active",
    risk_state: "ACTIVE",
    initial_balance: 10_000,
    starting_balance: 10_000,
    current_balance: 10_000,
    current_equity: 10_000,
    daily_starting_equity: 10_000,
    realized_pnl_today: 0,
    unrealized_pnl_today: 0,
    fees_today: 0,
    daily_trade_count: 0,
    open_positions: [],
    market_data_fresh: true,
    ...overrides,
  };
}

function request(overrides: Partial<Parameters<typeof evaluateRisk>[0]> = {}) {
  return {
    account_id: "account-1",
    symbol: "NIFTY",
    segment: "NSE_FNO",
    side: "BUY" as const,
    quantity: 2,
    order_type: "market",
    estimated_loss: 100,
    now,
    ...overrides,
  };
}

describe("risk event generation", () => {
  it("creates the correct event for a daily-loss breach", () => {
    const evaluation = evaluateRisk(request(), state({ realized_pnl_today: -250, current_equity: 9_750 }), rules);
    expect(evaluation.reason_code).toBe("DAILY_LOSS_EXCEEDED");

    const event = createRiskEventFromRiskEvaluation(evaluation, { source: "risk_engine" });
    expect(event.eventType).toBe("DAILY_LOSS_LIMIT_BREACH");
    expect(event.accountId).toBe("account-1");
    expect(event.metricName).toBe("daily_loss_limit");
    expect(event.metricValue).toBe(250);
    expect(event.configuredLimit).toBe(250);
    expect(event.reason).toBe("Daily loss limit reached");
    expect(event.status).toBe("open");
  });

  it("creates the correct event for a maximum-drawdown breach", () => {
    const evaluation = evaluateRisk(request(), state({ current_equity: 9_000 }), rules);
    expect(evaluation.reason_code).toBe("DRAWDOWN_EXCEEDED");

    const event = createRiskEventFromRiskEvaluation(evaluation, { source: "risk_engine" });
    expect(event.eventType).toBe("MAX_DRAWDOWN_BREACH");
    expect(event.accountId).toBe("account-1");
    expect(event.metricName).toBe("maximum_drawdown");
    expect(event.metricValue).toBe(1_000);
    expect(event.configuredLimit).toBe(1_000);
    expect(event.reason).toBe("Maximum drawdown reached");
  });

  it("creates a canonical event for a pre-trade rejection", () => {
    const evaluation = evaluateRisk(request({ estimated_loss: 300 }), state(), { ...rules, risk_per_trade: 250 });
    expect(evaluation.reason_code).toBe("RISK_PER_TRADE_EXCEEDED");

    const event = createRiskEventFromRiskEvaluation(evaluation, { source: "risk_engine" });
    expect(event.eventType).toBe("PRE_TRADE_RISK_REJECTION");
    expect(event.accountId).toBe("account-1");
    expect(event.reason).toBe("Estimated trade risk exceeds the configured limit");
    expect(event.metricName).toBe("risk_per_trade");
    expect(event.metricValue).toBe(300);
    expect(event.configuredLimit).toBe(250);
  });

  it("creates an account risk-state change event when the risk state transitions", () => {
    const event = createAccountRiskStateTransitionEvent({
      accountId: "account-1",
      previousState: "ACTIVE",
      nextState: "BREACHED",
      reason: "Maximum drawdown reached",
      source: "risk_engine",
      occurredAt: now.toISOString(),
    });

    expect(event.eventType).toBe("ACCOUNT_RISK_STATE_CHANGE");
    expect(event.accountId).toBe("account-1");
    expect(event.metricName).toBe("risk_state");
    expect(event.metricValue).toBe("BREACHED");
    expect(event.configuredLimit).toBe("ACTIVE");
    expect(event.reason).toBe("Maximum drawdown reached");
    expect(event.status).toBe("open");
  });

  it("deduplicates repeated processing of the same risk condition", () => {
    const ledger = new RiskEventLedger();
    const evaluation = evaluateRisk(request(), state({ current_equity: 9_000 }), rules);

    const first = ledger.recordRiskEvent(createRiskEventFromRiskEvaluation(evaluation, { source: "risk_engine" }));
    const second = ledger.recordRiskEvent(createRiskEventFromRiskEvaluation(evaluation, { source: "risk_engine" }));

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(ledger.getEvents("account-1")).toHaveLength(1);
  });

  it("keeps different risk events distinct and does not deduplicate unrelated conditions", () => {
    const ledger = new RiskEventLedger();
    const dailyLoss = createRiskEventFromRiskEvaluation(
      evaluateRisk(request(), state({ realized_pnl_today: -250, current_equity: 9_750 }), rules),
      { source: "risk_engine" },
    );
    const drawdown = createRiskEventFromRiskEvaluation(
      evaluateRisk(request(), state({ current_equity: 9_000 }), rules),
      { source: "risk_engine" },
    );

    ledger.recordRiskEvent(dailyLoss);
    ledger.recordRiskEvent(drawdown);

    expect(ledger.getEvents("account-1")).toHaveLength(2);
    expect(new Set(ledger.getEvents("account-1").map((event) => event.eventType)).size).toBe(2);
  });

  it("does not create breach events for normal non-breach trading", () => {
    const ledger = new RiskEventLedger();
    const evaluation = evaluateRisk(request(), state({ current_equity: 10_000 }), rules);
    const event = createRiskEventFromRiskEvaluation(evaluation, { source: "risk_engine" });

    expect(evaluation.decision).toBe("ALLOW");
    expect(event).toBeNull();
    expect(ledger.recordRiskEvent(event as never)).toBeNull();
  });
});

it("maintains a consistent account reference and canonical metadata", () => {
  const event = createRiskEventFromRiskEvaluation(
    evaluateRisk(request(), state({ current_equity: 9_000 }), rules),
    { source: "risk_engine", metadata: { orderType: "market" } },
  );

  expect(event.accountId).toBe("account-1");
  expect(event.source).toBe("risk_engine");
  expect(event.metadata).toMatchObject({ orderType: "market" });
  expect(event.reference).toContain("account-1");
});

it("accepts risk state change events with canonical status metadata", () => {
  const event = createAccountRiskStateTransitionEvent({
    accountId: "account-1",
    previousState: "ACTIVE",
    nextState: "LOCKED",
    reason: "Account risk blocked",
    source: "account_lifecycle",
  });

  expect(event.status).toBe("open");
  expect(event.severity).toBe("critical");
  expect((event as any).eventType).toBe("ACCOUNT_RISK_STATE_CHANGE");
  expect(event.metadata).toMatchObject({ previousState: "ACTIVE", nextState: "LOCKED" });
});

it("uses the canonical source and reason for a risk decision", () => {
  const event = createRiskEventFromRiskEvaluation(
    evaluateRisk(request({ estimated_loss: 300 }), state(), { ...rules, risk_per_trade: 250 }),
    { source: "risk_engine" },
  );

  expect(event.source).toBe("risk_engine");
  expect(event.reason).toBe("Estimated trade risk exceeds the configured limit");
  expect(event.reference).toContain("risk_engine");
});
