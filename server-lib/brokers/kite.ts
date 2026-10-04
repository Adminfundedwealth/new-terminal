import { parseCsv } from "./csv.js";
import { normalizeMarketOptionChain } from "./normalization.js";
import { MarketDataProviderError } from "./provider-error.js";
import type {
  BrokerCredentialMap,
  Fetcher,
  MarketCandle,
  MarketDataProvider,
  MarketInstrument,
  MarketOptionChain,
  MarketOptionLeg,
  MarketQuote,
} from "./types.js";

const KITE_API = "https://api.kite.trade";
const KITE_EXCHANGES = new Set(["NSE", "BSE", "NFO", "BFO", "CDS", "BCD", "MCX"]);
const INTERVALS = new Set(["minute", "3minute", "5minute", "10minute", "15minute", "30minute", "60minute", "day"]);
const OPTION_UNDERLYINGS: Record<string, string[]> = { NIFTY: ["NIFTY", "NIFTY 50"], BANKNIFTY: ["BANKNIFTY", "NIFTY BANK"], FINNIFTY: ["FINNIFTY", "NIFTY FIN SERVICE", "NIFTY FINANCIAL SERVICES"], MIDCPNIFTY: ["MIDCPNIFTY", "NIFTY MID SELECT", "NIFTY MIDCAP 50"] };
const OPTION_QUOTE_BATCH_SIZE = 75;

function credential(credentials: BrokerCredentialMap, ...keys: string[]): string {
  for (const key of keys) {
    const value = credentials[key]?.trim();
    if (value) return value;
  }
  return "";
}

