import {
  APPROVED_STOCK_UNIVERSE,
  LEGACY_STOCK_SYMBOL_ALIASES,
  UNRESOLVED_APPROVED_STOCK_SYMBOLS,
  normalizeApprovedStockKey,
  resolveApprovedStockSymbol,
} from "./approved-stock-universe.mjs";

export {
  APPROVED_STOCK_UNIVERSE,
  LEGACY_STOCK_SYMBOL_ALIASES,
  UNRESOLVED_APPROVED_STOCK_SYMBOLS,
  resolveApprovedStockSymbol,
};

export const CURATED_STOCK_SYMBOLS: readonly string[] = [
  ...new Set(
    APPROVED_STOCK_UNIVERSE.flatMap(({ symbols }) => [...symbols])
      .map(resolveApprovedStockSymbol)
      .filter((symbol): symbol is string => Boolean(symbol)),
  ),
];

export const CURATED_STOCK_SET = new Set(CURATED_STOCK_SYMBOLS.map((symbol) => normalizeMarketLookupKey(symbol)));

export const CURATED_INDEX_NAME_TO_SYMBOL: Record<string, string> = {
  "NIFTY 50": "NIFTY",
  "BSE SENSEX": "SENSEX",
  "INDIA VIX": "INDIAVIX",
  "NIFTY BANK": "BANKNIFTY",
  "NIFTY NEXT 50": "NIFTYNXT50",
  "NIFTY 100": "NIFTY100",
  "NIFTY 200": "NIFTY200",
  "NIFTY 500": "NIFTY500",
  "NIFTY MIDCAP 50": "NIFTY_MIDCAP_50",
  "NIFTY MIDCAP 100": "NIFTYMIDCAP100",
  "NIFTY MIDCAP 150": "NIFTYMIDCAP150",
  "NIFTY SMALLCAP 50": "NIFTYSMLCAP50",
  "NIFTY SMALLCAP 100": "NIFTYSMLCAP100",
  "NIFTY SMALLCAP 250": "NIFTYSMLCAP250",
  "NIFTY FINANCIAL SERVICES": "FINNIFTY",
  "NIFTY IT": "NIFTYIT",
  "NIFTY AUTO": "NIFTYAUTO",
  "NIFTY PHARMA": "NIFTYPHARMA",
  "NIFTY FMCG": "NIFTYFMCG",
  "NIFTY METAL": "NIFTYMETAL",
  "NIFTY REALTY": "NIFTYREALTY",
  "NIFTY ENERGY": "NIFTYENERGY",
  "NIFTY INFRASTRUCTURE": "NIFTYINFRA",
  "NIFTY MEDIA": "NIFTYMEDIA",
  "NIFTY PSU BANK": "NIFTYPSUBANK",
  "NIFTY PRIVATE BANK": "NIFTYPVTBANK",
};

export const CURATED_INDEX_NAMES = new Set(
  Object.keys(CURATED_INDEX_NAME_TO_SYMBOL).map((name) => normalizeMarketLookupKey(name)),
);
export const CURATED_INDEX_SYMBOLS = new Set([
  ...Object.values(CURATED_INDEX_NAME_TO_SYMBOL).map((symbol) => normalizeMarketLookupKey(symbol)),
  "NIFTYMID50",
  "NIFTYNEXT50",
  "NIFTYMIDCAP50",
  "NIFTYMIDCAP50",
  "NIFTY_MIDCAP_50",
  "NIFTYFINSERVICE",
  "NIFTYFINANCIALSERVICES",
]);
export const CURATED_INDEX_LABELS = Object.fromEntries(
  Object.entries(CURATED_INDEX_NAME_TO_SYMBOL).map(([name, symbol]) => [symbol, name]),
);

export function normalizeMarketLookupKey(value?: string | null): string {
  return normalizeApprovedStockKey(value);
}

export function isCuratedStockEntry(symbol?: string | null, fallback?: string | null): boolean {
  const keys = [symbol, fallback].filter((value): value is string => Boolean(value)).map(normalizeMarketLookupKey);
  return keys.some((key) => CURATED_STOCK_SET.has(key));
}

export function isCuratedIndexEntry(symbol?: string | null, name?: string | null): boolean {
  const keys = [symbol, name].filter((value): value is string => Boolean(value)).map(normalizeMarketLookupKey);
  return keys.some((key) => CURATED_INDEX_SYMBOLS.has(key) || CURATED_INDEX_NAMES.has(key));
}
