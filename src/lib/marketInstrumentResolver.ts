import { canonicalIndexSymbol, classifyInstrument, hasActiveInstrumentExpiry, isCashEquityListing, isProductionInstrument } from "@/lib/instrumentClassification";
import type { Instrument } from "@/lib/localDatabase";

function normalizeSymbol(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function resolveCashEquityUniverse(instruments: readonly Instrument[]): Instrument[] {
  const unique = new Map<string, Instrument>();
  for (const instrument of instruments) {
    if (
      !["NSE_EQ", "BSE_EQ"].includes(instrument.exchangeSegment) ||
      !isProductionInstrument(instrument) ||
      !isCashEquityListing(instrument)
    ) continue;

    const identity = `${instrument.exchangeSegment}:${instrument.providerInstrumentId ?? instrument.securityId}`;
    if (!unique.has(identity)) unique.set(identity, instrument);
  }

  return [...unique.values()].sort((left, right) =>
    left.tradingSymbol.localeCompare(right.tradingSymbol) ||
    left.exchangeSegment.localeCompare(right.exchangeSegment) ||
    left.securityId.localeCompare(right.securityId),
  );
}

export function resolveIndianIndexUniverse(instruments: readonly Instrument[]): Instrument[] {
  const unique = new Map<string, Instrument>();
  for (const instrument of instruments) {
    if (!isProductionInstrument(instrument) || classifyInstrument(instrument) !== "indices") continue;
    const identity = `${instrument.exchangeSegment}:${instrument.providerInstrumentId ?? instrument.securityId}`;
    if (!unique.has(identity)) unique.set(identity, instrument);
  }

  return [...unique.values()].sort((left, right) =>
    left.tradingSymbol.localeCompare(right.tradingSymbol) ||
    left.exchangeSegment.localeCompare(right.exchangeSegment) ||
    left.securityId.localeCompare(right.securityId),
  );
}

export function resolveOptionChainUnderlyings(
  instruments: readonly Instrument[],
  instrumentType: "OPTIDX" | "OPTSTK",
): string[] {
  return [...new Set(instruments
    .filter((instrument) =>
      isProductionInstrument(instrument) &&
      instrument.instrumentType === instrumentType &&
      classifyInstrument(instrument) === "options" &&
      hasActiveInstrumentExpiry(instrument.expiryDate),
    )
    .map((instrument) => instrument.symbol.trim().toUpperCase())
    .filter(Boolean))].sort();
}

export function findDhanOptionInstrument(
  instruments: readonly Instrument[],
  option: {
    underlying: string;
    expiry: string;
    strike: number;
    optionType: "CE" | "PE";
    underlyingSecurityId?: string;
    exchange?: string;
  },
): Instrument | undefined {
  const underlying = normalizeSymbol(option.underlying);
  const canonicalUnderlying = normalizeSymbol(canonicalIndexSymbol(option.underlying));
  const expiryDay = option.expiry.slice(0, 10);
  return instruments.find((instrument) => {
    if (
      instrument.provider !== "dhan" ||
      classifyInstrument(instrument) !== "options" ||
      (option.exchange && instrument.exchange !== option.exchange) ||
      (instrument.expiryDate ?? "").slice(0, 10) !== expiryDay ||
      Number(instrument.strikePrice) !== option.strike ||
      instrument.optionType !== option.optionType
    ) return false;

    if (option.underlyingSecurityId && instrument.underlyingSecurityId) {
      return instrument.underlyingSecurityId === option.underlyingSecurityId;
    }

    const instrumentUnderlying = normalizeSymbol(canonicalIndexSymbol(instrument.symbol));
    if (instrumentUnderlying === underlying || instrumentUnderlying === canonicalUnderlying) return true;

    const rawTradingSymbol = instrument.tradingSymbol.trim().toUpperCase();
    const tradingSymbol = normalizeSymbol(rawTradingSymbol);
    const contractUnderlying = normalizeSymbol(rawTradingSymbol.split(/[-\s]/, 1)[0]);
    if (contractUnderlying === underlying || contractUnderlying === canonicalUnderlying) return true;
    return [underlying, canonicalUnderlying].some((candidate) => {
      if (!tradingSymbol.startsWith(candidate)) return false;
      return /^\d/.test(tradingSymbol.slice(candidate.length));
    });
  });
}
