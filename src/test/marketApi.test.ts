import { describe, it, expect, vi } from "vitest";
import { fetchInstrumentMaster, fetchLiveOptionChain, normalizeKiteFnOStockQuotes, normalizeTerminalMarketQuote, parseDhanOptionChain, parseNSEOptionChain, normalizeInstrumentMasterResponse } from "@/lib/marketApi";
import { resolveAllowedOrigin } from "../../proxy-origin.mjs";

const { requestTerminalMarketData } = vi.hoisted(() => ({ requestTerminalMarketData: vi.fn() }));
vi.mock("@/lib/terminalApi", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/terminalApi")>(),
  requestTerminalMarketData,
}));

describe("Terminal OS option-chain routing", () => {
  it("requests the selected account/provider chain from the gateway", async () => {
    requestTerminalMarketData.mockResolvedValueOnce({
      provider: "dhan",
      underlying: "NIFTY",
      expiry: "2026-10-01",
      expiries: ["2026-10-01"],
      spotPrice: 25000,
      chain: [],
      totalCEOI: 0,
      totalPEOI: 0,
      greeksAvailable: false,
    });

    const result = await fetchLiveOptionChain("NIFTY", "2026-10-01", "test-account", "dhan");

    expect(requestTerminalMarketData).toHaveBeenCalledWith("test-account", "dhan", {
      operation: "getOptionChain",
      underlying: "NIFTY",
      expiry: "2026-10-01",
    });
    expect(result).toMatchObject({ spotPrice: 25000, source: "dhan", expiries: [{ value: "2026-10-01" }] });
  });
});

describe("Terminal OS quote normalization", () => {
  it.each([
    ["dhan", "dhan"],
    ["kite", "zerodha"],
  ] as const)("normalizes %s quotes into the existing UI quote shape", (gatewayProvider, uiProvider) => {
    const instrument = {
      provider: gatewayProvider,
      providerInstrumentId: "13",
      securityId: "canonical-13",
      symbol: "NIFTY 50",
      tradingSymbol: "NIFTY",
      exchange: "NSE",
      exchangeSegment: "IDX_I",
      instrumentType: "INDEX",
    };
    const result = normalizeTerminalMarketQuote({
      provider: gatewayProvider,
      symbol: "NIFTY 50",
      tradingSymbol: "NIFTY",
      exchange: "NSE",
      ltp: 25100,
      open: 25000,
      high: 25200,
      low: 24900,
      previousClose: 25000,
      change: 100,
      changePercent: 0.4,
      volume: 10,
      openInterest: null,
      timestamp: "2026-09-29T10:00:00.000Z",
    }, instrument, instrument.securityId);

    expect(result).toMatchObject({
      provider: uiProvider,
      instrumentId: "canonical-13",
      providerInstrumentId: "13",
      symbol: "NIFTY",
      ltp: 25100,
      lastTradedPrice: 25100,
      change: 100,
      changePercent: 0.4,
      volume: 10,
    });
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

describe("normalizeKiteFnOStockQuotes", () => {
  it("pairs Kite equity quotes to canonical provider tokens only for futures underlyings", () => {
    const instruments = [
      { securityId: "3329", providerInstrumentId: "3329", symbol: "ABB INDIA", tradingSymbol: "ABB", displayName: "ABB India", exchange: "NSE", exchangeSegment: "NSE_EQ", instrumentType: "EQUITY", lotSize: 1, tickSize: 0.05, provider: "zerodha" },
      { securityId: "17513986", providerInstrumentId: "17513986", symbol: "ABB", tradingSymbol: "ABB26SEPFUT", displayName: "ABB", exchange: "NSE", exchangeSegment: "NSE_FNO", instrumentType: "FUTSTK", lotSize: 125, tickSize: 0.05, expiryDate: "2026-09-29", provider: "zerodha" },
      { securityId: "738561", providerInstrumentId: "738561", symbol: "RELIANCE", tradingSymbol: "RELIANCE", displayName: "Reliance", exchange: "NSE", exchangeSegment: "NSE_EQ", instrumentType: "EQUITY", lotSize: 1, tickSize: 0.05, provider: "zerodha" },
    ];
    const quotes = [{ instrumentId: "3329", providerInstrumentId: "3329", symbol: "ABB", ltp: 7052.5, change: -76.5, changePercent: -1.07, timestamp: new Date().toISOString(), open: 7111, high: 7201.5, low: 7025, previousClose: 7129, volume: 1310, openInterest: 0 }];

    expect(normalizeKiteFnOStockQuotes(instruments, quotes)).toEqual([
      expect.objectContaining({ symbol: "ABB", ltp: 7052.5, open: 7111, high: 7201.5, low: 7025, previousClose: 7129, volume: 1310 }),
    ]);
  });
});

describe("fetchInstrumentMaster provider priority", () => {
  it("uses the authenticated Kite instrument master before attempting Dhan", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/kite/status")) return Promise.resolve(new Response(JSON.stringify({ authenticated: true }), { status: 200 }));
      if (url.includes("/api/kite-proxy")) {
        return Promise.resolve(new Response(JSON.stringify({ status: "success", data: [{ name: "ABB INDIA", tradingsymbol: "ABB", instrument_token: "3329", segment: "NSE", exchange: "NSE", instrument_type: "EQ", lot_size: "1", tick_size: "0.5" }] }), { status: 200 }));
      }
      throw new Error(`Unexpected provider request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchInstrumentMaster();

    expect(result.instruments).toEqual([expect.objectContaining({ securityId: "3329", provider: "zerodha", tradingSymbol: "ABB" })]);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("dhan-proxy"))).toBe(false);
  });
});

describe("proxy CORS allowlist", () => {
  it("allows the live app origin and localhost variants while rejecting unrelated origins", () => {
    expect(resolveAllowedOrigin("http://127.0.0.1:4001")).toBe("http://127.0.0.1:4001");
    expect(resolveAllowedOrigin("http://localhost:4001")).toBe("http://localhost:4001");
    expect(resolveAllowedOrigin("https://app.example.com")).toBeUndefined();
  });
});
