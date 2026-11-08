import { useQuery } from "@tanstack/react-query";
import { useAccountContext } from "@/hooks/useAccountContext";
import { canonicalizeCandle } from "@/lib/historicalData";
import {
  requestTerminalMarketData,
  resolveTerminalMarketDataProvider,
  type TerminalMarketDataCandle,
  type TerminalMarketDataInstrument,
} from "@/lib/terminalApi";

export const KITE_INDEX_TOKEN_MAP: Record<string, string> = {
  NIFTY: "256265",
  BANKNIFTY: "260105",
  FINNIFTY: "257801",
};
const KITE_HISTORICAL_SYMBOL_ALIASES: Record<string, string[]> = {
  NIFTY: ["NIFTY 50"],
  BANKNIFTY: ["NIFTY BANK"],
  FINNIFTY: ["NIFTY FIN SERVICE"],
  MIDCPNIFTY: ["NIFTY MID SELECT", "NIFTY MIDCAP 50"],
  NIFTY_MIDCAP_50: ["NIFTY MIDCAP 50"],
};

const MAX_CONCURRENT_SPARKLINE_REQUESTS = 3;
let activeSparklineRequests = 0;
const queuedSparklineRequests: Array<() => void> = [];

async function withSparklineRequestSlot<T>(request: () => Promise<T>): Promise<T> {
  if (activeSparklineRequests >= MAX_CONCURRENT_SPARKLINE_REQUESTS) {
    await new Promise<void>((resolve) => queuedSparklineRequests.push(resolve));
  }
  activeSparklineRequests++;
  try {
    return await request();
  } finally {
    activeSparklineRequests--;
    queuedSparklineRequests.shift()?.();
  }
}

export interface OHLCVCandle {
  time: number; // Unix timestamp in seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export function resolveKiteHistoricalToken(symbol: string, instrumentToken?: string): string | undefined {
  return instrumentToken?.trim() || KITE_INDEX_TOKEN_MAP[symbol.toUpperCase()];
}

// ── Map a UI time range to candle interval + lookback days ──
interface HistoricalRangeParams {
  interval: string;
  daysBack: number;
  aggregateMinutes?: number;
}

function rangeToParams(range: string): HistoricalRangeParams {
  switch (range) {
    case "1W": return { interval: "15", daysBack: 10 };
    case "1M": return { interval: "60", daysBack: 31 };
    case "3M": return { interval: "D", daysBack: 92 };
    case "6M": return { interval: "D", daysBack: 183 };
    case "1Y": return { interval: "D", daysBack: 365 };
    case "1m": return { interval: "1", daysBack: 5 };
    case "3m": return { interval: "1", daysBack: 5, aggregateMinutes: 3 };
    case "5m": return { interval: "5", daysBack: 30 };
    case "15m": return { interval: "15", daysBack: 90 };
    case "30m": return { interval: "15", daysBack: 90, aggregateMinutes: 30 };
    case "1H": return { interval: "60", daysBack: 180 };
    case "1D": return { interval: "D", daysBack: 365 };
    default:   return { interval: "D", daysBack: 92 };
  }
}

interface ColumnarCandleData {
  open?: (number | null)[];
  high?: (number | null)[];
  low?: (number | null)[];
  close?: (number | null)[];
  volume?: (number | null)[];
  timestamp?: (number | string | null)[];
  start_Time?: (number | string | null)[];
}

/**
 * Parses the proxy's column-array candle response (shared by Dhan + Yahoo,
 * which both return { open[], high[], low[], close[], volume[], timestamp[] }).
 * Exported for unit testing.
 */
