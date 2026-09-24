import type { BrokerCredentials } from "./brokerConfig";
import type { OptionData } from "./mockData";

export type BrokerId = "dhan" | "zerodha" | "angel_one" | "upstox" | "fivepaisa" | "fyers" | "aliceblue";
export type BrokerCapability =
  | "authenticate" | "profile" | "funds" | "instruments" | "quote" | "historical"
  | "optionChain" | "websocket" | "positions" | "holdings" | "orders" | "orderStatus";

export type CapabilityState = "available" | "not_supported" | "not_verified";

export interface BrokerCapabilities {
  [capability: string]: CapabilityState;
}

export interface NormalizedQuote {
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

export interface NormalizedInstrument {
  symbol: string;
  tradingSymbol: string;
  securityId?: string;
  exchangeSegment?: string;
  instrumentType?: string;
  lotSize?: number;
  expiryDate?: string;
  strikePrice?: number;
  optionType?: string;
}

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
  authenticate(): Promise<BrokerResult<true>>;
  getProfile(): Promise<BrokerResult<unknown>>;
  getFunds(): Promise<BrokerResult<NormalizedFunds[]>>;
  getInstruments(): Promise<BrokerResult<NormalizedInstrument[]>>;
  getQuote(symbol: string): Promise<BrokerResult<NormalizedQuote>>;
  getHistoricalData(symbol: string, interval?: string, request?: HistoricalDataRequest): Promise<BrokerResult<NormalizedCandle[]>>;
  getOptionChain(symbol: string, expiry?: string): Promise<BrokerResult<NormalizedOptionChain>>;
  connectWebSocket(): Promise<BrokerResult<true>>;
  subscribe(symbol: string, onTick: (tick: NormalizedTick) => void): () => void;
  unsubscribe(symbol: string, onTick: (tick: NormalizedTick) => void): void;
  disconnectWebSocket(): void;
  getPositions(): Promise<BrokerResult<NormalizedPosition[]>>;
  getHoldings(): Promise<BrokerResult<NormalizedHolding[]>>;
  getOrders(): Promise<BrokerResult<NormalizedOrder[]>>;
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

  authenticate() { return unsupported<true>(this.id, "authenticate"); }
  getProfile() { return unsupported(this.id, "profile"); }
  getFunds() { return unsupported<NormalizedFunds[]>(this.id, "funds"); }
  getInstruments() { return unsupported<NormalizedInstrument[]>(this.id, "instruments"); }
  getQuote(_symbol: string) { return unsupported<NormalizedQuote>(this.id, "quote"); }
  getHistoricalData(_symbol: string, _interval?: string, _request?: HistoricalDataRequest) { return unsupported<NormalizedCandle[]>(this.id, "historical"); }
  getOptionChain(_symbol: string, _expiry?: string) { return unsupported<NormalizedOptionChain>(this.id, "optionChain"); }
  connectWebSocket() { return unsupported<true>(this.id, "websocket"); }
  subscribe(_symbol: string, _onTick: (tick: NormalizedTick) => void) { return () => undefined; }
  unsubscribe(_symbol: string, _onTick: (tick: NormalizedTick) => void) { return undefined; }
  disconnectWebSocket() { return undefined; }
  getPositions() { return unsupported<NormalizedPosition[]>(this.id, "positions"); }
  getHoldings() { return unsupported<NormalizedHolding[]>(this.id, "holdings"); }
  getOrders() { return unsupported<NormalizedOrder[]>(this.id, "orders"); }
  getOrderStatus(_orderId: string) { return unsupported<NormalizedOrder[]>(this.id, "orderStatus"); }
  placeOrder(_order: unknown) { return unsupported(this.id, "orders"); }
  modifyOrder() { return unsupported(this.id, "orders"); }
  cancelOrder() { return unsupported(this.id, "orders"); }
}