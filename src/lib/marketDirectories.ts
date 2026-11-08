import {
  canonicalIndexSymbol,
  classifyInstrument,
  isNseCashEquityListing,
  isProductionInstrument,
  isTradableContract,
} from "./instrumentClassification";
import {
  CURATED_INDEX_NAME_TO_SYMBOL,
  CURATED_STOCK_SYMBOLS,
  normalizeMarketLookupKey,
  resolveApprovedStockSymbol,
} from "./curatedMarketLists";
import type { Instrument } from "./localDatabase";

function hasCanonicalDhanIdentity(instrument: Instrument): boolean {
  return instrument.provider === "dhan" &&
    /^\d+$/.test(instrument.securityId) &&
    instrument.providerInstrumentId === instrument.securityId;
}

const stockSymbolByKey = new Map(
  CURATED_STOCK_SYMBOLS.map((symbol) => [normalizeMarketLookupKey(symbol), symbol]),
);

export function selectConfiguredStocks(instruments: Instrument[]): Instrument[] {
  const selected = new Map<string, Instrument>();
  const usedSecurityIds = new Set<string>();

  for (const instrument of instruments) {
    if (
      !hasCanonicalDhanIdentity(instrument) ||
      instrument.exchange !== "NSE" ||
      !isProductionInstrument(instrument) ||
      !isNseCashEquityListing(instrument)
    ) continue;

    const key = normalizeMarketLookupKey(instrument.tradingSymbol);
    const configuredSymbol = stockSymbolByKey.get(key);
    if (!configuredSymbol || selected.has(configuredSymbol) || usedSecurityIds.has(instrument.securityId)) continue;
    selected.set(configuredSymbol, instrument);
    usedSecurityIds.add(instrument.securityId);
  }

  return CURATED_STOCK_SYMBOLS.flatMap((symbol) => {
    const instrument = selected.get(symbol);
    return instrument ? [instrument] : [];
  });
}

export function getMissingConfiguredStockSymbols(instruments: Instrument[]): string[] {
  const mapped = new Set(selectConfiguredStocks(instruments).map((instrument) => instrument.tradingSymbol));
  return CURATED_STOCK_SYMBOLS.filter((symbol) => !mapped.has(symbol));
}

const indexSymbolByKey = new Map<string, string>();
for (const [name, symbol] of Object.entries(CURATED_INDEX_NAME_TO_SYMBOL)) {
  for (const value of [name, symbol]) {
    indexSymbolByKey.set(
      normalizeMarketLookupKey(canonicalIndexSymbol(value)),
      symbol,
    );
  }
}

export function selectConfiguredIndices(instruments: Instrument[]): Array<{ instrument: Instrument; symbol: string }> {
  const selected = new Map<string, { instrument: Instrument; symbol: string }>();
  const usedSecurityIds = new Set<string>();

  for (const instrument of instruments) {
    if (
      !hasCanonicalDhanIdentity(instrument) ||
      !["NSE", "BSE"].includes(instrument.exchange ?? "") ||
      !["IDX_I", "BSE_IDX"].includes(instrument.exchangeSegment) ||
      (instrument.exchangeSegment === "IDX_I" && !["NSE", "BSE"].includes(instrument.exchange ?? "")) ||
      (instrument.exchangeSegment === "BSE_IDX" && instrument.exchange !== "BSE") ||
      classifyInstrument(instrument) !== "indices" ||
      !isProductionInstrument(instrument)
    ) continue;

    const candidates = [instrument.tradingSymbol, instrument.symbol, instrument.displayName];
    const symbol = candidates
      .map((value) => normalizeMarketLookupKey(canonicalIndexSymbol(value ?? "")))
      .map((key) => indexSymbolByKey.get(key))
      .find((value): value is string => value !== undefined);
    if (!symbol || selected.has(symbol) || usedSecurityIds.has(instrument.securityId)) continue;
    selected.set(symbol, { instrument, symbol });
    usedSecurityIds.add(instrument.securityId);
  }

  return Object.values(CURATED_INDEX_NAME_TO_SYMBOL).flatMap((symbol) => {
    const entry = selected.get(symbol);
    return entry ? [entry] : [];
  });
}