export function parseColumnarCandles(rawData: ColumnarCandleData | null | undefined): OHLCVCandle[] {
  if (!rawData || !Array.isArray(rawData.close) || rawData.close.length === 0) return [];
  const candles: OHLCVCandle[] = [];
  const timestamps = rawData.timestamp ?? rawData.start_Time ?? [];
  for (let index = 0; index < rawData.close.length; index += 1) {
    const close = rawData.close[index];
    if (close === null) continue;
    const open = rawData.open?.[index];
    const high = rawData.high?.[index];
    const low = rawData.low?.[index];
    const volume = rawData.volume?.[index];
    const sourceTimestamp = timestamps[index];
    if (open == null || high == null || low == null || volume == null || sourceTimestamp == null) {
      throw new Error("Historical market data omitted a required candle field.");
    }
    let timestamp: number;
    if (typeof sourceTimestamp === "number") {
      timestamp = sourceTimestamp > 1e12 ? Math.floor(sourceTimestamp / 1000) : Math.floor(sourceTimestamp);
    } else if (/^\d+(?:\.\d+)?$/.test(sourceTimestamp.trim())) {
      const numericTimestamp = Number(sourceTimestamp);
      timestamp = numericTimestamp > 1e12 ? Math.floor(numericTimestamp / 1000) : Math.floor(numericTimestamp);
    } else {
      const milliseconds = Date.parse(sourceTimestamp);
      timestamp = Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : NaN;
    }
    const candle = canonicalizeCandle({
      instrumentId: "chart-data",
      timestamp,
      open,
      high,
      low,
      close,
      volume,
      interval: "D",
      exchange: "NSE",
      symbol: "UNKNOWN",
    });
    candles.push({
      time: candle.timestamp,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
    });
  }
  return candles.sort((left, right) => left.time - right.time);
}

function normalizeInstrumentName(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

async function findGatewayInstrument(
  accountId: string | null,
  provider: "dhan" | "kite",
  symbol: string,
  instrumentToken?: string,
): Promise<TerminalMarketDataInstrument | null> {
  const normalizedSymbol = symbol.toUpperCase();
  const search = await requestTerminalMarketData<TerminalMarketDataInstrument[]>(accountId, provider, {
    operation: "searchInstruments",
    query: symbol.replace(/_/g, " "),
  });
  const token = instrumentToken || (provider === "kite" ? resolveKiteHistoricalToken(normalizedSymbol) : undefined);
  if (token) {
    const tokenMatch = search.find((instrument) => instrument.providerInstrumentId === token);
    if (tokenMatch) return tokenMatch;
  }

  const acceptedNames = new Set([
    normalizedSymbol,
    ...(provider === "kite" ? KITE_HISTORICAL_SYMBOL_ALIASES[normalizedSymbol] ?? [] : []),
  ].map(normalizeInstrumentName));
  return search.find((instrument) =>
    acceptedNames.has(normalizeInstrumentName(instrument.tradingSymbol)) ||
    acceptedNames.has(normalizeInstrumentName(instrument.symbol))
  ) ?? null;
}

function toChartCandles(candles: TerminalMarketDataCandle[]): OHLCVCandle[] {
  return candles.map((candle) => {
    const time = typeof candle.timestamp === "number"
      ? Math.floor(candle.timestamp > 1e12 ? candle.timestamp / 1000 : candle.timestamp)
      : Math.floor(Date.parse(candle.timestamp) / 1000);
    const values = [candle.open, candle.high, candle.low, candle.close, candle.volume];
    if (
      !Number.isFinite(time) ||
      values.some((value) => !Number.isFinite(value)) ||
      candle.high < Math.max(candle.open, candle.close) ||
      candle.low > Math.min(candle.open, candle.close) ||
      candle.volume < 0
    ) {
      throw new Error("Historical market data contained an invalid candle.");
    }
    return { time, open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume };
  });
}

function aggregateCandles(candles: OHLCVCandle[], intervalMinutes: number): OHLCVCandle[] {
  const intervalSeconds = intervalMinutes * 60;
  const buckets = new Map<number, OHLCVCandle>();
  for (const candle of candles) {
    const istSeconds = candle.time + 330 * 60;
    const localDay = Math.floor(istSeconds / 86400);
    const minuteOfDay = Math.floor((istSeconds % 86400) / 60);
    const sessionOpenMinute = 9 * 60 + 15;
    const bucketMinute = minuteOfDay < sessionOpenMinute
      ? minuteOfDay
      : sessionOpenMinute + Math.floor((minuteOfDay - sessionOpenMinute) / intervalMinutes) * intervalMinutes;
    const bucketTime = localDay * 86400 + bucketMinute * 60 - 330 * 60;
    const current = buckets.get(bucketTime);
    if (current) {
      current.high = Math.max(current.high, candle.high);
      current.low = Math.min(current.low, candle.low);
      current.close = candle.close;
      current.volume = (current.volume ?? 0) + (candle.volume ?? 0);
    } else {
      buckets.set(bucketTime, {
        time: bucketTime,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
      });
    }
  }
  return [...buckets.values()].sort((left, right) => left.time - right.time);
}

async function fetchGatewayHistorical(
  accountId: string | null,
  provider: "dhan" | "kite",
  symbol: string,
  range: string,
  instrumentToken?: string,
): Promise<OHLCVCandle[]> {
  const scopedAccountId = provider === "dhan" ? null : accountId;
  const instrument = await findGatewayInstrument(scopedAccountId, provider, symbol, instrumentToken);
  if (!instrument) throw new Error(`The canonical Dhan instrument could not be resolved for ${symbol}.`);
  const rangeParams = rangeToParams(range);
  const { interval, daysBack } = rangeParams;
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - daysBack);
  const apiInterval = interval === "D"
    ? "day"
    : provider === "kite"
      ? `${interval}minute`
      : `${interval}m`;
  const result = await requestTerminalMarketData<TerminalMarketDataCandle[]>(scopedAccountId, provider, {
    operation: "getHistoricalCandles",
    instrument,
    interval: apiInterval,
    fromDate: from.toISOString().split("T")[0],
    toDate: now.toISOString().split("T")[0],
  });
  const candles = toChartCandles(result);
  return rangeParams.aggregateMinutes
    ? aggregateCandles(candles, rangeParams.aggregateMinutes)
    : candles;
}

