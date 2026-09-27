import { describe, expect, it } from "vitest";
import {
  derivePositionProtectionPrice,
  mergeCanonicalProtectionFields,
  validatePositionProtectionPrice,
  type PositionProtectionSnapshot,
} from "@/lib/positionProtectionValidation";

const longPosition: PositionProtectionSnapshot = {
  side: "long",
  entryPrice: 100,
  currentPrice: 110,
  tickSize: 0.05,
  stopLoss: 95,
  takeProfit: 120,
};

describe("position protection price validation", () => {
  it("accepts directionally valid BUY levels and rejects levels through market or entry", () => {
    expect(validatePositionProtectionPrice("stop_loss", 99.95, longPosition).valid).toBe(true);
    expect(validatePositionProtectionPrice("take_profit", 110.05, longPosition).valid).toBe(true);
    expect(validatePositionProtectionPrice("stop_loss", 110, longPosition).valid).toBe(false);
    expect(validatePositionProtectionPrice("take_profit", 100, longPosition).valid).toBe(false);
  });

  it("mirrors level direction for SELL positions", () => {
    const shortPosition = { ...longPosition, side: "short" as const, stopLoss: 120, takeProfit: 95 };
    expect(validatePositionProtectionPrice("stop_loss", 110.05, shortPosition).valid).toBe(true);
    expect(validatePositionProtectionPrice("take_profit", 99.95, shortPosition).valid).toBe(true);
    expect(validatePositionProtectionPrice("stop_loss", 100, shortPosition).valid).toBe(false);
    expect(validatePositionProtectionPrice("take_profit", 110, shortPosition).valid).toBe(false);
  });

  it("rejects invalid tick sizes and crossing the opposite protection", () => {
    expect(validatePositionProtectionPrice("stop_loss", 99.93, longPosition).message).toContain("tick size");
    expect(validatePositionProtectionPrice("stop_loss", 99.95, { ...longPosition, takeProfit: 99.9 }).message).toContain("cross");
    expect(validatePositionProtectionPrice("take_profit", 110.05, { ...longPosition, stopLoss: 111 }).message).toContain("cross");
    expect(validatePositionProtectionPrice("take_profit", 110.05, { ...longPosition, tickSize: 0 }).valid).toBe(false);
  });

  it("preserves valid levels across null WebSocket merges unless explicitly removed", () => {
    const merged = mergeCanonicalProtectionFields(
      [{ id: "position-1", stop_loss: 95, take_profit: 120 }],
      [{ id: "position-1", stop_loss: null, take_profit: undefined }],
    );
    expect(merged[0]).toMatchObject({ stop_loss: 95, take_profit: 120 });

    const removedSnapshot: Array<{ id: string; stop_loss?: number | null; take_profit?: number | null; stop_loss_removed?: boolean }> = [{ id: "position-1", stop_loss_removed: true }];
    const removed = mergeCanonicalProtectionFields(merged, removedSnapshot);
    expect(removed[0].stop_loss).toBeNull();
    expect(removed[0].take_profit).toBe(120);
  });

  it("derives a valid default price for unset exit levels without crossing the opposing protection", () => {
    const longDefaultStop = derivePositionProtectionPrice("stop_loss", {
      ...longPosition,
      stopLoss: null,
      takeProfit: 120,
    });
    const longDefaultTake = derivePositionProtectionPrice("take_profit", {
      ...longPosition,
      stopLoss: 95,
      takeProfit: null,
    });
    const shortDefaultStop = derivePositionProtectionPrice("stop_loss", {
      ...longPosition,
      side: "short",
      entryPrice: 100,
      currentPrice: 90,
      stopLoss: null,
      takeProfit: 95,
    });

    expect(longDefaultStop).toBeLessThan(longPosition.entryPrice);
    expect(longDefaultTake).toBeGreaterThan(longPosition.currentPrice);
    expect(shortDefaultStop).toBeGreaterThan(100);
    expect(validatePositionProtectionPrice("stop_loss", longDefaultStop, { ...longPosition, stopLoss: null, takeProfit: 120 }).valid).toBe(true);
    expect(validatePositionProtectionPrice("take_profit", longDefaultTake, { ...longPosition, stopLoss: 95, takeProfit: null }).valid).toBe(true);
  });
});