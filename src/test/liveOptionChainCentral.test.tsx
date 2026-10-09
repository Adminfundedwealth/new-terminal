import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useLiveOptionChain } from "@/hooks/useMarketData";
import { fetchLiveOptionChain } from "@/lib/marketApi";

vi.mock("@/hooks/useAccountContext", () => ({
  useAccountContext: () => ({ activeAccountId: null, accounts: [], isLoading: false }),
}));

vi.mock("@/lib/marketApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/marketApi")>();
  return {
    ...actual,
    fetchLiveOptionChain: vi.fn(),
  };
});

describe("useLiveOptionChain central Dhan fallback", () => {
  function renderOptionChain(symbol: string, underlying?: { securityId: string; exchangeSegment: string }) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    return renderHook(() => useLiveOptionChain(symbol, undefined, true, underlying), { wrapper });
  }

  it("loads a stock option chain from central Dhan without an active account", async () => {
    vi.mocked(fetchLiveOptionChain).mockResolvedValue({
      chain: [{
        strikePrice: 1200,
        ce: { ltp: 12, oi: 100, oiChange: 10, volume: 20, iv: 15, delta: 0.5, gamma: 0, theta: 0, vega: 0, bidPrice: 11, askPrice: 13 },
        pe: { ltp: 9, oi: 80, oiChange: 8, volume: 16, iv: 15, delta: -0.5, gamma: 0, theta: 0, vega: 0, bidPrice: 8, askPrice: 10 },
      }],
      spotPrice: 1207.7,
      totalCEOI: 100,
      totalPEOI: 80,
      expiries: [{ label: "29 Oct 2026", value: "2026-10-29", daysToExpiry: 20 }],
      source: "dhan",
      afterHours: false,
      cachedAt: null,
    });

    const underlying = { securityId: "2885", exchangeSegment: "NSE_EQ" };
    const { result } = renderOptionChain("RELIANCE", underlying);

    await waitFor(() => expect(result.current.data?.isLive).toBe(true));
    expect(result.current.data).toMatchObject({
      spotPrice: 1207.7,
      source: "dhan",
      chain: [{ strikePrice: 1200 }],
    });
    expect(fetchLiveOptionChain).toHaveBeenCalledWith("RELIANCE", undefined, underlying);
  });

  it("resolves central index underlyings without an instrument-master lookup", async () => {
    vi.mocked(fetchLiveOptionChain).mockResolvedValue({
      chain: [{
        strikePrice: 25000,
        ce: { ltp: 12, oi: 100, oiChange: 10, volume: 20, iv: 15, delta: 0.5, gamma: 0, theta: 0, vega: 0, bidPrice: 11, askPrice: 13 },
        pe: { ltp: 9, oi: 80, oiChange: 8, volume: 16, iv: 15, delta: -0.5, gamma: 0, theta: 0, vega: 0, bidPrice: 8, askPrice: 10 },
      }],
      spotPrice: 25000,
      totalCEOI: 100,
      totalPEOI: 80,
      expiries: [],
      source: "dhan",
      afterHours: false,
      cachedAt: null,
    });

    const { result } = renderOptionChain("NIFTY");

    await waitFor(() => expect(result.current.data?.isLive).toBe(true));
    expect(fetchLiveOptionChain).toHaveBeenCalledWith("NIFTY", undefined, {
      securityId: "13",
      exchangeSegment: "IDX_I",
    });
  });
});
