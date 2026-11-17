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
    expect(vi.mocked(requestTerminalMarketData).mock.calls.map(([, , request]) =>
      request.operation === "getQuotes" ? [...new Set(request.instruments.map((item) => item.exchangeSegment))] : []
    )).toEqual([["NSE_EQ"], ["IDX_I"]]);
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
    expect(result.errors).toEqual(["Central Dhan quote batch failed: global provider unavailable"]);
  });

  it("keeps successful batch quotes when another Dhan batch fails", async () => {
    vi.mocked(requestTerminalMarketData).mockImplementation(async (_accountId, _provider, request) => {
      if (request.operation !== "getQuotes") return [];
      if (request.instruments[0]?.providerInstrumentId === "101000") {
        return request.instruments.map((item) =>
          quote(item.providerInstrumentId, 1200, item.tradingSymbol)
        ) as never;
      }
      throw new Error("batch unavailable");
    });

    const targets = Array.from({ length: 1_001 }, (_, index) => {
      const id = String(101_000 + index);
      return {
        key: `NSE_EQ:SYMBOL${id}`,
        instrument: instrument({
          securityId: id,
          providerInstrumentId: id,
          symbol: `SYMBOL${id}`,
          tradingSymbol: `SYMBOL${id}`,
        }),
      };
    });

    const result = await fetchCentralMarketQuotes(targets);

    expect(result.quotes["NSE_EQ:SYMBOL101000"]).toMatchObject({ ltp: 1200 });
    expect(Object.keys(result.quotes)).toHaveLength(1_000);
    expect(result.errors).toEqual(["Central Dhan quote batch failed: batch unavailable"]);
  });

  it("retries a global Dhan quote batch once after rate limiting", async () => {
    vi.mocked(requestTerminalMarketData)
      .mockRejectedValueOnce(new TerminalMarketDataError("RATE_LIMITED", 429))
      .mockImplementation(async (_accountId, _provider, request) => {
        if (request.operation !== "getQuotes") return [];
        return request.instruments.map((item) =>
          quote(item.providerInstrumentId, item.providerInstrumentId === "13" ? 25000 : 1207.7, item.tradingSymbol)
        ) as never;
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

    expect(requestTerminalMarketData).toHaveBeenCalledTimes(3);
    expect(result.quotes).toMatchObject({ RELIANCE: { ltp: 1207.7 }, NIFTY: { ltp: 25000 } });
    expect(result.errors).toEqual([]);
  });

  it("splits mixed NSE and BSE cash listings into exchange-segment-safe batches", async () => {
    vi.mocked(requestTerminalMarketData).mockImplementation(async (_accountId, _provider, request) => {
      if (request.operation !== "getQuotes") return [];
      return request.instruments.map((item) => ({
        ...quote(item.providerInstrumentId, 1200, item.tradingSymbol),
        exchange: item.exchange,
      })) as never;
    });

    const result = await fetchCentralMarketQuotes([
      { key: "NSE_EQ:RELIANCE", instrument: instrument() },
      { key: "BSE_EQ:RELIANCE", instrument: instrument({
        securityId: "500325",
        providerInstrumentId: "500325",
        exchange: "BSE",
        exchangeSegment: "BSE_EQ",
      }) },
    ]);

    const requests = vi.mocked(requestTerminalMarketData).mock.calls.map(([, , request]) => request);
    expect(requests).toHaveLength(2);
    expect(requests.every((request) =>
      request.operation === "getQuotes" &&
      new Set(request.instruments.map((item) => item.exchangeSegment)).size === 1
    )).toBe(true);
    expect(result.quotes).toHaveProperty("NSE_EQ:RELIANCE");
    expect(result.quotes).toHaveProperty("BSE_EQ:RELIANCE");
  });

  it("keeps each Dhan quote batch within the 1,000-instrument provider limit", async () => {
    vi.mocked(requestTerminalMarketData).mockImplementation(async (_accountId, _provider, request) => {
      if (request.operation !== "getQuotes") return [];
      return request.instruments.map((item) => ({
        ...quote(item.providerInstrumentId, 1200, item.tradingSymbol),
        exchange: item.exchange,
      })) as never;
    });
    const targets = Array.from({ length: 1_001 }, (_, index) => {
      const id = String(100_000 + index);
      return {
        key: `NSE_EQ:SYMBOL${id}`,
        instrument: instrument({
          securityId: id,
          providerInstrumentId: id,
          symbol: `SYMBOL${id}`,
          tradingSymbol: `SYMBOL${id}`,
        }),
      };
    });

    await fetchCentralMarketQuotes(targets);

    const sizes = vi.mocked(requestTerminalMarketData).mock.calls.map(([, , request]) =>
      request.operation === "getQuotes" ? request.instruments.length : 0
    );
    expect(sizes).toEqual([1_000, 1]);
  });

  it("fetches large quote catalogs with bounded batch concurrency", async () => {
    let activeRequests = 0;
    let maxActiveRequests = 0;
    vi.mocked(requestTerminalMarketData).mockImplementation(async (_accountId, _provider, request) => {
      if (request.operation !== "getQuotes") return [];
      activeRequests += 1;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeRequests -= 1;
      return request.instruments.map((item) => ({
        ...quote(item.providerInstrumentId, 1200, item.tradingSymbol),
        exchange: item.exchange,
      })) as never;
    });
    const targets = Array.from({ length: 4_001 }, (_, index) => {
      const id = String(200_000 + index);
      return {
        key: `NSE_EQ:SYMBOL${id}`,
        instrument: instrument({
          securityId: id,
          providerInstrumentId: id,
          symbol: `SYMBOL${id}`,
          tradingSymbol: `SYMBOL${id}`,
        }),
      };
    });

    await fetchCentralMarketQuotes(targets);

    expect(maxActiveRequests).toBe(3);
    expect(requestTerminalMarketData).toHaveBeenCalledTimes(5);
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
    expect(requestTerminalMarketData).toHaveBeenCalledWith(
      null,
      "dhan",
      expect.objectContaining({ operation: "getQuotes" }),
      "production",
      undefined,
    );
    expect(result.quotes).toMatchObject({
      TATAMOTORS: { ltp: 278.85, tradingSymbol: "TMPV", exchange: "NSE" },
    });
    expect(result.errors).toEqual([]);
  });
});
