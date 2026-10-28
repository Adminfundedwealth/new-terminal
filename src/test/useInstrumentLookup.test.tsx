import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useInstrumentLookup } from "@/hooks/useLocalDatabase";
import { getAllInstruments, saveInstruments } from "@/lib/localDatabase";

const { requestTerminalMarketDataMock, fetchDhanInstrumentMasterMock } = vi.hoisted(() => ({
  requestTerminalMarketDataMock: vi.fn(),
  fetchDhanInstrumentMasterMock: vi.fn(),
}));

vi.mock("@/lib/localDatabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/localDatabase")>();
  return {
    ...actual,
    getAllInstruments: vi.fn().mockResolvedValue([]),
    saveInstruments: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("@/lib/terminalApi", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/terminalApi")>(),
  requestTerminalMarketData: requestTerminalMarketDataMock,
}));

vi.mock("@/lib/marketApi", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/marketApi")>(),
  fetchDhanInstrumentMaster: fetchDhanInstrumentMasterMock,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null }),
}));

describe("useInstrumentLookup Founder-global Dhan catalog", () => {
  beforeEach(() => {
    requestTerminalMarketDataMock.mockReset();
    fetchDhanInstrumentMasterMock.mockReset();
  });

  afterEach(() => vi.clearAllMocks());

  function renderLookup() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    return renderHook(() => useInstrumentLookup(), { wrapper });
  }

  it("loads and caches the bounded global instrument catalog without a linked account", async () => {
    requestTerminalMarketDataMock.mockResolvedValue([{
      provider: "dhan",
      providerInstrumentId: "2885",
      symbol: "RELIANCE INDUSTRIES LTD",
      tradingSymbol: "RELIANCE",
      exchange: "NSE",
      exchangeSegment: "NSE_EQ",
      instrumentType: "EQUITY",
      lotSize: 1,
      tickSize: 0.05,
    }]);

    const { result } = renderLookup();

    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.instruments).toMatchObject([
      { securityId: "2885", tradingSymbol: "RELIANCE", provider: "dhan", tickSize: 0.05 },
    ]);
    expect(saveInstruments).toHaveBeenCalledWith([
      expect.objectContaining({ securityId: "2885", tradingSymbol: "RELIANCE", provider: "dhan" }),
    ]);
    expect(requestTerminalMarketDataMock).toHaveBeenCalledWith(null, "dhan", {
      operation: "listInstruments",
    });
    expect(result.current.loadError).toBeNull();
  });

  it("fills missing cash equities from the official Dhan master when Terminal OS only lists derivatives and indices", async () => {
    requestTerminalMarketDataMock.mockResolvedValue([{
      provider: "dhan",
      providerInstrumentId: "13",
      symbol: "NIFTY",
      tradingSymbol: "NIFTY",
      exchange: "NSE",
      exchangeSegment: "IDX_I",
      instrumentType: "INDEX",
      lotSize: 1,
      tickSize: 0.05,
    }]);
    fetchDhanInstrumentMasterMock.mockResolvedValue([{
      securityId: "2885",
      symbol: "RELIANCE INDUSTRIES LTD",
      tradingSymbol: "RELIANCE",
      exchange: "NSE",
      exchangeSegment: "NSE_EQ",
      instrumentType: "EQUITY",
      lotSize: 1,
      tickSize: 0.05,
      series: "EQ",
    }]);

    const { result } = renderLookup();

    await waitFor(() => expect(result.current.instruments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        securityId: "2885",
        tradingSymbol: "RELIANCE",
        exchangeSegment: "NSE_EQ",
        instrumentType: "EQUITY",
      }),
    ])));
    expect(fetchDhanInstrumentMasterMock).toHaveBeenCalledTimes(1);
    expect(saveInstruments).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ providerInstrumentId: "2885", tradingSymbol: "RELIANCE" }),
    ]));
  });

  it("starts central instrument resolution while the local cache is still loading", async () => {
    let finishLocalLoad: ((instruments: Awaited<ReturnType<typeof getAllInstruments>>) => void) | undefined;
    vi.mocked(getAllInstruments).mockImplementationOnce(() => new Promise((resolve) => {
      finishLocalLoad = resolve;
    }));
    requestTerminalMarketDataMock.mockResolvedValue([{
      provider: "dhan",
      providerInstrumentId: "3456",
      symbol: "TATA MOTORS PASS VEH LTD",
      tradingSymbol: "TMPV",
      exchange: "NSE",
      exchangeSegment: "NSE_EQ",
      instrumentType: "EQUITY",
      lotSize: 1,
      tickSize: 0.05,
    }]);

    const { result } = renderLookup();

    await waitFor(() => expect(requestTerminalMarketDataMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.instruments).toMatchObject([{ securityId: "3456", tradingSymbol: "TMPV" }]));
    expect(result.current.isLoaded).toBe(false);

    finishLocalLoad?.([]);
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
  });

  it("surfaces a global instrument-master failure instead of requiring an account", async () => {
    vi.mocked(getAllInstruments).mockResolvedValue([]);
    requestTerminalMarketDataMock.mockRejectedValue(new Error("Founder Dhan catalog unavailable"));

    const { result } = renderLookup();

    await waitFor(() => expect(result.current.loadError).toBe("Founder Dhan catalog unavailable"));
    expect(result.current.isLoaded).toBe(true);
    expect(result.current.instruments).toEqual([]);
  });

  it("uses cached Dhan instruments when the global master is unavailable", async () => {
    const cachedInstrument = {
      securityId: "2885",
      symbol: "RELIANCE INDUSTRIES LTD",
      tradingSymbol: "RELIANCE",
      exchangeSegment: "NSE_EQ",
      instrumentType: "EQUITY",
      lotSize: 1,
      tickSize: 0.05,
      provider: "dhan" as const,
      providerInstrumentId: "2885",
    };
    vi.mocked(getAllInstruments).mockResolvedValue([cachedInstrument]);
    requestTerminalMarketDataMock.mockRejectedValue(new Error("Founder Dhan catalog unavailable"));

    const { result } = renderLookup();

    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.instruments).toEqual([cachedInstrument]);
    expect(result.current.loadError).toBe("Founder Dhan catalog unavailable");
  });

  it("loads the same Founder-global master regardless of the selected trading account", async () => {
    const instrument = {
      provider: "dhan" as const,
      providerInstrumentId: "2885",
      securityId: "2885",
      symbol: "RELIANCE INDUSTRIES LTD",
      tradingSymbol: "RELIANCE",
      exchange: "NSE",
      exchangeSegment: "NSE_EQ",
      instrumentType: "EQUITY",
      lotSize: 1,
      tickSize: 0.05,
    };
    requestTerminalMarketDataMock.mockResolvedValue([instrument]);

    const { result } = renderLookup();

    await waitFor(() => expect(result.current.instruments).toMatchObject([{
      provider: "dhan",
      providerInstrumentId: "2885",
      securityId: "2885",
      symbol: "RELIANCE INDUSTRIES LTD",
      tradingSymbol: "RELIANCE",
      exchange: "NSE",
      exchangeSegment: "NSE_EQ",
      instrumentType: "EQUITY",
      lotSize: 1,
    }]));
    expect(requestTerminalMarketDataMock).toHaveBeenCalledWith(null, "dhan", {
      operation: "listInstruments",
    });
  });

  it("keeps fresh central instruments available if local caching fails", async () => {
    const error = new Error("IndexedDB quota exceeded");
    vi.mocked(saveInstruments).mockRejectedValue(error);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    requestTerminalMarketDataMock.mockResolvedValue([{
      provider: "dhan",
      providerInstrumentId: "2885",
      symbol: "RELIANCE INDUSTRIES LTD",
      tradingSymbol: "RELIANCE",
      exchange: "NSE",
      exchangeSegment: "NSE_EQ",
      instrumentType: "EQUITY",
      lotSize: 1,
      tickSize: 0.05,
    }]);

    const { result } = renderLookup();

    await waitFor(() => expect(result.current.instruments).toMatchObject([{ securityId: "2885", provider: "dhan" }]));
    expect(consoleError).toHaveBeenCalledWith("Founder Dhan instruments could not be cached locally:", error);
    consoleError.mockRestore();
  });
});
