import { describe, expect, it } from "vitest";
import { PositionEngine } from "@/lib/positionEngine";

describe("Task 25 unrealized P&L", () => {
  const makeEngine = (accountId = "acct-1", now = new Date("2026-09-24T10:00:00.000Z")) => new PositionEngine(accountId, { now: () => now, staleAfterMs: 30_000 });

  it("calculates long unrealized P&L from the authoritative position and current market price", () => {
    const engine = makeEngine();

    engine.applyExecution({
      id: "e-long-1",
      accountId: "acct-1",
      symbol: "INFY",
      instrumentKey: "INFY",
      side: "BUY",
      quantity: 10,
      price: 100,
      executedAt: "2026-09-24T09:00:00.000Z",
    });

    const position = engine.valueMarketPrice({
      symbol: "INFY",
      instrumentKey: "INFY",
      price: 110,
      asOf: "2026-09-24T10:00:00.000Z",
    });

    expect(position).toMatchObject({
      symbol: "INFY",
      side: "LONG",
      quantity: 10,
      averageEntryPrice: 100,
      currentPrice: 110,
      unrealizedPnl: 100,
      valuationStatus: "VALUED",
    });
    expect(engine.accountValuation(10_000)).toMatchObject({
      unrealizedPnl: 100,
      equity: 10_100,
      openPositionCount: 1,
    });
  });

  it("calculates short unrealized P&L from the authoritative position and current market price", () => {
    const engine = makeEngine();

    engine.applyExecution({
      id: "e-short-1",
      accountId: "acct-1",
      symbol: "BANKNIFTY",
      instrumentKey: "BANKNIFTY",
      side: "SELL",
      quantity: 8,
      price: 100,
      executedAt: "2026-09-24T09:00:00.000Z",
    });

    const position = engine.valueMarketPrice({
      symbol: "BANKNIFTY",
      instrumentKey: "BANKNIFTY",
      price: 90,
      asOf: "2026-09-24T10:00:00.000Z",
    });

    expect(position).toMatchObject({
      symbol: "BANKNIFTY",
      side: "SHORT",
      quantity: 8,
      averageEntryPrice: 100,
      currentPrice: 90,
      unrealizedPnl: 80,
      valuationStatus: "VALUED",
    });
    expect(engine.accountValuation(10_000)).toMatchObject({
      unrealizedPnl: 80,
      equity: 10_080,
      openPositionCount: 1,
    });
  });

  it("resets to zero or null when positions are closed or market data is stale", () => {
    const engine = makeEngine();
    engine.applyExecution({ id: "e-open-1", accountId: "acct-1", symbol: "TCS", instrumentKey: "TCS", side: "BUY", quantity: 5, price: 200, executedAt: "2026-09-24T09:00:00.000Z" });
    engine.valueMarketPrice({ symbol: "TCS", instrumentKey: "TCS", price: 220, asOf: "2026-09-24T10:00:00.000Z" });
    expect(engine.getPosition("TCS")).toMatchObject({ quantity: 5, unrealizedPnl: 100, valuationStatus: "VALUED" });

    const stalePrice = engine.valueMarketPrice({
      symbol: "TCS",
      instrumentKey: "TCS",
      price: 225,
      asOf: "2026-09-24T09:29:00.000Z",
    });
    expect(stalePrice).toMatchObject({ valuationStatus: "STALE", unrealizedPnl: null });

    const closed = makeEngine();
    closed.applyExecution({ id: "e-close-1", accountId: "acct-1", symbol: "RELIANCE", instrumentKey: "RELIANCE", side: "BUY", quantity: 4, price: 100, executedAt: "2026-09-24T09:00:00.000Z" });
    closed.applyExecution({ id: "e-close-2", accountId: "acct-1", symbol: "RELIANCE", instrumentKey: "RELIANCE", side: "SELL", quantity: 4, price: 100, executedAt: "2026-09-24T09:05:00.000Z" });
    expect(closed.getPositions()).toHaveLength(0);
    expect(closed.accountValuation(10_000)).toMatchObject({ unrealizedPnl: 0, openPositionCount: 0, equity: 10_000 });
  });

  it("updates unrealized P&L as the live market price changes", () => {
    const engine = makeEngine();
    engine.applyExecution({ id: "e-update-1", accountId: "acct-1", symbol: "ITC", instrumentKey: "ITC", side: "BUY", quantity: 20, price: 50, executedAt: "2026-09-24T09:00:00.000Z" });

    engine.valueMarketPrice({ symbol: "ITC", instrumentKey: "ITC", price: 55, asOf: "2026-09-24T10:00:00.000Z" });
    expect(engine.getPosition("ITC")?.unrealizedPnl).toBe(100);

    engine.valueMarketPrice({ symbol: "ITC", instrumentKey: "ITC", price: 45, asOf: "2026-09-24T10:00:30.000Z" });
    expect(engine.getPosition("ITC")?.unrealizedPnl).toBe(-100);

    engine.valueMarketPrice({ symbol: "ITC", instrumentKey: "ITC", price: 50, asOf: "2026-09-24T10:00:45.000Z" });
    expect(engine.getPosition("ITC")?.unrealizedPnl).toBe(0);
  });
});
