import { describe, expect, it } from "vitest";
import {
  canonicalCuratedStockSymbol,
  curatedIndexForInstrument,
  curatedStockForInstrument,
  CURATED_INDICES,
  CURATED_STOCKS,
  rankRowsByVolume,
} from "@/lib/curatedMarketLists";

describe("curated cash-market lists", () => {
  it("contains exactly 100 unique stock symbols and 25 unique indices", () => {
    expect(CURATED_STOCKS).toHaveLength(100);
    expect(new Set(CURATED_STOCKS.map(({ symbol }) => symbol)).size).toBe(100);
    expect(CURATED_INDICES).toHaveLength(25);
    expect(new Set(CURATED_INDICES.map(({ symbol }) => symbol)).size).toBe(25);
  });

  it("resolves current provider ticker aliases without inventing security IDs", () => {
    expect(curatedStockForInstrument("TMPV")?.symbol).toBe("TATAMOTORS");
    expect(canonicalCuratedStockSymbol("TATAMOTORS")).toBe("TMPV");
    expect(curatedIndexForInstrument("NIFTY FIN SERVICE")?.symbol).toBe("FINNIFTY");
    expect(curatedIndexForInstrument("NIFTY MID SELECT")).toBeUndefined();
  });

  it("ranks only by available quote volume and leaves missing quotes last", () => {
    const rows = [
      { symbol: "LOW", chartSymbol: "LOW" },
      { symbol: "MISSING", chartSymbol: "MISSING" },
      { symbol: "HIGH", chartSymbol: "HIGH" },
    ];

    expect(rankRowsByVolume(rows, {
      LOW: { volume: 5 },
      HIGH: { volume: 20 },
    }).map(({ symbol }) => symbol)).toEqual(["HIGH", "LOW", "MISSING"]);
  });
});
