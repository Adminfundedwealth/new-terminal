import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FundedWealthOpenAlgoDataFeed,
  isIndianMarketInstrument,
  normalizeDhanCandle,
  normalizeDhanCandles,
  parseDhanTimestamp,
} from "@/lib/openAlgoDataFeed";
import type { TerminalMarketDataInstrument } from "@/lib/terminalApi";

const {
  requestTerminalMarketDataMock,
  subscribeToTerminalMarketDataStreamMock,
} = vi.hoisted(() => ({
  requestTerminalMarketDataMock: vi.fn(),
  subscribeToTerminalMarketDataStreamMock: vi.fn(() => vi.fn()),
}));
vi.mock("@/lib/terminalApi", () => ({
  requestTerminalMarketData: requestTerminalMarketDataMock,
  subscribeToTerminalMarketDataStream: subscribeToTerminalMarketDataStreamMock,
}));

beforeEach(() => {
  requestTerminalMarketDataMock.mockReset();
  subscribeToTerminalMarketDataStreamMock.mockReset();
  subscribeToTerminalMarketDataStreamMock.mockReturnValue(vi.fn());
});

function instrument(
  overrides: Partial<TerminalMarketDataInstrument> = {},
): TerminalMarketDataInstrument {
  return {
    provider: "dhan",
    providerInstrumentId: "12345",
    symbol: "HDFCBANK",
    tradingSymbol: "HDFCBANK",
    exchange: "NSE",
    exchangeSegment: "NSE_EQ",
    instrumentType: "EQUITY",
    ...overrides,
  };
}

