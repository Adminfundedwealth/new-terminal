import type { Instrument } from "./localDatabase";
import { InstrumentMaster } from "./instrumentMaster";

export type HistoricalInterval = "1" | "3" | "5" | "10" | "15" | "30" | "60" | "D" | "W" | "M";

export interface HistoricalCandle {
  instrumentId: string;
  symbol: string;
  exchange: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  interval: string;
  provider?: string;
  session?: string;
}

export interface HistoricalInstrumentResolverInput {
  instrumentId?: string;
  provider?: string;
  providerInstrumentId?: string;
  exchange?: string;
  symbol?: string;
  tradingSymbol?: string;
}

export type ResolvedHistoricalInstrument = Instrument & { instrumentId: string };

const VALID_INTERVALS = new Set<HistoricalInterval>(["1", "3", "5", "10", "15", "30", "60", "D", "W", "M"]);
const TIMEFRAME_ALIASES: Record<string, HistoricalInterval> = {
  "1M": "1",
  "5M": "5",
  "15M": "15",
  "30M": "30",
  "60M": "60",
  "1H": "60",
  "1D": "D",
  "1W": "W",
  "1MO": "M",
  "1MINUTE": "1",
  "3MINUTE": "3",
  "5MINUTE": "5",
  "10MINUTE": "10",
  "15MINUTE": "15",
  "30MINUTE": "30",
  "60MINUTE": "60",
};

function asFiniteNumber(value: unknown, field: string): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  throw new Error(`Invalid ${field}: expected a finite number.`);
}

function normalizeTimestamp(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    const candidate = value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
    if (candidate > 0) return candidate;
    throw new Error(`Invalid timestamp: ${value}.`);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) throw new Error("Invalid timestamp: empty string.");
    const ms = Date.parse(trimmed);
    if (!Number.isNaN(ms)) return Math.floor(ms / 1000);
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) return normalizeTimestamp(numeric);
  }
  throw new Error("Invalid timestamp.");
}

export function normalizeTimeframe(value: string): HistoricalInterval {
  if (!value) throw new Error("Invalid timeframe: empty value.");
  const raw = String(value).trim();
  const normalized = raw.toUpperCase();
  if (VALID_INTERVALS.has(normalized as HistoricalInterval)) return normalized as HistoricalInterval;
  const alias = TIMEFRAME_ALIASES[raw.toUpperCase()] ?? TIMEFRAME_ALIASES[raw.toUpperCase().replace(/\s+/g, "")];
  if (alias) return alias;
  if (/^\d+$/.test(raw)) {
    const valueNumber = Number(raw);
    if (VALID_INTERVALS.has(String(valueNumber) as HistoricalInterval)) return String(valueNumber) as HistoricalInterval;
  }
  throw new Error(`Unsupported timeframe: ${value}.`);
}

export function canonicalizeCandle(raw: Partial<HistoricalCandle> & { instrumentId?: string; interval?: string; tradingSymbol?: string }): HistoricalCandle {
  const instrumentId = String(raw.instrumentId ?? "").trim();
  if (!instrumentId) throw new Error("Historical candle is missing instrumentId.");

  const symbol = String(raw.symbol ?? raw.tradingSymbol ?? "").trim().toUpperCase();
  const exchange = String(raw.exchange ?? "NSE").trim().toUpperCase();
  const interval = normalizeTimeframe(String(raw.interval ?? "D"));
  const timestamp = normalizeTimestamp(raw.timestamp);
  const open = asFiniteNumber(raw.open, "open");
  const high = asFiniteNumber(raw.high, "high");
  const low = asFiniteNumber(raw.low, "low");
  const close = asFiniteNumber(raw.close, "close");
  const volume = asFiniteNumber(raw.volume ?? 0, "volume");

  if (volume < 0) throw new Error(`Invalid volume for ${instrumentId}: volume cannot be negative.`);
  if (high < Math.max(open, close)) throw new Error(`Invalid OHLC: high below the open/close range for ${instrumentId}.`);
  if (low > Math.min(open, close)) throw new Error(`Invalid OHLC: low above the open/close range for ${instrumentId}.`);

  return {
    instrumentId,
    symbol,
    exchange,
    timestamp,
    open,
    high,
    low,
    close,
    volume,
    interval,
    provider: raw.provider,
    session: raw.session,
  };
}

