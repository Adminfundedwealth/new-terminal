import type { BrokerCredentials } from "./brokerConfig";
import type { OptionData } from "./mockData";
import type { Instrument } from "./localDatabase";
import type { Quote } from "./quoteService";

export type BrokerId = "dhan" | "zerodha" | "angel_one" | "upstox" | "fivepaisa" | "fyers" | "aliceblue";
export type BrokerCapability =
  | "authenticate" | "profile" | "funds" | "instruments" | "quote" | "historical"
  | "optionChain" | "websocket" | "positions" | "holdings" | "orders" | "orderStatus";

export type BrokerConnectionState = "disconnected" | "connecting" | "connected" | "authentication_required" | "error";
export type CanonicalBrokerOrderStatus =
  | "pending" | "open" | "partially_filled" | "filled" | "rejected" | "cancelled" | "trigger_pending" | "unknown";
export type BrokerErrorCategory =
  | "authentication_failure" | "validation_failure" | "insufficient_funds" | "instrument_error"
  | "rate_limit" | "provider_unavailable" | "unknown";

export interface BrokerConnectionStatus {
  provider: BrokerId;
  state: BrokerConnectionState;
  message?: string;
}

export interface NormalizedAccount {
  provider: BrokerId;
  providerAccountId?: string;
  accountStatus?: string;
  availableBalance?: number;
  usedMargin?: number;
  availableMargin?: number;
}

export interface BrokerError {
  provider: BrokerId;
  code?: string;
  category: BrokerErrorCategory;
  message: string;
  retryable: boolean | null;
}

export type CapabilityState = "available" | "not_supported" | "not_verified";

export interface BrokerCapabilities {
  [capability: string]: CapabilityState;
}

export interface NormalizedQuote extends Quote {
  symbol: string;
  ltp: number;
  change: number;
  changePercent: number;
  timestamp: string;
}

export interface NormalizedCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type NormalizedInstrument = Instrument;

export interface NormalizedFunds {
  segment: string;
  net: number;
  available: number;
  utilised: number;
}

export interface NormalizedPosition {
  symbol: string;
  exchange: string;
  quantity: number;
  averagePrice: number;
  lastPrice: number;
  pnl: number;
  instrumentId?: string;
  providerInstrumentId?: string;
  side?: "BUY" | "SELL" | "LONG" | "SHORT" | string;
  realizedPnl?: number;
  unrealizedPnl?: number;
  product?: string;
  positionId?: string;
}

export interface NormalizedHolding {
  symbol: string;
  exchange: string;
  quantity: number;
  averagePrice: number;
  lastPrice: number;
  pnl: number;
}

export interface NormalizedOrder {
  orderId: string;
  symbol: string;
  exchange: string;
  side: string;
  quantity: number;
  filledQuantity: number;
  status: string;
  averagePrice: number;
  placedAt?: string;
  message?: string;
  instrumentId?: string;
  providerInstrumentId?: string;
  clientOrderId?: string;
  orderType?: string;
  product?: string;
  canonicalStatus?: CanonicalBrokerOrderStatus;
  rejectionReason?: string;
}

export interface NormalizedOptionChain {
  symbol: string;
  spotPrice: number;
  expiries: string[];
  chain: OptionData[];
  source?: "broker";
  totalCEOI?: number;
  totalPEOI?: number;
  oiChangeAvailable?: boolean;
  cachedAt?: string | number | null;
  greeksAvailable?: boolean;
  depthAvailable?: boolean;
  afterHours?: boolean;
}

export interface NormalizedTick extends NormalizedQuote {
  securityId: number;
  exchangeSegment: string;
  volume?: number;
  openInterest?: number;
}

export interface BrokerResult<T> {
  provider: BrokerId;
  capability: BrokerCapability;
  state: CapabilityState;
  data?: T;
  message?: string;
}

export interface HistoricalDataRequest {
  exchangeSegment?: string;
  instrument?: string;
  fromDate?: string;
  toDate?: string;
}

