import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAllIndices, useFnOStocks, useLiveIndices } from "@/hooks/useMarketData";

const { requestTerminalMarketDataMock } = vi.hoisted(() => ({
  requestTerminalMarketDataMock: vi.fn(),
}));

vi.mock("@/lib/terminalApi", () => ({
  requestTerminalMarketData: requestTerminalMarketDataMock,
}));

vi.mock("@/hooks/useWebSocket", () => ({
  useWebSocketIndices: () => ({ indices: [], isConnected: false }),
  useWebSocketVix: () => ({ vix: null }),
  useWebSocketStatus: () => false,
}));

describe("shared market index snapshot", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("shares one snapshot request between live indices and dashboard overview consumers", async () => {
    requestTerminalMarketDataMock.mockImplementation(async (_accountId, _provider, operation, _environment) =>
      operation.instruments.map((instrument: { symbol: string; tradingSymbol: string }) => ({
        symbol: instrument.symbol,
        tradingSymbol: instrument.tradingSymbol,
        ltp: 25_000,
        change: 100,
        changePercent: 0.4,
        open: 24_900,
        high: 25_100,
        low: 24_800,
        previousClose: 24_900,
      }))
    );

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result, unmount } = renderHook(() => ({
      live: useLiveIndices(),
      overview: useAllIndices(),
    }), { wrapper });

    await waitFor(() => expect(result.current.live.data.data).toHaveLength(4));
    expect(result.current.overview.data.vix).toBeNull();
    expect(requestTerminalMarketDataMock).toHaveBeenCalledTimes(1);

    unmount();
    queryClient.clear();
  });

  it("loads F&O stocks and quotes through the central Dhan catalog", async () => {
    const equity = {
      provider: "dhan",
      providerInstrumentId: "equity-1",
      symbol: "RELIANCE INDUSTRIES LTD",
      tradingSymbol: "RELIANCE",
      exchange: "NSE",
      exchangeSegment: "NSE_EQ",
      instrumentType: "EQUITY",
    };
    const future = {
      provider: "dhan",
      providerInstrumentId: "future-1",
      symbol: "RELIANCE",
      tradingSymbol: "RELIANCE-26DEC-FUT",
      exchange: "NSE",
      exchangeSegment: "NSE_FNO",
      instrumentType: "FUTSTK",
      expiryDate: "2026-12-31",
    };
    requestTerminalMarketDataMock.mockImplementation(async (_accountId, _provider, operation) => {
      if (operation.operation === "listInstruments") return [equity, future];
      if (operation.operation !== "getQuotes") return [];
      return operation.instruments.map((instrument: typeof equity | typeof future) => ({
        provider: "dhan",
        symbol: instrument.symbol,
        tradingSymbol: instrument.tradingSymbol,
        exchange: "NSE",
        ltp: instrument.exchangeSegment === "NSE_EQ" ? 1_200 : 1_205,
        open: 1_190,
        high: 1_210,
        low: 1_180,
        previousClose: 1_195,
        change: 5,
        changePercent: 0.4,
        volume: instrument.exchangeSegment === "NSE_EQ" ? 100 : 500,
        openInterest: instrument.exchangeSegment === "NSE_EQ" ? null : 12_000,
        timestamp: new Date().toISOString(),
      }));
    });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result, unmount } = renderHook(() => useFnOStocks(), { wrapper });

    await waitFor(() => expect(result.current.data?.allStocks).toHaveLength(1));
    expect(result.current.data).toMatchObject({
      source: "dhan",
      allStocks: [{ symbol: "RELIANCE", ltp: 1_200, volume: 500, openInterest: 12_000 }],
    });
    expect(requestTerminalMarketDataMock.mock.calls.map(([, provider, operation]) => [
      provider,
      operation.operation,
    ])).toEqual([["dhan", "listInstruments"], ["dhan", "getQuotes"]]);
    expect(requestTerminalMarketDataMock.mock.calls[0][0]).toBeNull();

    unmount();
    queryClient.clear();
  });
});
