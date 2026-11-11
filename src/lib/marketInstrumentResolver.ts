import { APPROVED_200_STOCKS, getUnderlyingFromTradingSymbol, type ApprovedStock } from "@/lib/approvedInstruments";
import type { ApprovedIndex } from "@/lib/approvedIndices";
import { canonicalIndexSymbol, classifyInstrument, isCashEquityListing, isProductionInstrument } from "@/lib/instrumentClassification";
import type { Instrument } from "@/lib/localDatabase";
import { findWatchlistInstrument } from "@/lib/watchlistInstrument";

function normalizeSymbol(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export interface ResolvedApprovedStock {
  stock: ApprovedStock;
  instrument?: Instrument;
}

export function resolveApprovedStockUniverse(instruments: readonly Instrument[]): ResolvedApprovedStock[] {
  const approvedSymbols = new Map<string, string>();
  for (const stock of APPROVED_200_STOCKS) {
    approvedSymbols.set(normalizeSymbol(stock.symbol), stock.symbol);
    approvedSymbols.set(normalizeSymbol(stock.dhanSymbol), stock.symbol);
  }

  const bySymbol = new Map<string, Instrument>();
  for (const instrument of instruments) {
    if (
      instrument.exchangeSegment !== "NSE_EQ" ||
      !isProductionInstrument(instrument) ||
      !isCashEquityListing(instrument)
    ) continue;

    const approvedSymbol = [instrument.symbol, instrument.tradingSymbol]
      .map(normalizeSymbol)
      .map((symbol) => approvedSymbols.get(symbol))
      .find((symbol): symbol is string => Boolean(symbol));
    if (approvedSymbol && !bySymbol.has(approvedSymbol)) bySymbol.set(approvedSymbol, instrument);
  }

  return APPROVED_200_STOCKS.map((stock) => {
    const instrument = bySymbol.get(stock.symbol)
      ?? findWatchlistInstrument(instruments, stock.symbol);
    return {
      stock,
      instrument: instrument?.exchangeSegment === "NSE_EQ" ? instrument : undefined,
    };
  });
}

export function findApprovedIndexInstrument(
  instruments: readonly Instrument[],
  index: Pick<ApprovedIndex, "symbol" | "segment">,
): Instrument | undefined {
  const canonicalSymbol = canonicalIndexSymbol(index.symbol).toUpperCase();
  return instruments.find((instrument) => {
    if (
      !isProductionInstrument(instrument) ||
      classifyInstrument(instrument) !== "indices" ||
      instrument.exchangeSegment !== index.segment
    ) return false;
    return [instrument.symbol, instrument.tradingSymbol].some(
      (symbol) => canonicalIndexSymbol(symbol).toUpperCase() === canonicalSymbol,
    );
  });
}

export function findDhanOptionInstrument(
  instruments: readonly Instrument[],
  option: {
    underlying: string;
    expiry: string;
    strike: number;
    optionType: "CE" | "PE";
    underlyingSecurityId?: string;
  },
): Instrument | undefined {
  const underlying = normalizeSymbol(option.underlying);
  const canonicalUnderlying = normalizeSymbol(canonicalIndexSymbol(option.underlying));
  return instruments.find((instrument) => {
    if (
      instrument.provider !== "dhan" ||
      classifyInstrument(instrument) !== "options" ||
      instrument.expiryDate !== option.expiry ||
      instrument.strikePrice !== option.strike ||
      instrument.optionType !== option.optionType
    ) return false;

    if (option.underlyingSecurityId && instrument.underlyingSecurityId) {
      return instrument.underlyingSecurityId === option.underlyingSecurityId;
    }

    const rawInstrumentUnderlying = getUnderlyingFromTradingSymbol(instrument.tradingSymbol) ?? instrument.symbol;
    const instrumentUnderlying = normalizeSymbol(rawInstrumentUnderlying);
    const canonicalInstrumentUnderlying = normalizeSymbol(canonicalIndexSymbol(rawInstrumentUnderlying));
    return instrumentUnderlying === underlying || canonicalInstrumentUnderlying === canonicalUnderlying;
  });
}
