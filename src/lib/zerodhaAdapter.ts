import type { BrokerCredentials } from "./brokerConfig";
import {
  BaseBrokerAdapter,
  type BrokerResult,
  type NormalizedCandle,
  type NormalizedFunds,
  type NormalizedHolding,
  type NormalizedInstrument,
  type NormalizedOrder,
  type NormalizedPosition,
  type NormalizedQuote,
  type NormalizedOptionChain,
  type NormalizedTick,
  type HistoricalDataRequest,
} from "./brokerAdapter";
import { marketWS } from "./websocketClient";
import { InstrumentMaster, normalizeProviderInstrument } from "./instrumentMaster";
import { normalizeQuote, toLegacyQuote } from "./quoteService";
import type { OptionData, OptionLegData } from "./mockData";

const KITE_INDEX_NAMES = new Set(["NIFTY", "NIFTY 50", "BANKNIFTY", "NIFTY BANK", "FINNIFTY", "NIFTY FIN SERVICE", "MIDCPNIFTY", "NIFTY MID SELECT", "NIFTY MIDCAP 50", "INDIA VIX", "SENSEX"]);

const PROXY_BASE = import.meta.env.VITE_PROXY_URL || "";

type KiteResponse<T> = { status: string; data: T; error_type?: string; message?: string };
type KiteQuote = {
  last_price?: number;
  volume?: number;
  oi?: number;
  ohlc?: { open?: number; high?: number; low?: number; close?: number };
  depth?: { buy?: Array<{ price?: number; quantity?: number }>; sell?: Array<{ price?: number; quantity?: number }> };
  timestamp?: string;
  last_trade_time?: string;
};

const KITE_UNDERLYING_NAMES: Record<string, string> = {
  NIFTY: "NIFTY",
  BANKNIFTY: "BANKNIFTY",
  FINNIFTY: "FINNIFTY",
};
const KITE_UNDERLYING_SYMBOLS: Record<string, string> = {
  NIFTY: "NIFTY 50",
  BANKNIFTY: "NIFTY BANK",
  FINNIFTY: "NIFTY FIN SERVICE",
};
const KITE_QUOTE_BATCH_SIZE = 75;
const KITE_QUOTE_CONCURRENCY = 3;
const KITE_INSTRUMENT_CACHE_TTL = 10 * 60 * 1000;
const kiteInstrumentCache = new Map<string, { expiresAt: number; data: NormalizedInstrument[] }>();
const kiteInstrumentRequests = new Map<string, Promise<NormalizedInstrument[]>>();

export function resetKiteInstrumentCache(): void {
  kiteInstrumentCache.clear();
  kiteInstrumentRequests.clear();
}

function unavailable<T>(capability: "optionChain" | "websocket"): BrokerResult<T> {
  return {
    provider: "zerodha",
    capability,
    state: "not_supported",
    message: capability === "optionChain"
      ? "Kite Connect does not expose an option-chain endpoint; use instruments and quotes instead."
      : "Kite WebSocket requires a server-side binary relay; it is not enabled in this terminal yet.",
  };
}

export class ZerodhaAdapter extends BaseBrokerAdapter {
  readonly id = "zerodha" as const;
  readonly name = "Zerodha/Kite";
  readonly capabilities = {
    authenticate: "not_verified" as const,
    profile: "not_verified" as const,
    funds: "not_verified" as const,
    instruments: "not_verified" as const,
    quote: "not_verified" as const,
    historical: "not_verified" as const,
    optionChain: "not_verified" as const,
    websocket: "not_supported" as const,
    positions: "not_verified" as const,
    holdings: "not_verified" as const,
    orders: "not_verified" as const,
    orderStatus: "not_verified" as const,
  };

  constructor(credentials?: BrokerCredentials) {
    super(credentials);
  }

  private get apiKey() { return this.credentials?.values.apiKey || ""; }
  private get accessToken() { return this.credentials?.values.accessToken || ""; }

