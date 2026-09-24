import { describe, expect, it } from "vitest";
import {
  calculateDailyLoss,
  calculateDrawdown,
  calculateProfitTarget,
  evaluateRisk,
  type RiskReasonCode,
  type RiskRules,
  type RiskStateInput,
} from "@/lib/riskEngine";
import { calculateAccountMetrics } from "@/lib/accountMetrics";

const now = new Date("2026-09-22T10:00:00.000Z");
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

describe("risk engine foundation", () => {
  it("allows a valid request deterministically", () => {
    const result = evaluateRisk(request(), state(), rules);
    expect(result).toMatchObject({ decision: "ALLOW", reason_code: null, account_id: "account-1" });
  });

  it.each([
    ["LOCKED", "ACCOUNT_LOCKED"],
    ["BREACHED", "ACCOUNT_BREACHED"],
  ] as const)("rejects %s accounts", (riskState, reasonCode) => {
    expect(evaluateRisk(request(), state({ risk_state: riskState }), rules).reason_code).toBe(reasonCode);
  });

  const violations: Array<[Partial<RiskRules>, RiskReasonCode]> = [
    [{ trading_permission: false }, "TRADING_PERMISSION_DISABLED"],
    [{ allowed_instruments: ["BANKNIFTY"] }, "INSTRUMENT_NOT_ALLOWED"],
    [{ max_position_quantity: 1 }, "QUANTITY_EXCEEDED"],
    [{ max_open_positions: 0 }, "MAX_OPEN_POSITIONS_EXCEEDED"],
    [{ max_daily_trades: 0 }, "MAX_DAILY_TRADES_EXCEEDED"],
    [{ daily_loss_limit: 100 }, "DAILY_LOSS_EXCEEDED"],
    [{ maximum_drawdown: 100 }, "DRAWDOWN_EXCEEDED"],
    [{ risk_per_trade: 50 }, "RISK_PER_TRADE_EXCEEDED"],
    [{ overnight_allowed: false }, "OVERNIGHT_NOT_ALLOWED"],
  ];

  it.each(violations)("rejects configured violation with stable code", (rulePatch, reasonCode) => {
    const input = rulePatch.overnight_allowed === false ? request({ is_overnight: true }) : request();
    const current = rulePatch.daily_loss_limit === 100
      ? state({ realized_pnl_today: -100 })
      : rulePatch.maximum_drawdown === 100
        ? state({ current_equity: 9_900 })
        : state();
    expect(evaluateRisk(input, current, { ...rules, ...rulePatch }).reason_code).toBe(reasonCode);
  });

  it("rejects stale market data when unrealized P&L is unavailable", () => {
    const result = evaluateRisk(request(), state({ market_data_fresh: false, unrealized_pnl_today: null }), rules);
    expect(result.reason_code).toBe("MARKET_DATA_STALE");
  });

  it("rejects missing required rule configuration", () => {
    const result = evaluateRisk(request(), state(), { ...rules, max_daily_trades: undefined });
    expect(result.reason_code).toBe("RULE_CONFIGURATION_MISSING");
  });

  it("calculates daily loss, static/trailing drawdown, and profit target", () => {
    expect(calculateDailyLoss(state({ realized_pnl_today: -100, unrealized_pnl_today: -50, fees_today: 25 }))).toBe(175);
    expect(calculateDrawdown(state({ current_equity: 9_000 }), rules)).toMatchObject({ amount: 1_000, base: 10_000 });
    expect(calculateDrawdown(state({ current_equity: 9_000, peak_equity: 12_000 }), { ...rules, drawdown_model: "trailing" })).toMatchObject({ amount: 3_000, base: 12_000 });
    expect(calculateProfitTarget(state({ current_equity: 11_000 }), rules)).toMatchObject({ currentProfit: 1_000, remaining: 1_000, progressPercentage: 50, reached: false });
  });

  it("consumes authoritative metrics without recomputing them", () => {
    const metrics = calculateAccountMetrics({
      accountId: "account-1",
      status: "active",
      startingBalance: 10_000,
      balance: 9_500,
      realizedPnl: -500,
      dailyStartingEquity: 10_000,
      previousHighWaterMark: 12_000,
      drawdownModel: "trailing",
    });
    const current = state({ current_balance: 9_500, current_equity: 9_500, account_metrics: metrics });
    expect(calculateDailyLoss(current)).toBe(500);
    expect(calculateDrawdown(current, { ...rules, drawdown_model: "static" })).toMatchObject({ amount: 2_500, base: 12_000 });
    expect(calculateProfitTarget(current, rules)).toMatchObject({ currentProfit: -500, remaining: 2_500 });
  });
});