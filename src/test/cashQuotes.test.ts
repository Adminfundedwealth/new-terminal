import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCashQuotes, normalizeDhanQuoteTimestamp } from "@/lib/marketApi";

describe("Dhan cash-equity quote requests", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns LTPs from the configured proxy for cash security IDs", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { NSE_EQ: { "2885": { last_price: 1425.5, net_change: 25.5, last_trade_time: "09/10/2026 13:33:34", oi: 123, ohlc: { open: 1410, high: 1430, low: 1405, close: 1400 }, volume: 7890 } } },
      status: "success",
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchCashQuotes("NSE_EQ", ["2885"])).resolves.toEqual({
      "2885": {
        ltp: 1425.5,
        open: 1410,
        high: 1430,
        low: 1405,
        previousClose: 1400,
        change: 25.5,
        changePercent: 1.8214285714285714,
        volume: 7890,
        openInterest: 123,
        timestamp: "2026-10-09T08:03:34.000Z",
      },
    });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("endpoint=cash-quotes"));
    const [, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit | undefined];
    const headers = new Headers(init?.headers);
    expect(headers.has("x-dhan-client-id")).toBe(false);
    expect(headers.has("x-dhan-access-token")).toBe(false);
  });

  it("supports NSE derivatives and rejects unsupported or oversized requests before fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      data: { NSE_FNO: { "48704": { last_price: 25000, ohlc: { close: 24900 }, volume: 10 } } },
    }), { status: 200 }));
    await expect(fetchCashQuotes("NSE_FNO", ["48704"])).resolves.toMatchObject({
      "48704": { ltp: 25000, previousClose: 24900, change: 100, changePercent: (100 / 24900) * 100 },
    });
    await expect(fetchCashQuotes("MCX_COMM", ["123"])).rejects.toThrow("Unsupported market quote segment");
    await expect(fetchCashQuotes("NSE_EQ", Array.from({ length: 1001 }, (_, index) => String(index)))).rejects.toThrow("up to 1,000");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("parses Dhan wall-clock timestamps as India Standard Time without month/day ambiguity", () => {
    expect(normalizeDhanQuoteTimestamp("09/10/2026 13:33:34")).toBe("2026-10-09T08:03:34.000Z");
    expect(normalizeDhanQuoteTimestamp("31/02/2026 13:33:34")).toBeNull();
  });
});
