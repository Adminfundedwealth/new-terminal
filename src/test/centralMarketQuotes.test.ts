import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCentralMarketQuotes } from "@/lib/centralMarketQuotes";
import { normalizeProviderInstrument } from "@/lib/instrumentMaster";
import { requestTerminalMarketData, TerminalMarketDataError } from "@/lib/terminalApi";
import { findWatchlistInstrument } from "@/lib/watchlistInstrument";

vi.mock("@/lib/terminalApi", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/terminalApi")>(),
  requestTerminalMarketData: vi.fn(),
}));

function quote(instrumentId: string, ltp: number, tradingSymbol: string) {
  return {
    provider: "dhan" as const,
    symbol: tradingSymbol,
    tradingSymbol,
    exchange: "NSE",
    ltp,
    open: ltp - 100,
    high: ltp + 100,
    low: ltp - 200,
    previousClose: ltp - 100,
    change: 100,
    changePercent: 0.4,
    volume: null,
    openInterest: null,
    timestamp: "2026-10-09T08:40:00.000Z",
    instrumentId,
  };
}

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

  it("batches quotes through the global Dhan market-data route without account context", async () => {
    vi.mocked(requestTerminalMarketData).mockImplementation(async (_accountId, _provider, request) => {
      if (request.operation !== "getQuotes") return [];
      return request.instruments.map((item) => ({
        ...quote(item.providerInstrumentId, item.providerInstrumentId === "13" ? 25000 : 1207.7, item.tradingSymbol),
        instrumentId: undefined,
      })) as never;
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

    expect(requestTerminalMarketData).toHaveBeenCalledTimes(2);
    expect(vi.mocked(requestTerminalMarketData).mock.calls.map(([accountId, provider]) => [accountId, provider])).toEqual([
      [null, "dhan"],
      [null, "dhan"],
    ]);
    expect(result.errors).toEqual([]);
    expect(result.quotes.RELIANCE).toMatchObject({ provider: "dhan", ltp: 1207.7, tradingSymbol: "RELIANCE" });
    expect(result.quotes.NIFTY).toMatchObject({ provider: "dhan", ltp: 25000, exchange: "NSE" });
  });

  it("surfaces missing central instruments and rejected quote requests explicitly", async () => {
    vi.mocked(requestTerminalMarketData).mockRejectedValue(new Error("global provider unavailable"));

    const result = await fetchCentralMarketQuotes([
      { key: "UNKNOWN" },
      { key: "RELIANCE", instrument: instrument() },
    ]);

    expect(result.quotes).toEqual({});
    expect(result.errors).toEqual([
      "Central Dhan instrument data is unavailable for UNKNOWN.",
      "Central Dhan quote request failed for RELIANCE: global provider unavailable",
    ]);
  });

  it("retries a global Dhan quote batch once after rate limiting", async () => {
    vi.mocked(requestTerminalMarketData)
      .mockResolvedValueOnce([quote("2885", 1207.7, "RELIANCE")] as never)
      .mockRejectedValueOnce(new TerminalMarketDataError("RATE_LIMITED", 429))
      .mockResolvedValueOnce([quote("13", 25000, "NIFTY")] as never);

    const result = await fetchCentralMarketQuotes([
      { key: "RELIANCE", instrument: instrument() },
      { key: "NIFTY", instrument: instrument({
        securityId: "13",
        symbol: "NIFTY",
        tradingSymbol: "NIFTY",
        exchangeSegment: "IDX_I",
      }) },
    ]);

    expect(requestTerminalMarketData).toHaveBeenCalledTimes(3);
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
    vi.mocked(requestTerminalMarketData).mockResolvedValue([quote("3456", 278.85, "TMPV")] as never);

    const result = await fetchCentralMarketQuotes([{ key: "TATAMOTORS", instrument: instrumentMatch }]);
    expect(requestTerminalMarketData).toHaveBeenCalledWith(null, "dhan", expect.objectContaining({ operation: "getQuotes" }));
    expect(result.quotes).toMatchObject({
      TATAMOTORS: { ltp: 278.85, tradingSymbol: "TMPV", exchange: "NSE" },
    });
    expect(result.errors).toEqual([]);
  });
});
