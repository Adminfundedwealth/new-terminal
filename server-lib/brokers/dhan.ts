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

const DHAN_API = "https://api.dhan.co/v2";
const DHAN_INSTRUMENT_MASTER = "https://images.dhan.co/api-data/api-scrip-master.csv";
const DHAN_SEGMENTS = new Set(["IDX_I", "NSE_EQ", "NSE_FNO", "BSE_EQ", "BSE_FNO", "MCX_COMM"]);
const OPTION_UNDERLYINGS: Record<string, number> = { NIFTY: 13, BANKNIFTY: 25, FINNIFTY: 27, MIDCPNIFTY: 442 };
const INTERVALS: Record<string, string> = {
  "1m": "1", "1": "1", "5m": "5", "5": "5", "15m": "15", "15": "15",
  "25m": "25", "25": "25", "60m": "60", "60": "60", day: "day", "1d": "day",
};

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

function requireValue(value: number | null, provider: "dhan"): number {
  if (value === null) throw new MarketDataProviderError(provider, "UPSTREAM_ERROR");
  return value;
}

export class DhanMarketDataProvider implements MarketDataProvider {
  private readonly clientId: string;
  private readonly accessToken: string;
  private instrumentCache: { expiresAt: number; rows: MarketInstrument[] } | null = null;

  constructor(credentials: BrokerCredentialMap, private readonly fetcher: Fetcher = fetch) {
    this.clientId = credential(credentials, "client_id", "clientId");
    this.accessToken = credential(credentials, "access_token", "accessToken");
    if (!this.clientId || !this.accessToken) {
      throw new MarketDataProviderError("dhan", "MISSING_CREDENTIALS");
    }
  }

  async authenticate(): Promise<{ authenticated: true }> {
    const response = await this.fetcher(`${DHAN_API}/profile`, { headers: this.headers() });
    const payload = await this.readJson(response);
    if (!payload || payload.status !== "success" || !payload.data) {
      throw new MarketDataProviderError("dhan", "INVALID_CREDENTIALS", response.status);
    }
    return { authenticated: true };
  }

  async searchInstruments(query: string): Promise<MarketInstrument[]> {
    const needle = query.trim().toUpperCase();
    if (!needle) throw new MarketDataProviderError("dhan", "INVALID_REQUEST");
    const instruments = await this.getInstrumentMaster();
    return instruments.filter((instrument) =>
      instrument.symbol.toUpperCase().includes(needle) ||
      instrument.tradingSymbol.toUpperCase().includes(needle)
    ).slice(0, 50);
  }

