import type { BrokerCredentials } from "./brokerConfig";
import { BaseBrokerAdapter, type BrokerResult, type HistoricalDataRequest, type NormalizedCandle, type NormalizedFunds, type NormalizedHolding, type NormalizedInstrument, type NormalizedOptionChain, type NormalizedOrder, type NormalizedPosition, type NormalizedQuote } from "./brokerAdapter";
import type { OptionData } from "./mockData";

const PROXY_BASE = import.meta.env.VITE_PROXY_URL || "http://localhost:4002";

type UpstoxResponse<T> = { status: string; data: T; message?: string };

export class UpstoxAdapter extends BaseBrokerAdapter {
  readonly id = "upstox" as const;
  readonly name = "Upstox";
  readonly capabilities = {
    authenticate: "not_verified" as const, profile: "not_verified" as const, funds: "not_verified" as const,
    instruments: "not_supported" as const, quote: "not_verified" as const, historical: "not_verified" as const,
    optionChain: "not_verified" as const, websocket: "not_verified" as const, positions: "not_verified" as const,
    holdings: "not_verified" as const, orders: "not_verified" as const, orderStatus: "not_verified" as const,
  };

  constructor(credentials?: BrokerCredentials) { super(credentials); }
  private get accessToken() { return this.credentials?.values.accessToken || ""; }

  private async request<T>(endpoint: string, params: Record<string, string> = {}): Promise<UpstoxResponse<T>> {
    if (!this.accessToken) throw new Error("Upstox access token is not configured.");
    const query = new URLSearchParams({ endpoint, ...params });
    const response = await fetch(`${PROXY_BASE}/api/upstox-proxy?${query}`, { headers: { Accept: "application/json" } });
    const body = await response.json() as UpstoxResponse<T>;
    if (!response.ok || body.status !== "success") throw new Error(body.message || `Upstox request failed (${response.status})`);
    return body;
  }

  async authenticate(): Promise<BrokerResult<true>> {
    if (!this.accessToken) return { provider: this.id, capability: "authenticate", state: "not_verified", message: "Upstox access token is required." };
    try { await this.request("profile"); return { provider: this.id, capability: "authenticate", state: "not_verified", data: true, message: "Profile response received; runtime credentials are not verified." }; }
    catch (error) { return { provider: this.id, capability: "authenticate", state: "not_verified", message: error instanceof Error ? error.message : "Upstox authentication failed." }; }
  }

  async getProfile() { return this.read("profile", "profile", (data) => data); }
  async getFunds(): Promise<BrokerResult<NormalizedFunds[]>> { return this.read("funds", "funds", (data: Record<string, Record<string, number>>) => Object.entries(data || {}).map(([segment, value]) => ({ segment, net: Number(value.available_margin || 0) - Number(value.used_margin || 0), available: Number(value.available_margin || 0), utilised: Number(value.used_margin || 0) }))); }
  getInstruments(): Promise<BrokerResult<NormalizedInstrument[]>> { return Promise.resolve({ provider: this.id, capability: "instruments", state: "not_supported", message: "Upstox instrument master is not exposed through the current proxy adapter." }); }

  async getQuote(symbol: string): Promise<BrokerResult<NormalizedQuote>> {
    if (!symbol.includes("|")) return { provider: this.id, capability: "quote", state: "not_verified", message: "Upstox quote requires an instrument_key such as NSE_EQ|ISIN." };
    return this.read("quote", "quote", (data: Record<string, { last_price: number }>) => { const quote = Object.values(data)[0]; if (!quote) throw new Error("Upstox returned no quote."); return { symbol, ltp: quote.last_price, change: 0, changePercent: 0, timestamp: new Date().toISOString() }; }, { instrumentKey: symbol });
  }

  async getHistoricalData(symbol: string, interval = "1", request?: HistoricalDataRequest): Promise<BrokerResult<NormalizedCandle[]>> {
    if (!symbol.includes("|")) return { provider: this.id, capability: "historical", state: "not_verified", message: "Upstox historical data requires an instrument_key." };
    const unit = interval === "D" || interval === "day" ? "days" : interval === "60" ? "hours" : "minutes";
    const normalizedInterval = interval === "D" || interval === "day" ? "1" : interval;
    const today = new Date().toISOString().slice(0, 10);
    return this.read("historical", "historical", (data: { candles: Array<[string, number, number, number, number, number]> }) => data.candles.map(([timestamp, open, high, low, close, volume]) => ({ timestamp: Math.floor(new Date(timestamp).getTime() / 1000), open, high, low, close, volume })), { instrumentKey: symbol, unit, interval: normalizedInterval, fromDate: request?.fromDate?.slice(0, 10) || today, toDate: request?.toDate?.slice(0, 10) || today });
  }

