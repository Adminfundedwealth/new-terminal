import { describe, expect, it } from "vitest";
import { ReconciliationEngine, SlTpEngine, type PositionSnapshot, type ProtectionRequest, type ReconciliationResult } from "@/lib/slTpEngine";

const basePosition: PositionSnapshot = {
  accountId: "acct-1",
  ownerUserId: "user-1",
  symbol: "NIFTY",
  side: "LONG" as const,
  quantity: 10,
  price: 100,
  currentPrice: 100,
};

function engineForPosition(position = basePosition) {
  const engine = new SlTpEngine({
    accountId: "acct-1",
    ownerUserId: "user-1",
    status: "ACTIVE",
    tradingPermission: true,
  });
  engine.setPosition(position);
  return engine;
}

describe("Phase 6 SL/TP + reconciliation engine", () => {
  it("creates a valid LONG stop loss", () => {
    const engine = engineForPosition();
    const result = engine.createProtection({
      accountId: "acct-1",
      ownerUserId: "user-1",
      symbol: "NIFTY",
      side: "LONG",
      type: "STOP_LOSS",
      quantity: 10,
      price: 95,
    });
    expect(result.decision).toBe("ALLOW");
    expect(result.protection?.type).toBe("STOP_LOSS");
  });

  it("creates a valid LONG take profit", () => {
    const engine = engineForPosition();
    const result = engine.createProtection({
      accountId: "acct-1",
      ownerUserId: "user-1",
      symbol: "NIFTY",
      side: "LONG",
      type: "TAKE_PROFIT",
      quantity: 10,
      price: 110,
    });
    expect(result.decision).toBe("ALLOW");
    expect(result.protection?.type).toBe("TAKE_PROFIT");
  });

  it("rejects invalid LONG stop loss direction", () => {
    const engine = engineForPosition();
    const result = engine.createProtection({
      accountId: "acct-1",
      ownerUserId: "user-1",
      symbol: "NIFTY",
      side: "LONG",
      type: "STOP_LOSS",
      quantity: 10,
      price: 120,
    });
    expect(result.decision).toBe("REJECT");
    expect(result.reasonCode).toBe("INVALID_STOP_PRICE");
  });

  it("rejects invalid take profit direction", () => {
    const engine = engineForPosition();
    const result = engine.createProtection({
      accountId: "acct-1",
      ownerUserId: "user-1",
      symbol: "NIFTY",
      side: "LONG",
      type: "TAKE_PROFIT",
      quantity: 10,
      price: 80,
    });
    expect(result.decision).toBe("REJECT");
    expect(result.reasonCode).toBe("INVALID_TARGET_PRICE");
  });

  it("rejects an unauthorized position", () => {
    const engine = engineForPosition();
    const result = engine.createProtection({
      accountId: "acct-2",
      ownerUserId: "user-1",
      symbol: "NIFTY",
      side: "LONG",
      type: "STOP_LOSS",
      quantity: 10,
      price: 95,
    });
    expect(result.reasonCode).toBe("UNAUTHORIZED_POSITION");
  });

  it("rejects missing market price safely", () => {
    const engine = engineForPosition();
    const result = engine.evaluateMarketPrice({
      symbol: "NIFTY",
      price: null,
      asOf: new Date().toISOString(),
    });
    expect(result.status).toBe("SAFE_REJECT");
    expect(result.reasonCode).toBe("MARKET_DATA_UNAVAILABLE");
  });

  it("triggers LONG stop loss when the market crosses the threshold", () => {
    const engine = engineForPosition();
    engine.createProtection({ accountId: "acct-1", ownerUserId: "user-1", symbol: "NIFTY", side: "LONG", type: "STOP_LOSS", quantity: 10, price: 95 });
    const result = engine.evaluateMarketPrice({ symbol: "NIFTY", price: 94, asOf: new Date().toISOString() });
    expect(result.triggered).toHaveLength(1);
    expect(result.triggered[0].type).toBe("STOP_LOSS");
  });

  it("triggers LONG take profit when the market crosses target", () => {
    const engine = engineForPosition();
    engine.createProtection({ accountId: "acct-1", ownerUserId: "user-1", symbol: "NIFTY", side: "LONG", type: "TAKE_PROFIT", quantity: 10, price: 110 });
    const result = engine.evaluateMarketPrice({ symbol: "NIFTY", price: 111, asOf: new Date().toISOString() });
    expect(result.triggered).toHaveLength(1);
    expect(result.triggered[0].type).toBe("TAKE_PROFIT");
  });

  it("triggers SHORT stop loss when the market crosses the threshold", () => {
    const engine = engineForPosition({ ...basePosition, side: "SHORT", quantity: 10, currentPrice: 100, price: 100 });
    engine.createProtection({ accountId: "acct-1", ownerUserId: "user-1", symbol: "NIFTY", side: "SHORT", type: "STOP_LOSS", quantity: 10, price: 105 });
    const result = engine.evaluateMarketPrice({ symbol: "NIFTY", price: 106, asOf: new Date().toISOString() });
    expect(result.triggered[0].type).toBe("STOP_LOSS");
  });

  it("triggers SHORT take profit when the market crosses target", () => {
    const engine = engineForPosition({ ...basePosition, side: "SHORT", quantity: 10, currentPrice: 100, price: 100 });
    engine.createProtection({ accountId: "acct-1", ownerUserId: "user-1", symbol: "NIFTY", side: "SHORT", type: "TAKE_PROFIT", quantity: 10, price: 90 });
    const result = engine.evaluateMarketPrice({ symbol: "NIFTY", price: 89, asOf: new Date().toISOString() });
    expect(result.triggered[0].type).toBe("TAKE_PROFIT");
  });

  it("modifies and removes protection deterministically", () => {
    const engine = engineForPosition();
    const created = engine.createProtection({ accountId: "acct-1", ownerUserId: "user-1", symbol: "NIFTY", side: "LONG", type: "STOP_LOSS", quantity: 10, price: 95 });
    const modified = engine.modifyProtection(created.protection!.id, { price: 92 });
    expect(modified.protection?.price).toBe(92);
    const removed = engine.removeProtection(created.protection!.id);
    expect(removed.removed).toBeTruthy();
  });

  it("prevents duplicate trigger protection", () => {
    const engine = engineForPosition();
    const created = engine.createProtection({ accountId: "acct-1", ownerUserId: "user-1", symbol: "NIFTY", side: "LONG", type: "STOP_LOSS", quantity: 10, price: 95 });
    engine.evaluateMarketPrice({ symbol: "NIFTY", price: 94, asOf: new Date().toISOString() });
    const again = engine.evaluateMarketPrice({ symbol: "NIFTY", price: 93, asOf: new Date().toISOString() });
    expect(again.triggered).toHaveLength(0);
    expect(created.protection?.status).toBe("ACTIVE");
  });

  it("handles partial close by preserving remaining protection state", () => {
    const engine = engineForPosition();
    const created = engine.createProtection({ accountId: "acct-1", ownerUserId: "user-1", symbol: "NIFTY", side: "LONG", type: "STOP_LOSS", quantity: 10, price: 95 });
    engine.applyPositionAdjustment("NIFTY", 6, "LONG");
    const current = engine.getProtection(created.protection!.id);
    expect(current?.quantity).toBe(4);
  });

  it("reversal detaches old protection before the new side is active", () => {
    const engine = engineForPosition();
    const created = engine.createProtection({ accountId: "acct-1", ownerUserId: "user-1", symbol: "NIFTY", side: "LONG", type: "STOP_LOSS", quantity: 10, price: 95 });
    engine.applyPositionAdjustment("NIFTY", 5, "SHORT");
    const current = engine.getProtection(created.protection!.id);
    expect(current?.status).toBe("INACTIVE");
  });

  it("rejects locked accounts", () => {
    const engine = new SlTpEngine({ accountId: "acct-1", ownerUserId: "user-1", status: "LOCKED", tradingPermission: true });
    engine.setPosition(basePosition);
    const result = engine.createProtection({ accountId: "acct-1", ownerUserId: "user-1", symbol: "NIFTY", side: "LONG", type: "STOP_LOSS", quantity: 10, price: 95 });
    expect(result.reasonCode).toBe("ACCOUNT_LOCKED");
  });

  it("rejects breached accounts", () => {
    const engine = new SlTpEngine({ accountId: "acct-1", ownerUserId: "user-1", status: "BREACHED", tradingPermission: true });
    engine.setPosition(basePosition);
    const result = engine.createProtection({ accountId: "acct-1", ownerUserId: "user-1", symbol: "NIFTY", side: "LONG", type: "STOP_LOSS", quantity: 10, price: 95 });
    expect(result.reasonCode).toBe("ACCOUNT_BREACHED");
  });

  it("reconciles a healthy state", () => {
    const engine = new ReconciliationEngine();
    const result = engine.reconcile({
      accountId: "acct-1",
      symbol: "NIFTY",
      orderState: { id: "o-1", status: "FILLED", qty: 10 },
      executionState: { executions: [{ id: "e-1", orderId: "o-1", qty: 10, price: 100 }] },
      positionState: { qty: 10, avgPrice: 100, realizedPnl: 0, unrealizedPnl: 0, stale: false },
      pnlState: { realizedPnl: 0, unrealizedPnl: 0 },
      protectionState: { activeProtections: 1 },
    });
    expect(result.status).toBe("RECONCILED");
  });

  it("detects quantity mismatch", () => {
    const engine = new ReconciliationEngine();
    const result = engine.reconcile({
      accountId: "acct-1",
      symbol: "NIFTY",
      orderState: { id: "o-1", status: "FILLED", qty: 10 },
      executionState: { executions: [{ id: "e-1", orderId: "o-1", qty: 8, price: 100 }] },
      positionState: { qty: 10, avgPrice: 100, realizedPnl: 0, unrealizedPnl: 0, stale: false },
      pnlState: { realizedPnl: 0, unrealizedPnl: 0 },
      protectionState: { activeProtections: 0 },
    });
    expect(result.status).toBe("MISMATCH");
    expect(result.discrepancyType).toBe("POSITION_QUANTITY_MISMATCH");
  });

  it("detects duplicate execution", () => {
    const engine = new ReconciliationEngine();
    const result = engine.reconcile({
      accountId: "acct-1",
      symbol: "NIFTY",
      orderState: { id: "o-1", status: "FILLED", qty: 10 },
      executionState: { executions: [{ id: "e-1", orderId: "o-1", qty: 10, price: 100 }, { id: "e-1", orderId: "o-1", qty: 10, price: 100 }] },
      positionState: { qty: 10, avgPrice: 100, realizedPnl: 0, unrealizedPnl: 0, stale: false },
      pnlState: { realizedPnl: 0, unrealizedPnl: 0 },
      protectionState: { activeProtections: 0 },
    });
    expect(result.discrepancyType).toBe("DUPLICATE_EXECUTION");
  });

  it("detects stale position state", () => {
    const engine = new ReconciliationEngine();
    const result = engine.reconcile({
      accountId: "acct-1",
      symbol: "NIFTY",
      orderState: { id: "o-1", status: "FILLED", qty: 10 },
      executionState: { executions: [{ id: "e-1", orderId: "o-1", qty: 10, price: 100 }] },
      positionState: { qty: 10, avgPrice: 100, realizedPnl: 0, unrealizedPnl: 0, stale: true },
      pnlState: { realizedPnl: 0, unrealizedPnl: 0 },
      protectionState: { activeProtections: 0 },
    });
    expect(result.discrepancyType).toBe("STALE_POSITION");
  });

  it("returns deterministic reconciliation output", () => {
    const fixedNow = new Date("2026-09-22T10:00:00.000Z");
    const engine = new ReconciliationEngine(() => fixedNow);
    const first = engine.reconcile({ accountId: "acct-1", symbol: "NIFTY", orderState: { id: "o-1", status: "FILLED", qty: 10 }, executionState: { executions: [{ id: "e-1", orderId: "o-1", qty: 10, price: 100 }] }, positionState: { qty: 10, avgPrice: 100, realizedPnl: 0, unrealizedPnl: 0, stale: false }, pnlState: { realizedPnl: 0, unrealizedPnl: 0 }, protectionState: { activeProtections: 0 } });
    const second = engine.reconcile({ accountId: "acct-1", symbol: "NIFTY", orderState: { id: "o-1", status: "FILLED", qty: 10 }, executionState: { executions: [{ id: "e-1", orderId: "o-1", qty: 10, price: 100 }] }, positionState: { qty: 10, avgPrice: 100, realizedPnl: 0, unrealizedPnl: 0, stale: false }, pnlState: { realizedPnl: 0, unrealizedPnl: 0 }, protectionState: { activeProtections: 0 } });
    expect(first).toEqual(second);
  });
});
