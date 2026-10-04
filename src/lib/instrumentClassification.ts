import type { Instrument } from "./localDatabase";

export type InstrumentCategory = "stocks" | "indices" | "futures" | "options";

const EQUITY_SEGMENTS = new Set(["NSE_EQ", "BSE_EQ"]);
const INDEX_SEGMENTS = new Set(["IDX_I", "BSE_IDX"]);

function normalized(value: string | undefined): string {
  return (value || "").trim().toUpperCase();
}

export function classifyInstrument(instrument: Instrument): InstrumentCategory | null {
  const segment = normalized(instrument.exchangeSegment);
  const type = normalized(instrument.instrumentType);

  if (type === "FUTSTK" || type === "FUTIDX") return "futures";
  if (type === "OPTSTK" || type === "OPTIDX") {
    if (!instrument.expiryDate || !instrument.strikePrice || !["CE", "PE"].includes(normalized(instrument.optionType))) return null;
    return "options";
  }
  if (INDEX_SEGMENTS.has(segment) && (type === "INDEX" || type === "INDEXFUT" || type === "INDEXOPT")) return "indices";
  if (EQUITY_SEGMENTS.has(segment) && type === "EQUITY") return "stocks";
  return null;
}

export function isProductionInstrument(instrument: Instrument | Partial<Instrument>): boolean {
  // Filter out test/demo/synthetic instruments
  // Production instruments should have valid trading symbols and not be marked as test
  if (!instrument?.symbol && !instrument?.tradingSymbol) return false;
  
  const symbol = (instrument.symbol || instrument.tradingSymbol || "").toUpperCase();
  const tradingSymbol = (instrument.tradingSymbol || "").toUpperCase();
  
  // Exclude common test prefixes/patterns
  if (symbol.startsWith("TEST") || symbol.startsWith("DEMO") || symbol.startsWith("SYNTH")) return false;
  if (tradingSymbol.startsWith("TEST") || tradingSymbol.startsWith("DEMO")) return false;
  
  return true;
}

export function isTradableContract(instrument: Instrument, category?: InstrumentCategory): boolean {
  const actualCategory = classifyInstrument(instrument);
  if (!actualCategory || (category && actualCategory !== category)) return false;
  if (actualCategory === "futures") return Boolean(instrument.expiryDate && instrument.lotSize > 0);
  if (actualCategory === "options") {
    return Boolean(instrument.expiryDate && instrument.strikePrice && instrument.lotSize > 0 && ["CE", "PE"].includes(normalized(instrument.optionType)));
  }
  return Boolean(instrument.securityId && instrument.tradingSymbol && instrument.lotSize > 0);
}

export function validateInstrumentForOrder(instrument: Instrument | undefined, category: InstrumentCategory): string | null {
  if (!instrument) return "Instrument was not found in the instrument master";
  if (!isTradableContract(instrument, category)) return `Instrument is not a valid ${category} contract`;
  if ((category === "futures" || category === "options") && instrument.expiryDate) {
    const expiry = new Date(instrument.expiryDate);
    if (!Number.isNaN(expiry.getTime()) && expiry.getTime() < Date.now()) return "Instrument contract has expired";
  }
  return null;
}