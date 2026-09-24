import { describe, expect, it } from "vitest";
import { hasMeaningfulMarketSnapshot, isMeaningfulMarketValue, resolveOIDataState } from "@/lib/marketDataState";

describe("resolveOIDataState", () => {
  it("keeps the historical label when the market is closed but data exists", () => {
    const state = resolveOIDataState({
      isLive: false,
      afterHours: false,
      hasData: true,
      isLoading: false,
      marketIsOpen: false,
    });

    expect(state.status).toBe("HISTORICAL");
    expect(state.badge).toBe("HISTORICAL");
  });
});

describe("market value semantics", () => {
  it("treats zero and empty price snapshots as unavailable, not real values", () => {
    expect(isMeaningfulMarketValue(0)).toBe(false);
    expect(isMeaningfulMarketValue(null)).toBe(false);
    expect(isMeaningfulMarketValue(undefined)).toBe(false);
    expect(isMeaningfulMarketValue(123.45)).toBe(true);

    expect(hasMeaningfulMarketSnapshot({ ltp: 0, open: 0, high: 0, low: 0, volume: 0 })).toBe(false);
    expect(hasMeaningfulMarketSnapshot({ ltp: 245.6, open: 242, high: 248, low: 240, volume: 120000 })).toBe(true);
  });
});
