import { describe, expect, it, vi } from "vitest";
import {
  isIndianMarketInstrument,
  normalizeDhanCandle,
  normalizeDhanCandles,
  parseDhanTimestamp,
} from "@/lib/openAlgoDataFeed";
import type { TerminalMarketDataInstrument } from "@/lib/terminalApi";

function instrument(
  overrides: Partial<TerminalMarketDataInstrument> = {},
): TerminalMarketDataInstrument {
  return {
    provider: "dhan",
    providerInstrumentId: "12345",
    symbol: "HDFCBANK",
    tradingSymbol: "HDFCBANK",
    exchange: "NSE",
    exchangeSegment: "NSE_EQ",
    instrumentType: "EQUITY",
    ...overrides,
  };
}

describe("OpenAlgo FundedWealth datafeed", () => {
  it("allows Indian cash, index, futures, and options but excludes foreign and commodity instruments", () => {
    expect(isIndianMarketInstrument(instrument())).toBe(true);
    expect(isIndianMarketInstrument(instrument({
      exchange: "BSE",
      exchangeSegment: "BSE_EQ",
    }))).toBe(true);
    expect(isIndianMarketInstrument(instrument({
      exchange: "BSE",
      exchangeSegment: "BSE_IDX",
      instrumentType: "INDEX",
    }))).toBe(true);
    expect(isIndianMarketInstrument(instrument({
      exchangeSegment: "NSE_FNO",
      instrumentType: "OPTSTK",
      tradingSymbol: "HDFCBANK-26JUN-1700-CE",
    }))).toBe(true);
    expect(isIndianMarketInstrument(instrument({
      exchange: "MCX",
      exchangeSegment: "MCX_COMM",
      instrumentType: "FUTCOM",
    }))).toBe(false);
    expect(isIndianMarketInstrument(instrument({
      exchange: "NASDAQ",
      exchangeSegment: "NASDAQ",
      instrumentType: "EQUITY",
    }))).toBe(false);
  });

  it("parses Dhan's offset-free timestamps as India Standard Time", () => {
    expect(parseDhanTimestamp("2026-05-04T09:15:00")).toBe(
      Date.UTC(2026, 4, 4, 3, 45, 0) / 1000,
    );
    expect(parseDhanTimestamp("2026-05-04T09:15:00+05:30")).toBe(
      Date.UTC(2026, 4, 4, 3, 45, 0) / 1000,
    );
  });

  it("normalizes daily candles to India-local midnight and carries open interest", () => {
    expect(normalizeDhanCandle({
      timestamp: "2026-05-04T00:00:00",
      open: 100,
      high: 110,
      low: 95,
      close: 105,
      volume: 1000,
      openInterest: 200,
    }, "1d")).toEqual({
      time: Date.UTC(2026, 4, 3, 18, 30, 0) / 1000,
      open: 100,
      high: 110,
      low: 95,
      close: 105,
      volume: 1000,
      oi: 200,
    });
  });

  it("keeps valid history and warns when Dhan returns an invalid candle", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const bars = normalizeDhanCandles([
      {
        timestamp: "2026-02-25T18:30:00.000Z",
        open: 100,
        high: 110,
        low: 95,
        close: 105,
        volume: 1000,
      },
      {
        timestamp: "2026-02-26T18:30:00.000Z",
        open: 100,
        high: 101,
        low: 95,
        close: 105,
        volume: 1000,
      },
    ], "1d", "NIFTY-Dec2026-FUT");

    expect(bars).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith("Skipped 1 invalid Dhan historical candle(s) for NIFTY-Dec2026-FUT.");
    warn.mockRestore();
  });
});
