import type { Instrument } from "./localDatabase";
import { InstrumentMaster } from "./instrumentMaster";

export type OptionType = "CE" | "PE";
export type OptionChainErrorCode =
  | "MISSING_UNDERLYING"
  | "UNKNOWN_UNDERLYING"
  | "UNSUPPORTED_UNDERLYING"
  | "AMBIGUOUS_UNDERLYING"
  | "INVALID_EXPIRY"
  | "INVALID_STRIKE"
  | "INVALID_OI"
  | "INVALID_QUOTE"
  | "INVALID_CONTRACT"
  | "PROVIDER_UNAVAILABLE";

export interface OptionChainError {
  code: OptionChainErrorCode;
  message: string;
}

export interface OptionChainUnderlying {
  securityId?: string;
  symbol: string;
  exchange?: string;
  instrumentType?: string;
  supported?: boolean;
  error?: OptionChainError;
}

export interface OptionContract {
  instrumentId: string;
  underlyingInstrumentId?: string;
  underlyingSymbol?: string;
  exchange?: string;
  providerInstrumentId?: string;
  expiry?: string;
  strike?: number;
  optionType: OptionType;
  lotSize?: number;
  tickSize?: number;
  tradingSymbol?: string;
  segment?: string;
  oi?: number;
  oiChange?: number;
  volume?: number;
  quote?: OptionQuote;
  greeks?: OptionGreeks;
}

export interface OptionQuote {
  instrumentId?: string;
  providerInstrumentId?: string;
  lastTradedPrice?: number;
  previousClose?: number;
  change?: number;
  changePercent?: number;
  volume?: number;
  timestamp?: string;
}

export interface OptionGreeks {
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  iv?: number;
}

export interface OptionExpiry {
  value: string;
  label: string;
  daysToExpiry: number;
}

export interface OptionChainRow {
  strike: number;
  ce?: OptionContract | null;
  pe?: OptionContract | null;
  ceQuote?: OptionQuote;
  peQuote?: OptionQuote;
  ceOI?: number;
  peOI?: number;
  ceOIChange?: number;
  peOIChange?: number;
  ceVolume?: number;
  peVolume?: number;
  greeks?: { ce?: OptionGreeks; pe?: OptionGreeks };
}

export interface CanonicalOptionChain {
  underlying: OptionChainUnderlying;
  source: "instrument-master" | "provider" | "fallback";
  selectedExpiry?: string;
  expiries: OptionExpiry[];
  rows: OptionChainRow[];
  ts: number;
  error?: OptionChainError;
}

const INDEX_ALIASES: Record<string, string[]> = {
  NIFTY: ["NIFTY", "NIFTY 50"],
  BANKNIFTY: ["BANKNIFTY", "NIFTY BANK"],
  FINNIFTY: ["FINNIFTY", "NIFTY FIN SERVICE", "NIFTY FINANCIAL SERVICES"],
  MIDCPNIFTY: ["MIDCPNIFTY", "NIFTY MIDCAP 50"],
  SENSEX: ["SENSEX"],
  INDIAVIX: ["INDIAVIX", "INDIA VIX"],
};

function normalizeKey(value: string | undefined): string {
  return (value || "").trim().toUpperCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
}

function isOptionInstrument(instrument: Instrument): boolean {
  return ["OPTIDX", "OPTSTK", "OPTFUT", "OPTCUR", "OPT"].includes((instrument.instrumentType || "").toUpperCase()) || Boolean((instrument.optionType || "").toUpperCase() === "CE" || (instrument.optionType || "").toUpperCase() === "PE");
}

