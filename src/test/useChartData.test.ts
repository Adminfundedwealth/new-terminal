import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, it, expect, vi } from "vitest";

const gatewayMocks = vi.hoisted(() => ({
  accountContext: vi.fn(),
  requestMarketData: vi.fn(),
}));

vi.mock("@/hooks/useAccountContext", () => ({ useAccountContext: gatewayMocks.accountContext }));
vi.mock("@/lib/terminalApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/terminalApi")>();
  return { ...actual, requestTerminalMarketData: gatewayMocks.requestMarketData };
});

import { KITE_INDEX_TOKEN_MAP, parseColumnarCandles, resolveKiteHistoricalToken, useChartData } from "@/hooks/useChartData";

describe("Kite index historical instrument mapping", () => {
  it("uses verified Kite spot-index tokens rather than the Dhan token map", () => {
    expect(KITE_INDEX_TOKEN_MAP).toEqual({ NIFTY: "256265", BANKNIFTY: "260105", FINNIFTY: "257801" });
  });

  it("prioritizes the selected derivative contract token over the symbol mapping", () => {
    expect(resolveKiteHistoricalToken("NIFTY", "991234")).toBe("991234");
  });
});

describe("parseColumnarCandles", () => {
  it("returns empty array for null/undefined/malformed input", () => {
    expect(parseColumnarCandles(null)).toHaveLength(0);
    expect(parseColumnarCandles(undefined)).toHaveLength(0);
    expect(parseColumnarCandles({})).toHaveLength(0);
    expect(parseColumnarCandles({ close: undefined })).toHaveLength(0);
  });

  it("parses a Dhan/Yahoo columnar payload into sorted OHLCV candles", () => {
    const result = parseColumnarCandles({
      open: [100, 102],
      high: [105, 106],
      low: [99, 101],
      close: [104, 103],
      volume: [1000, 2000],
      timestamp: [1779200000, 1779286400],
    });
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ open: 100, high: 105, low: 99, close: 104, volume: 1000 });
    expect(result[0].time).toBe(1779200000);
  });

  it("skips Yahoo's null gaps (non-trading slots) instead of emitting broken candles", () => {
    const result = parseColumnarCandles({
      open: [100, null as unknown as number, 110],
      high: [105, null as unknown as number, 112],
      low: [99, null as unknown as number, 108],
      close: [104, null as unknown as number, 111],
      volume: [1000, 0, 1500],
      timestamp: [1779200000, 1779286400, 1779372800],
    });
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.close)).toEqual([104, 111]);
  });

  it("normalises millisecond timestamps down to seconds", () => {
    const result = parseColumnarCandles({
      close: [104],
      timestamp: [1779200000000], // ms
    });
    expect(result[0].time).toBe(1779200000); // seconds
  });

  it("accepts ISO string timestamps (Dhan start_Time)", () => {
    const result = parseColumnarCandles({
      close: [250],
      start_Time: ["2026-06-11 09:15:00"],
    });
    expect(result).toHaveLength(1);
    expect(typeof result[0].time).toBe("number");
    expect(result[0].time).toBeGreaterThan(1_700_000_000);
  });

  it("falls back high/low/open to close when a column is missing", () => {
    const result = parseColumnarCandles({
      close: [200, 210],
      timestamp: [1779200000, 1779286400],
    });
    expect(result[0]).toMatchObject({ open: 200, high: 200, low: 200, close: 200 });
  });

  it("sorts out-of-order candles ascending by time", () => {
    const result = parseColumnarCandles({
      close: [3, 1, 2],
      timestamp: [1779372800, 1779200000, 1779286400],
    });
    expect(result.map((c) => c.close)).toEqual([1, 2, 3]);
  });
});

describe("account-scoped chart history gateway", () => {
  const accountId = "11111111-1111-4111-8111-111111111111";
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);

  beforeEach(() => {
    queryClient.clear();
    gatewayMocks.requestMarketData.mockReset();
    gatewayMocks.accountContext.mockReturnValue({
      activeAccountId: accountId,
      accounts: [{ id: accountId, broker_provider: "dhan" }],
    });
  });

  it.each([
    ["dhan", "dhan", "13", "15m"],
    ["kite", "kite", "256265", "15minute"],
  ] as const)("routes %s chart candles through Terminal OS with account and provider context", async (accountProvider, gatewayProvider, providerInstrumentId, expectedInterval) => {
    const instrument = {
      provider: gatewayProvider,
      providerInstrumentId,
      symbol: "NIFTY 50",
      tradingSymbol: gatewayProvider === "kite" ? "NIFTY 50" : "NIFTY",
      exchange: "NSE",
      exchangeSegment: "IDX_I",
      instrumentType: "INDEX",
    };
    gatewayMocks.accountContext.mockReturnValue({
      activeAccountId: accountId,
      accounts: [{ id: accountId, broker_provider: accountProvider }],
    });
    gatewayMocks.requestMarketData.mockImplementation(async (_accountId, _provider, operation) => {
      if (operation.operation === "searchInstruments") return [instrument];
      if (operation.operation === "getHistoricalCandles") return [{
        timestamp: "2026-09-28T09:15:00.000Z",
        open: 100,
        high: 105,
        low: 99,
        close: 103,
        volume: 10,
      }];
      return null;
    });

    const { result } = renderHook(() => useChartData("NIFTY", "1W"), { wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(1));

    expect(gatewayMocks.requestMarketData).toHaveBeenCalledWith(accountId, gatewayProvider, {
      operation: "searchInstruments",
      query: "NIFTY",
    });
    expect(gatewayMocks.requestMarketData).toHaveBeenCalledWith(accountId, gatewayProvider, expect.objectContaining({
      operation: "getHistoricalCandles",
      instrument: expect.objectContaining({ providerInstrumentId }),
      interval: expectedInterval,
    }));
    expect(result.current.data?.[0]).toMatchObject({ open: 100, high: 105, low: 99, close: 103, volume: 10 });
  });
});
