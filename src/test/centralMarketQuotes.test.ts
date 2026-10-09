import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCentralMarketQuotes } from "@/lib/centralMarketQuotes";
import { fetchCashQuotes } from "@/lib/marketApi";

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
    vi.mocked(fetchCashQuotes).mockRejectedValue(new Error("provider unavailable"));

    const result = await fetchCentralMarketQuotes([
      { key: "UNKNOWN" },
      { key: "RELIANCE", instrument: instrument() },
    ]);

    expect(result.quotes).toEqual({});
    expect(result.errors).toEqual([
      "Central Dhan instrument data is unavailable for UNKNOWN.",
      "Central Dhan quote request failed for RELIANCE: provider unavailable",
    ]);
  });
});