  async getQuote(instrument: MarketInstrument): Promise<MarketQuote> {
    this.validateInstrument(instrument);
    const response = await this.fetcher(`${DHAN_API}/marketfeed/ltp`, {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ [instrument.exchangeSegment]: [Number(instrument.providerInstrumentId)] }),
    });
    const payload = await this.readJson(response);
    const quote = payload.data?.[instrument.exchangeSegment]?.[instrument.providerInstrumentId];
    if (!quote) throw new MarketDataProviderError("dhan", "INVALID_INSTRUMENT", response.status);

    const ltp = requireValue(numeric(quote.last_price), "dhan");
    const ohlc = quote.ohlc ?? {};
    const previousClose = numeric(ohlc.close ?? quote.previous_close);
    const change = previousClose === null ? null : ltp - previousClose;
    return {
      provider: "dhan",
      symbol: instrument.symbol,
      tradingSymbol: instrument.tradingSymbol,
      exchange: instrument.exchange,
      ltp,
      open: numeric(ohlc.open),
      high: numeric(ohlc.high),
      low: numeric(ohlc.low),
      previousClose,
      change,
      changePercent: previousClose && change !== null ? (change / previousClose) * 100 : null,
      volume: numeric(quote.volume),
      openInterest: numeric(quote.oi),
      timestamp: String(quote.last_trade_time ?? new Date().toISOString()),
    };
  }

  async getHistoricalCandles(
    instrument: MarketInstrument,
    interval: string,
    fromDate: string,
    toDate: string
  ): Promise<MarketCandle[]> {
    this.validateInstrument(instrument);
    const dhanInterval = INTERVALS[interval.toLowerCase()];
    if (!dhanInterval || !/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
      throw new MarketDataProviderError("dhan", "INVALID_REQUEST");
    }
    const daily = dhanInterval === "day";
    const endpoint = daily ? "historical" : "intraday";
    const body: Record<string, string | number> = {
      securityId: instrument.providerInstrumentId,
      exchangeSegment: instrument.exchangeSegment,
      instrument: instrument.instrumentType,
      fromDate,
      toDate,
    };
    if (daily) body.expiryCode = 0;
    else body.interval = dhanInterval;

    const response = await this.fetcher(`${DHAN_API}/charts/${endpoint}`, {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await this.readJson(response);
    const data = payload.data;
    if (!data || !Array.isArray(data.timestamp)) {
      throw new MarketDataProviderError("dhan", "UPSTREAM_ERROR", response.status);
    }
    return data.timestamp.map((timestamp: unknown, index: number) => ({
      timestamp: String(timestamp),
      open: numeric(data.open?.[index]) ?? 0,
      high: numeric(data.high?.[index]) ?? 0,
      low: numeric(data.low?.[index]) ?? 0,
      close: numeric(data.close?.[index]) ?? 0,
      volume: numeric(data.volume?.[index]) ?? 0,
      ...(numeric(data.oi?.[index]) === null ? {} : { openInterest: numeric(data.oi[index])! }),
    }));
  }

  async getOptionChain(underlying: string, expiry?: string): Promise<MarketOptionChain> {
    const normalizedUnderlying = underlying.trim().toUpperCase();
    const underlyingScrip = OPTION_UNDERLYINGS[normalizedUnderlying];
    if (!underlyingScrip) throw new MarketDataProviderError("dhan", "INVALID_REQUEST");

    let expiries = expiry ? [expiry] : [];
    if (!expiry) {
      const expiryResponse = await this.fetcher(`${DHAN_API}/optionchain/expirylist`, {
        method: "POST", headers: { ...this.headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ UnderlyingScrip: underlyingScrip, UnderlyingSeg: "NSE_FNO" }),
      });
      const expiryPayload = await this.readJson(expiryResponse);
      if (expiryPayload.status !== "success" || !Array.isArray(expiryPayload.data)) throw new MarketDataProviderError("dhan", "UPSTREAM_ERROR", expiryResponse.status);
      expiries = expiryPayload.data.filter((value: unknown): value is string => typeof value === "string");
    }
    const selectedExpiry = expiry ?? expiries[0];
    if (!selectedExpiry) throw new MarketDataProviderError("dhan", "UPSTREAM_ERROR");

    const response = await this.fetcher(`${DHAN_API}/optionchain`, {
      method: "POST", headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ UnderlyingScrip: underlyingScrip, UnderlyingSeg: "IDX_I", Expiry: selectedExpiry }),
    });
    const payload = await this.readJson(response);
    const data = payload.status === "success" ? payload.data : null;
    if (!data || typeof data.oc !== "object" || data.oc === null) throw new MarketDataProviderError("dhan", "UPSTREAM_ERROR", response.status);

    const rows = Object.entries(data.oc as Record<string, { ce?: Record<string, unknown>; pe?: Record<string, unknown> }>).flatMap(([strikeText, legs]) => {
      const strike = numeric(strikeText);
      if (strike === null) return [];
      const iv = data.iv_oc?.[strikeText] ?? {};
      const greeks = data.gk_oc?.[strikeText] ?? {};
      const oi = data.oi_data?.[strikeText] ?? {};
      return [{ strike, call: normalizeDhanOptionLeg(legs.ce, { iv: iv.ce_iv, oi: oi.ce_oi, oiChange: oi.ce_oi_chg, greeks: { delta: greeks.ce_delta, gamma: greeks.ce_gamma, theta: greeks.ce_theta, vega: greeks.ce_vega } }), put: normalizeDhanOptionLeg(legs.pe, { iv: iv.pe_iv, oi: oi.pe_oi, oiChange: oi.pe_oi_chg, greeks: { delta: greeks.pe_delta, gamma: greeks.pe_gamma, theta: greeks.pe_theta, vega: greeks.pe_vega } }) }];
    });
    const spotPrice = numeric(data.last_price);
    if (spotPrice === null || spotPrice <= 0) throw new MarketDataProviderError("dhan", "UPSTREAM_ERROR", response.status);
    return normalizeMarketOptionChain({ provider: "dhan", underlying: normalizedUnderlying, expiry: selectedExpiry, expiries, spotPrice, rows });
  }

  private headers(): Record<string, string> {
    return {
      Accept: "application/json",
      "Content-Type": "application/json",
      "access-token": this.accessToken,
      "client-id": this.clientId,
    };
  }

  private async readJson(response: Response): Promise<any> {
    if (!response.ok) {
      throw new MarketDataProviderError(
        "dhan",
        response.status === 401 || response.status === 403 ? "INVALID_CREDENTIALS" : "UPSTREAM_ERROR",
        response.status
      );
    }
    try {
      return await response.json();
    } catch {
      throw new MarketDataProviderError("dhan", "UPSTREAM_ERROR", response.status);
    }
  }

  private validateInstrument(instrument: MarketInstrument): void {
    if (
      instrument.provider !== "dhan" ||
      !/^\d+$/.test(instrument.providerInstrumentId) ||
      !DHAN_SEGMENTS.has(instrument.exchangeSegment)
    ) {
      throw new MarketDataProviderError("dhan", "INVALID_INSTRUMENT");
    }
  }

  private async getInstrumentMaster(): Promise<MarketInstrument[]> {
    if (this.instrumentCache && this.instrumentCache.expiresAt > Date.now()) {
      return this.instrumentCache.rows;
    }
    const response = await this.fetcher(DHAN_INSTRUMENT_MASTER, { headers: { Accept: "text/csv" } });
    if (!response.ok) throw new MarketDataProviderError("dhan", "UPSTREAM_ERROR", response.status);
    const rows = parseCsv(await response.text()).map((row) => this.toInstrument(row)).filter((row): row is MarketInstrument => row !== null);
    this.instrumentCache = { rows, expiresAt: Date.now() + 60 * 60 * 1000 };
    return rows;
  }

  private toInstrument(row: Record<string, string>): MarketInstrument | null {
    const securityId = row.SEM_SMST_SECURITY_ID;
    const rawSegment = row.SEM_SEGMENT?.toUpperCase();
    const exchange = row.SEM_EXM_EXCH_ID?.toUpperCase();
    if (!securityId || !rawSegment || !exchange) return null;

    const exchangeSegment = rawSegment.includes("_")
      ? rawSegment
      : rawSegment === "I" ? "IDX_I"
        : rawSegment === "D" ? (exchange === "BSE" ? "BSE_FNO" : "NSE_FNO")
          : exchange === "BSE" ? "BSE_EQ" : exchange === "MCX" ? "MCX_COMM" : "NSE_EQ";
    if (!DHAN_SEGMENTS.has(exchangeSegment)) return null;

    const tradingSymbol = row.SEM_TRADING_SYMBOL || row.SEM_CUSTOM_SYMBOL || row.SEM_INSTRUMENT_NAME || "";
    if (!tradingSymbol) return null;
    return {
      provider: "dhan",
      providerInstrumentId: securityId,
      symbol: row.SEM_INSTRUMENT_NAME || tradingSymbol,
      tradingSymbol,
      exchange,
      exchangeSegment,
      instrumentType: row.SEM_EXM_INSTRUMENT_TYPE || (exchangeSegment === "IDX_I" ? "INDEX" : "EQUITY"),
      lotSize: numeric(row.SEM_LOT_UNITS) ?? undefined,
      tickSize: numeric(row.SEM_TICK_SIZE) ?? undefined,
      expiryDate: row.SEM_EXPIRY_DATE || undefined,
      strikePrice: numeric(row.SEM_STRIKE_PRICE) ?? undefined,
      optionType: row.SEM_OPTION_TYPE || undefined,
    };
  }
}