  async getOptionChain(symbol: string, expiry = "current_week"): Promise<BrokerResult<NormalizedOptionChain>> {
    return this.read("option-chain", "optionChain", (data: Array<Record<string, unknown>>) => ({ symbol, spotPrice: Number(data[0]?.underlying_spot_price || 0), expiries: [...new Set(data.map((row) => String(row.expiry || expiry)))], chain: data as unknown as OptionData[] }), { instrumentKey: symbol, expiryDate: expiry });
  }

  connectWebSocket(): Promise<BrokerResult<true>> { return Promise.resolve({ provider: this.id, capability: "websocket", state: "not_verified", message: "Upstox authorized WebSocket URL is available, but normalized binary streaming is not enabled in this terminal." }); }
  subscribe() { return () => undefined; }
  unsubscribe() { return undefined; }
  disconnectWebSocket() { return undefined; }

  async getPositions(): Promise<BrokerResult<NormalizedPosition[]>> { return this.read("positions", "positions", (data: Array<Record<string, unknown>>) => data.map((p) => ({ symbol: String(p.tradingsymbol || p.trading_symbol || ""), exchange: String(p.exchange || ""), quantity: Number(p.quantity || 0), averagePrice: Number(p.average_price || 0), lastPrice: Number(p.last_price || 0), pnl: Number(p.pnl || p.unrealised || 0) }))); }
  async getHoldings(): Promise<BrokerResult<NormalizedHolding[]>> { return this.read("holdings", "holdings", (data: Array<Record<string, unknown>>) => data.map((p) => ({ symbol: String(p.tradingsymbol || p.trading_symbol || ""), exchange: String(p.exchange || ""), quantity: Number(p.quantity || 0), averagePrice: Number(p.average_price || 0), lastPrice: Number(p.last_price || 0), pnl: Number(p.pnl || 0) }))); }
  async getOrders(): Promise<BrokerResult<NormalizedOrder[]>> { return this.read("orders", "orders", (data: Array<Record<string, unknown>>) => data.map(normalizeOrder)); }
  async getOrderStatus(orderId: string): Promise<BrokerResult<NormalizedOrder[]>> { return this.read("order-status", "orderStatus", (data: Record<string, unknown>) => [normalizeOrder(data)], { orderId }); }
  placeOrder() { return Promise.resolve({ provider: this.id, capability: "orders" as const, state: "not_verified" as const, message: "Live Upstox order placement is intentionally disabled." }); }
  modifyOrder() { return Promise.resolve({ provider: this.id, capability: "orders" as const, state: "not_verified" as const, message: "Live Upstox order modification is intentionally disabled." }); }
  cancelOrder() { return Promise.resolve({ provider: this.id, capability: "orders" as const, state: "not_verified" as const, message: "Live Upstox order cancellation is intentionally disabled." }); }

  private async read<T, R>(endpoint: string, capability: "profile" | "funds" | "quote" | "historical" | "optionChain" | "positions" | "holdings" | "orders" | "orderStatus", normalize: (data: T) => R, params: Record<string, string> = {}): Promise<BrokerResult<R>> {
    try { const response = await this.request<T>(endpoint, params); return { provider: this.id, capability, state: "not_verified", data: normalize(response.data) }; }
    catch (error) { return { provider: this.id, capability, state: "not_verified", message: error instanceof Error ? error.message : `Upstox ${capability} unavailable.` }; }
  }
}

function normalizeOrder(order: Record<string, unknown>): NormalizedOrder {
  return { orderId: String(order.order_id || ""), symbol: String(order.tradingsymbol || order.trading_symbol || ""), exchange: String(order.exchange || ""), side: String(order.transaction_type || ""), quantity: Number(order.quantity || 0), filledQuantity: Number(order.filled_quantity || 0), status: String(order.status || ""), averagePrice: Number(order.average_price || 0), placedAt: order.order_timestamp ? String(order.order_timestamp) : undefined, message: order.status_message ? String(order.status_message) : undefined };
}