function selectSupportedIndices(instruments: Instrument[]): Array<{ instrument: Instrument; symbol: string }> {
  const selected = new Map<string, { instrument: Instrument; symbol: string }>();
  const usedSecurityIds = new Set<string>();

  for (const instrument of instruments) {
    if (
      !hasCanonicalDhanIdentity(instrument) ||
      !["NSE", "BSE"].includes(instrument.exchange ?? "") ||
      !["IDX_I", "BSE_IDX"].includes(instrument.exchangeSegment) ||
      (instrument.exchangeSegment === "BSE_IDX" && instrument.exchange !== "BSE") ||
      classifyInstrument(instrument) !== "indices" ||
      !isProductionInstrument(instrument)
    ) continue;

    const candidates = [instrument.tradingSymbol, instrument.symbol, instrument.displayName];
    const knownSymbol = candidates
      .map((value) => normalizeMarketLookupKey(canonicalIndexSymbol(value ?? "")))
      .map((key) => indexSymbolByKey.get(key))
      .find((value): value is string => value !== undefined);
    const symbol = knownSymbol ?? canonicalIndexSymbol(instrument.tradingSymbol).trim().toUpperCase();
    if (!symbol || selected.has(symbol) || usedSecurityIds.has(instrument.securityId)) continue;
    selected.set(symbol, { instrument, symbol });
    usedSecurityIds.add(instrument.securityId);
  }

  return [...selected.values()];
}

export interface ConfiguredDerivative {
  instrument: Instrument;
  underlyingSymbol: string;
}

function dateKeyInIndia(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function normalizeContractExpiry(value?: string): string | undefined {
  if (!value) return undefined;
  const isoDate = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoDate && !Number.isNaN(Date.parse(`${isoDate[1]}T00:00:00Z`))) return isoDate[1];
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : dateKeyInIndia(new Date(timestamp));
}

function resolveSupportedIndexSymbol(
  value: string | undefined,
  symbolByKey: Map<string, string>,
): string | undefined {
  if (!value) return undefined;
  const canonicalValue = canonicalIndexSymbol(value).trim().toUpperCase();
  const fullKey = normalizeMarketLookupKey(canonicalValue);
  const direct = symbolByKey.get(fullKey);
  if (direct) return direct;
  const baseKey = normalizeMarketLookupKey(canonicalIndexSymbol(canonicalValue.split(/\s+/)[0]));
  const base = symbolByKey.get(baseKey);
  if (base) return base;
  let longestPrefixLength = 0;
  let prefixSymbol: string | undefined;
  for (const [key, symbol] of symbolByKey) {
    if (key.length <= longestPrefixLength || !fullKey.startsWith(key)) continue;
    let consumedCharacters = 0;
    let sourcePosition = 0;
    while (sourcePosition < canonicalValue.length && consumedCharacters < key.length) {
      if (/[A-Z0-9]/.test(canonicalValue[sourcePosition])) consumedCharacters += 1;
      sourcePosition += 1;
    }
    const hasContractBoundary = sourcePosition === canonicalValue.length ||
      /[\s_-]/.test(canonicalValue[sourcePosition]) ||
      /\d/.test(canonicalValue[sourcePosition]);
    if (consumedCharacters === key.length && hasContractBoundary) {
      longestPrefixLength = key.length;
      prefixSymbol = symbol;
    }
  }
  return prefixSymbol;
}

