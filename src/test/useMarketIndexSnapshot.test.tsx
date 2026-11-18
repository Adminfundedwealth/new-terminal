import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAllIndices, useLiveIndices } from "@/hooks/useMarketData";

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
    requestTerminalMarketDataMock.mockImplementation(async (_accountId, _provider, _environment, operation) => ({
      symbol: operation.instrument.symbol,
      tradingSymbol: operation.instrument.tradingSymbol,
      ltp: 25_000,
      change: 100,
      changePercent: 0.4,
      open: 24_900,
      high: 25_100,
      low: 24_800,
      previousClose: 24_900,
    }));

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
    expect(requestTerminalMarketDataMock).toHaveBeenCalledTimes(4);

    unmount();
    queryClient.clear();
  });
});
