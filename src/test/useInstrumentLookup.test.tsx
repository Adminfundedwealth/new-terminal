import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useInstrumentLookup } from "@/hooks/useLocalDatabase";
import { fetchInstrumentMaster } from "@/lib/marketApi";
import { getAllInstruments, saveInstruments } from "@/lib/localDatabase";

vi.mock("@/hooks/useAccountContext", () => ({
  useAccountContext: () => ({ activeAccountId: null, accounts: [], isLoading: false }),
}));

vi.mock("@/lib/localDatabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/localDatabase")>();
  return {
    ...actual,
    getAllInstruments: vi.fn().mockResolvedValue([]),
    saveInstruments: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("@/lib/marketApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/marketApi")>();
  return {
    ...actual,
    fetchInstrumentMaster: vi.fn(),
  };
});

describe("useInstrumentLookup central Dhan fallback", () => {
  afterEach(() => vi.clearAllMocks());

  function renderLookup() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    return renderHook(() => useInstrumentLookup(), { wrapper });
  }

  it("loads and normalizes central instruments without a linked account or IndexedDB write", async () => {
    vi.mocked(fetchInstrumentMaster).mockResolvedValue({
      count: 1,
      instruments: [{
        securityId: "2885",
        symbol: "RELIANCE INDUSTRIES LTD",
        tradingSymbol: "RELIANCE",
        exchangeSegment: "NSE_EQ",
        instrumentType: "EQUITY",
        lotSize: 1,
        tickSize: 0.05,
      }],
    });

    const { result } = renderLookup();

    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.instruments).toMatchObject([
      { securityId: "2885", tradingSymbol: "RELIANCE", provider: "dhan", tickSize: 0.05 },
    ]);
    expect(saveInstruments).not.toHaveBeenCalled();
    expect(result.current.loadError).toBeNull();
  });

  it("starts central instrument resolution while the local cache is still loading", async () => {
    let finishLocalLoad: ((instruments: Awaited<ReturnType<typeof getAllInstruments>>) => void) | undefined;
    vi.mocked(getAllInstruments).mockImplementationOnce(() => new Promise((resolve) => {
      finishLocalLoad = resolve;
    }));
    vi.mocked(fetchInstrumentMaster).mockResolvedValue({
      count: 1,
      instruments: [{
        securityId: "3456",
        symbol: "TATA MOTORS PASS VEH LTD",
        tradingSymbol: "TMPV",
        exchangeSegment: "NSE_EQ",
        instrumentType: "EQUITY",
        lotSize: 1,
        tickSize: 0.05,
      }],
    });

    const { result } = renderLookup();

    await waitFor(() => expect(fetchInstrumentMaster).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.instruments).toMatchObject([{ securityId: "3456", tradingSymbol: "TMPV" }]));
    expect(result.current.isLoaded).toBe(false);

    finishLocalLoad?.([]);
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
  });

  it("retries the central instrument master a bounded number of times after transient errors", async () => {
    vi.mocked(fetchInstrumentMaster)
      .mockRejectedValueOnce(new Error("Dhan proxy error 429: rate limited"))
      .mockResolvedValueOnce({
        count: 1,
        instruments: [{
          securityId: "3456",
          symbol: "TATA MOTORS PASS VEH LTD",
          tradingSymbol: "TMPV",
          exchangeSegment: "NSE_EQ",
          instrumentType: "EQUITY",
          lotSize: 1,
          tickSize: 0.05,
        }],
      });

    const { result } = renderLookup();

    await waitFor(() => expect(result.current.instruments).toMatchObject([{ securityId: "3456", tradingSymbol: "TMPV" }]));
    expect(fetchInstrumentMaster).toHaveBeenCalledTimes(2);
  });

  it("surfaces a central instrument-master failure instead of requesting a personal broker account", async () => {
    vi.mocked(getAllInstruments).mockResolvedValue([]);
    vi.mocked(fetchInstrumentMaster).mockRejectedValue(new Error("Central Dhan master unavailable"));

    const { result } = renderLookup();

    await waitFor(() => expect(result.current.loadError).toBe("Central Dhan master unavailable"));
    expect(result.current.isLoaded).toBe(true);
    expect(result.current.instruments).toEqual([]);
  });
});
