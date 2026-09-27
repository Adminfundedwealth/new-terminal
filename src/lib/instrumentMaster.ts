import type { Instrument } from "./localDatabase";

export type InstrumentProvider = "dhan" | "zerodha" | "angel_one" | string;

export interface InstrumentNormalizationIssue {
  index: number;
  code: "MISSING_FIELD" | "INVALID_VALUE" | "DUPLICATE_IDENTIFIER" | "CONFLICTING_METADATA" | "DUPLICATE_SYMBOL";
  message: string;
}

export interface InstrumentNormalizationReport {
  instruments: Instrument[];
  issues: InstrumentNormalizationIssue[];
}

const SUPPORTED_SEGMENTS = new Set(["NSE_EQ", "NSE_FNO", "NFO", "BSE_EQ", "BSE_FNO", "BFO", "MCX_COMM", "MCX", "NSE_CDS", "CDS", "BSE_CDS"]);

function text(value: unknown): string { return value == null ? "" : String(value).trim(); }
function upper(value: unknown): string { return text(value).toUpperCase(); }
function first(raw: Record<string, unknown>, keys: string[]): unknown { return keys.map((key) => raw[key]).find((value) => value !== undefined && value !== null && value !== ""); }
function numberValue(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}
function dateValue(value: unknown): string | undefined {
  const result = text(value);
  if (!result) return undefined;
  return Number.isNaN(new Date(result).getTime()) ? undefined : result;
}
function providerId(raw: Record<string, unknown>): string { return text(first(raw, ["securityId", "security_id", "instrument_token", "instrumentToken", "token", "SEM_SMST_SECURITY_ID", "exchange_token"])); }
function segmentValue(raw: Record<string, unknown>): string {
  const explicit = upper(first(raw, ["exchangeSegment", "exchange_segment", "exch_seg", "SEM_EXM", "segment"]));
  const exchange = upper(first(raw, ["exchange", "SEM_EXCH_ID", "SEM_EXM_EXCH_ID"]));
  const segmentCode = upper(first(raw, ["SEM_SEGMENT"]));
  const instrumentType = upper(first(raw, ["instrumentType", "instrument_type", "instrumenttype", "SEM_INSTRUMENT_NAME", "SEM_EXCH_INSTRUMENT_TYPE"]));
  if (explicit) return explicit === "NFO" ? "NSE_FNO" : explicit === "BFO" ? "BSE_FNO" : explicit;
  if (segmentCode) {
    const mapped = ({ "NSE:E": "NSE_EQ", "NSE:D": "NSE_FNO", "NSE:I": "IDX_I", "NSE:C": "NSE_CDS", "BSE:E": "BSE_EQ", "BSE:D": "BSE_FNO", "BSE:I": "BSE_IDX", "BSE:C": "BSE_CDS", "MCX:M": "MCX_COMM" } as Record<string, string>)[`${exchange}:${segmentCode}`];
    if (mapped) return mapped;
  }
  if (instrumentType === "INDEX") return exchange === "BSE" ? "BSE_IDX" : "IDX_I";
  if (exchange === "NSE") return "NSE_EQ";
  if (exchange === "BSE") return "BSE_EQ";
  return exchange;
}
function exchangeFor(segment: string): string {
  if (segment === "IDX_I") return "NSE";
  if (segment === "BSE_IDX") return "BSE";
  if (segment.startsWith("NSE") || segment === "NFO" || segment === "CDS") return "NSE";
  if (segment.startsWith("BSE") || segment === "BFO") return "BSE";
  if (segment.startsWith("MCX")) return "MCX";
  return segment.split("_")[0] || "";
}
function instrumentTypeValue(raw: Record<string, unknown>, segment: string): string {
  const source = upper(first(raw, ["instrumentType", "instrument_type", "instrumenttype", "SEM_EXCH_INSTRUMENT_TYPE", "SEM_INSTRUMENT_NAME"]));
  if (source === "INDEX") return "INDEX";
  return source || (segment.endsWith("_EQ") ? "EQUITY" : "");
}

