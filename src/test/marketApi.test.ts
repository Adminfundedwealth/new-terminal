import { afterEach, describe, it, expect, vi } from "vitest";
import { fetchInstrumentMaster, fetchLiveFnOStocks, isNseMarketOpenAt, isWithinNseSessionAt, parseDhanOptionChain, parseNSEOptionChain, normalizeInstrumentMasterResponse } from "@/lib/marketApi";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("isNseMarketOpenAt", () => {
  it("rejects a stale NSE open status outside regular Indian market hours", () => {
    expect(isNseMarketOpenAt("Open", "07-Oct-2026 15:30", new Date("2026-10-08T01:50:00.000Z"))).toBe(false);
  });

  it("requires the NSE trade date to match today, even during market hours", () => {
    expect(isNseMarketOpenAt("Open", "07-Oct-2026 15:30", new Date("2026-10-08T04:00:00.000Z"))).toBe(false);
  });

  it("reports open only within weekday NSE trading hours in Asia/Kolkata", () => {
    expect(isNseMarketOpenAt("Open", "08-Oct-2026", new Date("2026-10-08T03:45:00.000Z"))).toBe(true);
    expect(isNseMarketOpenAt("Open", "08-Oct-2026", new Date("2026-10-08T10:00:00.000Z"))).toBe(true);
    expect(isNseMarketOpenAt("Open", "08-Oct-2026", new Date("2026-10-08T03:44:00.000Z"))).toBe(false);
    expect(isNseMarketOpenAt("Open", "08-Oct-2026", new Date("2026-10-08T10:01:00.000Z"))).toBe(false);
    expect(isNseMarketOpenAt("Open", "10-Oct-2026", new Date("2026-10-10T05:00:00.000Z"))).toBe(false);
  });
});

describe("isWithinNseSessionAt", () => {
  it("uses Indian local time and regular weekday market hours when the live status provider is unavailable", () => {
    expect(isWithinNseSessionAt(new Date("2026-10-08T03:45:00.000Z"))).toBe(true);
    expect(isWithinNseSessionAt(new Date("2026-10-08T01:50:00.000Z"))).toBe(false);
    expect(isWithinNseSessionAt(new Date("2026-10-10T05:00:00.000Z"))).toBe(false);
  });
});

describe("fetchLiveFnOStocks", () => {
  it("uses the TradingView scanner instead of requesting NSE outside regular hours", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-08T01:50:00.000Z"));
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      stocks: [{ symbol: "RELIANCE", ltp: 100, changeAbs: 1, changePercent: 1, open: 99, high: 101, low: 99, volume: 200 }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const stocks = await fetchLiveFnOStocks();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/tv-scan?type=stocks");
    expect(stocks[0]?.symbol).toBe("RELIANCE");
  });

  it("filters treasury bills and non-equity debt instruments from the live NSE list", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-08T05:00:00.000Z"));
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/dhan-proxy?endpoint=instruments")) {
        return Promise.resolve(new Response(JSON.stringify({
          instruments: [
            { securityId: "1", symbol: "RELIANCE INDUSTRIES LTD", tradingSymbol: "RELIANCE", exchangeSegment: "NSE_EQ", instrumentType: "EQUITY", lotSize: 1, tickSize: 0.05 },
            { securityId: "2", symbol: "GOI T-BILL 182D-01/04/27", tradingSymbol: "GOITBILL182D", exchangeSegment: "NSE_EQ", instrumentType: "EQUITY", lotSize: 1, tickSize: 0.05 },
          ],
        }), { status: 200, headers: { "Content-Type": "application/json" } }));
      }
      if (url.includes("/api/nse-proxy?endpoint=equity-derivatives")) {
        return Promise.resolve(new Response(JSON.stringify({
          data: [
            { symbol: "RELIANCE", lastPrice: 2800, change: 20, pChange: 0.72, open: 2780, dayHigh: 2810, dayLow: 2775, previousClose: 2785, totalTradedVolume: 200000, changeinOpenInterest: 0 },
            { symbol: "GOI T-BILL 182D-01/04/27", lastPrice: 99.5, change: 0, pChange: 0.0, open: 99.5, dayHigh: 99.7, dayLow: 99.4, previousClose: 99.5, totalTradedVolume: 2000, changeinOpenInterest: 0 },
          ],
        }), { status: 200, headers: { "Content-Type": "application/json" } }));
      }
      return Promise.resolve(new Response(JSON.stringify({ stocks: [] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    });

    const stocks = await fetchLiveFnOStocks();

    expect(stocks.map((stock) => stock.symbol)).toEqual(["RELIANCE"]);
    expect(fetchMock).toHaveBeenCalled();
  });
});

