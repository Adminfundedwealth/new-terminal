import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAllIndices, useLiveIndices } from "@/hooks/useMarketData";

const { fetchMarketIndicesSnapshotMock } = vi.hoisted(() => ({
  fetchMarketIndicesSnapshotMock: vi.fn(),
}));

vi.mock("@/lib/marketApi", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/marketApi")>(),
  fetchMarketIndicesSnapshot: fetchMarketIndicesSnapshotMock,
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
    fetchMarketIndicesSnapshotMock.mockResolvedValue({
      indices: [{
        name: "NIFTY 50",
        symbol: "NIFTY",
        ltp: 25_000,
        change: 100,
        changePercent: 0.4,
        open: 24_900,
        high: 25_100,
        low: 24_800,
        prevClose: 24_900,
      }],
      allIndices: {
        vix: { value: 15, change: 0.5, changePercent: 3.4, high: 15.5, low: 14.5 },
        sectors: [],
        advances: 1,
        declines: 0,
        unchanged: 0,
      },
    });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result, unmount } = renderHook(() => ({
      live: useLiveIndices(),
      overview: useAllIndices(),
    }), { wrapper });

    await waitFor(() => expect(result.current.live.data.data).toHaveLength(1));
    expect(result.current.overview.data.vix?.value).toBe(15);
    expect(fetchMarketIndicesSnapshotMock).toHaveBeenCalledTimes(1);

    unmount();
    queryClient.clear();
  });
});
