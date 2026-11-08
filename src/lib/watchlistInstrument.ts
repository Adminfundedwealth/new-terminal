import { canonicalIndexSymbol, classifyInstrument, isProductionInstrument } from "./instrumentClassification";
import { CURATED_INDEX_SYMBOLS, LEGACY_STOCK_SYMBOL_ALIASES } from "./curatedMarketLists";
import { selectConfiguredStocks } from "./marketDirectories";
import type { Instrument } from "./localDatabase";

const INDEX_SYMBOLS = new Set([...CURATED_INDEX_SYMBOLS, "INDIAVIX", "NIFTY_MIDCAP_50", "SENSEX"]);

export function findWatchlistInstrument(instruments: Instrument[], symbol: string): Instrument | undefined {
  const canonicalSymbol = canonicalIndexSymbol(symbol).toUpperCase();
  const isMasterIndex = instruments.some((instrument) =>
    classifyInstrument(instrument) === "indices" &&
    [instrument.symbol, instrument.tradingSymbol].some((value) =>
      canonicalIndexSymbol(value).toUpperCase().replace(/[^A-Z0-9]/g, "") ===
        canonicalSymbol.replace(/[^A-Z0-9]/g, "")
    )
  );
  const category = INDEX_SYMBOLS.has(canonicalSymbol) || isMasterIndex ? "indices" : "stocks";
  const lookupSymbol = LEGACY_STOCK_SYMBOL_ALIASES[canonicalSymbol] ?? canonicalSymbol;
  const normalizedSymbol = lookupSymbol.replace(/[^A-Z0-9]/g, "");
  const configuredInstruments = category === "indices"
    ? instruments.filter((instrument) =>
      classifyInstrument(instrument) === "indices" &&
      instrument.provider === "dhan" &&
      isProductionInstrument(instrument)
    )
    : selectConfiguredStocks(instruments);

  return configuredInstruments.find((instrument) => {
    return [instrument.symbol, instrument.tradingSymbol].some((value) =>
      (category === "indices" ? canonicalIndexSymbol(value) : value).toUpperCase().replace(/[^A-Z0-9]/g, "") === normalizedSymbol
    );
  });
}