function filterConfiguredDerivatives(
  instruments: Instrument[],
  category: "futures" | "options",
  now: Date,
): ConfiguredDerivative[] {
  const stocks = selectConfiguredStocks(instruments);
  const stockSymbolById = new Map(stocks.map((instrument) => [instrument.securityId, instrument.tradingSymbol]));
  const indices = selectSupportedIndices(instruments);
  const indexSymbolById = new Map(indices.map(({ instrument, symbol }) => [instrument.securityId, symbol]));
  const indexSymbolByKey = new Map<string, string>();
  for (const { instrument, symbol } of indices) {
    for (const value of [instrument.tradingSymbol, instrument.symbol, instrument.displayName, symbol]) {
      if (value) indexSymbolByKey.set(normalizeMarketLookupKey(canonicalIndexSymbol(value)), symbol);
    }
  }
  const today = dateKeyInIndia(now);
  const selected = new Map<string, ConfiguredDerivative>();
  const usedSecurityIds = new Set<string>();

  for (const instrument of instruments) {
    if (
      !hasCanonicalDhanIdentity(instrument) ||
      !(
        instrument.exchange === "NSE" && instrument.exchangeSegment === "NSE_FNO" ||
        instrument.exchange === "BSE" && instrument.exchangeSegment === "BSE_FNO"
      ) ||
      classifyInstrument(instrument) !== category ||
      !isTradableContract(instrument, category)
    ) continue;

    const expiry = normalizeContractExpiry(instrument.expiryDate);
    if (!expiry || expiry < today) continue;

    const stockUnderlying = instrument.exchangeSegment === "NSE_FNO" && instrument.underlyingSecurityId
      ? stockSymbolById.get(instrument.underlyingSecurityId)
      : undefined;
    const indexUnderlying = instrument.underlyingSecurityId
      ? indexSymbolById.get(instrument.underlyingSecurityId)
      : undefined;
    if (
      instrument.underlyingSecurityId &&
      (
        ["FUTSTK", "OPTSTK"].includes(instrument.instrumentType ?? "") && !stockUnderlying ||
        ["FUTIDX", "OPTIDX"].includes(instrument.instrumentType ?? "") && !indexUnderlying
      )
    ) continue;
    const candidates = [
      instrument.symbol,
      instrument.displayName,
      instrument.tradingSymbol,
    ];
    const stockCandidates = instrument.exchangeSegment === "NSE_FNO"
      ? candidates.map(resolveApprovedStockSymbol)
      : [];
    const underlyingSymbol = stockUnderlying ??
      stockCandidates.find((symbol) => symbol !== undefined) ??
      indexUnderlying ??
      candidates.map((candidate) => resolveSupportedIndexSymbol(candidate, indexSymbolByKey))
        .find((symbol) => symbol !== undefined);
    if (!underlyingSymbol || usedSecurityIds.has(instrument.securityId)) continue;

    const stockContract = stockUnderlying !== undefined ||
      stockCandidates.some((symbol) => symbol !== undefined);
    const indexContract = indexUnderlying !== undefined ||
      candidates.some((candidate) => resolveSupportedIndexSymbol(candidate, indexSymbolByKey) !== undefined);
    if (category === "futures" && !stockContract && !indexContract) continue;
    if (stockContract && !stockSymbolByKey.has(normalizeMarketLookupKey(underlyingSymbol))) continue;

    const contractKey = category === "futures"
      ? `${underlyingSymbol}|${expiry}|${instrument.instrumentType}`
      : `${underlyingSymbol}|${expiry}|${instrument.strikePrice}|${instrument.optionType}`;
    if (selected.has(contractKey)) continue;
    selected.set(contractKey, { instrument, underlyingSymbol });
    usedSecurityIds.add(instrument.securityId);
  }

  return [...selected.values()].sort((left, right) =>
    left.underlyingSymbol.localeCompare(right.underlyingSymbol) ||
    (normalizeContractExpiry(left.instrument.expiryDate) ?? "").localeCompare(normalizeContractExpiry(right.instrument.expiryDate) ?? "") ||
    (left.instrument.strikePrice ?? 0) - (right.instrument.strikePrice ?? 0) ||
    (left.instrument.optionType ?? "").localeCompare(right.instrument.optionType ?? ""),
  );
}

export function selectConfiguredDerivatives(
  instruments: Instrument[],
  category: "futures" | "options",
  now = new Date(),
): ConfiguredDerivative[] {
  return filterConfiguredDerivatives(instruments, category, now);
}

export interface OptionChainUnderlying {
  symbol: string;
  label: string;
  securityId: string;
  exchangeSegment: string;
}

export function getConfiguredDerivativeExpiries(
  instruments: Instrument[],
  underlyingSymbol: string,
  category: "futures" | "options" = "options",
  now = new Date(),
): string[] {
  return [...new Set(
    filterConfiguredDerivatives(instruments, category, now)
      .filter(({ underlyingSymbol: symbol }) => symbol === underlyingSymbol)
      .map(({ instrument }) => normalizeContractExpiry(instrument.expiryDate))
      .filter((expiry): expiry is string => expiry !== undefined),
  )].sort();
}

export function selectOptionChainUnderlyings(
  instruments: Instrument[],
  market: "stocks" | "indices",
  now = new Date(),
): OptionChainUnderlying[] {
  const validDerivatives = filterConfiguredDerivatives(instruments, "options", now);
  const allowed = market === "stocks"
    ? new Map(selectConfiguredStocks(instruments).map((instrument) => [instrument.tradingSymbol, instrument]))
    : new Map(selectSupportedIndices(instruments).map(({ instrument, symbol }) => [symbol, instrument]));
  const seen = new Set<string>();
  return validDerivatives.flatMap(({ underlyingSymbol }) => {
    const underlying = allowed.get(underlyingSymbol);
    if (!underlying || seen.has(underlyingSymbol)) return [];
    seen.add(underlyingSymbol);
    return [{
      symbol: underlyingSymbol,
      label: underlyingSymbol,
      securityId: underlying.securityId,
      exchangeSegment: underlying.exchangeSegment,
    }];
  });
}
