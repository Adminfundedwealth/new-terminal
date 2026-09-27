import { describe, expect, it } from "vitest";
import { SlTpEngine, type PositionSnapshot } from "@/lib/slTpEngine";

const position: PositionSnapshot = {
  accountId: "acct-1",
  ownerUserId: "user-1",
  instrumentId: "nifty-1",
  symbol: "NIFTY",
  side: "LONG",
  quantity: 10,
  price: 100,
  currentPrice: 100,
  tickSize: 0.05,
  status: "OPEN",
};

function createEngine(snapshot: PositionSnapshot = position) {
  const engine = new SlTpEngine({ accountId: "acct-1", ownerUserId: "user-1", status: "ACTIVE", tradingPermission: true }, () => new Date("2026-01-01T00:00:00.000Z"));
  engine.setPosition(snapshot);
  return engine;
}

describe("Task 43 canonical SL/TP lifecycle", () => {
  it("creates SL and TP independently and replays an idempotent request", () => {
    const engine = createEngine();
    const stop = engine.createProtection({ accountId: "acct-1", ownerUserId: "user-1", instrumentId: "nifty-1", symbol: "NIFTY", side: "LONG", type: "STOP_LOSS", quantity: 10, price: 95, idempotencyKey: "sl-1" });
    const target = engine.createProtection({ accountId: "acct-1", ownerUserId: "user-1", instrumentId: "nifty-1", symbol: "NIFTY", side: "LONG", type: "TAKE_PROFIT", quantity: 10, price: 105, idempotencyKey: "tp-1" });
    const replay = engine.createProtection({ accountId: "acct-1", ownerUserId: "user-1", instrumentId: "nifty-1", symbol: "NIFTY", side: "LONG", type: "STOP_LOSS", quantity: 10, price: 95, idempotencyKey: "sl-1" });
    expect(stop.decision).toBe("ALLOW");
    expect(target.decision).toBe("ALLOW");
    expect(replay.protection?.id).toBe(stop.protection?.id);
  });

  it("modifies one protection without changing its sibling", () => {
    const engine = createEngine();
    const stop = engine.createProtection({ accountId: "acct-1", ownerUserId: "user-1", symbol: "NIFTY", side: "LONG", type: "STOP_LOSS", quantity: 10, price: 95 });
    const target = engine.createProtection({ accountId: "acct-1", ownerUserId: "user-1", symbol: "NIFTY", side: "LONG", type: "TAKE_PROFIT", quantity: 10, price: 105 });
    const updated = engine.modifyProtection(stop.protection!.id, { price: 96 });
    expect(updated.protection?.price).toBe(96);
    expect(engine.getProtection(target.protection!.id)?.price).toBe(105);
  });

  it("rejects wrong instrument, tick, crossing, and closed-position requests", () => {
    const engine = createEngine();
    expect(engine.createProtection({ accountId: "acct-1", ownerUserId: "user-1", instrumentId: "other", symbol: "NIFTY", side: "LONG", type: "STOP_LOSS", quantity: 10, price: 95 }).decision).toBe("REJECT");
    expect(engine.createProtection({ accountId: "acct-1", ownerUserId: "user-1", symbol: "NIFTY", side: "LONG", type: "STOP_LOSS", quantity: 10, price: 95.03 }).decision).toBe("REJECT");
    engine.createProtection({ accountId: "acct-1", ownerUserId: "user-1", symbol: "NIFTY", side: "LONG", type: "STOP_LOSS", quantity: 10, price: 95 });
    expect(engine.createProtection({ accountId: "acct-1", ownerUserId: "user-1", symbol: "NIFTY", side: "LONG", type: "TAKE_PROFIT", quantity: 10, price: 94 }).reasonCode).toBe("INVALID_TARGET_PRICE");
    const closed = createEngine({ ...position, quantity: 0, status: "CLOSED" });
    expect(closed.createProtection({ accountId: "acct-1", ownerUserId: "user-1", symbol: "NIFTY", side: "LONG", type: "STOP_LOSS", quantity: 1, price: 95 }).reasonCode).toBe("NO_POSITION");
  });

  it("is idempotent for repeated removal and partial protection adjustment", () => {
    const engine = createEngine();
    const stop = engine.createProtection({ accountId: "acct-1", ownerUserId: "user-1", symbol: "NIFTY", side: "LONG", type: "STOP_LOSS", quantity: 10, price: 95 });
    engine.applyPositionAdjustment("NIFTY", 4, "LONG");
    expect(engine.getProtection(stop.protection!.id)?.quantity).toBe(6);
    expect(engine.removeProtection(stop.protection!.id).removed).toBe(true);
    expect(engine.removeProtection(stop.protection!.id).removed).toBe(true);
  });
});