export function normalizeProviderInstrument(rawValue: unknown, provider: InstrumentProvider, index = 0): { instrument?: Instrument; issue?: InstrumentNormalizationIssue } {
  if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) return { issue: { index, code: "INVALID_VALUE", message: "Instrument row is not an object." } };
  const raw = rawValue as Record<string, unknown>;
  const securityId = providerId(raw);
  const tradingSymbol = text(first(raw, ["tradingSymbol", "trading_symbol", "tradingsymbol", "SEM_TRADING_SYMBOL", "symbol"]));
  const symbol = text(first(raw, ["symbol", "name", "customSymbol", "custom_symbol", "SEM_CUSTOM_SYMBOL", "SEM_SECURITY_NAME"])) || tradingSymbol;
  const segment = segmentValue(raw);
  const instrumentType = instrumentTypeValue(raw, segment);
  const exchange = exchangeFor(segment);
  const expiryDate = dateValue(first(raw, ["expiryDate", "expiry_date", "expiry", "SEM_EXPIRY_DATE"]));
  const strikePrice = numberValue(first(raw, ["strikePrice", "strike_price", "strike", "SEM_STRIKE_PRICE"]));
  const optionType = upper(first(raw, ["optionType", "option_type", "SEM_OPTION_TYPE"])) || undefined;
  const lotSize = numberValue(first(raw, ["lotSize", "lot_size", "SEM_LOT_SIZE", "SEM_LOT_UNITS"])) ?? (instrumentType === "INDEX" ? 1 : undefined);
  const tickSize = numberValue(first(raw, ["tickSize", "tick_size", "SEM_TICK_SIZE"]));
  const underlyingSecurityId = text(first(raw, ["underlyingSecurityId", "underlying_security_id", "underlying_token", "SEM_UNDERLYING_SECURITY_ID"])) || undefined;
  const missing = [!securityId && "provider instrument identifier", !tradingSymbol && "trading symbol", !symbol && "display symbol", !segment && "exchange segment", !instrumentType && "instrument type", lotSize === undefined && "lot size", tickSize === undefined && "tick size"].filter(Boolean) as string[];
  if (missing.length) return { issue: { index, code: "MISSING_FIELD", message: `Missing ${missing.join(", ")}.` } };
  if (!SUPPORTED_SEGMENTS.has(segment) && segment !== "IDX_I" && segment !== "BSE_IDX") return { issue: { index, code: "INVALID_VALUE", message: `Unsupported exchange segment: ${segment}.` } };
  if (["FUTSTK", "FUTIDX", "FUTCOM", "FUTCUR"].includes(instrumentType) && !expiryDate) return { issue: { index, code: "INVALID_VALUE", message: "Futures require a valid expiry." } };
  if (["OPTSTK", "OPTIDX", "OPTFUT", "OPTCUR"].includes(instrumentType) && (!expiryDate || strikePrice === undefined || strikePrice <= 0 || !["CE", "PE"].includes(optionType || ""))) return { issue: { index, code: "INVALID_VALUE", message: "Options require expiry, positive strike, and CE or PE option type." } };
  if (lotSize <= 0 || tickSize <= 0) return { issue: { index, code: "INVALID_VALUE", message: "Lot size and tick size must be positive." } };
  return { instrument: { securityId, symbol, tradingSymbol, displayName: text(first(raw, ["displayName", "display_name", "name", "SEM_CUSTOM_SYMBOL"])) || symbol, exchange, exchangeSegment: segment, instrumentType, lotSize, tickSize, expiryDate, strikePrice, optionType: ["CE", "PE"].includes(optionType || "") ? optionType : undefined, underlyingSecurityId, provider, providerInstrumentId: securityId } };
}

