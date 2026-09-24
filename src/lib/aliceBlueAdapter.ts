import type { BrokerCredentials } from "./brokerConfig";
import { BaseBrokerAdapter, type BrokerResult, type NormalizedCandle, type NormalizedFunds, type NormalizedHolding, type NormalizedInstrument, type NormalizedOptionChain, type NormalizedOrder, type NormalizedPosition, type NormalizedQuote, type HistoricalDataRequest } from "./brokerAdapter";

export class AliceBlueAdapter extends BaseBrokerAdapter {
  readonly id = "aliceblue" as const;
  readonly name = "Alice Blue";
  readonly capabilities = {
    authenticate: "not_verified" as const, profile: "not_verified" as const, funds: "not_verified" as const,
    instruments: "not_verified" as const, quote: "not_verified" as const, historical: "not_verified" as const,
    optionChain: "not_verified" as const, websocket: "not_verified" as const, positions: "not_verified" as const,
    holdings: "not_verified" as const, orders: "not_verified" as const, orderStatus: "not_verified" as const,
  };
  constructor(credentials?: BrokerCredentials) { super(credentials); }
  private missing() { return !this.credentials?.values.userId || !this.credentials.values.apiKey; }
  authenticate(): Promise<BrokerResult<true>> { return Promise.resolve({ provider: this.id, capability: "authenticate", state: "not_verified", message: this.missing() ? "Alice Blue user ID and API key are required." : "Alice Blue session authentication requires runtime credentials." }); }
  getProfile() { return this.unverified("profile"); }
  getFunds() { return this.unverified<NormalizedFunds[]>("funds"); }
  getInstruments() { return this.unverified<NormalizedInstrument[]>("instruments"); }
  getQuote() { return this.unverified<NormalizedQuote>("quote"); }
  getHistoricalData(_symbol?: string, _interval?: string, _request?: HistoricalDataRequest) { return this.unverified<NormalizedCandle[]>("historical"); }
  getOptionChain() { return this.unverified<NormalizedOptionChain>("optionChain"); }
  connectWebSocket() { return this.unverified<true>("websocket"); }
  subscribe() { return () => undefined; }
  unsubscribe() { return undefined; }
  disconnectWebSocket() { return undefined; }
  getPositions() { return this.unverified<NormalizedPosition[]>("positions"); }
  getHoldings() { return this.unverified<NormalizedHolding[]>("holdings"); }
  getOrders() { return this.unverified<NormalizedOrder[]>("orders"); }
  getOrderStatus() { return this.unverified<NormalizedOrder[]>("orderStatus"); }
  placeOrder() { return this.unverified("orders"); }
  modifyOrder() { return this.unverified("orders"); }
  cancelOrder() { return this.unverified("orders"); }
  private unverified<T>(capability: BrokerResult<T>["capability"]): Promise<BrokerResult<T>> { return Promise.resolve({ provider: this.id, capability, state: "not_verified", message: "Alice Blue runtime transport is not configured or credential-verified in this terminal." }); }
}
