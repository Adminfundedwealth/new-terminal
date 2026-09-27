import type { Instrument } from "./localDatabase";
import { InstrumentMaster, type InstrumentProvider } from "./instrumentMaster";

export type QuoteFreshness = "fresh" | "stale" | "invalid";

export interface Quote {
  instrumentId?: string;
  exchange?: string;
  symbol?: string;
  providerInstrumentId?: string;
  timestamp?: string;
  lastTradedPrice?: number;
  previousClose?: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
  openInterest?: number;
  bidPrice?: number;
  bidQuantity?: number;
  askPrice?: number;
  askQuantity?: number;
  change?: number;
  changePercent?: number;
  marketStatus?: string;
  session?: string;
  provider?: string;
}

export interface QuoteResult {
  quote?: Quote;
  freshness: QuoteFreshness;
  error?: QuoteError;
}

export type QuoteErrorCode =
  | "MISSING_INSTRUMENT"
  | "UNKNOWN_INSTRUMENT"
  | "CONFLICTING_INSTRUMENT"
  | "UNSUPPORTED_EXCHANGE"
  | "MALFORMED_PAYLOAD"
  | "INVALID_PRICE"
  | "INVALID_QUANTITY"
  | "INVALID_TIMESTAMP"
  | "INVALID_OHLC"
  | "STALE_QUOTE"
  | "PROVIDER_UNAVAILABLE";

export interface QuoteError {
  code: QuoteErrorCode;
  message: string;
}

export interface QuoteInput {
  provider: InstrumentProvider;
  payload: unknown;
  instrumentId?: string;
  providerInstrumentId?: string;
  exchange?: string;
  symbol?: string;
  now?: number;
}

const DEFAULT_MAX_AGE_MS = 15 * 60 * 1000;
const SUPPORTED_EXCHANGES = new Set(["NSE", "BSE", "MCX"]);

function value(record: Record<string, unknown>, keys: string[]): unknown {
  return keys.map((key) => record[key]).find((item) => item !== undefined && item !== null && item !== "");
}

