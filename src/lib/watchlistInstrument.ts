import { canonicalIndexSymbol, classifyInstrument, isCashEquityListing } from "./instrumentClassification";
import type { Instrument } from "./localDatabase";

const WATCHLIST_SYMBOL_ALIASES: Record<string, string> = {
  TATAMOTORS: "TMPV",
};
const INDEX_SYMBOLS = new Set(["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "INDIAVIX", "NIFTY_MIDCAP_50", "SENSEX"]);

export function findWatchlistInstrument(instruments: Instrument[], symbol: string): Instrument | undefined {
  const canonicalSymbol = canonicalIndexSymbol(symbol).toUpperCase();
  const category = INDEX_SYMBOLS.has(canonicalSymbol) ? "indices" : "stocks";
  const lookupSymbol = WATCHLIST_SYMBOL_ALIASES[canonicalSymbol] ?? canonicalSymbol;
  const normalizedSymbol = lookupSymbol.replace(/[^A-Z0-9]/g, "");

  return instruments.find((instrument) => {
    if (classifyInstrument(instrument) !== category) return false;
    if (category === "stocks" && !isCashEquityListing(instrument)) return false;
    return [instrument.symbol, instrument.tradingSymbol].some((value) =>
      (category === "indices" ? canonicalIndexSymbol(value) : value).toUpperCase().replace(/[^A-Z0-9]/g, "") === normalizedSymbol
    );
  });
}
