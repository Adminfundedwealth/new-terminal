import { canonicalIndexSymbol, classifyInstrument, isCashEquityListing } from "./instrumentClassification";
import { curatedIndexForInstrument, curatedIndexForSymbol, CURATED_INDICES } from "./curatedMarketLists";
import type { Instrument } from "./localDatabase";

const WATCHLIST_SYMBOL_ALIASES: Record<string, string> = {
  TATAMOTORS: "TMPV",
};
const INDEX_SYMBOLS = new Set([...CURATED_INDICES.map((index) => index.symbol), "INDIAVIX", "MIDCPNIFTY", "NIFTY_MIDCAP_50"]);

export function findWatchlistInstrument(instruments: Instrument[], symbol: string): Instrument | undefined {
  const canonicalSymbol = canonicalIndexSymbol(symbol).toUpperCase();
  const curatedIndex = curatedIndexForSymbol(symbol);
  const category = INDEX_SYMBOLS.has(canonicalSymbol) ? "indices" : "stocks";
  const lookupSymbol = WATCHLIST_SYMBOL_ALIASES[canonicalSymbol] ?? canonicalSymbol;
  const normalizedSymbol = lookupSymbol.replace(/[^A-Z0-9]/g, "");

  return instruments.find((instrument) => {
    if (classifyInstrument(instrument) !== category) return false;
    if (category === "stocks" && !isCashEquityListing(instrument)) return false;
    if (curatedIndex) return curatedIndexForInstrument(instrument.tradingSymbol, instrument.symbol, instrument.displayName)?.symbol === curatedIndex.symbol;
    return [instrument.symbol, instrument.tradingSymbol].some((value) =>
      (category === "indices" ? canonicalIndexSymbol(value) : value).toUpperCase().replace(/[^A-Z0-9]/g, "") === normalizedSymbol
    );
  });
}
