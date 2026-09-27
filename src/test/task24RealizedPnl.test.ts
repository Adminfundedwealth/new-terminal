import { describe, expect, it } from "vitest";
import { PositionEngine } from "@/lib/positionEngine";

describe("Task 24 realized P&L", () => {
  it("calculates weighted-average realized P&L on partial closes and reversals", () => {
    const long = new PositionEngine("acct-24-long");
    long.applyExecution({ id: "open-1", accountId: "acct-24-long", symbol: "NIFTY", instrumentKey: "NIFTY-INDEX", side: "BUY", quantity: 10, price: 100, executedAt: "2026-09-24T09:15:00.000Z" });
    long.applyExecution({ id: "open-2", accountId: "acct-24-long", symbol: "NIFTY", instrumentKey: "NIFTY-INDEX", side: "BUY", quantity: 10, price: 110, executedAt: "2026-09-24T09:16:00.000Z" });

    expect(long.applyExecution({ id: "close-1", accountId: "acct-24-long", symbol: "NIFTY", instrumentKey: "NIFTY-INDEX", side: "SELL", quantity: 5, price: 120, executedAt: "2026-09-24T09:17:00.000Z" })).toMatchObject({ side: "LONG", quantity: 15, averageEntryPrice: 105, realizedPnl: 75 });

    const short = new PositionEngine("acct-24-short");
    short.applyExecution({ id: "short-open-1", accountId: "acct-24-short", symbol: "BANKNIFTY", instrumentKey: "BANKNIFTY-INDEX", side: "SELL", quantity: 20, price: 100, executedAt: "2026-09-24T09:20:00.000Z" });
    expect(short.applyExecution({ id: "short-close-1", accountId: "acct-24-short", symbol: "BANKNIFTY", instrumentKey: "BANKNIFTY-INDEX", side: "BUY", quantity: 5, price: 90, executedAt: "2026-09-24T09:21:00.000Z" })).toMatchObject({ side: "SHORT", quantity: 15, realizedPnl: 50 });

    const reversal = new PositionEngine("acct-24-reversal");
    reversal.applyExecution({ id: "rev-open", accountId: "acct-24-reversal", symbol: "INFY", instrumentKey: "INFY-EQ", side: "BUY", quantity: 20, price: 100, executedAt: "2026-09-24T09:25:00.000Z" });
    const actual = reversal.applyExecution({ id: "rev-close", accountId: "acct-24-reversal", symbol: "INFY", instrumentKey: "INFY-EQ", side: "SELL", quantity: 25, price: 110, executedAt: "2026-09-24T09:26:00.000Z" });
    expect(actual).toMatchObject({ side: "SHORT", quantity: 5, averageEntryPrice: 110, realizedPnl: 200 });
  });

  it("rejects duplicate external execution IDs and repeated replay without inflating realized P&L", () => {
    const engine = new PositionEngine("acct-24-dup");
    const first = engine.applyExecution({
      id: "exec-1",
      accountId: "acct-24-dup",
      symbol: "TCS",
      instrumentKey: "TCS-EQ",
      side: "BUY",
      quantity: 10,
      price: 100,
      executedAt: "2026-09-24T09:30:00.000Z",
      externalExecutionId: "BROKER-EXTERNAL-1",
    });
    expect(first).toMatchObject({ quantity: 10, side: "LONG", averageEntryPrice: 100 });

    const replay = engine.applyExecution({
      id: "exec-2",
      accountId: "acct-24-dup",
      symbol: "TCS",
      instrumentKey: "TCS-EQ",
      side: "BUY",
      quantity: 10,
      price: 100,
      executedAt: "2026-09-24T09:30:00.000Z",
      externalExecutionId: "BROKER-EXTERNAL-1",
    });
    expect(replay).toMatchObject({ quantity: 10, side: "LONG" });
    expect(() => engine.applyExecution({
      id: "exec-3",
      accountId: "acct-24-dup",
      symbol: "TCS",
      instrumentKey: "TCS-EQ",
      side: "BUY",
      quantity: 5,
      price: 101,
      executedAt: "2026-09-24T09:35:00.000Z",
      externalExecutionId: "BROKER-EXTERNAL-1",
    })).toThrow(/duplicate|conflict/i);

    const close = engine.applyExecution({
      id: "exec-4",
      accountId: "acct-24-dup",
      symbol: "TCS",
      instrumentKey: "TCS-EQ",
      side: "SELL",
      quantity: 10,
      price: 110,
      executedAt: "2026-09-24T09:40:00.000Z",
      externalExecutionId: "BROKER-EXTERNAL-2",
    });
    expect(close).toBeNull();
    expect(engine.accountValuation(1000).realizedPnl).toBe(100);
  });

  it("enforces account ownership and rejects invalid quantity or price", () => {
    const engine = new PositionEngine("acct-24-owner");
    expect(() => engine.applyExecution({ id: "exec-1", accountId: "acct-24-other", symbol: "NIFTY", instrumentKey: "NIFTY-INDEX", side: "BUY", quantity: 2, price: 100, executedAt: "2026-09-24T09:45:00.000Z" })).toThrow(/different account|account/i);
    expect(() => engine.applyExecution({ id: "exec-2", accountId: "acct-24-owner", symbol: "NIFTY", instrumentKey: "NIFTY-INDEX", side: "BUY", quantity: 0, price: 100, executedAt: "2026-09-24T09:46:00.000Z" })).toThrow(/positive/i);
    expect(() => engine.applyExecution({ id: "exec-3", accountId: "acct-24-owner", symbol: "NIFTY", instrumentKey: "NIFTY-INDEX", side: "BUY", quantity: 2, price: 0, executedAt: "2026-09-24T09:47:00.000Z" })).toThrow(/positive/i);
  });
});
