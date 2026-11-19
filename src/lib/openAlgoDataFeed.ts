import {
  CandleBuilder,
  SessionCalendar,
  utcSecondsToZonedParts,
  withTimeframes,
  zonedWallClockToUtcSeconds,
} from "openalgo-charts";
import type {
  Bar,
  BarSubscriptionOptions,
  BarsRequest,
  DataFeed,
  SymbolMatch,
  SymbolSearchRequest,
} from "openalgo-charts";
import {
  requestTerminalMarketData,
  subscribeToTerminalMarketDataStream,
  type TerminalMarketDataCandle,
  type TerminalMarketDataInstrument,
} from "@/lib/terminalApi";

const INDIA_TIME_ZONE = "Asia/Kolkata";
const INDIA_OFFSET_SECONDS = 5 * 60 * 60 + 30 * 60;
const SESSION_ANCHOR_SECONDS = (9 * 60 + 15) * 60 - INDIA_OFFSET_SECONDS;
const MAX_LIVE_QUOTE_AGE_SECONDS = 5;
const QUOTE_CONNECT_TIMEOUT_MS = 10_000;

const ALLOWED_SEGMENTS = new Set([
  "NSE_EQ",
  "BSE_EQ",
  "IDX_I",
  "BSE_IDX",
  "NSE_FNO",
  "BSE_FNO",
]);
const ALLOWED_INSTRUMENT_TYPES = new Set([
  "EQUITY",
  "INDEX",
  "FUTSTK",
  "FUTIDX",
  "OPTSTK",
  "OPTIDX",
]);
const NATIVE_INTERVAL_SECONDS: Record<string, number> = {
  "1m": 60,
  "5m": 5 * 60,
  "15m": 15 * 60,
  "25m": 25 * 60,
  "1h": 60 * 60,
  "1d": 24 * 60 * 60,
};
const DHAN_INTERVALS: Record<string, string> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "25m": "25m",
  "1h": "60m",
  "1d": "1d",
};

const indiaCalendar = new SessionCalendar({
  timezone: INDIA_TIME_ZONE,
  sessions: ["0915-1530:23456"],
});

export type OpenAlgoQuoteStatus = "connecting" | "live" | "stale" | "error";

export function isIndianMarketInstrument(
  instrument: TerminalMarketDataInstrument,
): boolean {
  return (
    (instrument.exchange.toUpperCase() === "NSE" || instrument.exchange.toUpperCase() === "BSE") &&
    ALLOWED_SEGMENTS.has(instrument.exchangeSegment.trim().toUpperCase()) &&
    ALLOWED_INSTRUMENT_TYPES.has(instrument.instrumentType.toUpperCase())
  );
}

export function parseDhanTimestamp(value: string): number {
  const trimmed = value.trim();
  const numeric = Number(trimmed);
  if (trimmed !== "" && Number.isFinite(numeric)) {
    const milliseconds = Math.abs(numeric) >= 1_000_000_000_000 ? numeric : numeric * 1000;
    const seconds = Math.floor(milliseconds / 1000);
    if (Number.isFinite(seconds)) return seconds;
  }

  const normalized = trimmed.includes(" ") ? trimmed.replace(" ", "T") : trimmed;
  const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)
    ? normalized
    : `${normalized}+05:30`;
  const milliseconds = Date.parse(withZone);
  if (!Number.isFinite(milliseconds)) {
    throw new Error(`The market-data service returned an invalid candle timestamp: ${value}`);
  }
  return Math.floor(milliseconds / 1000);
}

export function normalizeDhanCandle(
  candle: TerminalMarketDataCandle,
  interval: string,
): Bar {
  const timestamp = parseDhanTimestamp(candle.timestamp);
  const time = interval === "1d"
    ? localMidnight(timestamp)
    : timestamp;
  const values = [candle.open, candle.high, candle.low, candle.close, candle.volume];
  if (
    !values.every(Number.isFinite) ||
    candle.open <= 0 ||
    candle.high <= 0 ||
    candle.low <= 0 ||
    candle.close <= 0 ||
    candle.high < Math.max(candle.open, candle.close) ||
    candle.low > Math.min(candle.open, candle.close)
  ) {
    throw new Error("The market-data service returned an invalid OHLCV candle.");
  }
  return {
    time,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
    ...(Number.isFinite(candle.openInterest) ? { oi: candle.openInterest } : {}),
  };
}