  private async request<T>(endpoint: string, params: Record<string, string> = {}): Promise<KiteResponse<T>> {
    const query = new URLSearchParams({ endpoint, ...params });
    const response = await fetch(`${PROXY_BASE}/api/kite-proxy?${query}`, {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    const body = await response.json() as KiteResponse<T>;
    if (!response.ok || body.status !== "success") throw new Error(body.message || `Kite request failed (${response.status})`);
    return body;
  }

  async authenticate(): Promise<BrokerResult<true>> {
    if (!this.apiKey && !this.accessToken) {
      return { provider: this.id, capability: "authenticate", state: "not_verified", message: "Kite API key or access token are not configured." };
    }
    try {
      await this.request("profile");
      return { provider: this.id, capability: "authenticate", state: "available", data: true, message: "Kite profile request succeeded." };
    } catch (error) {
      return { provider: this.id, capability: "authenticate", state: "not_verified", message: error instanceof Error ? error.message : "Kite authentication failed." };
    }
  }

  async getProfile() {
    try { return { provider: this.id, capability: "profile" as const, state: "not_verified" as const, data: (await this.request("profile")).data }; }
    catch (error) { return { provider: this.id, capability: "profile" as const, state: "not_verified" as const, message: error instanceof Error ? error.message : "Kite profile unavailable." }; }
  }

  async getFunds(): Promise<BrokerResult<NormalizedFunds[]>> {
    try {
      const response = await this.request<Record<string, { net: number; available?: { live_balance?: number; cash?: number }; utilised?: { debits?: number } }>>("margins");
      const data = Object.entries(response.data || {}).map(([segment, value]) => ({ segment, net: value.net || 0, available: value.available?.live_balance ?? value.available?.cash ?? 0, utilised: value.utilised?.debits ?? 0 }));
      return { provider: this.id, capability: "funds", state: "not_verified", data };
    } catch (error) { return { provider: this.id, capability: "funds", state: "not_verified", message: error instanceof Error ? error.message : "Kite funds unavailable." }; }
  }

  async getInstruments(): Promise<BrokerResult<NormalizedInstrument[]>> {
    const cacheKey = `${this.apiKey || "session"}:${this.accessToken}`;
    const cached = kiteInstrumentCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { provider: this.id, capability: "instruments", state: "not_verified", data: cached.data };
    }
    const pending = kiteInstrumentRequests.get(cacheKey);
    if (pending) {
      try {
        return { provider: this.id, capability: "instruments", state: "not_verified", data: await pending };
      } catch (error) {
        return { provider: this.id, capability: "instruments", state: "not_verified", message: error instanceof Error ? error.message : "Kite instruments unavailable." };
      }
    }
    const request = this.loadInstruments(cacheKey);
    kiteInstrumentRequests.set(cacheKey, request);
    try {
      const data = await request;
      return { provider: this.id, capability: "instruments", state: "not_verified", data };
    } catch (error) { return { provider: this.id, capability: "instruments", state: "not_verified", message: error instanceof Error ? error.message : "Kite instruments unavailable." }; }
  }

  private async loadInstruments(cacheKey: string): Promise<NormalizedInstrument[]> {
    try {
      const response = await this.request<Array<Record<string, string>>>("instruments");
      const data = response.data.map((item, index) => normalizeProviderInstrument({
        ...item,
        exchangeSegment: item.instrument_type === "INDEX" || item.segment === "INDICES"
          ? "IDX_I"
          : item.segment === "NSE" ? "NSE_EQ" : item.segment?.startsWith("NFO") ? "NFO" : item.segment?.startsWith("BFO") ? "BFO" : item.segment,
        instrumentType: normalizeKiteInstrumentType(item),
        optionType: item.instrument_type,
        tickSize: item.tick_size,
      }, "zerodha", index).instrument).filter((item): item is NormalizedInstrument => !!item);
      kiteInstrumentCache.set(cacheKey, { data, expiresAt: Date.now() + KITE_INSTRUMENT_CACHE_TTL });
      return data;
    } finally {
      kiteInstrumentRequests.delete(cacheKey);
    }
  }

  async getQuote(symbol: string): Promise<BrokerResult<NormalizedQuote>> {
    try {
      const quoteSymbol = KITE_UNDERLYING_SYMBOLS[symbol.toUpperCase()] || symbol.toUpperCase();
      const response = await this.request<Record<string, { last_price: number; ohlc?: { close?: number }; timestamp?: string }>>("quote", { instrument: `NSE:${quoteSymbol}` });
      const quote = Object.values(response.data)[0];
      if (!quote) throw new Error(`Kite returned no quote for ${symbol}`);
      const close = quote.ohlc?.close ?? quote.last_price;
      return { provider: this.id, capability: "quote", state: "not_verified", data: { symbol: symbol.toUpperCase(), ltp: quote.last_price, change: quote.last_price - close, changePercent: close ? ((quote.last_price - close) / close) * 100 : 0, timestamp: quote.timestamp || new Date().toISOString() } };
    } catch (error) { return { provider: this.id, capability: "quote", state: "not_verified", message: error instanceof Error ? error.message : "Kite quote unavailable." }; }
  }

  async getQuotes(symbols: string[]): Promise<BrokerResult<NormalizedQuote[]> & { data: NormalizedQuote[] }> {
    if (symbols.length === 0) return { provider: this.id, capability: "quote", state: "not_verified", data: [] };
    try {
      const instrumentResult = await this.getInstruments();
      if (!instrumentResult.data) throw new Error(instrumentResult.message || "Kite instrument master unavailable.");

      const master = new InstrumentMaster();
      master.addAll(instrumentResult.data);
      const requested = symbols.map((value) => {
        const separator = value.indexOf(":");
        const exchange = separator < 0 ? "NSE" : value.slice(0, separator).toUpperCase();
        const tradingSymbol = separator < 0 ? value : value.slice(separator + 1);
        return { key: `${exchange}:${tradingSymbol}`, exchange, tradingSymbol };
      });
      const batches: string[][] = [];
      for (let offset = 0; offset < requested.length; offset += KITE_QUOTE_BATCH_SIZE) {
        batches.push(requested.slice(offset, offset + KITE_QUOTE_BATCH_SIZE).map((item) => item.key));
      }

      const rawQuotes: Record<string, KiteQuote> = {};
      let nextBatch = 0;
      const worker = async () => {
        while (nextBatch < batches.length) {
          const batch = batches[nextBatch++];
          const response = await this.request<Record<string, KiteQuote>>("quote", { instruments: batch.join(",") });
          Object.assign(rawQuotes, response.data || {});
        }
      };
      await Promise.all(Array.from({ length: Math.min(KITE_QUOTE_CONCURRENCY, batches.length) }, () => worker()));

      const quotes = requested.flatMap(({ key, exchange, tradingSymbol }) => {
        const instrument = instrumentResult.data!.find((item) => {
          const quoteExchange = item.exchangeSegment === "NFO" || item.exchangeSegment === "NSE_FNO" ? "NFO" : item.exchange;
          return quoteExchange === exchange && item.tradingSymbol.toUpperCase() === tradingSymbol.toUpperCase();
        });
        const rawQuote = rawQuotes[key];
        if (!instrument || !rawQuote) return [];
        const normalized = normalizeQuote({
          provider: this.id,
          payload: { ...rawQuote, timestamp: rawQuote.timestamp ?? rawQuote.last_trade_time },
          instrumentId: instrument.securityId,
          providerInstrumentId: instrument.providerInstrumentId,
          exchange: instrument.exchange,
          symbol: instrument.tradingSymbol,
        }, master);
        const quote = normalized.quote ? toLegacyQuote(normalized.quote) : undefined;
        return quote ? [quote] : [];
      });

      return {
        provider: this.id,
        capability: "quote",
        state: "not_verified",
        data: quotes,
        message: quotes.length < requested.length ? "Kite omitted one or more requested quotes." : undefined,
      };
    } catch (error) {
      return { provider: this.id, capability: "quote", state: "not_verified", data: [], message: error instanceof Error ? error.message : "Kite quotes unavailable." };
    }
  }

  async getOptionChain(symbol: string, expiry?: string): Promise<BrokerResult<NormalizedOptionChain>> {
    try {
      const instruments = await this.getInstruments();
      if (!instruments.data) throw new Error("Kite instrument master unavailable.");
      const underlyingName = KITE_UNDERLYING_NAMES[symbol.toUpperCase()] || symbol.toUpperCase();
      const contracts = instruments.data.filter((item) =>
        (item.exchangeSegment === "NFO" || item.exchangeSegment === "NSE_FNO") &&
        (item.instrumentType === "OPTIDX" || item.instrumentType === "OPTSTK") &&
        item.symbol === underlyingName &&
        (!expiry || item.expiryDate === expiry)
      );
      const expiries = [...new Set(contracts.map((item) => item.expiryDate).filter(Boolean) as string[])].sort();
      const selectedExpiry = expiry || expiries[0];
      const selectedContracts = contracts.filter((item) => item.expiryDate === selectedExpiry && item.securityId && item.strikePrice && item.optionType);
      if (selectedContracts.length === 0) {
        return { provider: this.id, capability: "optionChain", state: "not_verified", data: { symbol, spotPrice: 0, expiries, chain: [], source: "broker", greeksAvailable: false, depthAvailable: false }, message: "Kite returned no valid option contracts for the selected expiry." };
      }

      const quotes = await this.getOptionQuotes(selectedContracts);
      const pairs = new Map<number, { ce?: NormalizedInstrument; pe?: NormalizedInstrument }>();
      for (const contract of selectedContracts) {
        const pair = pairs.get(contract.strikePrice!) || {};
        pair[contract.optionType === "CE" ? "ce" : "pe"] = contract;
        pairs.set(contract.strikePrice!, pair);
      }
      const chain: OptionData[] = [...pairs.entries()].sort(([a], [b]) => a - b).map(([strikePrice, pair]) => ({
        strikePrice,
        ce: normalizeKiteOptionLeg(pair.ce && quotes[`NFO:${pair.ce.tradingSymbol}`]),
        pe: normalizeKiteOptionLeg(pair.pe && quotes[`NFO:${pair.pe.tradingSymbol}`]),
      }));
      const underlyingQuote = await this.request<Record<string, KiteQuote>>("quote", { instrument: `NSE:${KITE_UNDERLYING_SYMBOLS[symbol.toUpperCase()] || symbol.toUpperCase()}` });
      const underlying = Object.values(underlyingQuote.data || {})[0];
      const spotPrice = underlying?.last_price || 0;
      const quoteTime = underlying?.timestamp ? new Date(underlying.timestamp).getTime() : 0;
      const afterHours = !quoteTime || Date.now() - quoteTime > 15 * 60 * 1000;
      return { provider: this.id, capability: "optionChain", state: "available", data: { symbol, spotPrice, expiries, chain, source: "broker", greeksAvailable: false, depthAvailable: chain.some((row) => row.ce.bidPrice > 0 || row.pe.bidPrice > 0), afterHours } };
    } catch (error) {
      console.warn("Kite option-chain construction failed:", error instanceof Error ? error.message : error);
      return { provider: this.id, capability: "optionChain", state: "not_verified", message: error instanceof Error ? error.message : "Kite option-chain construction failed." };
    }
  }

  private async getOptionQuotes(contracts: NormalizedInstrument[]): Promise<Record<string, KiteQuote>> {
    const batches: NormalizedInstrument[][] = [];
    for (let offset = 0; offset < contracts.length; offset += KITE_QUOTE_BATCH_SIZE) {
      batches.push(contracts.slice(offset, offset + KITE_QUOTE_BATCH_SIZE));
    }

    const quotes: Record<string, KiteQuote> = {};
    let nextBatch = 0;
    const worker = async () => {
      while (nextBatch < batches.length) {
        const batch = batches[nextBatch++];
        const instruments = batch.map((item) => `NFO:${item.tradingSymbol}`);
        const quoteResult = await this.request<Record<string, KiteQuote>>("quote", { instruments: instruments.join(",") });
        for (const instrument of instruments) {
          const quote = quoteResult.data?.[instrument];
          if (!quote) throw new Error(`Kite quote response omitted ${instrument}`);
          quotes[instrument] = quote;
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(KITE_QUOTE_CONCURRENCY, batches.length) }, () => worker()));
    return quotes;
  }

  async getHistoricalData(symbol: string, interval = "day", request?: HistoricalDataRequest): Promise<BrokerResult<NormalizedCandle[]>> {
    if (!/^\d+$/.test(symbol)) return { provider: this.id, capability: "historical", state: "not_verified", message: "Kite historical data requires an instrument token, not a display symbol." };
    try {
      const response = await this.request<{ candles: Array<[string, number, number, number, number, number]> }>("historical", { instrumentToken: symbol, interval, from: request?.fromDate || "", to: request?.toDate || "" });
      const data = response.data.candles.map(([timestamp, open, high, low, close, volume]) => ({ timestamp: Math.floor(new Date(timestamp).getTime() / 1000), open, high, low, close, volume }));
      return { provider: this.id, capability: "historical", state: "not_verified", data };
    } catch (error) { return { provider: this.id, capability: "historical", state: "not_verified", message: error instanceof Error ? error.message : "Kite historical data unavailable." }; }
  }

  connectWebSocket(): Promise<BrokerResult<true>> {
    marketWS.connect("zerodha");
    return Promise.resolve({
      provider: this.id,
      capability: "websocket",
      state: marketWS.isKiteConnected ? "available" : "not_verified",
      data: true,
      message: "Kite WebSocket connection initiated through the authenticated server-side session.",
    });
  }
  subscribe(symbol: string, onTick: (tick: NormalizedTick) => void) {
    return marketWS.subscribeSymbol(symbol, onTick);
  }
  unsubscribe(symbol: string, onTick: (tick: NormalizedTick) => void) {
    void symbol;
    void onTick;
  }
  disconnectWebSocket() { marketWS.disconnect(); }

  async getPositions(): Promise<BrokerResult<NormalizedPosition[]>> {
    try { const response = await this.request<{ net: Array<Record<string, number | string>> }>("positions"); return { provider: this.id, capability: "positions", state: "not_verified", data: (response.data.net || []).map((p) => ({ symbol: String(p.tradingsymbol), exchange: String(p.exchange), quantity: Number(p.quantity || 0), averagePrice: Number(p.average_price || 0), lastPrice: Number(p.last_price || 0), pnl: Number(p.pnl || 0) })) }; }
    catch (error) { return { provider: this.id, capability: "positions", state: "not_verified", message: error instanceof Error ? error.message : "Kite positions unavailable." }; }
  }

  async getHoldings(): Promise<BrokerResult<NormalizedHolding[]>> {
    try { const response = await this.request<Array<Record<string, number | string>>>("holdings"); return { provider: this.id, capability: "holdings", state: "not_verified", data: response.data.map((p) => ({ symbol: String(p.tradingsymbol), exchange: String(p.exchange), quantity: Number(p.quantity || 0), averagePrice: Number(p.average_price || 0), lastPrice: Number(p.last_price || 0), pnl: Number(p.pnl || 0) })) }; }
    catch (error) { return { provider: this.id, capability: "holdings", state: "not_verified", message: error instanceof Error ? error.message : "Kite holdings unavailable." }; }
  }

  async getOrders(): Promise<BrokerResult<NormalizedOrder[]>> {
    try { const response = await this.request<Array<Record<string, number | string>>>("orders"); return { provider: this.id, capability: "orders", state: "not_verified", data: response.data.map(normalizeKiteOrder) }; }
    catch (error) { return { provider: this.id, capability: "orders", state: "not_verified", message: error instanceof Error ? error.message : "Kite orders unavailable." }; }
  }

  async getOrderStatus(orderId: string): Promise<BrokerResult<NormalizedOrder[]>> {
    try { const response = await this.request<Array<Record<string, number | string>>>("order-status", { orderId }); return { provider: this.id, capability: "orderStatus", state: "not_verified", data: response.data.map(normalizeKiteOrder) }; }
    catch (error) { return { provider: this.id, capability: "orderStatus", state: "not_verified", message: error instanceof Error ? error.message : "Kite order status unavailable." }; }
  }

  placeOrder() { return Promise.resolve({ provider: this.id, capability: "orders" as const, state: "not_verified" as const, message: "Live Kite order placement is intentionally disabled in this terminal." }); }
  modifyOrder() { return Promise.resolve({ provider: this.id, capability: "orders" as const, state: "not_verified" as const, message: "Live Kite order modification is intentionally disabled in this terminal." }); }
  cancelOrder() { return Promise.resolve({ provider: this.id, capability: "orders" as const, state: "not_verified" as const, message: "Live Kite order cancellation is intentionally disabled in this terminal." }); }
}

function normalizeKiteInstrumentType(item: Record<string, string>): string {
  if (item.instrument_type === "INDEX") return "INDEX";
  if (item.instrument_type === "EQ") return "EQUITY";
  if (item.instrument_type === "FUT") return KITE_INDEX_NAMES.has(item.name) ? "FUTIDX" : "FUTSTK";
  if (item.instrument_type === "CE" || item.instrument_type === "PE") return KITE_INDEX_NAMES.has(item.name) ? "OPTIDX" : "OPTSTK";
  return item.instrument_type;
}

function emptyKiteOptionLeg(): OptionLegData {
  return { ltp: 0, oi: 0, oiChange: 0, volume: 0, iv: 0, delta: 0, gamma: 0, theta: 0, vega: 0, bidPrice: 0, askPrice: 0 };
}

function normalizeKiteOptionLeg(quote: KiteQuote | undefined): OptionLegData {
  if (!quote) return emptyKiteOptionLeg();
  return {
    ltp: quote.last_price || 0,
    oi: quote.oi || 0,
    oiChange: 0,
    volume: quote.volume || 0,
    iv: 0,
    delta: 0,
    gamma: 0,
    theta: 0,
    vega: 0,
    bidPrice: quote.depth?.buy?.[0]?.price || 0,
    askPrice: quote.depth?.sell?.[0]?.price || 0,
  };
}

function normalizeKiteOrder(order: Record<string, number | string>): NormalizedOrder {
  return { orderId: String(order.order_id), symbol: String(order.tradingsymbol || ""), exchange: String(order.exchange || ""), side: String(order.transaction_type || ""), quantity: Number(order.quantity || 0), filledQuantity: Number(order.filled_quantity || 0), status: String(order.status || ""), averagePrice: Number(order.average_price || 0), placedAt: order.order_timestamp ? String(order.order_timestamp) : undefined, message: order.status_message ? String(order.status_message) : undefined };
}
