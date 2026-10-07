import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCashQuotes } from "@/lib/marketApi";

describe("Dhan cash-equity quote requests", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns LTPs from the configured proxy for cash security IDs", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { data: { NSE_EQ: { "2885": { last_price: 1425.5, ohlc: { open: 1410, high: 1430, low: 1405, close: 1400 }, volume: 7890 } } } },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchCashQuotes("NSE_EQ", ["2885"])).resolves.toEqual({
      "2885": { ltp: 1425.5, open: 1410, high: 1430, low: 1405, previousClose: 1400, volume: 7890 },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("endpoint=cash-quotes"),
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it("rejects unsupported or oversized quote requests before fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchCashQuotes("NSE_FNO", ["2885"])).rejects.toThrow("Unsupported cash quote segment");
    await expect(fetchCashQuotes("NSE_EQ", Array.from({ length: 1001 }, (_, index) => String(index)))).rejects.toThrow("up to 1,000");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
