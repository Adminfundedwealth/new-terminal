import { describe, expect, it } from "vitest";
import {
  calculateDailyLoss,
  calculateDrawdown,
  calculateProfitTarget,
  evaluateRisk,
  type RiskRules,
  type RiskStateInput,
} from "@/lib/riskEngine";
import { calculateAccountMetrics } from "@/lib/accountMetrics";

const rules: RiskRules = {
  trading_permission: true,
  allowed_segments: ["NSE_FNO"],
  allowed_instruments: ["NIFTY"],
  trading_hours: [{ start: "09:15", end: "15:30" }],
  overnight_allowed: false,
  daily_loss_limit: 500,
  maximum_drawdown: 1_000,
  drawdown_model: "static",
  max_open_positions: 2,
  max_position_quantity: 10,
  max_daily_trades: 5,
  risk_per_trade: 250,
  margin_requirement: 1_000,
  profit_target: 2_000,
};

const now = new Date("2026-09-22T10:00:00.000Z");

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

describe("Task 27 drawdown engine", () => {
  it("handles zero loss and positive growth without drawdown", () => {
    expect(calculateDailyLoss(state({ realized_pnl_today: 0, unrealized_pnl_today: 0 }))).toBe(0);
    expect(calculateDrawdown(state({ current_equity: 11_000 }), rules)).toMatchObject({ amount: 0, base: 10_000, percentage: 0 });
    expect(calculateProfitTarget(state({ current_equity: 11_000 }), rules)).toMatchObject({ currentProfit: 1_000, remaining: 1_000, reached: false });
  });

  it("calculates daily loss from the canonical account state", () => {
    expect(calculateDailyLoss(state({ realized_pnl_today: -150, unrealized_pnl_today: -75, fees_today: 25 }))).toBe(250);
  });

  it("calculates maximum drawdown from the authoritative balance and equity", () => {
    const metrics = calculateAccountMetrics({
      accountId: "account-1",
      status: "active",
      startingBalance: 10_000,
      balance: 9_200,
      realizedPnl: -800,
      dailyStartingEquity: 10_000,
      previousHighWaterMark: 11_500,
      drawdownModel: "trailing",
      positions: [{ unrealizedPnl: -150 }],
    });
    expect(metrics).toMatchObject({ drawdown: 2_450, drawdownBase: 11_500, highWaterMark: 11_500 });
    expect(calculateDrawdown(state({ current_equity: 9_050, peak_equity: 11_500, starting_balance: 10_000, initial_balance: 10_000 }), { ...rules, drawdown_model: "trailing" })).toMatchObject({ amount: 2_450, base: 11_500 });
  });

  it("handles long and short unrealized loss deterministically", () => {
    const longLoss = calculateAccountMetrics({
      accountId: "account-1",
      status: "active",
      startingBalance: 10_000,
      balance: 10_000,
      realizedPnl: 0,
      dailyStartingEquity: 10_000,
      positions: [{ unrealizedPnl: -250 }],
    });
    const shortLoss = calculateAccountMetrics({
      accountId: "account-1",
      status: "active",
      startingBalance: 10_000,
      balance: 10_000,
      realizedPnl: 0,
      dailyStartingEquity: 10_000,
      positions: [{ unrealizedPnl: 250 }],
    });
    expect(longLoss.unrealizedPnl).toBe(-250);
    expect(shortLoss.unrealizedPnl).toBe(250);
    expect(longLoss.equity).toBe(9_750);
    expect(shortLoss.equity).toBe(10_250);
  });

  it("treats drawdown at the configured limit as a breach and recovers after recovery", () => {
    const atLimit = evaluateRisk(request(), state({ current_equity: 9_000, starting_balance: 10_000, initial_balance: 10_000 }), { ...rules, maximum_drawdown: 1_000, daily_loss_limit: 1_500 });
    expect(atLimit.reason_code).toBe("DRAWDOWN_EXCEEDED");

    const recovered = evaluateRisk(request(), state({ current_equity: 10_500, starting_balance: 10_000, initial_balance: 10_000 }), { ...rules, maximum_drawdown: 1_000, daily_loss_limit: 1_500 });
    expect(recovered.decision).toBe("ALLOW");
  });

  it("keeps repeated calculations and reloads deterministic", () => {
    const first = calculateDrawdown(state({ current_equity: 9_100, starting_balance: 10_000, initial_balance: 10_000, peak_equity: 11_000 }), rules);
    const second = calculateDrawdown(state({ current_equity: 9_100, starting_balance: 10_000, initial_balance: 10_000, peak_equity: 11_000 }), rules);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ amount: 900, base: 10_000, percentage: 9 });
  });

  it("handles invalid or missing state safely without throwing", () => {
    const invalid = calculateDrawdown(state({ current_equity: Number.NaN, starting_balance: 10_000, initial_balance: 10_000 }), rules);
    expect(invalid).toMatchObject({ amount: 0, base: 10_000, percentage: 0 });

    const missing = calculateDrawdown(state({
      current_equity: undefined as any,
      starting_balance: undefined as any,
      initial_balance: undefined as any,
      daily_starting_equity: undefined as any,
      current_balance: undefined as any,
    }), rules);
    expect(missing).toMatchObject({ amount: 0, base: 0, percentage: 0 });

    expect(() => evaluateRisk(request(), state({ status: "inactive" }), rules)).not.toThrow();
  });

  it("routes drawdown breaches through the authoritative risk decision path", () => {
    const evaluation = evaluateRisk(request(), state({ current_equity: 8_900, starting_balance: 10_000, initial_balance: 10_000 }), { ...rules, maximum_drawdown: 1_000, daily_loss_limit: 1_500 });
    expect(evaluation.decision).toBe("REJECT");
    expect(evaluation.reason_code).toBe("DRAWDOWN_EXCEEDED");
    expect(evaluation.configured_limit).toBe(1_000);
    expect(evaluation.current_value).toBe(1_100);
  });
});