describe("browser broker credential boundary", () => {
  it("does not forward browser-held Dhan credentials to the legacy proxy", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      instruments: [],
      count: 0,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    await fetchInstrumentMaster();

    const [, init] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit | undefined];
    const headers = new Headers(init?.headers);
    expect(headers.has("x-dhan-client-id")).toBe(false);
    expect(headers.has("x-dhan-access-token")).toBe(false);
  });
});

describe("parseDhanOptionChain", () => {
  it("returns empty chain for null/undefined input", () => {
    const result = parseDhanOptionChain(null as any);
    expect(result.chain).toHaveLength(0);
    expect(result.spotPrice).toBe(0);
  });

  it("returns empty chain for empty oc object", () => {
    const result = parseDhanOptionChain({
      data: { oc: {}, last_price: 24000 },
      status: "success",
    });
    expect(result.chain).toHaveLength(0);
    expect(result.spotPrice).toBe(24000);
  });

  it("parses Dhan API v1 format (flat fields)", () => {
    const result = parseDhanOptionChain({
      status: "success",
      data: {
        last_price: 24100,
        oc: {
          "24000": {
            ce: { ltp: 150, oi: 500000, volume: 100000, iv: 15.5, delta: 0.55, gamma: 0.01, theta: -5, vega: 10 },
            pe: { ltp: 80, oi: 600000, volume: 80000, iv: 16.2, delta: -0.45, gamma: 0.01, theta: -4, vega: 9 },
          },
          "24200": {
            ce: { ltp: 50, oi: 300000, volume: 60000, iv: 14.8, delta: 0.35, gamma: 0.008, theta: -3, vega: 8 },
            pe: { ltp: 200, oi: 400000, volume: 90000, iv: 17.1, delta: -0.65, gamma: 0.008, theta: -6, vega: 11 },
          },
        },
      },
    });

    expect(result.chain).toHaveLength(2);
    expect(result.spotPrice).toBe(24100);
    expect(result.chain[0].strikePrice).toBe(24000); // sorted
    expect(result.chain[0].ce.ltp).toBe(150);
    expect(result.chain[0].ce.iv).toBe(15.5);
    expect(result.chain[0].ce.delta).toBe(0.55);
    expect(result.totalCEOI).toBe(800000);
    expect(result.totalPEOI).toBe(1000000);
  });

  it("parses Dhan API v2 format (nested greeks + last_price)", () => {
    const result = parseDhanOptionChain({
      status: "success",
      data: {
        last_price: 24500,
        oc: {
          "24400": {
            ce: {
              last_price: 200,
              oi: 100000,
              previous_oi: 90000,
              volume: 50000,
              implied_volatility: 18.5,
              top_bid_price: 199,
              top_ask_price: 201,
              greeks: { delta: 0.6, gamma: 0.015, theta: -8, vega: 12 },
            },
            pe: {
              last_price: 120,
              oi: 80000,
              previous_oi: 85000,
              volume: 40000,
              implied_volatility: 19.2,
              top_bid_price: 119,
              top_ask_price: 121,
              greeks: { delta: -0.4, gamma: 0.015, theta: -6, vega: 11 },
            },
          },
        },
      },
    });

    expect(result.chain).toHaveLength(1);
    expect(result.spotPrice).toBe(24500);
    
    const row = result.chain[0];
    expect(row.ce.ltp).toBe(200);  // last_price, not ltp
    expect(row.ce.iv).toBe(18.5);  // implied_volatility, not iv
    expect(row.ce.delta).toBe(0.6); // from greeks object
    expect(row.ce.oiChange).toBe(10000); // 100000 - 90000
    expect(row.ce.bidPrice).toBe(199); // top_bid_price
    expect(row.pe.oiChange).toBe(-5000); // 80000 - 85000
    expect(row.pe.delta).toBe(-0.4);
  });

  it("sorts chain by strike price ascending", () => {
    const result = parseDhanOptionChain({
      status: "success",
      data: {
        last_price: 24000,
        oc: {
          "24200": { ce: { ltp: 10 }, pe: { ltp: 10 } },
          "23800": { ce: { ltp: 10 }, pe: { ltp: 10 } },
          "24000": { ce: { ltp: 10 }, pe: { ltp: 10 } },
        },
      },
    });
    expect(result.chain.map(r => r.strikePrice)).toEqual([23800, 24000, 24200]);
  });
});

