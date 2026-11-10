import { APPROVED_200_STOCKS } from "./approvedInstruments";

export interface CuratedStock {
  symbol: string;
  name: string;
}

/**
 * Derived from the canonical APPROVED_200_STOCKS universe.
 * Do NOT maintain a separate list here — always derive from approvedInstruments.ts.
 */
export const CURATED_STOCKS: CuratedStock[] = APPROVED_200_STOCKS.map(stock => ({
  symbol: stock.symbol,
  name: stock.name,
}));

export interface CuratedIndex {
  symbol: string;
  name: string;
  providerAliases: string[];
}

export const CURATED_INDICES: CuratedIndex[] = [
  { symbol: "NIFTY", name: "NIFTY 50", providerAliases: ["NIFTY 50", "NIFTY50"] },
  { symbol: "SENSEX", name: "BSE SENSEX", providerAliases: ["SENSEX", "BSE SENSEX"] },
  { symbol: "BANKNIFTY", name: "NIFTY BANK", providerAliases: ["NIFTY BANK", "NIFTYBANK"] },
  { symbol: "NIFTYNXT50", name: "NIFTY NEXT 50", providerAliases: ["NIFTY NEXT 50", "NIFTYNEXT50"] },
  { symbol: "NIFTY100", name: "NIFTY 100", providerAliases: ["NIFTY 100", "NIFTY100"] },
  { symbol: "NIFTY200", name: "NIFTY 200", providerAliases: ["NIFTY 200", "NIFTY200"] },
  { symbol: "NIFTY500", name: "NIFTY 500", providerAliases: ["NIFTY 500", "NIFTY500"] },
  { symbol: "NIFTYMID50", name: "NIFTY MIDCAP 50", providerAliases: ["NIFTY MIDCAP 50", "NIFTY_MIDCAP_50", "NIFTYMID50"] },
  { symbol: "NIFTYMIDCAP100", name: "NIFTY MIDCAP 100", providerAliases: ["NIFTY MIDCAP 100", "NIFTYMIDCAP100"] },
  { symbol: "NIFTYMIDCAP150", name: "NIFTY MIDCAP 150", providerAliases: ["NIFTY MIDCAP 150", "NIFTYMIDCAP150"] },
  { symbol: "NIFTYSMLCAP50", name: "NIFTY SMALLCAP 50", providerAliases: ["NIFTY SMALLCAP 50", "NIFTYSMLCAP50"] },
  { symbol: "NIFTYSMLCAP100", name: "NIFTY SMALLCAP 100", providerAliases: ["NIFTY SMALLCAP 100", "NIFTYSMLCAP100"] },
  { symbol: "NIFTYSMLCAP250", name: "NIFTY SMALLCAP 250", providerAliases: ["NIFTY SMALLCAP 250", "NIFTYSMLCAP250"] },
  { symbol: "FINNIFTY", name: "NIFTY FINANCIAL SERVICES", providerAliases: ["NIFTY FINANCIAL SERVICES", "NIFTY FIN SERVICE", "FINNIFTY"] },
  { symbol: "NIFTYIT", name: "NIFTY IT", providerAliases: ["NIFTY IT", "NIFTYIT"] },
  { symbol: "NIFTYAUTO", name: "NIFTY AUTO", providerAliases: ["NIFTY AUTO", "NIFTYAUTO"] },
  { symbol: "NIFTYPHARMA", name: "NIFTY PHARMA", providerAliases: ["NIFTY PHARMA", "NIFTYPHARMA"] },
  { symbol: "NIFTYFMCG", name: "NIFTY FMCG", providerAliases: ["NIFTY FMCG", "NIFTYFMCG"] },
  { symbol: "NIFTYMETAL", name: "NIFTY METAL", providerAliases: ["NIFTY METAL", "NIFTYMETAL"] },
  { symbol: "NIFTYREALTY", name: "NIFTY REALTY", providerAliases: ["NIFTY REALTY", "NIFTYREALTY"] },
  { symbol: "NIFTYENERGY", name: "NIFTY ENERGY", providerAliases: ["NIFTY ENERGY", "NIFTYENERGY"] },
  { symbol: "NIFTYINFRA", name: "NIFTY INFRASTRUCTURE", providerAliases: ["NIFTY INFRASTRUCTURE", "NIFTY INFRA", "NIFTYINFRA"] },
  { symbol: "NIFTYMEDIA", name: "NIFTY MEDIA", providerAliases: ["NIFTY MEDIA", "NIFTYMEDIA"] },
  { symbol: "NIFTYPSUBANK", name: "NIFTY PSU BANK", providerAliases: ["NIFTY PSU BANK", "NIFTYPSUBANK"] },
  { symbol: "NIFTYPVTBANK", name: "NIFTY PRIVATE BANK", providerAliases: ["NIFTY PRIVATE BANK", "NIFTY PVT BANK", "NIFTYPVTBANK"] },
];

const normalize = (value: string | null | undefined) => (value ?? "").replace(/[^A-Z0-9]/gi, "").toUpperCase();
const STOCK_SYMBOLS = new Map(CURATED_STOCKS.map((stock) => [normalize(stock.symbol), stock]));
const STOCK_ALIAS_TO_SYMBOL = new Map<string, string>();
const INDEX_ALIASES = new Map<string, CuratedIndex>();

for (const index of CURATED_INDICES) {
  for (const alias of [index.symbol, index.name, ...index.providerAliases]) {
    INDEX_ALIASES.set(normalize(alias), index);
  }
}

export function curatedStockForInstrument(...values: Array<string | null | undefined>): CuratedStock | undefined {
  for (const value of values) {
    const key = normalize(value);
    const stock = STOCK_SYMBOLS.get(STOCK_ALIAS_TO_SYMBOL.get(key) ?? key);
    if (stock) return stock;
  }
  return undefined;
}

export function curatedIndexForSymbol(value: string | null | undefined): CuratedIndex | undefined {
  return INDEX_ALIASES.get(normalize(value));
}

export function curatedIndexForInstrument(...values: Array<string | null | undefined>): CuratedIndex | undefined {
  for (const value of values) {
    const index = curatedIndexForSymbol(value);
    if (index) return index;
  }
  return undefined;
}

export function canonicalCuratedStockSymbol(value: string): string {
  return value;
}

export function rankRowsByVolume<T extends { symbol: string; chartSymbol?: string }>(
  rows: T[],
  quotes: Record<string, { volume?: number | null } | undefined>,
): T[] {
  return rows
    .map((row, index) => ({
      row,
      index,
      volume: quotes[row.chartSymbol ?? row.symbol]?.volume,
    }))
    .sort((a, b) => {
      const aHasVolume = Number.isFinite(a.volume) && (a.volume ?? -1) >= 0;
      const bHasVolume = Number.isFinite(b.volume) && (b.volume ?? -1) >= 0;
      if (aHasVolume && bHasVolume) return (b.volume ?? 0) - (a.volume ?? 0) || a.index - b.index;
      if (aHasVolume) return -1;
      if (bHasVolume) return 1;
      return a.index - b.index;
    })
    .map(({ row }) => row);
}