export interface BrokerAdapter {
  readonly id: BrokerId;
  readonly name: string;
  readonly capabilities: BrokerCapabilities;
  getConnectionStatus(): Promise<BrokerConnectionStatus>;
  authenticate(): Promise<BrokerResult<true>>;
  getAccount(): Promise<BrokerResult<NormalizedAccount>>;
  getProfile(): Promise<BrokerResult<unknown>>;
  getFunds(): Promise<BrokerResult<NormalizedFunds[]>>;
  getInstruments(): Promise<BrokerResult<NormalizedInstrument[]>>;
  getInstrument(instrumentId: string): Promise<BrokerResult<NormalizedInstrument>>;
  searchInstruments(query: string): Promise<BrokerResult<NormalizedInstrument[]>>;
  getQuote(symbol: string): Promise<BrokerResult<NormalizedQuote>>;
  getQuotes(symbols: string[]): Promise<BrokerResult<NormalizedQuote[]>>;
  getHistoricalData(symbol: string, interval?: string, request?: HistoricalDataRequest): Promise<BrokerResult<NormalizedCandle[]>>;
  getHistoricalCandles(symbol: string, interval?: string, request?: HistoricalDataRequest): Promise<BrokerResult<NormalizedCandle[]>>;
  getOptionChain(symbol: string, expiry?: string): Promise<BrokerResult<NormalizedOptionChain>>;
  connectWebSocket(): Promise<BrokerResult<true>>;
  subscribe(symbol: string, onTick: (tick: NormalizedTick) => void): () => void;
  unsubscribe(symbol: string, onTick: (tick: NormalizedTick) => void): void;
  disconnectWebSocket(): void;
  getPositions(): Promise<BrokerResult<NormalizedPosition[]>>;
  getHoldings(): Promise<BrokerResult<NormalizedHolding[]>>;
  getOrders(): Promise<BrokerResult<NormalizedOrder[]>>;
  getOrderHistory(): Promise<BrokerResult<NormalizedOrder[]>>;
  getOrderStatus(orderId: string): Promise<BrokerResult<NormalizedOrder[]>>;
  placeOrder(order: unknown): Promise<BrokerResult<unknown>>;
  modifyOrder(orderId: string, update: unknown): Promise<BrokerResult<unknown>>;
  cancelOrder(orderId: string): Promise<BrokerResult<unknown>>;
}

export const BROKER_CAPABILITIES: Record<BrokerId, BrokerCapabilities> = {
  dhan: {
    authenticate: "not_verified", profile: "not_supported", funds: "not_verified", instruments: "not_verified",
    quote: "not_verified", historical: "not_verified", optionChain: "not_verified", websocket: "not_verified",
    positions: "not_supported", holdings: "not_supported", orders: "not_supported", orderStatus: "not_supported",
  },
  zerodha: {
    authenticate: "not_verified", profile: "not_verified", funds: "not_verified", instruments: "not_verified",
    quote: "not_verified", historical: "not_verified", optionChain: "not_supported", websocket: "not_verified",
    positions: "not_verified", holdings: "not_verified", orders: "not_verified", orderStatus: "not_verified",
  },
  angel_one: {
    authenticate: "not_verified", profile: "not_verified", funds: "not_verified", instruments: "not_verified",
    quote: "not_verified", historical: "not_verified", optionChain: "not_supported", websocket: "not_verified",
    positions: "not_verified", holdings: "not_verified", orders: "not_verified", orderStatus: "not_verified",
  },
  upstox: {
    authenticate: "not_verified", profile: "not_verified", funds: "not_verified", instruments: "not_supported",
    quote: "not_verified", historical: "not_verified", optionChain: "not_verified", websocket: "not_verified",
    positions: "not_verified", holdings: "not_verified", orders: "not_verified", orderStatus: "not_verified",
  },
  fivepaisa: {
    authenticate: "not_verified", profile: "not_verified", funds: "not_verified", instruments: "not_verified",
    quote: "not_verified", historical: "not_verified", optionChain: "not_verified", websocket: "not_verified",
    positions: "not_verified", holdings: "not_verified", orders: "not_verified", orderStatus: "not_verified",
  },
  fyers: {
    authenticate: "not_verified", profile: "not_verified", funds: "not_verified", instruments: "not_verified",
    quote: "not_verified", historical: "not_verified", optionChain: "not_verified", websocket: "not_verified",
    positions: "not_verified", holdings: "not_verified", orders: "not_verified", orderStatus: "not_verified",
  },
  aliceblue: {
    authenticate: "not_verified", profile: "not_verified", funds: "not_verified", instruments: "not_verified",
    quote: "not_verified", historical: "not_verified", optionChain: "not_verified", websocket: "not_verified",
    positions: "not_verified", holdings: "not_verified", orders: "not_verified", orderStatus: "not_verified",
  },
};