describe("parseNSEOptionChain", () => {
  it("returns empty for malformed input", () => {
    const result = parseNSEOptionChain({} as any);
    expect(result.chain).toHaveLength(0);
    expect(result.spotPrice).toBe(0);
  });

  it("parses standard NSE response format", () => {
    const result = parseNSEOptionChain({
      records: {
        expiryDates: ["08-May-2026", "15-May-2026"],
        strikePrices: [24000, 24100],
        data: [
          {
            strikePrice: 24000,
            expiryDate: "08-May-2026",
            CE: { lastPrice: 150, openInterest: 500000, changeinOpenInterest: 10000, totalTradedVolume: 100000, impliedVolatility: 15.5, bidprice: 149, askPrice: 151, underlyingValue: 24050 },
            PE: { lastPrice: 80, openInterest: 600000, changeinOpenInterest: -5000, totalTradedVolume: 80000, impliedVolatility: 16, bidprice: 79, askPrice: 81, underlyingValue: 24050 },
          },
          {
            strikePrice: 24100,
            expiryDate: "08-May-2026",
            CE: { lastPrice: 100, openInterest: 300000, changeinOpenInterest: 8000, totalTradedVolume: 60000, impliedVolatility: 14.5, bidprice: 99, askPrice: 101, underlyingValue: 24050 },
            PE: { lastPrice: 130, openInterest: 400000, changeinOpenInterest: 12000, totalTradedVolume: 70000, impliedVolatility: 17, bidprice: 129, askPrice: 131, underlyingValue: 24050 },
          },
        ],
      },
      filtered: {
        CE: { totOI: 800000, totVol: 160000 },
        PE: { totOI: 1000000, totVol: 150000 },
      },
    });

    expect(result.chain).toHaveLength(2);
    expect(result.spotPrice).toBe(24050);
    expect(result.expiries).toHaveLength(2);
    expect(result.totalCEOI).toBe(800000);
    expect(result.totalPEOI).toBe(1000000);
    expect(result.chain[0].ce.ltp).toBe(150);
    expect(result.chain[0].pe.oiChange).toBe(-5000);
  });
});

describe("normalizeInstrumentMasterResponse", () => {
  it("unwraps the proxy response and exposes the instrument array", () => {
    expect(normalizeInstrumentMasterResponse({ data: { instruments: [{ securityId: "13", symbol: "NIFTY" }], count: 1 } })).toEqual([
      { securityId: "13", symbol: "NIFTY" },
    ]);
    expect(normalizeInstrumentMasterResponse({ instruments: [{ securityId: "25", symbol: "BANKNIFTY" }] })).toEqual([
      { securityId: "25", symbol: "BANKNIFTY" },
    ]);
    expect(normalizeInstrumentMasterResponse([{ securityId: "27", symbol: "FINNIFTY" }])).toEqual([
      { securityId: "27", symbol: "FINNIFTY" },
    ]);
  });
});
