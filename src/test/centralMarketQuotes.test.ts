import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCentralMarketQuotes } from "@/lib/centralMarketQuotes";
import { normalizeProviderInstrument } from "@/lib/instrumentMaster";
import { fetchCashQuotes } from "@/lib/marketApi";
import { findWatchlistInstrument } from "@/lib/watchlistInstrument";

vi.mock("@/lib/marketApi", () => ({
  fetchCashQuotes: vi.fn(),
}));

function instrument(overrides: Partial<{
  securityId: string;
  symbol: string;
  tradingSymbol: string;
  exchangeSegment: string;
  provider: "dhan" | "kite" | "zerodha";
  exchange: string;
}> = {}) {
  return {
    securityId: "2885",
    symbol: "RELIANCE INDUSTRIES LTD",
    tradingSymbol: "RELIANCE",
    exchangeSegment: "NSE_EQ",
    instrumentType: "EQUITY",
    lotSize: 1,
    provider: "dhan" as const,
    ...overrides,
  };
}

describe("central market quotes", () => {
  afterEach(() => vi.clearAllMocks());

  it("batches Dhan cash and index quotes by segment and returns customer-safe quote shapes", async () => {
    vi.mocked(fetchCashQuotes).mockImplementation(async (segment) => segment === "NSE_EQ"
      ? {
          "2885": {
            ltp: 1207.7, open: 1200, high: 1210, low: 1198, previousClose: 1190,
            change: 17.7, changePercent: 1.49, volume: 1000, openInterest: null, timestamp: "2026-10-09T08:40:00.000Z",
          },
        }
      : {
          "13": {
            ltp: 25000, open: 24900, high: 25100, low: 24800, previousClose: 24900,
            change: 100, changePercent: 0.4, volume: null, openInterest: null, timestamp: "2026-10-09T08:40:00.000Z",
          },
        });

    const result = await fetchCentralMarketQuotes([
      { key: "RELIANCE", instrument: instrument() },
      { key: "NIFTY", instrument: instrument({
        securityId: "13",
        symbol: "NIFTY",
        tradingSymbol: "NIFTY",
        exchangeSegment: "IDX_I",
      }) },
    ]);

    expect(fetchCashQuotes).toHaveBeenCalledTimes(2);
    expect(fetchCashQuotes).toHaveBeenCalledWith("NSE_EQ", ["2885"]);
    expect(fetchCashQuotes).toHaveBeenCalledWith("IDX_I", ["13"]);
    expect(result.errors).toEqual([]);
    expect(result.quotes.RELIANCE).toMatchObject({ provider: "dhan", ltp: 1207.7, tradingSymbol: "RELIANCE" });
    expect(result.quotes.NIFTY).toMatchObject({ provider: "dhan", ltp: 25000, exchange: "NSE" });
  });

  it("surfaces missing central instruments and rejected quote requests explicitly", async () => {
    vi.mocked(fetchCashQuotes).mockRejectedValue(new Error("Dhan proxy error 503: provider unavailable"));

    const result = await fetchCentralMarketQuotes([
      { key: "UNKNOWN" },
      { key: "RELIANCE", instrument: instrument() },
    ]);

    expect(result.quotes).toEqual({});
    expect(result.errors).toEqual([
      "Central Dhan instrument data is unavailable for UNKNOWN.",
      "Central Dhan quote request failed for RELIANCE: Dhan proxy error 503: provider unavailable",
    ]);
  });

  it("serializes segment requests and retries an index quote once after rate limiting", async () => {
    vi.mocked(fetchCashQuotes)
      .mockResolvedValueOnce({
        "2885": {
          ltp: 1207.7, open: 1200, high: 1210, low: 1198, previousClose: 1190,
          change: 17.7, changePercent: 1.49, volume: 1000, openInterest: null, timestamp: "2026-10-09T08:40:00.000Z",
        },
      })
      .mockRejectedValueOnce(new Error("Dhan proxy error 429: rate limited"))
      .mockResolvedValueOnce({
        "13": {
          ltp: 25000, open: 24900, high: 25100, low: 24800, previousClose: 24900,
          change: 100, changePercent: 0.4, volume: null, openInterest: null, timestamp: "2026-10-09T08:40:00.000Z",
        },
      });

    const result = await fetchCentralMarketQuotes([
      { key: "RELIANCE", instrument: instrument() },
      { key: "NIFTY", instrument: instrument({
        securityId: "13",
        symbol: "NIFTY",
        tradingSymbol: "NIFTY",
        exchangeSegment: "IDX_I",
      }) },
    ]);

    expect(fetchCashQuotes.mock.calls.map(([segment]) => segment)).toEqual(["NSE_EQ", "IDX_I", "IDX_I"]);
    expect(result.quotes).toMatchObject({ RELIANCE: { ltp: 1207.7 }, NIFTY: { ltp: 25000 } });
    expect(result.errors).toEqual([]);
  });

  it("resolves the saved TATAMOTORS key to its current NSE passenger-vehicle listing", async () => {
    const normalized = normalizeProviderInstrument({
      SEM_EXM_EXCH_ID: "NSE",
      SEM_SEGMENT: "E",
      SEM_SMST_SECURITY_ID: "3456",
      SEM_INSTRUMENT_NAME: "EQUITY",
      SEM_TRADING_SYMBOL: "TMPV",
      SEM_CUSTOM_SYMBOL: "Tata Motors Passenger Vehicles",
      SEM_LOT_UNITS: "1",
      SEM_TICK_SIZE: "5",
      SEM_SERIES: "EQ",
      SM_SYMBOL_NAME: "TATA MOTORS PASS VEH LTD",
    }, "dhan");
    expect(normalized.issue).toBeUndefined();
    expect(normalized.instrument).toMatchObject({
      securityId: "3456",
      exchange: "NSE",
      exchangeSegment: "NSE_EQ",
      tradingSymbol: "TMPV",
      series: "EQ",
    });

    if (!normalized.instrument) throw new Error("Verified Dhan master row did not normalize to a supported instrument.");
    const instrumentMatch = findWatchlistInstrument([normalized.instrument], "TATAMOTORS");
    expect(instrumentMatch?.securityId).toBe("3456");
    vi.mocked(fetchCashQuotes).mockResolvedValue({
      "3456": {
        ltp: 278.85, open: 275.8, high: 280.95, low: 274.6, previousClose: 273,
        change: 5.85, changePercent: 2.14, volume: 6360894, openInterest: null, timestamp: "2026-10-09T09:45:00.000Z",
      },
    });

    const result = await fetchCentralMarketQuotes([{ key: "TATAMOTORS", instrument: instrumentMatch }]);
    expect(vi.mocked(fetchCashQuotes)).toHaveBeenCalledWith("NSE_EQ", ["3456"]);
    expect(result.quotes).toMatchObject({
      TATAMOTORS: { ltp: 278.85, tradingSymbol: "TMPV", exchange: "NSE" },
    });
    expect(result.errors).toEqual([]);
  });
});
