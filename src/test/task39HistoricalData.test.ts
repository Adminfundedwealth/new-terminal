import { describe, expect, it } from "vitest";
import {
  canonicalizeCandle,
  normalizeCandlePayload,
  normalizeTimeframe,
  resolveHistoricalInstrument,
  deduplicateHistoricalCandles,
  mergeHistoricalRanges,
  HistoricalCandle,
} from "@/lib/historicalData";
import { InstrumentMaster } from "@/lib/instrumentMaster";

describe("Task 39 historical-data contract", () => {
  const master = new InstrumentMaster();
  master.add({
    securityId: "13",
    symbol: "NIFTY",
    tradingSymbol: "NIFTY",
    displayName: "NIFTY",
    exchange: "NSE",
    exchangeSegment: "IDX_I",
    instrumentType: "INDEX",
    lotSize: 1,
    tickSize: 0.05,
    provider: "dhan",
    providerInstrumentId: "13",
  });
  master.add({
    securityId: "1001",
    symbol: "RELIANCE",
    tradingSymbol: "RELIANCE",
    displayName: "RELIANCE",
    exchange: "NSE",
    exchangeSegment: "NSE_EQ",
    instrumentType: "EQUITY",
    lotSize: 1,
    tickSize: 0.05,
    provider: "dhan",
    providerInstrumentId: "1001",
  });
  master.add({
    securityId: "FUT-1",
    symbol: "RELIANCE",
    tradingSymbol: "RELIANCE26JANFUT",
    displayName: "RELIANCE26JANFUT",
    exchange: "NSE",
    exchangeSegment: "NSE_FNO",
    instrumentType: "FUTSTK",
    lotSize: 250,
    tickSize: 0.05,
    expiryDate: "2026-01-29",
    strikePrice: undefined,
    provider: "dhan",
    providerInstrumentId: "FUT-1",
  });

  it("normalizes a canonical candle contract", () => {
    const candle = canonicalizeCandle({
      instrumentId: "13",
      timestamp: 1700000000,
      open: 22000,
      high: 22110,
      low: 21980,
      close: 22060,
      volume: 1234,
      interval: "5",
      exchange: "NSE",
      symbol: "NIFTY",
    });

    expect(candle).toMatchObject({
      instrumentId: "13",
      exchange: "NSE",
      symbol: "NIFTY",
      interval: "5",
      volume: 1234,
    });
    expect(candle.high).toBeGreaterThanOrEqual(candle.open);
    expect(candle.low).toBeLessThanOrEqual(candle.close);
  });

  it("normalizes provider payloads into ordered, valid candles", () => {
    const candles = normalizeCandlePayload({
      timestamp: [1700000000, 1700003600, 1700003600, 1700007200],
      open: [100, 101, 101.5, 102],
      high: [101, 103, 104, 103],
      low: [99, 100, 99.5, 101],
      close: [100.5, 102, 103, 102.5],
      volume: [10, 20, 25, 30],
    }, { instrumentId: "13", interval: "5", symbol: "NIFTY", exchange: "NSE" });

    expect(candles).toHaveLength(3);
    expect(candles.map((c: HistoricalCandle) => c.timestamp)).toEqual([1700000000, 1700003600, 1700007200]);
    expect(candles[1]).toMatchObject({ close: 103, volume: 25 });
  });

  it("resolves canonical instruments from canonical ID, provider ID, and exchange+symbol", () => {
    expect(resolveHistoricalInstrument({ instrumentId: "13" }, master)?.instrumentId).toBe("13");
    expect(resolveHistoricalInstrument({ provider: "dhan", providerInstrumentId: "1001" }, master)?.instrumentId).toBe("1001");
    expect(resolveHistoricalInstrument({ exchange: "NSE", symbol: "NIFTY" }, master)?.instrumentId).toBe("13");
    expect(resolveHistoricalInstrument({ exchange: "NSE", symbol: "UNKNOWN" }, master)).toBeNull();
  });

  it("accepts valid and rejects invalid timeframes", () => {
    expect(normalizeTimeframe("5")).toBe("5");
    expect(normalizeTimeframe("1m")).toBe("1");
    expect(normalizeTimeframe("1D")).toBe("D");
    expect(() => normalizeTimeframe("INVALID")).toThrow();
  });

  it("rejects malformed candles and invalid timestamps", () => {
    expect(() => canonicalizeCandle({ instrumentId: "13", timestamp: -1, open: 1, high: 2, low: 1, close: 1.5, volume: 10, interval: "5", exchange: "NSE", symbol: "NIFTY" })).toThrow();
    expect(() => canonicalizeCandle({ instrumentId: "13", timestamp: 1700000000, open: 10, high: 9, low: 8, close: 7, volume: 10, interval: "5", exchange: "NSE", symbol: "NIFTY" })).toThrow();
    expect(() => canonicalizeCandle({ instrumentId: "13", timestamp: 1700000000, open: null as unknown as number, high: 2, low: 1, close: 1.5, volume: 10, interval: "5", exchange: "NSE", symbol: "NIFTY" })).toThrow();
  });

  it("deduplicates and merges out-of-order ranges deterministically", () => {
    const result = mergeHistoricalRanges(
      [
        { instrumentId: "13", timestamp: 1700003600, open: 101, high: 102, low: 100, close: 101.5, volume: 20, interval: "5", exchange: "NSE", symbol: "NIFTY" },
        { instrumentId: "13", timestamp: 1700000000, open: 100, high: 101, low: 99, close: 100.5, volume: 10, interval: "5", exchange: "NSE", symbol: "NIFTY" },
      ],
      [
        { instrumentId: "13", timestamp: 1700003600, open: 101.5, high: 102.5, low: 100.5, close: 102, volume: 25, interval: "5", exchange: "NSE", symbol: "NIFTY" },
        { instrumentId: "13", timestamp: 1700007200, open: 102, high: 103, low: 101, close: 102.5, volume: 30, interval: "5", exchange: "NSE", symbol: "NIFTY" },
      ],
    );

    expect(result.map((c) => c.timestamp)).toEqual([1700000000, 1700003600, 1700007200]);
    expect(result[1].volume).toBe(25);
  });

  it("keeps historical data isolated across instruments", () => {
    const first = normalizeCandlePayload({ timestamp: [1700000000], open: [100], high: [110], low: [90], close: [105], volume: [50] }, { instrumentId: "13", interval: "5", symbol: "NIFTY", exchange: "NSE" });
    const second = normalizeCandlePayload({ timestamp: [1700000000], open: [200], high: [210], low: [190], close: [205], volume: [80] }, { instrumentId: "1001", interval: "5", symbol: "RELIANCE", exchange: "NSE" });

    expect(first[0].instrumentId).toBe("13");
    expect(second[0].instrumentId).toBe("1001");
    expect(first[0].close).toBe(105);
    expect(second[0].close).toBe(205);
  });
});