function withMeta<T extends Partial<HistoricalCandle>>(payload: T, fallback: Partial<HistoricalCandle>): T & Partial<HistoricalCandle> {
  return { ...fallback, ...payload };
}

export function normalizeCandlePayload(
  raw: { timestamp?: unknown[]; open?: unknown[]; high?: unknown[]; low?: unknown[]; close?: unknown[]; volume?: unknown[]; start_Time?: unknown[] } | null | undefined,
  meta: Partial<HistoricalCandle> & { instrumentId: string; interval?: string; symbol?: string; exchange?: string; provider?: string },
): HistoricalCandle[] {
  if (!raw || !Array.isArray(raw.close) || raw.close.length === 0) return [];

  const timestamps = Array.isArray(raw.timestamp) ? raw.timestamp : Array.isArray(raw.start_Time) ? raw.start_Time : [];
  const opens = Array.isArray(raw.open) ? raw.open : [];
  const highs = Array.isArray(raw.high) ? raw.high : [];
  const lows = Array.isArray(raw.low) ? raw.low : [];
  const closes = raw.close;
  const volumes = Array.isArray(raw.volume) ? raw.volume : [];

  const normalized: HistoricalCandle[] = [];
  for (let index = 0; index < closes.length; index += 1) {
    if (closes[index] == null) continue;
    const timestamp = timestamps[index];
    const candle = canonicalizeCandle(withMeta({
      instrumentId: meta.instrumentId,
      symbol: meta.symbol,
      exchange: meta.exchange,
      interval: meta.interval ?? "D",
      provider: meta.provider,
      timestamp: normalizeTimestamp(timestamp),
      open: Number(opens[index] ?? closes[index]),
      high: Number(highs[index] ?? closes[index]),
      low: Number(lows[index] ?? closes[index]),
      close: Number(closes[index]),
      volume: Number(volumes[index] ?? 0),
    }, meta));
    normalized.push(candle);
  }

  normalized.sort((a, b) => a.timestamp - b.timestamp);
  const deduped = new Map<number, HistoricalCandle>();
  for (const candle of normalized) {
    deduped.set(candle.timestamp, candle);
  }
  return [...deduped.values()].sort((a, b) => a.timestamp - b.timestamp);
}

export function deduplicateHistoricalCandles(candles: HistoricalCandle[]): HistoricalCandle[] {
  const deduped = new Map<number, HistoricalCandle>();
  for (const candle of [...candles].sort((a, b) => a.timestamp - b.timestamp)) {
    deduped.set(candle.timestamp, candle);
  }
  return [...deduped.values()].sort((a, b) => a.timestamp - b.timestamp);
}

export function mergeHistoricalRanges(...ranges: HistoricalCandle[][]): HistoricalCandle[] {
  return deduplicateHistoricalCandles(ranges.flat());
}

export function resolveHistoricalInstrument(
  input: HistoricalInstrumentResolverInput,
  master?: InstrumentMaster,
): ResolvedHistoricalInstrument | null {
  const source = master ?? new InstrumentMaster();
  const byId = input.instrumentId ? source.getById(input.instrumentId) : undefined;
  if (byId) return { ...byId, instrumentId: byId.securityId };

  if (input.provider && input.providerInstrumentId) {
    const byProvider = source.getByProviderId(input.provider, input.providerInstrumentId);
    if (byProvider) return { ...byProvider, instrumentId: byProvider.securityId };
  }

  if (input.exchange && input.symbol) {
    const bySymbol = source.getByExchangeSymbol(input.exchange, input.symbol);
    if (bySymbol) return { ...bySymbol, instrumentId: bySymbol.securityId };
  }

  if (input.exchange && input.tradingSymbol) {
    const byTradingSymbol = source.getByExchangeSymbol(input.exchange, input.tradingSymbol);
    if (byTradingSymbol) return { ...byTradingSymbol, instrumentId: byTradingSymbol.securityId };
  }

  return null;
}

export function buildInstrumentMasterFromRows(rows: Instrument[]): InstrumentMaster {
  const master = new InstrumentMaster();
  master.addAll(rows);
  return master;
}
