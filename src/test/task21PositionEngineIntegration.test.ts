import { describe, expect, it } from "vitest";
import { PositionEngine } from "@/lib/positionEngine";

describe("Task 21 canonical position engine integration", () => {
  it("opens a long and increases the same-side position with a weighted average", () => {
    const engine = new PositionEngine("account-21");
    const first = engine.applyExecution({
      id: "exec-1",
      accountId: "account-21",
      symbol: "NIFTY",
      instrumentKey: "NIFTY-INDEX",
      side: "BUY",
      quantity: 10,
      price: 100,
      executedAt: "2026-09-24T09:16:00.000Z",
    });
    const second = engine.applyExecution({
      id: "exec-2",
      accountId: "account-21",
      symbol: "NIFTY",
      instrumentKey: "NIFTY-INDEX",
      side: "BUY",
      quantity: 10,
      price: 110,
      executedAt: "2026-09-24T09:17:00.000Z",
      externalExecutionId: "BROKER-FILL-2",
    });

    expect(first?.side).toBe("LONG");
    expect(first?.quantity).toBe(10);
    expect(second).toMatchObject({ side: "LONG", quantity: 20, averageEntryPrice: 105 });
  });

  it("closes and reverses the position deterministically", () => {
    const engine = new PositionEngine("account-21");
    engine.applyExecution({ id: "exec-1", accountId: "account-21", symbol: "BANKNIFTY", instrumentKey: "BANKNIFTY-INDEX", side: "BUY", quantity: 10, price: 100, executedAt: "2026-09-24T09:16:00.000Z" });
    const reversed = engine.applyExecution({ id: "exec-2", accountId: "account-21", symbol: "BANKNIFTY", instrumentKey: "BANKNIFTY-INDEX", side: "SELL", quantity: 15, price: 90, executedAt: "2026-09-24T09:17:00.000Z", externalExecutionId: "BROKER-FILL-2" });

    expect(reversed).toMatchObject({ side: "SHORT", quantity: 5, averageEntryPrice: 90, realizedPnl: -100 });
  });

  it("enforces ownership and idempotency for duplicate IDs and duplicate external IDs", () => {
    const engine = new PositionEngine("account-21");
    const first = engine.applyExecution({
      id: "exec-1",
      accountId: "account-21",
      symbol: "INFY",
      instrumentKey: "INFY-EQ",
      side: "BUY",
      quantity: 5,
      price: 100,
      executedAt: "2026-09-24T09:18:00.000Z",
      externalExecutionId: "BROKER-FILL-1",
    });

    expect(first).toMatchObject({ quantity: 5, averageEntryPrice: 100, side: "LONG" });
    expect(engine.applyExecution({
      id: "exec-1",
      accountId: "account-21",
      symbol: "INFY",
      instrumentKey: "INFY-EQ",
      side: "BUY",
      quantity: 5,
      price: 100,
      executedAt: "2026-09-24T09:18:00.000Z",
      externalExecutionId: "BROKER-FILL-1",
    })).toMatchObject({ quantity: 5, side: "LONG" });
    expect(engine.applyExecution({
      id: "exec-2",
      accountId: "account-21",
      symbol: "INFY",
      instrumentKey: "INFY-EQ",
      side: "BUY",
      quantity: 5,
      price: 100,
      executedAt: "2026-09-24T09:18:00.000Z",
      externalExecutionId: "BROKER-FILL-1",
    })).toMatchObject({ quantity: 5, side: "LONG" });
    expect(() => engine.applyExecution({
      id: "exec-3",
      accountId: "account-21",
      symbol: "INFY",
      instrumentKey: "INFY-EQ",
      side: "BUY",
      quantity: 7,
      price: 100,
      executedAt: "2026-09-24T09:18:00.000Z",
      externalExecutionId: "BROKER-FILL-1",
    })).toThrow(/conflict|duplicate/i);
    expect(() => engine.applyExecution({
      id: "exec-4",
      accountId: "other-account",
      symbol: "INFY",
      instrumentKey: "INFY-EQ",
      side: "BUY",
      quantity: 1,
      price: 100,
      executedAt: "2026-09-24T09:19:00.000Z",
    })).toThrow(/different account|account/i);
  });
});
