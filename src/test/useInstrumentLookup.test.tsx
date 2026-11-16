import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useInstrumentLookup } from "@/hooks/useLocalDatabase";
import { getAllInstruments, saveInstruments, type Instrument } from "@/lib/localDatabase";
import { classifyInstrument } from "@/lib/instrumentClassification";

const { requestTerminalMarketDataMock } = vi.hoisted(() => ({
  requestTerminalMarketDataMock: vi.fn(),
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

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null }),
}));

describe("useInstrumentLookup Dhan catalog", () => {
  beforeEach(() => {
    requestTerminalMarketDataMock.mockReset().mockResolvedValue([]);
  });

  afterEach(() => vi.clearAllMocks());

  function renderLookup() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    return renderHook(() => useInstrumentLookup(), { wrapper });
  }

  it("loads the central Dhan catalog, retains all instrument classes, and excludes mutual funds from stocks", async () => {
    requestTerminalMarketDataMock.mockResolvedValue([
      {
        securityId: "2885",
        symbol: "RELIANCE INDUSTRIES LTD",
        tradingSymbol: "RELIANCE",
        exchange: "NSE",
        exchangeSegment: "NSE_EQ",
        instrumentType: "ES",
        lotSize: 1,
        tickSize: 0.05,
        series: "EQ",
      },
      {
        securityId: "500570",
        symbol: "TATA CONSULTANCY SERVICES LTD",
        tradingSymbol: "TCS",
        exchange: "BSE",
        exchangeSegment: "BSE_EQ",
        instrumentType: "ES",
        lotSize: 1,
        tickSize: 0.05,
        series: "MT",
      },
      {
        securityId: "543151",
        symbol: "Nippon India Mutual Fund",
        tradingSymbol: "08ABB",
        exchange: "BSE",
        exchangeSegment: "BSE_EQ",
        instrumentType: "EQUITY",
        lotSize: 1,
        tickSize: 0.05,
        series: "B",
      },
      {
        securityId: "13",
        symbol: "NIFTY",
        tradingSymbol: "NIFTY",
        exchange: "NSE",
        exchangeSegment: "IDX_I",
        instrumentType: "INDEX",
        lotSize: 1,
        tickSize: 0.05,
      },
      {
        securityId: "12345",
        symbol: "RELIANCE",
        tradingSymbol: "RELIANCE-2099-01-29",
        exchange: "NSE",
        exchangeSegment: "NSE_FNO",
        instrumentType: "FUTSTK",
        lotSize: 250,
        tickSize: 0.05,
        expiryDate: "2099-01-29",
      },
      {
        securityId: "54321",
        symbol: "NIFTY",
        tradingSymbol: "NIFTY-2099-01-29",
        exchange: "NSE",
        exchangeSegment: "NSE_FNO",
        instrumentType: "FUTIDX",
        lotSize: 25,
        tickSize: 0.05,
        expiryDate: "2099-01-29",
      },
      {
        securityId: "10001",
        symbol: "RELIANCE",
        tradingSymbol: "RELIANCE-2099-01-29-1500-CE",
        exchange: "NSE",
        exchangeSegment: "NSE_FNO",
        instrumentType: "OPTSTK",
        lotSize: 250,
        tickSize: 0.05,
        expiryDate: "2099-01-29",
        strikePrice: 1500,
        optionType: "CE",
      },
      {
        securityId: "10002",
        symbol: "NIFTY",
        tradingSymbol: "NIFTY-2099-01-29-25000-PE",
        exchange: "NSE",
        exchangeSegment: "NSE_FNO",
        instrumentType: "OPTIDX",
        lotSize: 25,
        tickSize: 0.05,
        expiryDate: "2099-01-29",
        strikePrice: 25000,
        optionType: "PE",
      },
    ]);

    const { result } = renderLookup();

    await waitFor(() => expect(result.current.instruments).toHaveLength(7));
    expect(result.current.instruments.filter((instrument) => classifyInstrument(instrument) === "stocks"))
      .toHaveLength(2);
    expect(result.current.instruments.map((instrument) => classifyInstrument(instrument))).toEqual(
      expect.arrayContaining(["stocks", "indices", "futures", "options"]),
    );
    expect(result.current.instruments.some((instrument) => instrument.tradingSymbol === "08ABB")).toBe(false);
    expect(saveInstruments).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ tradingSymbol: "RELIANCE", series: "EQ" }),
      expect.objectContaining({ tradingSymbol: "TCS", series: "MT", providerInstrumentType: "ES" }),
      expect.objectContaining({ tradingSymbol: "RELIANCE-2099-01-29", instrumentType: "FUTSTK", lotSize: 250 }),
      expect.objectContaining({ tradingSymbol: "NIFTY-2099-01-29-25000-PE", instrumentType: "OPTIDX" }),
    ]));
    expect(requestTerminalMarketDataMock).toHaveBeenCalledWith(
      null,
      "dhan",
      { operation: "listInstruments" },
      "production",
      expect.any(AbortSignal),
    );
    expect(result.current.loadError).toBeNull();
  });

  it("keeps cached Dhan instruments available and reports an error when the central catalog fails", async () => {
    const cachedInstrument: Instrument = {
      securityId: "2885",
      symbol: "RELIANCE INDUSTRIES LTD",
      tradingSymbol: "RELIANCE",
      exchangeSegment: "NSE_EQ",
      instrumentType: "EQUITY",
      lotSize: 1,
      tickSize: 0.05,
      series: "EQ",
      provider: "dhan",
      providerInstrumentId: "2885",
    };
    const cachedMutualFund: Instrument = {
      ...cachedInstrument,
      securityId: "543151",
      symbol: "Nippon India Mutual Fund",
      tradingSymbol: "08ABB",
      exchange: "BSE",
      exchangeSegment: "BSE_EQ",
      series: "B",
      providerInstrumentId: "543151",
    };
    vi.mocked(getAllInstruments).mockResolvedValue([cachedInstrument, cachedMutualFund]);
    const error = new Error("Dhan market data request failed.");
    requestTerminalMarketDataMock.mockRejectedValue(error);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { result } = renderLookup();

    await waitFor(() => expect(result.current.loadError).toBe(
      "Central Dhan instrument catalog failed: Dhan market data request failed.",
    ));
    expect(result.current.instruments).toEqual([cachedInstrument]);
    expect(consoleError).toHaveBeenCalledWith("Central Dhan instrument catalog failed:", error);
    consoleError.mockRestore();
  });

  it("uses cached instruments when the master returns no usable rows", async () => {
    const cachedInstrument: Instrument = {
      securityId: "2885",
      symbol: "RELIANCE INDUSTRIES LTD",
      tradingSymbol: "RELIANCE",
      exchangeSegment: "NSE_EQ",
      instrumentType: "EQUITY",
      lotSize: 1,
      tickSize: 0.05,
      provider: "dhan",
      providerInstrumentId: "2885",
    };
    vi.mocked(getAllInstruments).mockResolvedValue([cachedInstrument]);
    requestTerminalMarketDataMock.mockResolvedValue([]);

    const { result } = renderLookup();

    await waitFor(() => expect(result.current.loadError).toBe(
      "Central Dhan instrument catalog returned no instruments.",
    ));
    expect(result.current.instruments).toEqual([cachedInstrument]);
  });

  it("starts master loading while the local cache is still loading", async () => {
    let finishLocalLoad: ((instruments: Instrument[]) => void) | undefined;
    vi.mocked(getAllInstruments).mockImplementationOnce(() => new Promise((resolve) => {
      finishLocalLoad = resolve;
    }));
    requestTerminalMarketDataMock.mockResolvedValue([{
      securityId: "3456",
      symbol: "TATA MOTORS PASS VEH LTD",
      tradingSymbol: "TMPV",
      exchange: "NSE",
      exchangeSegment: "NSE_EQ",
      instrumentType: "EQUITY",
      lotSize: 1,
      tickSize: 0.05,
      series: "EQ",
    }]);

    const { result } = renderLookup();

    await waitFor(() => expect(requestTerminalMarketDataMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.instruments).toMatchObject([{ securityId: "3456", tradingSymbol: "TMPV" }]));
    expect(result.current.isLoaded).toBe(false);

    finishLocalLoad?.([]);
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
  });

  it("keeps fresh instruments available if local caching fails", async () => {
    const error = new Error("IndexedDB quota exceeded");
    vi.mocked(saveInstruments).mockRejectedValue(error);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    requestTerminalMarketDataMock.mockResolvedValue([{
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

    await waitFor(() => expect(result.current.instruments).toMatchObject([{ securityId: "2885", provider: "dhan" }]));
    await waitFor(() => expect(consoleError).toHaveBeenCalledWith(
      "Founder Dhan instruments could not be cached locally:",
      error,
    ));
    consoleError.mockRestore();
  });
});