export function normalizeInstrumentMaster(rawRows: unknown[], provider: InstrumentProvider): InstrumentNormalizationReport {
  const instruments: Instrument[] = [];
  const issues: InstrumentNormalizationIssue[] = [];
  const byId = new Map<string, Instrument>();
  const byExchangeSymbol = new Map<string, Instrument>();
  rawRows.forEach((row, index) => {
    const result = normalizeProviderInstrument(row, provider, index);
    if (result.issue || !result.instrument) { if (result.issue) issues.push(result.issue); return; }
    const instrument = result.instrument;
    const existingId = byId.get(instrument.securityId);
    const symbolKey = `${instrument.exchange}|${instrument.tradingSymbol.toUpperCase()}`;
    const existingSymbol = byExchangeSymbol.get(symbolKey);
    if (existingId) { issues.push({ index, code: JSON.stringify(existingId) === JSON.stringify(instrument) ? "DUPLICATE_IDENTIFIER" : "CONFLICTING_METADATA", message: `Identifier ${instrument.securityId} already exists.` }); return; }
    if (existingSymbol) { issues.push({ index, code: "DUPLICATE_SYMBOL", message: `Duplicate ${symbolKey}; existing identifier ${existingSymbol.securityId} retained.` }); return; }
    byId.set(instrument.securityId, instrument); byExchangeSymbol.set(symbolKey, instrument); instruments.push(instrument);
  });
  return { instruments, issues };
}

export class InstrumentMaster {
  private readonly byId = new Map<string, Instrument>();
  private readonly byExchangeSymbol = new Map<string, Instrument>();
  private readonly byProviderId = new Map<string, Instrument>();
  add(instrument: Instrument): InstrumentNormalizationIssue | undefined {
    const existing = this.byId.get(instrument.securityId);
    if (existing) return { index: -1, code: JSON.stringify(existing) === JSON.stringify(instrument) ? "DUPLICATE_IDENTIFIER" : "CONFLICTING_METADATA", message: `Identifier ${instrument.securityId} already exists.` };
    const key = `${instrument.exchange}|${instrument.tradingSymbol.toUpperCase()}`;
    const existingSymbol = this.byExchangeSymbol.get(key);
    const isOptionContract = (candidate: Instrument): boolean => Boolean(candidate.optionType && ["CE", "PE"].includes(candidate.optionType.toUpperCase())) || Boolean(candidate.expiryDate && candidate.strikePrice && candidate.strikePrice > 0);
    if (existingSymbol) {
      const sameContract = existingSymbol.securityId === instrument.securityId || (
        existingSymbol.expiryDate === instrument.expiryDate &&
        existingSymbol.strikePrice === instrument.strikePrice &&
        existingSymbol.optionType === instrument.optionType &&
        existingSymbol.underlyingSecurityId === instrument.underlyingSecurityId
      );
      const allowDistinctOptionContracts = isOptionContract(existingSymbol) && isOptionContract(instrument) && !sameContract;
      if (!allowDistinctOptionContracts) {
        return { index: -1, code: "DUPLICATE_SYMBOL", message: `Exchange-symbol ${key} already exists.` };
      }
    }
    this.byId.set(instrument.securityId, instrument); this.byExchangeSymbol.set(key, instrument); this.byProviderId.set(`${instrument.provider}:${instrument.providerInstrumentId}`, instrument);
    return undefined;
  }
  addAll(instruments: Instrument[]): InstrumentNormalizationIssue[] { return instruments.map((instrument) => this.add(instrument)).filter((issue): issue is InstrumentNormalizationIssue => !!issue); }
  getById(securityId: string): Instrument | undefined { return this.byId.get(securityId); }
  getByExchangeSymbol(exchange: string, tradingSymbol: string): Instrument | undefined { return this.byExchangeSymbol.get(`${exchange.toUpperCase()}|${tradingSymbol.toUpperCase()}`); }
  getByProviderId(provider: string, providerInstrumentId: string): Instrument | undefined { return this.byProviderId.get(`${provider}:${providerInstrumentId}`); }
  values(): Instrument[] { return [...this.byId.values()]; }
}