function toValidNumber(value: unknown, fallback?: number): number | undefined {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asDateString(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : value;
}

function getInstrumentSymbolCandidates(instrument: Instrument): string[] {
  const names = new Set<string>();
  for (const value of [instrument.symbol, instrument.tradingSymbol, instrument.displayName]) {
    const normalized = normalizeKey(value);
    if (normalized) names.add(normalized);
  }
  return [...names];
}

function matchesUnderlyingInstrument(instrument: Instrument, resolved: OptionChainUnderlying): boolean {
  if (!resolved.securityId && !resolved.symbol) return false;

  const candidateKeys = getInstrumentSymbolCandidates(instrument);
  const baseSymbol = normalizeKey(resolved.symbol);
  const compactBase = baseSymbol.replace(/\s+/g, "");
  const symbolMatches = candidateKeys.some((candidate) => {
    const normalizedCandidate = normalizeKey(candidate);
    const compactCandidate = normalizedCandidate.replace(/\s+/g, "");
    return normalizedCandidate.includes(baseSymbol)
      || baseSymbol.includes(normalizedCandidate)
      || normalizedCandidate === baseSymbol
      || normalizedCandidate === `${baseSymbol} 50`
      || compactCandidate.includes(compactBase)
      || compactBase.includes(compactCandidate);
  });

  const securityMatch = Boolean(resolved.securityId && (instrument.underlyingSecurityId === resolved.securityId || instrument.securityId === resolved.securityId));
  const sameSymbolRecord = Boolean(baseSymbol && candidateKeys.includes(baseSymbol));
  const fallbackSymbolGuess = Boolean(baseSymbol && instrument.tradingSymbol && normalizeKey(instrument.tradingSymbol).includes(baseSymbol));
  return securityMatch || symbolMatches || sameSymbolRecord || fallbackSymbolGuess;
}

export function resolveUnderlyingInstrument(master: InstrumentMaster, rawUnderlying?: string): OptionChainUnderlying | undefined {
  const input = normalizeKey(rawUnderlying);

  if (!input) {
    return { symbol: "", error: { code: "MISSING_UNDERLYING", message: "Underlying symbol is required." } };
  }

  const candidates = master.values().filter((instrument) => {
    if ((instrument.exchangeSegment || "").toUpperCase() === "IDX_I" || (instrument.exchangeSegment || "").toUpperCase() === "BSE_IDX") return true;
    return Boolean((instrument.instrumentType || "").toUpperCase() === "INDEX");
  });

  const exact = candidates.find((instrument) => {
    const keys = getInstrumentSymbolCandidates(instrument);
    return keys.includes(input) || keys.includes(`${input} 50`) || keys.includes(input.replace(/\s+50$/i, ""));
  });

  if (exact) {
    return {
      securityId: exact.securityId,
      symbol: exact.symbol || exact.tradingSymbol,
      exchange: exact.exchange,
      instrumentType: exact.instrumentType,
      supported: true,
    };
  }

  const aliasMatch = Object.entries(INDEX_ALIASES).find(([, aliases]) => aliases.map(normalizeKey).includes(input));
  if (aliasMatch && aliasMatch[0] === "SENSEX") {
    return {
      symbol: "SENSEX",
      exchange: "NSE",
      supported: false,
      error: {
        code: "UNSUPPORTED_UNDERLYING",
        message: "SENSEX is not supported by the active provider for option-chain discovery.",
      },
    };
  }

  if (aliasMatch) {
    return {
      symbol: aliasMatch[0],
      supported: false,
      error: {
        code: "UNKNOWN_UNDERLYING",
        message: `Underlying '${aliasMatch[0]}' is not loaded into the active instrument master.`,
      },
    };
  }

  return {
    symbol: input,
    supported: false,
    error: {
      code: "UNKNOWN_UNDERLYING",
      message: `Underlying '${input}' is not recognized by the instrument master.`,
    },
  };
}

export function discoverOptionExpiries(master: InstrumentMaster, underlying?: string): OptionExpiry[] {
  const resolved = resolveUnderlyingInstrument(master, underlying);
  if (!resolved || resolved.error) {
    return [];
  }

  const valid = master.values()
    .filter((instrument) => isOptionInstrument(instrument))
    .filter((instrument) => matchesUnderlyingInstrument(instrument, resolved) && !!instrument.expiryDate)
    .map((instrument) => asDateString(instrument.expiryDate))
    .filter((value): value is string => Boolean(value))
    .filter((value, index, arr) => arr.indexOf(value) === index)
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

  return valid.map((value) => {
    const date = new Date(value);
    const daysToExpiry = Math.max(0, Math.ceil((date.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
    return { value, label: date.toISOString().slice(0, 10), daysToExpiry };
  });
}

export function normalizeOptionContract(raw: Record<string, unknown>): OptionContract & { error?: OptionChainError } {
  const strike = toValidNumber(raw.strike, Number.NaN);
  const optionType = normalizeKey(String(raw.optionType || "")).toUpperCase() as OptionType;

  if (strike === undefined || !Number.isFinite(strike) || strike <= 0) {
    return {
      instrumentId: String(raw.instrumentId || raw.providerInstrumentId || ""),
      underlyingInstrumentId: String(raw.underlyingInstrumentId || ""),
      underlyingSymbol: String(raw.underlyingSymbol || ""),
      exchange: String(raw.exchange || ""),
      providerInstrumentId: raw.providerInstrumentId ? String(raw.providerInstrumentId) : undefined,
      expiry: String(raw.expiry || ""),
      strike: Number.NaN,
      optionType: optionType === "CE" || optionType === "PE" ? optionType : "CE",
      lotSize: toValidNumber(raw.lotSize),
      tickSize: toValidNumber(raw.tickSize),
      tradingSymbol: raw.tradingSymbol ? String(raw.tradingSymbol) : undefined,
      segment: raw.segment ? String(raw.segment) : undefined,
      oi: toValidNumber(raw.oi),
      oiChange: toValidNumber(raw.oiChange),
      volume: toValidNumber(raw.volume),
      quote: raw.quote && typeof raw.quote === "object" ? (raw.quote as OptionQuote) : undefined,
      greeks: raw.greeks && typeof raw.greeks === "object" ? (raw.greeks as OptionGreeks) : undefined,
      error: { code: "INVALID_STRIKE", message: `Strike must be a positive number; received '${raw.strike ?? "undefined"}'.` },
    };
  }

  const normalized: OptionContract & { error?: OptionChainError } = {
    instrumentId: String(raw.instrumentId || raw.providerInstrumentId || `${String(raw.underlyingSymbol || "")}:${String(raw.expiry || "")}:${strike}:${optionType}`),
    underlyingInstrumentId: raw.underlyingInstrumentId ? String(raw.underlyingInstrumentId) : undefined,
    underlyingSymbol: raw.underlyingSymbol ? String(raw.underlyingSymbol) : undefined,
    exchange: raw.exchange ? String(raw.exchange) : undefined,
    providerInstrumentId: raw.providerInstrumentId ? String(raw.providerInstrumentId) : undefined,
    expiry: asDateString(String(raw.expiry || "")) || String(raw.expiry || ""),
    strike,
    optionType: optionType === "CE" || optionType === "PE" ? optionType : "CE",
    lotSize: toValidNumber(raw.lotSize),
    tickSize: toValidNumber(raw.tickSize),
    tradingSymbol: raw.tradingSymbol ? String(raw.tradingSymbol) : undefined,
    segment: raw.segment ? String(raw.segment) : undefined,
    oi: toValidNumber(raw.oi),
    oiChange: toValidNumber(raw.oiChange),
    volume: toValidNumber(raw.volume),
    quote: raw.quote && typeof raw.quote === "object" ? (raw.quote as OptionQuote) : undefined,
    greeks: raw.greeks && typeof raw.greeks === "object" ? (raw.greeks as OptionGreeks) : undefined,
  };

  if (raw.oi !== undefined && (normalized.oi === undefined || !Number.isFinite(normalized.oi))) {
    normalized.error = { code: "INVALID_OI", message: `Open interest for ${normalized.optionType} at ${normalized.strike} is invalid.` };
  }

  return normalized;
}

function normalizeOptionRowContract(instrument: Instrument, strike: number): OptionContract {
  return {
    instrumentId: instrument.securityId,
    underlyingInstrumentId: instrument.underlyingSecurityId,
    underlyingSymbol: instrument.symbol,
    exchange: instrument.exchange,
    providerInstrumentId: instrument.providerInstrumentId,
    expiry: instrument.expiryDate,
    strike,
    optionType: (instrument.optionType || "CE").toUpperCase() === "CE" ? "CE" : "PE",
    lotSize: instrument.lotSize,
    tickSize: instrument.tickSize,
    tradingSymbol: instrument.tradingSymbol,
    segment: instrument.exchangeSegment,
    oi: undefined,
    oiChange: undefined,
    volume: undefined,
    quote: undefined,
    greeks: undefined,
  };
}

export function buildOptionChain(master: InstrumentMaster, underlying: string, expiry?: string): CanonicalOptionChain {
  const resolved = resolveUnderlyingInstrument(master, underlying);
  if (!resolved || resolved.error) {
    return {
      underlying: resolved || { symbol: normalizeKey(underlying), supported: false, error: { code: "UNKNOWN_UNDERLYING", message: `Underlying '${underlying}' is not recognized.` } },
      source: "instrument-master",
      selectedExpiry: expiry,
      expiries: discoverOptionExpiries(master, underlying),
      rows: [],
      ts: Date.now(),
      error: resolved?.error ?? { code: "UNKNOWN_UNDERLYING", message: `Underlying '${underlying}' is not recognized.` },
    };
  }

  const expiries = discoverOptionExpiries(master, underlying);
  const selectedExpiry = expiry && expiries.some((candidate) => candidate.value === expiry)
    ? expiry
    : expiries[0]?.value;

  const filtered = master.values().filter((instrument) => {
    if (!isOptionInstrument(instrument)) return false;
    const sameUnderlying = matchesUnderlyingInstrument(instrument, resolved);
    const sameExpiry = !selectedExpiry || instrument.expiryDate === selectedExpiry;
    return sameUnderlying && sameExpiry;
  });

  const byStrike = new Map<number, { ce?: Instrument; pe?: Instrument }>();
  for (const instrument of filtered) {
    const strike = toValidNumber(instrument.strikePrice, Number.NaN);
    if (!Number.isFinite(strike) || strike <= 0) continue;
    const entry = byStrike.get(strike) || {} as { ce?: Instrument; pe?: Instrument };
    if ((instrument.optionType || "").toUpperCase() === "CE") entry.ce = instrument;
    if ((instrument.optionType || "").toUpperCase() === "PE") entry.pe = instrument;
    byStrike.set(strike, entry);
  }

  const rows: OptionChainRow[] = [...byStrike.entries()]
    .sort(([left], [right]) => left - right)
    .map(([strike, pair]) => {
      const ce = pair.ce ? normalizeOptionRowContract(pair.ce, strike) : null;
      const pe = pair.pe ? normalizeOptionRowContract(pair.pe, strike) : null;
      const ceQuote = ce?.quote && (ce.quote.lastTradedPrice !== undefined || ce.quote.volume !== undefined || ce.quote.timestamp)
        ? ce.quote
        : undefined;
      const peQuote = pe?.quote && (pe.quote.lastTradedPrice !== undefined || pe.quote.volume !== undefined || pe.quote.timestamp)
        ? pe.quote
        : undefined;
      return {
        strike,
        ce,
        pe,
        ceQuote,
        peQuote,
        ceOI: undefined,
        peOI: undefined,
        ceOIChange: undefined,
        peOIChange: undefined,
        ceVolume: undefined,
        peVolume: undefined,
        greeks: { ce: undefined, pe: undefined },
      };
    });

  return {
    underlying: resolved,
    source: "instrument-master",
    selectedExpiry,
    expiries,
    rows,
    ts: Date.now(),
  };
}

export class OptionChainService {
  private readonly cache = new Map<string, { ts: number; chain: CanonicalOptionChain }>();

  constructor(private readonly master: InstrumentMaster) {}

  async load({ underlying, expiry }: { underlying: string; expiry?: string }): Promise<CanonicalOptionChain> {
    const key = `${normalizeKey(underlying)}:${expiry || "latest"}`;
    const cached = this.cache.get(key);
    if (cached) return { ...cached.chain, ts: cached.ts };

    const chain = buildOptionChain(this.master, underlying, expiry);
    const ts = Date.now();
    this.cache.set(key, { ts, chain: { ...chain, ts } });
    return { ...chain, ts };
  }

  invalidate(): void {
    this.cache.clear();
  }
}

export function applyRealtimeOptionUpdate(
  chain: CanonicalOptionChain,
  update: {
    instrumentId?: string;
    providerInstrumentId?: string;
    ltp?: number;
    volume?: number;
    oi?: number;
    oiChange?: number;
    timestamp?: number | string;
  },
): CanonicalOptionChain {
  const matchId = update.instrumentId || update.providerInstrumentId;
  if (!matchId) return chain;

  for (const row of chain.rows) {
    const candidates = [row.ce, row.pe].filter(Boolean) as OptionContract[];
    for (const leg of candidates) {
      const providerMatches = leg.providerInstrumentId === update.providerInstrumentId || leg.instrumentId === update.instrumentId || leg.instrumentId === matchId;
      if (!providerMatches) continue;

      const quote: OptionQuote = {
        instrumentId: leg.instrumentId,
        providerInstrumentId: leg.providerInstrumentId,
        lastTradedPrice: toValidNumber(update.ltp, undefined),
        volume: toValidNumber(update.volume, undefined),
        timestamp: typeof update.timestamp === "number" ? new Date(update.timestamp).toISOString() : update.timestamp,
      };

      if (leg.optionType === "CE") {
        row.ceQuote = quote;
        row.ceOI = update.oi ?? row.ceOI;
        row.ceOIChange = update.oiChange ?? row.ceOIChange;
        row.ceVolume = update.volume ?? row.ceVolume;
      } else {
        row.peQuote = quote;
        row.peOI = update.oi ?? row.peOI;
        row.peOIChange = update.oiChange ?? row.peOIChange;
        row.peVolume = update.volume ?? row.peVolume;
      }

      if (leg.quote) leg.quote = { ...leg.quote, ...quote };
      if (update.oi !== undefined) leg.oi = update.oi;
      if (update.oiChange !== undefined) leg.oiChange = update.oiChange;
      if (update.volume !== undefined) leg.volume = update.volume;
      break;
    }
  }

  return chain;
}
