import { canonicalIndexSymbol, classifyInstrument, hasActiveInstrumentExpiry, isCashEquityListing, isProductionInstrument } from "@/lib/instrumentClassification";
import type { Instrument } from "@/lib/localDatabase";

function normalizeSymbol(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function resolveCashEquityUniverse(instruments: readonly Instrument[]): Instrument[] {
  const listings = new Map<string, Instrument>();
  for (const instrument of instruments) {
    if (
      !["NSE_EQ", "BSE_EQ"].includes(instrument.exchangeSegment) ||
      !isProductionInstrument(instrument) ||
      !isCashEquityListing(instrument)
    ) continue;

    const companyName = normalizeSymbol(instrument.displayName || instrument.symbol)
      .replace(/(PRIVATE|LIMITED|LTD|PVT|COMPANY|CO)+$/, "");
    const identity = companyName || `${instrument.exchangeSegment}:${instrument.providerInstrumentId ?? instrument.securityId}`;
    const current = listings.get(identity);
    if (!current || (instrument.exchangeSegment === "NSE_EQ" && current.exchangeSegment !== "NSE_EQ")) {
      listings.set(identity, instrument);
    }
  }

  return [...listings.values()].sort((left, right) =>
    left.tradingSymbol.localeCompare(right.tradingSymbol) ||
    left.exchangeSegment.localeCompare(right.exchangeSegment) ||
    left.securityId.localeCompare(right.securityId),
  );
}

export interface CashEquityActivityQuote {
  ltp: number;
  volume: number | null;
  tradedValue?: number | null;
  timestamp: string;
}

export function rankCashEquitiesByActivity(
  instruments: readonly Instrument[],
  quotes: ReadonlyMap<string, CashEquityActivityQuote>,
  limit = 100,
): Instrument[] {
  if (!Number.isInteger(limit) || limit < 1) return [];

  const available = instruments.flatMap((instrument) => {
    const key = `${instrument.exchangeSegment}:${instrument.tradingSymbol}`;
    const quote = quotes.get(key);
    if (
      !quote ||
      !Number.isFinite(quote.ltp) ||
      quote.ltp <= 0 ||
      !Number.isFinite(quote.volume) ||
      (quote.volume ?? 0) < 0 ||
      !Number.isFinite(Date.parse(quote.timestamp))
    ) return [];
    return [{ instrument, quote }];
  });
  const hasCompleteTurnover = available.length > 0 &&
    available.every(({ quote }) => Number.isFinite(quote.tradedValue) && (quote.tradedValue ?? 0) > 0);

  return available
    .sort((left, right) => {
      const leftActivity = hasCompleteTurnover ? left.quote.tradedValue! : left.quote.volume ?? 0;
      const rightActivity = hasCompleteTurnover ? right.quote.tradedValue! : right.quote.volume ?? 0;
      return rightActivity - leftActivity ||
        left.instrument.tradingSymbol.localeCompare(right.instrument.tradingSymbol);
    })
    .slice(0, limit)
    .map(({ instrument }) => instrument);
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