export function unsupported<T>(provider: BrokerId, capability: BrokerCapability): Promise<BrokerResult<T>> {
  return Promise.resolve({
    provider,
    capability,
    state: "not_supported",
    message: "This capability has no verified runtime adapter in the terminal.",
  });
}

export abstract class BaseBrokerAdapter implements BrokerAdapter {
  abstract readonly id: BrokerId;
  abstract readonly name: string;
  abstract readonly capabilities: BrokerCapabilities;

  constructor(protected readonly credentials?: BrokerCredentials) {}

  getConnectionStatus(): Promise<BrokerConnectionStatus> {
    return this.authenticate().then((result) => ({
      provider: this.id,
      state: result.state === "available" ? "connected" : result.message?.toLowerCase().includes("required") ? "authentication_required" : "error",
      message: result.message,
    }));
  }

  authenticate() { return unsupported<true>(this.id, "authenticate"); }
  getProfile() { return unsupported(this.id, "profile"); }
  async getAccount(): Promise<BrokerResult<NormalizedAccount>> {
    const [profile, funds] = await Promise.all([this.getProfile(), this.getFunds()]);
    if (!profile.data && !funds.data) return { provider: this.id, capability: "profile", state: "not_supported", message: "Account information is not supported by this adapter." };
    const rawProfile = profile.data && typeof profile.data === "object" ? profile.data as Record<string, unknown> : {};
    const firstFunds = funds.data?.[0];
    const account: NormalizedAccount = {
      provider: this.id,
      providerAccountId: typeof rawProfile.user_id === "string" ? rawProfile.user_id : typeof rawProfile.client_id === "string" ? rawProfile.client_id : undefined,
      accountStatus: typeof rawProfile.status === "string" ? rawProfile.status : undefined,
      availableBalance: firstFunds?.available,
      usedMargin: firstFunds?.utilised,
      availableMargin: firstFunds?.available,
    };
    return { provider: this.id, capability: "profile", state: profile.state === "available" || funds.state === "available" ? "available" : "not_verified", data: account, message: profile.message ?? funds.message };
  }
  getFunds() { return unsupported<NormalizedFunds[]>(this.id, "funds"); }
  getInstruments() { return unsupported<NormalizedInstrument[]>(this.id, "instruments"); }
  async getInstrument(instrumentId: string) {
    const result = await this.getInstruments();
    const instrument = result.data?.find((item) => item.securityId === instrumentId || item.providerInstrumentId === instrumentId);
    return instrument ? { ...result, data: instrument } : { provider: this.id, capability: "instruments" as const, state: result.state, message: `Instrument ${instrumentId} was not found.` };
  }
  async searchInstruments(query: string) {
    const result = await this.getInstruments();
    const normalized = query.trim().toUpperCase();
    return { ...result, data: result.data?.filter((item) => [item.symbol, item.tradingSymbol, item.securityId].some((value) => value.toUpperCase().includes(normalized))) };
  }
  getQuote(_symbol: string) { return unsupported<NormalizedQuote>(this.id, "quote"); }
  async getQuotes(symbols: string[]): Promise<BrokerResult<NormalizedQuote[]>> {
    const results = await Promise.all(symbols.map((symbol) => this.getQuote(symbol)));
    const failure = results.find((result) => !result.data);
    return failure ? { ...failure, data: undefined } : { provider: this.id, capability: "quote" as const, state: results.every((result) => result.state === "available") ? "available" as const : results[0]?.state ?? "not_verified" as const, data: results.flatMap((result) => result.data ? [result.data] : []) };
  }
  getHistoricalData(_symbol: string, _interval?: string, _request?: HistoricalDataRequest) { return unsupported<NormalizedCandle[]>(this.id, "historical"); }
  getHistoricalCandles(symbol: string, interval?: string, request?: HistoricalDataRequest) { return this.getHistoricalData(symbol, interval, request); }
  getOptionChain(_symbol: string, _expiry?: string) { return unsupported<NormalizedOptionChain>(this.id, "optionChain"); }
  connectWebSocket() { return unsupported<true>(this.id, "websocket"); }
  subscribe(_symbol: string, _onTick: (tick: NormalizedTick) => void) { return () => undefined; }
  unsubscribe(_symbol: string, _onTick: (tick: NormalizedTick) => void) { return undefined; }
  disconnectWebSocket() { return undefined; }
  getPositions() { return unsupported<NormalizedPosition[]>(this.id, "positions"); }
  getHoldings() { return unsupported<NormalizedHolding[]>(this.id, "holdings"); }
  getOrders() { return unsupported<NormalizedOrder[]>(this.id, "orders"); }
  getOrderHistory() { return this.getOrders(); }
  getOrderStatus(_orderId: string) { return unsupported<NormalizedOrder[]>(this.id, "orderStatus"); }
  placeOrder(_order: unknown) { return unsupported(this.id, "orders"); }
  modifyOrder() { return unsupported(this.id, "orders"); }
  cancelOrder() { return unsupported(this.id, "orders"); }
}

