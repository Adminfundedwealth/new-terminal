import { describe, expect, it } from "vitest";
import { calculateAccountMetrics, type AccountMetricsInput } from "@/lib/accountMetrics";

const base: AccountMetricsInput = {
  accountId: "account-1",
  status: "active",
  startingBalance: 10_000,
  balance: 10_000,
  realizedPnl: 0,
  dailyStartingEquity: 10_000,
};

describe("account metrics engine", () => {
  it("calculates an initial account deterministically", () => {
    expect(calculateAccountMetrics(base)).toMatchObject({
      balance: 10_000,
      equity: 10_000,
      realizedPnl: 0,
      unrealizedPnl: 0,
      dailyPnl: 0,
      dailyLoss: 0,
      totalProfit: 0,
      highWaterMark: 10_000,
      drawdown: 0,
    });
  });

  it("separates profitable and losing realized trades from open-position P&L", () => {
    expect(calculateAccountMetrics({ ...base, balance: 10_250, realizedPnl: 250 })).toMatchObject({
      balance: 10_250,
      equity: 10_250,
      realizedPnl: 250,
      unrealizedPnl: 0,
      totalProfit: 250,
    });
    expect(calculateAccountMetrics({ ...base, balance: 9_800, realizedPnl: -200 })).toMatchObject({
      realizedPnl: -200,
      dailyPnl: -200,
      dailyLoss: 200,
      drawdown: 200,
    });
    expect(calculateAccountMetrics({
      ...base,
      balance: 10_000,
      positions: [{ unrealizedPnl: 125 }],
    })).toMatchObject({ equity: 10_125, realizedPnl: 0, unrealizedPnl: 125, totalProfit: 125 });
  });

  it("keeps closed realized P&L and aggregates multiple open positions", () => {
    expect(calculateAccountMetrics({
      ...base,
      balance: 10_050,
      realizedPnl: 50,
      positions: [{ unrealizedPnl: 25 }, { unrealizedPnl: -10 }],
    })).toMatchObject({ realizedPnl: 50, unrealizedPnl: 15, equity: 10_065 });
  });

  it("uses the existing start-of-day baseline and high-water mark", () => {
    const drawdown = calculateAccountMetrics({
      ...base,
      balance: 10_700,
      realizedPnl: 700,
      dailyStartingEquity: 11_000,
      previousHighWaterMark: 12_000,
      drawdownModel: "trailing",
    });
    expect(drawdown).toMatchObject({ dailyPnl: -300, dailyLoss: 300, highWaterMark: 12_000, drawdown: 1_300, drawdownBase: 12_000 });

    const recovery = calculateAccountMetrics({ ...base, balance: 11_500, previousHighWaterMark: 12_000, drawdownModel: "trailing" });
    expect(recovery).toMatchObject({ highWaterMark: 12_000, drawdown: 500 });
  });

  it("does not fabricate equity when an open position is unvalued", () => {
    expect(calculateAccountMetrics({ ...base, positions: [{ unrealizedPnl: null }] })).toMatchObject({
      equity: null,
      unrealizedPnl: null,
      dailyPnl: null,
      dailyLoss: null,
      totalProfit: null,
      drawdown: null,
    });
  });

  it("handles zero and negative boundaries without invalid percentages", () => {
    expect(calculateAccountMetrics({
      accountId: "zero-account",
      status: "active",
      startingBalance: 0,
      balance: 0,
      realizedPnl: -1,
      dailyStartingEquity: 0,
    })).toMatchObject({ totalProfit: 0, drawdown: 0, drawdownPercentage: 0 });
    expect(calculateAccountMetrics({ ...base, balance: 9_000, realizedPnl: -1_000, fees: 12.5 })).toMatchObject({ realizedPnl: -1_000, fees: 12.5 });
  });

  it("preserves breached and inactive account status and is repeatable", () => {
    const input = { ...base, status: "breached", balance: 8_000, realizedPnl: -2_000, snapshotAt: "2026-09-23T10:00:00.000Z" } as const;
    const first = calculateAccountMetrics(input);
    expect(first.status).toBe("breached");
    expect(calculateAccountMetrics(input)).toEqual(first);
    expect(calculateAccountMetrics({ ...base, status: "inactive" }).status).toBe("inactive");
  });
});