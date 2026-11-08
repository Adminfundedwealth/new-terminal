import type { Instrument } from "./localDatabase";
import { LEGACY_STOCK_SYMBOL_ALIASES, normalizeMarketLookupKey } from "./curatedMarketLists";

export interface WatchlistInstrument {
  provider: NonNullable<Instrument["provider"]>;
  securityId: string;
  symbol: string;
  tradingSymbol: string;
  exchange: string;
  exchangeSegment: string;
}

const STORAGE_KEY = "fundedwealth.market-watchlist.v2";

export function watchlistInstrumentKey(instrument: Pick<WatchlistInstrument, "provider" | "exchangeSegment" | "securityId">): string {
  return `${instrument.provider}:${instrument.exchangeSegment}:${instrument.securityId}`;
}

function canonicalWatchlistSymbol(symbol: string): string {
  const key = normalizeMarketLookupKey(symbol);
  return normalizeMarketLookupKey(LEGACY_STOCK_SYMBOL_ALIASES[key] ?? symbol);
}

export function sameWatchlistInstrument(left: WatchlistInstrument, right: WatchlistInstrument): boolean {
  const hasLegacyAlias = [left.tradingSymbol, right.tradingSymbol].some((symbol) =>
    Object.prototype.hasOwnProperty.call(LEGACY_STOCK_SYMBOL_ALIASES, normalizeMarketLookupKey(symbol))
  );
  return watchlistInstrumentKey(left) === watchlistInstrumentKey(right) || (
    left.provider === right.provider &&
    left.exchangeSegment === right.exchangeSegment &&
    canonicalWatchlistSymbol(left.tradingSymbol) === canonicalWatchlistSymbol(right.tradingSymbol) &&
    hasLegacyAlias
  );
}

export function toWatchlistInstrument(instrument: Instrument): WatchlistInstrument {
  const securityId = instrument.providerInstrumentId || instrument.securityId;
  const exchange = instrument.exchange ||
    (instrument.exchangeSegment.startsWith("BSE") ? "BSE" : instrument.exchangeSegment.startsWith("MCX") ? "MCX" : "NSE");
  if (!instrument.provider || !securityId || !instrument.symbol || !instrument.tradingSymbol || !instrument.exchangeSegment || !exchange) {
    throw new Error("Cannot add an instrument without its canonical broker identity.");
  }
  return {
    provider: instrument.provider,
    securityId,
    symbol: instrument.symbol,
    tradingSymbol: instrument.tradingSymbol,
    exchange,
    exchangeSegment: instrument.exchangeSegment,
  };
}

function isWatchlistInstrument(value: unknown): value is WatchlistInstrument {
  if (!value || typeof value !== "object") return false;
  const instrument = value as Partial<WatchlistInstrument>;
  return typeof instrument.provider === "string" &&
    typeof instrument.securityId === "string" &&
    typeof instrument.symbol === "string" &&
    typeof instrument.tradingSymbol === "string" &&
    typeof instrument.exchange === "string" &&
    typeof instrument.exchangeSegment === "string";
}

function storageKey(userId: string): string {
  return `${STORAGE_KEY}:${encodeURIComponent(userId)}`;
}

export function getSavedWatchlist(userId: string | null | undefined): WatchlistInstrument[] {
  if (!userId) return [];
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("Saved watchlist data is not an array.");
    const unique = new Map<string, WatchlistInstrument>();
    for (const item of parsed) {
      if (!isWatchlistInstrument(item)) continue;
      unique.set(watchlistInstrumentKey(item), item);
    }
    return [...unique.values()];
  } catch (error) {
    console.error("Could not load the saved watchlist:", error);
    return [];
  }
}

export function saveWatchlist(instruments: WatchlistInstrument[], userId: string): void {
  if (!userId) throw new Error("An authenticated user is required to save a watchlist.");
  const unique = new Map<string, WatchlistInstrument>();
  for (const instrument of instruments) {
    unique.set(watchlistInstrumentKey(instrument), instrument);
  }
  localStorage.setItem(storageKey(userId), JSON.stringify([...unique.values()]));
}

export function isWatchlisted(symbol: string, symbols: string[]): boolean {
  const normalized = canonicalWatchlistSymbol(symbol);
  return symbols.some((entry) => canonicalWatchlistSymbol(entry) === normalized);
}

export const WATCHLIST_STORAGE_KEY = STORAGE_KEY;