const STATUS_ALIASES: Record<string, CanonicalBrokerOrderStatus> = {
  pending: "pending", queued: "pending", submitted: "pending", ack: "pending", accepted: "pending",
  open: "open", active: "open", partially_filled: "partially_filled", partial: "partially_filled",
  complete: "filled", completed: "filled", filled: "filled", rejected: "rejected", failed: "rejected",
  cancelled: "cancelled", canceled: "cancelled", trigger_pending: "trigger_pending", triggerpending: "trigger_pending",
};

export function normalizeBrokerOrderStatus(value: unknown): CanonicalBrokerOrderStatus {
  const key = typeof value === "string" ? value.trim().toLowerCase().replace(/[ -]/g, "_") : "";
  return STATUS_ALIASES[key] ?? "unknown";
}

export function normalizeBrokerError(provider: BrokerId, error: unknown, code?: string): BrokerError {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "Broker provider returned an unknown error.";
  const message = raw.replace(/(token|secret|password|api[_ -]?key)\s*[:=]\s*[^\s,;]+/gi, "$1: [REDACTED]");
  const lower = message.toLowerCase();
  const category: BrokerErrorCategory = lower.includes("auth") || lower.includes("token") || lower.includes("login") ? "authentication_failure"
    : lower.includes("margin") || lower.includes("fund") ? "insufficient_funds"
    : lower.includes("instrument") || lower.includes("symbol") ? "instrument_error"
    : lower.includes("rate") || lower.includes("throttle") ? "rate_limit"
    : lower.includes("timeout") || lower.includes("unavailable") || lower.includes("network") ? "provider_unavailable"
    : lower.includes("invalid") || lower.includes("validation") ? "validation_failure" : "unknown";
  return { provider, code, category, message, retryable: category === "rate_limit" || category === "provider_unavailable" ? true : category === "authentication_failure" || category === "validation_failure" || category === "insufficient_funds" ? false : null };
}