/** Fetch OHLCV candles through Terminal OS using Founder-global Dhan credentials. */
async function fetchHistorical(
  symbol: string,
  range: string,
  accountId: string | null,
  provider: "dhan" | "kite" | null,
  instrumentToken?: string,
): Promise<OHLCVCandle[]> {
  if (provider === "dhan" || (accountId && provider)) {
    return fetchGatewayHistorical(accountId, provider ?? "dhan", symbol, range, instrumentToken);
  }
  return [];
}

/**
 * React Query hook for chart data. Fetches OHLCV candles from Dhan API.
 */
export function useChartData(symbol: string, range: string = "3M", enabled: boolean = true, instrumentToken?: string) {
  const { activeAccountId, accounts } = useAccountContext();
  const activeAccount = accounts.find((account) => account.id === activeAccountId);
  const provider = resolveTerminalMarketDataProvider(activeAccount?.broker_provider);

  return useQuery({
    queryKey: ["chart-data", activeAccountId, provider, symbol, range, instrumentToken],
    queryFn: () => fetchHistorical(symbol, range, activeAccountId, provider, instrumentToken),
    enabled: !!symbol && enabled,
    staleTime: 5 * 60 * 1000, // 5 min cache
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

/**
 * Fetches a quick sparkline (close prices only) for mini charts.
 */
export function useSparklineData(symbol: string, enabled: boolean = true) {
  const { activeAccountId, accounts } = useAccountContext();
  const activeAccount = accounts.find((account) => account.id === activeAccountId);
  const provider = resolveTerminalMarketDataProvider(activeAccount?.broker_provider);

  return useQuery({
    queryKey: ["sparkline", activeAccountId, provider, symbol],
    queryFn: async (): Promise<number[]> => {
      const candles = await withSparklineRequestSlot(
        () => fetchHistorical(symbol, "3M", activeAccountId, provider),
      );
      if (candles.length > 0) {
        return candles.map(c => c.close);
      }
      return [];
    },
    enabled: !!symbol && enabled,
    staleTime: 10 * 60 * 1000, // 10 min cache
    refetchOnWindowFocus: false,
    retry: 1,
  });
}
