import type { BrokerCredentials } from "./brokerConfig";
import {
  BaseBrokerAdapter,
  type BrokerResult,
  type HistoricalDataRequest,
  type NormalizedCandle,
  type NormalizedFunds,
  type NormalizedHolding,
  type NormalizedInstrument,
  type NormalizedOptionChain,
  type NormalizedOrder,
  type NormalizedPosition,
  type NormalizedQuote,
} from "./brokerAdapter";

const PROXY_BASE = import.meta.env.VITE_PROXY_URL || "http://localhost:4002";

export class AngelOneAdapter extends BaseBrokerAdapter {
  readonly id = "angel_one" as const;
  readonly name = "Angel One/SmartAPI";
  readonly capabilities = {
    authenticate: "not_verified" as const,
    profile: "not_verified" as const,
    funds: "not_verified" as const,
    instruments: "not_verified" as const,
    quote: "not_verified" as const,
    historical: "not_verified" as const,
    optionChain: "not_supported" as const,
    websocket: "not_verified" as const,
    positions: "not_verified" as const,
    holdings: "not_verified" as const,
    orders: "not_verified" as const,
    orderStatus: "not_verified" as const,
  };

  constructor(credentials?: BrokerCredentials) {
    super(credentials);
  }

  private get apiKey() { return this.credentials?.values.apiKey || ""; }
  private get clientCode() { return this.credentials?.values.clientId || ""; }
  private get password() { return this.credentials?.values.password || ""; }
  private get totp() { return this.credentials?.values.totpSecret || ""; }
  private get jwtToken() { return this.credentials?.values.jwtToken || ""; }

  private async request<T>(endpoint: string, params: Record<string, string> = {}): Promise<{ status: boolean; message?: string; data: T }> {
    const query = new URLSearchParams({ endpoint, ...params });
    const response = await fetch(`${PROXY_BASE}/api/angel-proxy?${query}`, { headers: { Accept: "application/json" } });
    const body = await response.json() as { status: boolean; message?: string; data: T };
    if (!response.ok || body.status !== true) throw new Error(body.message || `Angel One request failed (${response.status})`);
    return body;
  }

  async authenticate(): Promise<BrokerResult<true>> {
    if (!this.apiKey || !this.clientCode || !this.password || !this.totp) {
      return { provider: this.id, capability: "authenticate", state: "not_verified", message: "Angel One API key, client ID, password/MPIN, and TOTP are required." };
    }
    try {
      return { provider: this.id, capability: "authenticate", state: "not_verified", message: "Angel One credentials must be configured on the server proxy." };
    } catch (error) {
      return { provider: this.id, capability: "authenticate", state: "not_verified", message: error instanceof Error ? error.message : "Angel One authentication failed." };
    }
  }

  async getProfile() { return this.read("profile", "profile", (data) => data); }

  async getFunds(): Promise<BrokerResult<NormalizedFunds[]>> {
    return this.read("funds", "funds", (data: Record<string, string>) => [{ segment: "all", net: Number(data.net || 0), available: Number(data.availablecash || 0), utilised: Number(data.utiliseddebits || 0) }]);
  }

  async getInstruments(): Promise<BrokerResult<NormalizedInstrument[]>> {
    try {
      const response = await fetch("https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json");
      if (!response.ok) throw new Error(`Angel One instrument master failed (${response.status})`);
      const data = await response.json() as Array<Record<string, string>>;
      return { provider: this.id, capability: "instruments", state: "not_verified", data: data.map((item) => ({ symbol: item.name || item.symbol, tradingSymbol: item.symbol, securityId: item.token, exchangeSegment: item.exch_seg, instrumentType: item.instrumenttype })) };
    } catch (error) {
      return { provider: this.id, capability: "instruments", state: "not_verified", message: error instanceof Error ? error.message : "Angel One instruments unavailable." };
    }
  }

  async getQuote(symbol: string): Promise<BrokerResult<NormalizedQuote>> {
    return this.read("quote", "quote", (data: Record<string, string | number>) => { const ltp = Number(data.ltp || 0); const close = Number(data.close || ltp); return { symbol: String(data.tradingsymbol || symbol), ltp, change: ltp - close, changePercent: close ? ((ltp - close) / close) * 100 : 0, timestamp: new Date().toISOString() }; }, { exchange: "NSE", symbolToken: symbol });
  }