function numeric(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export class KiteMarketDataProvider implements MarketDataProvider {
  private readonly apiKey: string;
  private readonly accessToken: string;
  private instrumentCache: { expiresAt: number; rows: MarketInstrument[] } | null = null;

  constructor(credentials: BrokerCredentialMap, private readonly fetcher: Fetcher = fetch) {
    this.apiKey = credential(credentials, "api_key", "apiKey");
    this.accessToken = credential(credentials, "access_token", "accessToken");
    if (!this.apiKey || !this.accessToken) {
      throw new MarketDataProviderError("kite", "MISSING_CREDENTIALS");
    }
  }

  async authenticate(): Promise<{ authenticated: true }> {
    const payload = await this.readJson(await this.fetcher(`${KITE_API}/user/profile`, {
      headers: this.headers(),
      cache: "no-store",
    }));
    if (payload.status !== "success" || !payload.data) {
      throw new MarketDataProviderError("kite", "INVALID_CREDENTIALS");
    }
    return { authenticated: true };
  }

  async searchInstruments(query: string): Promise<MarketInstrument[]> {
    const needle = query.trim().toUpperCase();
    if (!needle) throw new MarketDataProviderError("kite", "INVALID_REQUEST");
    const instruments = await this.getInstrumentMaster();
    return instruments.filter((instrument) =>
      instrument.symbol.toUpperCase().includes(needle) ||
      instrument.tradingSymbol.toUpperCase().includes(needle)
    ).slice(0, 50);
  }

  async getQuote(instrument: MarketInstrument): Promise<MarketQuote> {
    this.validateInstrument(instrument);
    const key = `${instrument.exchange}:${instrument.tradingSymbol}`;
    const query = new URLSearchParams({ i: key });
    const payload = await this.readJson(await this.fetcher(`${KITE_API}/quote?${query}`, {
      headers: this.headers(),
      cache: "no-store",
    }));
    const quote = payload.data?.[key];
    if (!quote) throw new MarketDataProviderError("kite", "INVALID_INSTRUMENT");

    const ltp = numeric(quote.last_price);
    if (ltp === null) throw new MarketDataProviderError("kite", "UPSTREAM_ERROR");
    const previousClose = numeric(quote.ohlc?.close);
    const change = previousClose === null ? null : ltp - previousClose;
    return {
      provider: "kite",
      symbol: instrument.symbol,
      tradingSymbol: instrument.tradingSymbol,
      exchange: instrument.exchange,
      ltp,
      open: numeric(quote.ohlc?.open),
      high: numeric(quote.ohlc?.high),
      low: numeric(quote.ohlc?.low),
      previousClose,
      change,
      changePercent: previousClose && change !== null ? (change / previousClose) * 100 : null,
      volume: numeric(quote.volume),
      openInterest: numeric(quote.oi),
      timestamp: String(quote.timestamp ?? quote.last_trade_time ?? new Date().toISOString()),
    };
  }

  async getHistoricalCandles(
    instrument: MarketInstrument,
    interval: string,
    fromDate: string,
    toDate: string
  ): Promise<MarketCandle[]> {
    this.validateInstrument(instrument);
    if (!INTERVALS.has(interval) || !this.isValidDate(fromDate) || !this.isValidDate(toDate) || fromDate > toDate) {
      throw new MarketDataProviderError("kite", "INVALID_REQUEST");
    }
    const query = new URLSearchParams({ from: fromDate, to: toDate });
    const payload = await this.readJson(await this.fetcher(
      `${KITE_API}/instruments/historical/${encodeURIComponent(instrument.providerInstrumentId)}/${interval}?${query}`,
      { headers: this.headers(), cache: "no-store" }
    ));
    const candles = payload.data?.candles;
    if (!Array.isArray(candles)) throw new MarketDataProviderError("kite", "UPSTREAM_ERROR");
    return candles.map((row: unknown[]) => ({
      timestamp: String(row[0]),
      open: numeric(row[1]) ?? 0,
      high: numeric(row[2]) ?? 0,
      low: numeric(row[3]) ?? 0,
      close: numeric(row[4]) ?? 0,
      volume: numeric(row[5]) ?? 0,
      ...(numeric(row[6]) === null ? {} : { openInterest: numeric(row[6])! }),
    }));
  }

  async getOptionChain(underlying: string, expiry?: string): Promise<MarketOptionChain> {
    const normalizedUnderlying = underlying.trim().toUpperCase();
    const aliases = OPTION_UNDERLYINGS[normalizedUnderlying] ?? [normalizedUnderlying];
    const instruments = await this.getInstrumentMaster();
    const contracts = instruments.filter((instrument) => (instrument.exchangeSegment === "NFO" || instrument.exchangeSegment.startsWith("NFO") || instrument.exchange === "NFO") && (instrument.optionType === "CE" || instrument.optionType === "PE") && aliases.includes(instrument.symbol.toUpperCase()) && Boolean(instrument.expiryDate) && (!expiry || instrument.expiryDate === expiry));
    const expiries = [...new Set(contracts.map((item) => item.expiryDate as string))].sort();
    const selectedExpiry = expiry ?? expiries[0];
    if (!selectedExpiry) throw new MarketDataProviderError("kite", "INVALID_INSTRUMENT");
    const selectedContracts = contracts.filter((instrument) => instrument.expiryDate === selectedExpiry);
    const quoteRows: Array<[MarketInstrument, Record<string, unknown>]> = [];
    for (let offset = 0; offset < selectedContracts.length; offset += OPTION_QUOTE_BATCH_SIZE) {
      const batch = selectedContracts.slice(offset, offset + OPTION_QUOTE_BATCH_SIZE);
      const query = new URLSearchParams();
      for (const instrument of batch) query.append("i", `${instrument.exchange}:${instrument.tradingSymbol}`);
      const payload = await this.readJson(await this.fetcher(`${KITE_API}/quote?${query}`, { headers: this.headers(), cache: "no-store" }));
      for (const instrument of batch) { const quote = payload.data?.[`${instrument.exchange}:${instrument.tradingSymbol}`]; if (quote) quoteRows.push([instrument, quote]); }
    }
    const strikes = new Map<number, { call: MarketOptionLeg | null; put: MarketOptionLeg | null }>();
    for (const [instrument, quote] of quoteRows) { if (instrument.strikePrice === undefined) continue; const row = strikes.get(instrument.strikePrice) ?? { call: null, put: null }; row[instrument.optionType === "CE" ? "call" : "put"] = normalizeKiteOptionLeg(quote); strikes.set(instrument.strikePrice, row); }
    const underlyingInstrument = instruments.find((instrument) => instrument.exchange === "NSE" && instrument.instrumentType === "INDEX" && aliases.includes(instrument.symbol.toUpperCase()));
    if (!underlyingInstrument) throw new MarketDataProviderError("kite", "INVALID_INSTRUMENT");
    const spotPrice = (await this.getQuote(underlyingInstrument)).ltp;
    if (!Number.isFinite(spotPrice) || spotPrice <= 0) throw new MarketDataProviderError("kite", "UPSTREAM_ERROR");
    return normalizeMarketOptionChain({ provider: "kite", underlying: normalizedUnderlying, expiry: selectedExpiry, expiries, spotPrice, rows: [...strikes.entries()].map(([strike, legs]) => ({ strike, ...legs })) });
  }

  private headers(): HeadersInit {
    return {
      Accept: "application/json",
      "X-Kite-Version": "3",
      Authorization: `token ${this.apiKey}:${this.accessToken}`,
    };
  }

  private async readJson(response: Response): Promise<any> {
    if (!response.ok) {
      throw new MarketDataProviderError(
        "kite",
        response.status === 401 || response.status === 403 ? "INVALID_CREDENTIALS" : "UPSTREAM_ERROR",
        response.status
      );
    }
    try {
      return await response.json();
    } catch {
      throw new MarketDataProviderError("kite", "UPSTREAM_ERROR", response.status);
    }
  }

  private validateInstrument(instrument: MarketInstrument): void {
    if (
      instrument.provider !== "kite" ||
      !/^\d+$/.test(instrument.providerInstrumentId) ||
      !KITE_EXCHANGES.has(instrument.exchange.toUpperCase())
    ) {
      throw new MarketDataProviderError("kite", "INVALID_INSTRUMENT");
    }
  }

  private isValidDate(value: string): boolean {
    return /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2})?$/.test(value) && Number.isFinite(Date.parse(value));
  }

  private async getInstrumentMaster(): Promise<MarketInstrument[]> {
    if (this.instrumentCache && this.instrumentCache.expiresAt > Date.now()) {
      return this.instrumentCache.rows;
    }
    const response = await this.fetcher(`${KITE_API}/instruments`, { headers: this.headers(), cache: "no-store" });
    if (!response.ok) {
      throw new MarketDataProviderError(
        "kite",
        response.status === 401 || response.status === 403 ? "INVALID_CREDENTIALS" : "UPSTREAM_ERROR",
        response.status
      );
    }
    const rows = parseCsv(await response.text()).map((row) => this.toInstrument(row)).filter((row): row is MarketInstrument => row !== null);
    this.instrumentCache = { rows, expiresAt: Date.now() + 60 * 60 * 1000 };
    return rows;
  }

  private toInstrument(row: Record<string, string>): MarketInstrument | null {
    const exchange = row.exchange?.toUpperCase();
    const token = row.instrument_token;
    const tradingSymbol = row.tradingsymbol;
    if (!exchange || !KITE_EXCHANGES.has(exchange) || !token || !tradingSymbol) return null;
    return {
      provider: "kite",
      providerInstrumentId: token,
      symbol: row.name || tradingSymbol,
      tradingSymbol,
      exchange,
      exchangeSegment: row.segment || exchange,
      instrumentType: row.instrument_type || "",
      lotSize: numeric(row.lot_size) ?? undefined,
      tickSize: numeric(row.tick_size) ?? undefined,
      expiryDate: row.expiry || undefined,
      strikePrice: numeric(row.strike) ?? undefined,
      optionType: row.instrument_type === "CE" || row.instrument_type === "PE" ? row.instrument_type : undefined,
    };
  }
}

function normalizeKiteOptionLeg(quote: Record<string, any>): MarketOptionLeg {
  const ltp = numeric(quote.last_price);
  const previousClose = numeric(quote.ohlc?.close);
  const change = ltp !== null && previousClose !== null ? ltp - previousClose : null;
  return { ltp, bid: numeric(quote.depth?.buy?.[0]?.price), ask: numeric(quote.depth?.sell?.[0]?.price), volume: numeric(quote.volume), oi: numeric(quote.oi), change, change_percent: previousClose && change !== null ? (change / previousClose) * 100 : null, iv: null, oi_change: null, greeks: null };
}