export function normalizeDhanCandles(
  candles: TerminalMarketDataCandle[],
  interval: string,
  symbol: string,
): Bar[] {
  const bars: Bar[] = [];
  let invalidCount = 0;
  for (const candle of candles) {
    try {
      bars.push(normalizeDhanCandle(candle, interval));
    } catch (error) {
      if (error instanceof Error && (
        error.message === "The market-data service returned an invalid OHLCV candle." ||
        error.message.startsWith("The market-data service returned an invalid candle timestamp:")
      )) {
        invalidCount += 1;
        continue;
      }
      throw error;
    }
  }
  if (invalidCount > 0) {
    console.warn(`Skipped ${invalidCount} invalid Dhan historical candle(s) for ${symbol}.`);
  }
  return bars;
}

function localMidnight(time: number): number {
  const parts = utcSecondsToZonedParts(time, INDIA_TIME_ZONE);
  return zonedWallClockToUtcSeconds(
    parts.year,
    parts.month,
    parts.day,
    0,
    0,
    0,
    INDIA_TIME_ZONE,
  );
}

function localDate(time: number): string {
  const parts = utcSecondsToZonedParts(time, INDIA_TIME_ZONE);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function instrumentKey(symbol: string, exchange: string): string {
  return `${exchange.trim().toUpperCase()}\u001f${symbol.trim().toUpperCase()}`;
}

function nativeBounds(interval: string, time: number) {
  if (interval === "1d") {
    const parts = utcSecondsToZonedParts(time, INDIA_TIME_ZONE);
    const open = zonedWallClockToUtcSeconds(
      parts.year,
      parts.month,
      parts.day,
      9,
      15,
      0,
      INDIA_TIME_ZONE,
    );
    const session = indiaCalendar.sessionAt(open);
    return session
      ? { time: session.open, from: session.open, to: session.close }
      : null;
  }

  const session = indiaCalendar.sessionAt(time);
  if (!session) return null;
  const intervalSeconds = NATIVE_INTERVAL_SECONDS[interval];
  if (!intervalSeconds) return null;
  const from = session.open + Math.floor((time - session.open) / intervalSeconds) * intervalSeconds;
  return {
    time: from,
    from,
    to: Math.min(from + intervalSeconds, session.close),
  };
}

function indiaTimeframeMarket() {
  return {
    key: "fundedwealth:dhan:india:regular:v1",
    calendar: indiaCalendar,
    sources: Object.keys(NATIVE_INTERVAL_SECONDS).map((interval) => ({
      interval,
      bounds: (time: number) => nativeBounds(interval, time),
    })),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The market-data request failed.";
}

function abortError(): Error {
  return new DOMException("The chart history request was cancelled.", "AbortError");
}

export class FundedWealthOpenAlgoDataFeed {
  private readonly instruments = new Map<string, TerminalMarketDataInstrument>();
  private readonly rawFeed: DataFeed;
  readonly feed: ReturnType<typeof withTimeframes>;

  constructor(
    initialInstrument: TerminalMarketDataInstrument | undefined,
    private readonly onQuoteStatus: (status: OpenAlgoQuoteStatus, message?: string) => void,
  ) {
    if (initialInstrument) this.registerInstrument(initialInstrument);
    this.rawFeed = {
      getBars: (request) => this.getBars(request),
      searchSymbols: (request) => this.searchSymbols(request),
      subscribeBars: (request, onBar, options) => this.subscribeBars(request, onBar, options),
    };
    this.feed = withTimeframes(this.rawFeed, {
      market: () => indiaTimeframeMarket(),
    });
  }

  registerInstrument(instrument: TerminalMarketDataInstrument): void {
    const providerInstrument = instrument.exchangeSegment.toUpperCase() === "BSE_IDX"
      ? { ...instrument, exchangeSegment: "IDX_I" }
      : instrument;
    if (!isIndianMarketInstrument(instrument)) {
      throw new Error("OpenAlgo charting is restricted to Indian NSE/BSE cash, index, and F&O instruments.");
    }
    if (providerInstrument.provider !== "dhan" || !/^\d+$/.test(providerInstrument.providerInstrumentId)) {
      throw new Error("The selected instrument does not have a valid Dhan security ID.");
    }
    this.instruments.set(
      instrumentKey(providerInstrument.tradingSymbol, providerInstrument.exchange),
      providerInstrument,
    );
  }

  destroy(): void {
    this.feed.destroy();
  }

  private async searchSymbols(request: SymbolSearchRequest): Promise<SymbolMatch[]> {
    const query = request.query.trim();
    if (!query || request.signal?.aborted) return [];
    const matches = await requestTerminalMarketData<TerminalMarketDataInstrument[]>(
      null,
      "dhan",
      { operation: "searchInstruments", query },
      "production",
      request.signal,
    );
    if (request.signal?.aborted) throw abortError();
    return matches
      .filter(isIndianMarketInstrument)
      .map((instrument) => {
        this.registerInstrument(instrument);
        return {
          symbol: instrument.tradingSymbol,
          exchange: instrument.exchange,
          name: `${instrument.symbol} · ${instrument.exchangeSegment}${instrument.expiryDate ? ` · ${instrument.expiryDate}` : ""}`,
          assetClass: instrument.instrumentType,
        };
      });
  }

  private async resolveInstrument(request: BarsRequest): Promise<TerminalMarketDataInstrument> {
    const cached = this.instruments.get(instrumentKey(request.symbol, request.exchange));
    if (cached) return cached;

    const results = await this.searchSymbols({ query: request.symbol, signal: request.signal });
    const exactSymbols = results.filter((result) =>
      result.symbol.toUpperCase() === request.symbol.trim().toUpperCase()
    );
    const exact = request.exchange.trim()
      ? exactSymbols.filter((result) =>
        result.exchange?.toUpperCase() === request.exchange.trim().toUpperCase()
      )
      : exactSymbols;
    const instrument = exact.length === 1
      ? this.instruments.get(instrumentKey(exact[0].symbol, exact[0].exchange ?? ""))
      : undefined;
    if (!instrument) {
      throw new Error(`Could not resolve ${request.exchange} ${request.symbol} to one Indian-market contract.`);
    }
    return instrument;
  }

  private async getBars(request: BarsRequest): Promise<Bar[]> {
    if (request.signal?.aborted) throw abortError();
    const interval = request.interval;
    const dhanInterval = DHAN_INTERVALS[interval];
    if (!dhanInterval) throw new Error(`Dhan historical candles do not support ${interval}.`);

    const instrument = await this.resolveInstrument(request);
    if (request.signal?.aborted) throw abortError();
    const now = Math.floor(Date.now() / 1000);
    const from = request.from ?? now - NATIVE_INTERVAL_SECONDS[interval] * 500;
    const to = request.to ?? now;
    if (!(from < to)) return [];

    const candles = await requestTerminalMarketData<TerminalMarketDataCandle[]>(
      null,
      "dhan",
      {
        operation: "getHistoricalCandles",
        instrument,
        interval: dhanInterval,
        fromDate: localDate(from),
        toDate: localDate(to),
      },
      "production",
      request.signal,
    );
    if (request.signal?.aborted) throw abortError();
    const fromBound = interval === "1d" ? localMidnight(from) : from;
    const toBound = interval === "1d" ? localMidnight(to - 1) + 24 * 60 * 60 : to;
    return normalizeDhanCandles(candles, interval, instrument.tradingSymbol)
      .filter((bar) => bar.time >= fromBound && bar.time < toBound)
      .sort((left, right) => left.time - right.time);
  }

  private subscribeBars(
    request: BarsRequest,
    onBar: (bar: Bar, meta?: { provisional?: boolean }) => void,
    options: BarSubscriptionOptions = {},
  ): () => void {
    const instrument = this.instruments.get(instrumentKey(request.symbol, request.exchange));
    const intervalSeconds = NATIVE_INTERVAL_SECONDS[request.interval];
    if (!instrument || !intervalSeconds) {
      throw new Error(`Cannot subscribe to ${request.exchange} ${request.symbol} at ${request.interval}.`);
    }

    const bucketStart = intervalSeconds >= 24 * 60 * 60
      ? localMidnight
      : (time: number) => SESSION_ANCHOR_SECONDS +
        Math.floor((time - SESSION_ANCHOR_SECONDS) / intervalSeconds) * intervalSeconds;
    const builder = new CandleBuilder({
      intervalSec: intervalSeconds,
      volumeMode: "day-delta",
      lateTickPolicy: "dropOlderThanPrevBar",
      sessionAnchorSec: SESSION_ANCHOR_SECONDS,
      bucketStart,
    });
    if (options.seedFrom) builder.seed(options.seedFrom, options.cumDayVolumeSoFar);

    let active = true;
    let receivedFreshQuote = false;
    const marketIsOpen = indiaCalendar.phaseAt(Math.floor(Date.now() / 1000)) === "regular";
    const quoteWaitTimeout = marketIsOpen
      ? setTimeout(() => {
          if (active && !receivedFreshQuote) {
            this.onQuoteStatus("stale", "No fresh Dhan quote has arrived; historical chart data remains available.");
          }
        }, QUOTE_CONNECT_TIMEOUT_MS)
      : undefined;
    const unsubscribe = subscribeToTerminalMarketDataStream(
      null,
      "dhan",
      [instrument],
      (event) => {
        if (!active || event.provider !== "dhan") return;
        const quote = event.quote;
        try {
          const time = parseDhanTimestamp(quote.timestamp);
          if (!Number.isFinite(quote.ltp) || quote.ltp <= 0) {
            throw new Error("The market-data service returned an invalid quote.");
          }
          const now = Math.floor(Date.now() / 1000);
          if (indiaCalendar.phaseAt(now) !== "regular" ||
            time > now + 2 ||
            now - time > MAX_LIVE_QUOTE_AGE_SECONDS) {
            this.onQuoteStatus("stale", "Market closed or the latest provider quote is stale.");
            return;
          }
          receivedFreshQuote = true;
          if (quoteWaitTimeout) clearTimeout(quoteWaitTimeout);
          const update = builder.onTick({
            time,
            price: quote.ltp,
            ...(quote.volume == null ? {} : { cumDayVolume: quote.volume }),
            ...(quote.openInterest == null ? {} : { oi: quote.openInterest }),
          });
          if (update) onBar(update.bar, { provisional: update.provisional });
          this.onQuoteStatus("live");
        } catch (error) {
          this.onQuoteStatus("error", errorMessage(error));
        }
      },
      (status) => {
        if (!active) return;
        if (status === "error") {
          if (quoteWaitTimeout) clearTimeout(quoteWaitTimeout);
          this.onQuoteStatus("error", "The Dhan quote stream is unavailable.");
        } else if (status === "disconnected") {
          if (quoteWaitTimeout) clearTimeout(quoteWaitTimeout);
          this.onQuoteStatus("stale", "Dhan quote stream disconnected.");
        } else if (status === "connected" && !marketIsOpen) {
          this.onQuoteStatus("stale", "Market closed; historical chart data remains available.");
        } else if (status !== "connected") this.onQuoteStatus("connecting");
      },
    );
    if (!receivedFreshQuote) {
      this.onQuoteStatus(
        marketIsOpen ? "connecting" : "stale",
        marketIsOpen ? undefined : "Market closed; historical chart data remains available.",
      );
    }
    return () => {
      active = false;
      if (quoteWaitTimeout) clearTimeout(quoteWaitTimeout);
      unsubscribe();
    };
  }
}