  async getHistoricalData(symbol: string, interval = "ONE_DAY", request?: HistoricalDataRequest): Promise<BrokerResult<NormalizedCandle[]>> {
    return this.read("historical", "historical", (data: Array<[string, number, number, number, number, number]>) => data.map(([timestamp, open, high, low, close, volume]) => ({ timestamp: Math.floor(new Date(timestamp).getTime() / 1000), open, high, low, close, volume })), { exchange: request?.exchangeSegment || "NSE", symbolToken: symbol, interval, fromDate: request?.fromDate || "", toDate: request?.toDate || "" });
  }

  getOptionChain(_symbol: string, _expiry?: string): Promise<BrokerResult<NormalizedOptionChain>> { return Promise.resolve({ provider: this.id, capability: "optionChain", state: "not_supported", message: "SmartAPI exposes option Greeks but no normalized option-chain endpoint in this adapter." }); }
  connectWebSocket(): Promise<BrokerResult<true>> { return Promise.resolve({ provider: this.id, capability: "websocket", state: "not_verified", message: "SmartAPI WebSocket 2.0 requires a binary Angel relay; no runtime relay is configured." }); }
  subscribe() { return () => undefined; }
  unsubscribe() { return undefined; }
  disconnectWebSocket() { return undefined; }

  async getPositions(): Promise<BrokerResult<NormalizedPosition[]>> {
    return this.read("positions", "positions", (data: Array<Record<string, string>>) => data.map((item) => ({ symbol: item.tradingsymbol || "", exchange: item.exchange || "", quantity: Number(item.netqty || 0), averagePrice: Number(item.avgnetprice || 0), lastPrice: Number(item.ltp || 0), pnl: Number(item.pnl || 0) })));
  }

  async getHoldings(): Promise<BrokerResult<NormalizedHolding[]>> {
    return this.read("holdings", "holdings", (data: { holdings?: Array<Record<string, string>> }) => (data.holdings || []).map((item) => ({ symbol: item.tradingsymbol || "", exchange: item.exchange || "", quantity: Number(item.quantity || 0), averagePrice: Number(item.averageprice || 0), lastPrice: Number(item.ltp || 0), pnl: Number(item.profitandloss || 0) })));
  }

  async getOrders(): Promise<BrokerResult<NormalizedOrder[]>> {
    return this.read("orders", "orders", (data: Array<Record<string, string>>) => data.map(normalizeAngelOrder));
  }

  async getOrderStatus(orderId: string): Promise<BrokerResult<NormalizedOrder[]>> {
    return this.read("order-status", "orderStatus", (data: Record<string, string>) => [normalizeAngelOrder(data)], { orderId });
  }

  placeOrder() { return Promise.resolve({ provider: this.id, capability: "orders" as const, state: "not_verified" as const, message: "Live Angel One order placement is intentionally disabled in this terminal." }); }
  modifyOrder() { return Promise.resolve({ provider: this.id, capability: "orders" as const, state: "not_verified" as const, message: "Live Angel One order modification is intentionally disabled in this terminal." }); }
  cancelOrder() { return Promise.resolve({ provider: this.id, capability: "orders" as const, state: "not_verified" as const, message: "Live Angel One order cancellation is intentionally disabled in this terminal." }); }

  private async read<T, R>(endpoint: string, capability: "profile" | "funds" | "quote" | "historical" | "positions" | "holdings" | "orders" | "orderStatus", normalize: (data: T) => R, params: Record<string, string> = {}): Promise<BrokerResult<R>> {
    try {
      const response = await this.request<T>(endpoint, params);
      return { provider: this.id, capability, state: "not_verified", data: normalize(response.data) };
    } catch (error) {
      return { provider: this.id, capability, state: "not_verified", message: error instanceof Error ? error.message : `Angel One ${capability} unavailable.` };
    }
  }
}

function normalizeAngelOrder(order: Record<string, string>): NormalizedOrder {
  return { orderId: String(order.orderid || order.uniqueorderid || ""), symbol: String(order.tradingsymbol || ""), exchange: String(order.exchange || ""), side: String(order.transactiontype || ""), quantity: Number(order.quantity || 0), filledQuantity: Number(order.filledshares || 0), status: String(order.orderstatus || order.status || ""), averagePrice: Number(order.averageprice || 0), placedAt: order.updatetime, message: order.text };
}