function normalizeDhanOptionLeg(source: Record<string, unknown> | undefined, extras: { iv?: unknown; oi?: unknown; oiChange?: unknown; greeks?: Record<string, unknown> }): MarketOptionLeg | null {
  if (!source) return null;
  const ltp = numeric(source.last_price ?? source.ltp);
  const previous = numeric(source.close);
  const rawGreeks = (source.greeks && typeof source.greeks === "object" ? source.greeks : {}) as Record<string, unknown>;
  const greeks = { delta: numeric(rawGreeks.delta ?? source.delta ?? extras.greeks?.delta), gamma: numeric(rawGreeks.gamma ?? source.gamma ?? extras.greeks?.gamma), theta: numeric(rawGreeks.theta ?? source.theta ?? extras.greeks?.theta), vega: numeric(rawGreeks.vega ?? source.vega ?? extras.greeks?.vega) };
  const hasGreeks = Object.values(greeks).some((value) => value !== null);
  const change = ltp !== null && previous !== null ? ltp - previous : numeric(source.change);
  return { ltp, bid: numeric(source.top_bid_price ?? source.best_bid_price ?? source.bid_price), ask: numeric(source.top_ask_price ?? source.best_ask_price ?? source.ask_price), volume: numeric(source.volume), oi: numeric(source.oi ?? extras.oi), change, change_percent: previous && change !== null ? (change / previous) * 100 : numeric(source.change_percent), iv: numeric(source.implied_volatility ?? source.iv ?? extras.iv), oi_change: numeric(source.oi_chg ?? extras.oiChange), greeks: hasGreeks ? greeks : null };
}