function numberValue(item: unknown): number | undefined {
  if (item === undefined || item === null || item === "") return undefined;
  const parsed = Number(item);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function timestampValue(item: unknown): string | undefined {
  if (typeof item === "number" && Number.isFinite(item)) {
    const milliseconds = item < 1e12 ? item * 1000 : item;
    const date = new Date(milliseconds);
    return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
  }
  if (typeof item !== "string" || !item.trim()) return undefined;
  const date = new Date(item);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function firstPayload(payload: unknown): Record<string, unknown> | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const root = payload as Record<string, unknown>;
  if (root.data && typeof root.data === "object" && !Array.isArray(root.data)) {
    const data = root.data as Record<string, unknown>;
    for (const item of Object.values(data)) {
      if (Array.isArray(item) && item[0] && typeof item[0] === "object") return item[0] as Record<string, unknown>;
      if (item && typeof item === "object" && !Array.isArray(item)) return item as Record<string, unknown>;
    }
  }
  if (root.quote && typeof root.quote === "object") return root.quote as Record<string, unknown>;
  return root;
}

function resolveInstrument(master: InstrumentMaster, input: QuoteInput): Instrument | QuoteError {
  const byId = input.instrumentId ? master.getById(input.instrumentId) : undefined;
  const byProvider = input.providerInstrumentId ? master.getByProviderId(input.provider, input.providerInstrumentId) : undefined;
  const bySymbol = input.exchange && input.symbol ? master.getByExchangeSymbol(input.exchange, input.symbol) : undefined;
  const matches = [byId, byProvider, bySymbol].filter(Boolean) as Instrument[];
  if (!matches.length) {
    if (!input.instrumentId && !input.providerInstrumentId && !(input.exchange && input.symbol)) return { code: "MISSING_INSTRUMENT", message: "Quote has no canonical instrument identity." };
    return { code: "UNKNOWN_INSTRUMENT", message: "Quote identity does not resolve in the instrument master." };
  }
  if (new Set(matches.map((item) => item.securityId)).size > 1) return { code: "CONFLICTING_INSTRUMENT", message: "Quote identity resolves to conflicting instruments." };
  const instrument = matches[0];
  if (!SUPPORTED_EXCHANGES.has(instrument.exchange)) return { code: "UNSUPPORTED_EXCHANGE", message: `Unsupported exchange: ${instrument.exchange}.` };
  return instrument;
}

export function normalizeQuote(input: QuoteInput, master: InstrumentMaster, maxAgeMs = DEFAULT_MAX_AGE_MS): QuoteResult {
  const instrument = resolveInstrument(master, input);
  if ("code" in instrument) return { freshness: "invalid", error: instrument };
  const raw = firstPayload(input.payload);
  if (!raw) return { freshness: "invalid", error: { code: "MALFORMED_PAYLOAD", message: "Provider quote payload is not an object." } };

  const ohlc = raw.ohlc && typeof raw.ohlc === "object" ? raw.ohlc as Record<string, unknown> : {};
  const lastTradedPrice = numberValue(value(raw, ["lastTradedPrice", "last_traded_price", "last_price", "ltp"]));
  const previousClose = numberValue(value(raw, ["previousClose", "previous_close", "prevClose", "close"]) ?? value(ohlc, ["close"]));
  const quote: Quote = {
    instrumentId: instrument.securityId,
    exchange: instrument.exchange,
    symbol: instrument.symbol,
    providerInstrumentId: instrument.providerInstrumentId,
    timestamp: timestampValue(value(raw, ["timestamp", "exchange_timestamp", "feed_timestamp", "last_trade_time"])),
    lastTradedPrice,
    previousClose,
    open: numberValue(value(raw, ["open"]) ?? value(ohlc, ["open"])),
    high: numberValue(value(raw, ["high"]) ?? value(ohlc, ["high"])),
    low: numberValue(value(raw, ["low"]) ?? value(ohlc, ["low"])),
    volume: numberValue(value(raw, ["volume", "vol"])),
    openInterest: numberValue(value(raw, ["openInterest", "open_interest", "oi"])),
    bidPrice: numberValue(value(raw, ["bidPrice", "bid_price", "best_bid_price", "top_bid_price"])),
    bidQuantity: numberValue(value(raw, ["bidQuantity", "bid_quantity"])),
    askPrice: numberValue(value(raw, ["askPrice", "ask_price", "best_ask_price", "top_ask_price"])),
    askQuantity: numberValue(value(raw, ["askQuantity", "ask_quantity"])),
    change: numberValue(value(raw, ["change"])) ?? (lastTradedPrice !== undefined && previousClose !== undefined ? lastTradedPrice - previousClose : undefined),
    changePercent: numberValue(value(raw, ["changePercent", "change_percent"])) ?? (lastTradedPrice !== undefined && previousClose ? ((lastTradedPrice - previousClose) / previousClose) * 100 : undefined),
    marketStatus: typeof value(raw, ["marketStatus", "market_status"]) === "string" ? String(value(raw, ["marketStatus", "market_status"])) : undefined,
    session: typeof value(raw, ["session"]) === "string" ? String(value(raw, ["session"])) : undefined,
    provider: input.provider,
  };
  const error = validateQuote(quote);
  if (error) return { freshness: "invalid", error };
  const age = (input.now ?? Date.now()) - new Date(quote.timestamp!).getTime();
  if (age < -60_000) return { freshness: "invalid", error: { code: "INVALID_TIMESTAMP", message: "Quote timestamp is in the future." } };
  if (age > maxAgeMs) return { quote, freshness: "stale", error: { code: "STALE_QUOTE", message: "Quote is older than the freshness threshold." } };
  return { quote, freshness: "fresh" };
}

export function validateQuote(quote: Quote): QuoteError | undefined {
  if (!quote.instrumentId || !quote.providerInstrumentId || !quote.exchange || !quote.symbol) return { code: "MISSING_INSTRUMENT", message: "Canonical quote identity is incomplete." };
  if (quote.lastTradedPrice === undefined || !Number.isFinite(quote.lastTradedPrice) || quote.lastTradedPrice <= 0) return { code: "INVALID_PRICE", message: "Last traded price must be positive." };
  if (!quote.timestamp || !Number.isFinite(new Date(quote.timestamp).getTime())) return { code: "INVALID_TIMESTAMP", message: "Quote timestamp is invalid." };
  for (const quantity of [quote.volume, quote.openInterest, quote.bidQuantity, quote.askQuantity]) if (quantity !== undefined && (!Number.isFinite(quantity) || quantity < 0)) return { code: "INVALID_QUANTITY", message: "Quote quantities cannot be negative or non-finite." };
  for (const price of [quote.previousClose, quote.open, quote.high, quote.low, quote.bidPrice, quote.askPrice]) if (price !== undefined && (!Number.isFinite(price) || price < 0)) return { code: "INVALID_PRICE", message: "Quote prices cannot be negative or non-finite." };
  if (quote.high !== undefined && quote.low !== undefined && quote.high < quote.low) return { code: "INVALID_OHLC", message: "Quote high cannot be lower than low." };
  if (quote.open !== undefined && quote.high !== undefined && quote.open > quote.high) return { code: "INVALID_OHLC", message: "Quote open cannot exceed high." };
  if (quote.open !== undefined && quote.low !== undefined && quote.open < quote.low) return { code: "INVALID_OHLC", message: "Quote open cannot be below low." };
  return undefined;
}

export class QuoteService {
  private readonly latest = new Map<string, Quote>();
  constructor(private readonly master: InstrumentMaster, private readonly maxAgeMs = DEFAULT_MAX_AGE_MS) {}

  ingest(input: QuoteInput): QuoteResult {
    const result = normalizeQuote(input, this.master, this.maxAgeMs);
    if (!result.quote || result.freshness === "invalid") return result;
    const key = result.quote.instrumentId!;
    const existing = this.latest.get(key);
    const incomingTime = new Date(result.quote.timestamp!).getTime();
    const existingTime = existing ? new Date(existing.timestamp!).getTime() : -1;
    if (incomingTime < existingTime) return { quote: existing, freshness: "stale", error: { code: "STALE_QUOTE", message: "Older quote ignored; latest quote retained." } };
    this.latest.set(key, result.quote);
    return result;
  }

  getLatest(instrumentId: string): Quote | undefined { return this.latest.get(instrumentId); }
}

export interface LegacyQuote extends Quote {
  symbol: string;
  ltp: number;
  change: number;
  changePercent: number;
  timestamp: string;
}

export function toLegacyQuote(quote: Quote): LegacyQuote | undefined {
  if (!quote.symbol || quote.lastTradedPrice === undefined || !quote.timestamp) return undefined;
  return {
    ...quote,
    symbol: quote.symbol,
    ltp: quote.lastTradedPrice,
    change: quote.change ?? 0,
    changePercent: quote.changePercent ?? 0,
    timestamp: quote.timestamp,
  };
}