describe("OpenAlgo FundedWealth datafeed", () => {
  it("allows Indian cash, index, futures, and options but excludes foreign and commodity instruments", () => {
    expect(isIndianMarketInstrument(instrument())).toBe(true);
    expect(isIndianMarketInstrument(instrument({
      exchange: "BSE",
      exchangeSegment: "BSE_EQ",
    }))).toBe(true);
    expect(isIndianMarketInstrument(instrument({
      exchange: "BSE",
      exchangeSegment: "BSE_IDX",
      instrumentType: "INDEX",
    }))).toBe(true);
    expect(isIndianMarketInstrument(instrument({
      exchangeSegment: "NSE_FNO",
      instrumentType: "OPTSTK",
      tradingSymbol: "HDFCBANK-26JUN-1700-CE",
    }))).toBe(true);
    expect(isIndianMarketInstrument(instrument({
      exchange: "MCX",
      exchangeSegment: "MCX_COMM",
      instrumentType: "FUTCOM",
    }))).toBe(false);
    expect(isIndianMarketInstrument(instrument({
      exchange: "NASDAQ",
      exchangeSegment: "NASDAQ",
      instrumentType: "EQUITY",
    }))).toBe(false);
  });

  it("derives 3-minute and 30-minute chart intervals from compatible Dhan candle sources", () => {
    const datafeed = new FundedWealthOpenAlgoDataFeed(instrument(), vi.fn());
    const from = Date.parse("2026-10-01T04:00:00.000Z") / 1000;
    const threeMinute = datafeed.feed.resolve({
      symbol: "HDFCBANK",
      exchange: "NSE",
      interval: "3m",
      from,
      to: from + 30 * 60,
    });
    const thirtyMinute = datafeed.feed.resolve({
      symbol: "HDFCBANK",
      exchange: "NSE",
      interval: "30m",
      from,
      to: from + 60 * 60,
    });

    expect(threeMinute).toMatchObject({ native: false, source: { interval: "1m" } });
    expect(thirtyMinute).toMatchObject({ native: false, source: { interval: "15m" } });
    datafeed.destroy();
  });

  it("parses Dhan's offset-free timestamps as India Standard Time", () => {
    expect(parseDhanTimestamp("2026-05-04T09:15:00")).toBe(
      Date.UTC(2026, 4, 4, 3, 45, 0) / 1000,
    );
    expect(parseDhanTimestamp("2026-05-04T09:15:00+05:30")).toBe(
      Date.UTC(2026, 4, 4, 3, 45, 0) / 1000,
    );
  });

  it("normalizes daily candles to India-local midnight and carries open interest", () => {
    expect(normalizeDhanCandle({
      timestamp: "2026-05-04T00:00:00",
      open: 100,
      high: 110,
      low: 95,
      close: 105,
      volume: 1000,
      openInterest: 200,
    }, "1d")).toEqual({
      time: Date.UTC(2026, 4, 3, 18, 30, 0) / 1000,
      open: 100,
      high: 110,
      low: 95,
      close: 105,
      volume: 1000,
      oi: 200,
    });
  });

  it("keeps valid history and warns when Dhan returns an invalid candle", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const bars = normalizeDhanCandles([
      {
        timestamp: "2026-02-25T18:30:00.000Z",
        open: 100,
        high: 110,
        low: 95,
        close: 105,
        volume: 1000,
      },
      {
        timestamp: "2026-02-26T18:30:00.000Z",
        open: 100,
        high: 101,
        low: 95,
        close: 105,
        volume: 1000,
      },
    ], "1d", "NIFTY-Dec2026-FUT");

    expect(bars).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith("Skipped 1 invalid Dhan historical candle(s) for NIFTY-Dec2026-FUT.");
    warn.mockRestore();
  });

  it("forwards the chart history cancellation signal to the Dhan request", async () => {
    requestTerminalMarketDataMock.mockImplementationOnce(() => new Promise(() => {}));
    const datafeed = new FundedWealthOpenAlgoDataFeed(instrument(), vi.fn());
    const controller = new AbortController();

    const request = datafeed.feed.getBars({
      symbol: "HDFCBANK",
      exchange: "NSE",
      interval: "1d",
      from: Date.UTC(2026, 4, 4) / 1000,
      to: Date.UTC(2026, 4, 5) / 1000,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(requestTerminalMarketDataMock).toHaveBeenCalledOnce());

    const [, provider, operation, environment, requestSignal] =
      requestTerminalMarketDataMock.mock.calls[0] as unknown as [
        null,
        string,
        { operation: string },
        string,
        AbortSignal,
      ];
    expect(provider).toBe("dhan");
    expect(operation.operation).toBe("getHistoricalCandles");
    expect(environment).toBe("production");
    expect(requestSignal).toBeInstanceOf(AbortSignal);
    controller.abort();
    expect(requestSignal.aborted).toBe(true);
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    datafeed.destroy();
  });

  it("subscribes to the selected Dhan contract stream and cleans it up on removal", () => {
    const unsubscribe = vi.fn();
    subscribeToTerminalMarketDataStreamMock.mockReturnValueOnce(unsubscribe);
    const datafeed = new FundedWealthOpenAlgoDataFeed(instrument(), vi.fn());
    const onBar = vi.fn();
    const cancel = datafeed.feed.subscribeBars({
      symbol: "HDFCBANK",
      exchange: "NSE",
      interval: "1m",
    }, onBar);

    expect(subscribeToTerminalMarketDataStreamMock).toHaveBeenCalledWith(
      null,
      "dhan",
      [instrument()],
      expect.any(Function),
      expect.any(Function),
    );
    const onQuote = subscribeToTerminalMarketDataStreamMock.mock.calls[0]?.[3] as (
      event: {
        provider: string;
        quote: {
          timestamp: string;
          ltp: number;
          volume: number;
          openInterest: number | null;
        };
      },
    ) => void;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T03:45:30.000Z"));
    onQuote({
      provider: "dhan",
      quote: {
        timestamp: "2026-10-01T03:45:30.000Z",
        ltp: 1725.5,
        volume: 100,
        openInterest: null,
      },
    });
    expect(onBar).toHaveBeenCalledWith(
      expect.objectContaining({ open: 1725.5, high: 1725.5, low: 1725.5, close: 1725.5 }),
      expect.objectContaining({ provisional: true }),
    );
    vi.useRealTimers();
    cancel();
    expect(unsubscribe).toHaveBeenCalledOnce();
    datafeed.destroy();
  });

  it("reports closed-market quote status instead of staying in the connecting state", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T10:01:00.000Z"));
    const onQuoteStatus = vi.fn();
    const datafeed = new FundedWealthOpenAlgoDataFeed(instrument(), onQuoteStatus);
    const cancel = datafeed.feed.subscribeBars({
      symbol: "HDFCBANK",
      exchange: "NSE",
      interval: "1m",
    }, vi.fn());

    expect(onQuoteStatus).toHaveBeenLastCalledWith(
      "stale",
      "Market closed; historical chart data remains available.",
    );

    cancel();
    datafeed.destroy();
    vi.useRealTimers();
  });

  it("marks an open-session stream stale if no fresh quote arrives", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T03:45:00.000Z"));
    const onQuoteStatus = vi.fn();
    const datafeed = new FundedWealthOpenAlgoDataFeed(instrument(), onQuoteStatus);
    const cancel = datafeed.feed.subscribeBars({
      symbol: "HDFCBANK",
      exchange: "NSE",
      interval: "1m",
    }, vi.fn());

    expect(onQuoteStatus).toHaveBeenLastCalledWith("connecting", undefined);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onQuoteStatus).toHaveBeenLastCalledWith(
      "stale",
      "No fresh Dhan quote has arrived; historical chart data remains available.",
    );

    cancel();
    datafeed.destroy();
    vi.useRealTimers();
  });
});
