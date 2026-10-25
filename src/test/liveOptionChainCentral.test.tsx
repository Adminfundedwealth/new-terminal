import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { requestMarketData } = vi.hoisted(() => ({ requestMarketData: vi.fn() }));
vi.mock("@/lib/terminalApi", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/terminalApi")>(),
  requestTerminalMarketData: requestMarketData,
}));

import { useLiveOptionChain } from "@/hooks/useMarketData";

describe("useLiveOptionChain Founder-global Dhan route", () => {
  function renderOptionChain(symbol: string, underlying?: { securityId: string; exchangeSegment: string }) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    return renderHook(() => useLiveOptionChain(symbol, undefined, true, underlying), { wrapper });
  }

  it("loads a stock option chain and instruments through Founder-global Dhan", async () => {
    requestMarketData
      .mockResolvedValueOnce({
        provider: "dhan",
        chain: [{
          strikePrice: 1200,
          ce: { ltp: 12, oi: 100, oiChange: 10, volume: 20, iv: 15, delta: 0.5, gamma: 0, theta: 0, vega: 0, bidPrice: 11, askPrice: 13 },
          pe: { ltp: 9, oi: 80, oiChange: 8, volume: 16, iv: 15, delta: -0.5, gamma: 0, theta: 0, vega: 0, bidPrice: 8, askPrice: 10 },
        }],
        spotPrice: 1207.7,
        totalCEOI: 100,
        totalPEOI: 80,
        expiries: ["2026-10-29"],
        afterHours: false,
      })
      .mockResolvedValueOnce([]);

    const { result } = renderOptionChain("RELIANCE", { securityId: "2885", exchangeSegment: "NSE_EQ" });

    await waitFor(() => expect(result.current.data?.isLive).toBe(true));
    expect(result.current.data).toMatchObject({
      spotPrice: 1207.7,
      source: "dhan",
      chain: [{ strikePrice: 1200 }],
    });
    expect(requestMarketData).toHaveBeenNthCalledWith(1, null, "dhan", {
      operation: "getOptionChain",
      underlying: "RELIANCE",
    });
    expect(requestMarketData).toHaveBeenNthCalledWith(2, null, "dhan", {
      operation: "searchInstruments",
      query: "RELIANCE",
    });
  });

  it("loads index option chains without requiring an account or per-account instrument", async () => {
    requestMarketData
      .mockResolvedValueOnce({
        provider: "dhan",
        chain: [{
          strikePrice: 25000,
          ce: { ltp: 12, oi: 100, oiChange: 10, volume: 20, iv: 15, delta: 0.5, gamma: 0, theta: 0, vega: 0, bidPrice: 11, askPrice: 13 },
          pe: { ltp: 9, oi: 80, oiChange: 8, volume: 16, iv: 15, delta: -0.5, gamma: 0, theta: 0, vega: 0, bidPrice: 8, askPrice: 10 },
        }],
        spotPrice: 25000,
        totalCEOI: 100,
        totalPEOI: 80,
        expiries: [],
        afterHours: false,
      })
      .mockResolvedValueOnce([]);

    const { result } = renderOptionChain("NIFTY");

    await waitFor(() => expect(result.current.data?.isLive).toBe(true));
    expect(requestMarketData).toHaveBeenCalledWith(null, "dhan", {
      operation: "getOptionChain",
      underlying: "NIFTY",
    });
  });
});
