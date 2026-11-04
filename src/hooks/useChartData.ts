import { useQuery } from "@tanstack/react-query";
import { useAccountContext } from "@/hooks/useAccountContext";
import { normalizeCandlePayload } from "@/lib/historicalData";
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
function rangeToParams(range: string): { interval: string; daysBack: number } {
  switch (range) {
    case "1m": return { interval: "1m", daysBack: 1 };
    case "5m": return { interval: "5m", daysBack: 5 };
    case "15m":
    case "1W": return { interval: "15m", daysBack: 10 };
    case "1M": return { interval: "60m", daysBack: 31 };
    case "day":
    case "3M": return { interval: "day", daysBack: 92 };
    case "6M": return { interval: "day", daysBack: 183 };
    case "1Y": return { interval: "day", daysBack: 365 };
    default: return { interval: "day", daysBack: 92 };
  }
}

interface ColumnarCandleData {
  open?: number[];
  high?: number[];
  low?: number[];
  close?: number[];
  volume?: number[];
  timestamp?: (number | string)[];
  start_Time?: (number | string)[];
}

/**
 * Parses a column-array candle response with { open[], high[], low[], close[], volume[], timestamp[] }.
 * Exported for unit testing.
 */
export function parseColumnarCandles(rawData: ColumnarCandleData | null | undefined): OHLCVCandle[] {
  const normalized = normalizeCandlePayload(rawData as any, {
    instrumentId: "chart-data",
    symbol: "UNKNOWN",
    exchange: "NSE",
    interval: "D",
  });

  return normalized.map((candle) => ({
    time: candle.timestamp,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
  }));
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
    ...(KITE_HISTORICAL_SYMBOL_ALIASES[normalizedSymbol] ?? []),
  ].map(normalizeInstrumentName));
  return search.find((instrument) =>
    acceptedNames.has(normalizeInstrumentName(instrument.tradingSymbol)) ||
    acceptedNames.has(normalizeInstrumentName(instrument.symbol))
  ) ?? null;
}

function toChartCandles(candles: TerminalMarketDataCandle[]): OHLCVCandle[] {
  return candles.flatMap((candle) => {
    const numericTimestamp = Number(candle.timestamp);
    const time = Number.isFinite(numericTimestamp) && /^\d+$/.test(String(candle.timestamp))
      ? Math.floor(numericTimestamp > 1e12 ? numericTimestamp / 1000 : numericTimestamp)
      : Math.floor(Date.parse(candle.timestamp) / 1000);
    if (!Number.isFinite(time)) return [];
    return [{ time, open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume }];
  });
}

async function fetchGatewayHistorical(
  accountId: string | null,
  provider: "dhan" | "kite",
  symbol: string,
  range: string,
  instrumentToken?: string,
  selectedInstrument?: TerminalMarketDataInstrument,
): Promise<OHLCVCandle[]> {
  const scopedAccountId = provider === "dhan" ? null : accountId;
  const instrument = selectedInstrument ?? await findGatewayInstrument(scopedAccountId, provider, symbol, instrumentToken);
  if (!instrument) throw new Error(`Dhan's official instrument catalog does not contain ${symbol}.`);
  const { interval, daysBack } = rangeToParams(range);
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - daysBack);
  const apiInterval = provider === "kite"
    ? interval === "day" ? "day"
      : interval === "1m" ? "minute"
        : interval === "5m" ? "5minute"
          : interval === "15m" ? "15minute"
            : interval === "60m" ? "60minute" : interval
    : interval;
  const result = await requestTerminalMarketData<TerminalMarketDataCandle[]>(scopedAccountId, provider, {
    operation: "getHistoricalCandles",
    instrument,
    interval: apiInterval,
    fromDate: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(from),
    toDate: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now),
  });
  return toChartCandles(result);
}

/** Fetch OHLCV candles through Terminal OS using Founder-global Dhan credentials. */
async function fetchHistorical(
  symbol: string,
  range: string,
  accountId: string | null,
  provider: "dhan" | "kite" | null,
  instrumentToken?: string,
  selectedInstrument?: TerminalMarketDataInstrument,
): Promise<OHLCVCandle[]> {
  if (provider === "dhan" || (accountId && provider)) {
    return fetchGatewayHistorical(accountId, provider ?? "dhan", symbol, range, instrumentToken, selectedInstrument);
  }
  return [];
}

/**
 * React Query hook for chart data. Fetches OHLCV candles from Dhan API.
 */
export function useChartData(
  symbol: string,
  range: string = "3M",
  enabled: boolean = true,
  instrumentToken?: string,
  selectedInstrument?: TerminalMarketDataInstrument,
) {
  const { activeAccountId, accounts } = useAccountContext();
  const activeAccount = accounts.find((account) => account.id === activeAccountId);
  const provider = resolveTerminalMarketDataProvider(activeAccount?.broker_provider);

  return useQuery({
    queryKey: [
      "chart-data",
      "global-dhan",
      symbol,
      range,
      instrumentToken,
      selectedInstrument?.exchangeSegment,
      selectedInstrument?.providerInstrumentId,
    ],
    queryFn: () => fetchHistorical(symbol, range, activeAccountId, provider, instrumentToken, selectedInstrument),
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
    queryKey: ["sparkline", "global-dhan", symbol],
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
