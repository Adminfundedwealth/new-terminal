import { getActiveBroker, type BrokerCredentials } from "./brokerConfig";
import {
  BaseBrokerAdapter,
  BROKER_CAPABILITIES,
  type BrokerResult,
  type NormalizedCandle,
  type NormalizedInstrument,
  type NormalizedOptionChain,
  type NormalizedQuote,
  type NormalizedTick,
  type HistoricalDataRequest,
  type BrokerAdapter,
  type BrokerCapabilities,
  type BrokerId,
} from "./brokerAdapter";
import { fetchDhanQuote, fetchHistoricalCandles, fetchInstrumentMaster, fetchLiveOptionChain, testDhanConnection } from "./marketApi";
import { marketWS } from "./websocketClient";
import { ZerodhaAdapter } from "./zerodhaAdapter";
import { AngelOneAdapter } from "./angelOneAdapter";
import { UpstoxAdapter } from "./upstoxAdapter";
import { FivePaisaAdapter } from "./fivePaisaAdapter";
import { FyersAdapter } from "./fyersAdapter";
import { AliceBlueAdapter } from "./aliceBlueAdapter";

export class DhanAdapter extends BaseBrokerAdapter {
  readonly id = "dhan" as const;
  readonly name = "Dhan";
  readonly capabilities = BROKER_CAPABILITIES.dhan;
  private readonly subscriptions = new Map<string, Map<(tick: NormalizedTick) => void, () => void>>();

  async authenticate(): Promise<BrokerResult<true>> {
    const result = await testDhanConnection();
    return {
      provider: this.id,
      capability: "authenticate",
      state: result.status === "success" ? "available" : "not_verified",
      data: result.status === "success" ? true : undefined,
      message: result.message,
    };
  }

  async getInstruments(): Promise<BrokerResult<NormalizedInstrument[]>> {
    const result = await fetchInstrumentMaster();
    const instruments = Array.isArray(result) ? result : result.instruments;
    return { provider: this.id, capability: "instruments", state: "not_verified", data: instruments ?? [] };
  }

  async getQuote(symbol: string): Promise<BrokerResult<NormalizedQuote>> {
    const data = await fetchDhanQuote(symbol);
    return { provider: this.id, capability: "quote", state: "not_verified", data };
  }

  async getHistoricalData(symbol: string, interval = "5", request?: HistoricalDataRequest): Promise<BrokerResult<NormalizedCandle[]>> {
    const securityIds: Record<string, string> = { NIFTY: "13", BANKNIFTY: "25", FINNIFTY: "27", MIDCPNIFTY: "442", INDIAVIX: "26" };
    const response = await fetchHistoricalCandles(
      securityIds[symbol.toUpperCase()] ?? symbol,
      request?.exchangeSegment ?? "IDX_I",
      request?.instrument ?? "INDEX",
      interval,
      request?.fromDate,
      request?.toDate,
    );
    const data = response.data;
    const candles = data.timestamp.map((timestamp, index) => ({
      timestamp,
      open: data.open[index],
      high: data.high[index],
      low: data.low[index],
      close: data.close[index],
      volume: data.volume[index],
    }));
    return { provider: this.id, capability: "historical", state: "not_verified", data: candles };
  }

  async getOptionChain(symbol: string, expiry?: string): Promise<BrokerResult<NormalizedOptionChain>> {
    const response = await fetchLiveOptionChain(symbol, expiry);
    return {
      provider: this.id,
      capability: "optionChain",
      state: response.source === "dhan" ? "not_verified" : "not_supported",
      data: {
        symbol,
        spotPrice: response.spotPrice,
        expiries: response.expiries.map((item) => item.value),
        chain: response.chain,
        totalCEOI: response.totalCEOI,
        totalPEOI: response.totalPEOI,
        afterHours: response.afterHours,
        cachedAt: response.cachedAt,
        oiChangeAvailable: response.chain.some((row) => row.ce.oiChange !== 0 || row.pe.oiChange !== 0),
      },
      message: response.source === "dhan" ? "Dhan response received; runtime authentication is not verified." : "Response came from a non-Dhan fallback.",
    };
  }

  async connectWebSocket(): Promise<BrokerResult<true>> {
    marketWS.connect();
    return {
      provider: this.id,
      capability: "websocket",
      state: marketWS.isDhanConnected ? "not_verified" : "not_verified",
      data: true,
      message: "Connection initiated; live Dhan ticks require valid credentials.",
    };
  }

  subscribe(symbol: string, onTick: (tick: NormalizedTick) => void): () => void {
    const cleanup = marketWS.subscribeSymbol(symbol, onTick);
    const callbacks = this.subscriptions.get(symbol.toUpperCase()) ?? new Map();
    callbacks.set(onTick, cleanup);
    this.subscriptions.set(symbol.toUpperCase(), callbacks);
    return () => this.unsubscribe(symbol, onTick);
  }

  unsubscribe(symbol: string, onTick: (tick: NormalizedTick) => void): void {
    const callbacks = this.subscriptions.get(symbol.toUpperCase());
    const cleanup = callbacks?.get(onTick);
    cleanup?.();
    callbacks?.delete(onTick);
    if (callbacks?.size === 0) this.subscriptions.delete(symbol.toUpperCase());
  }

  disconnectWebSocket(): void {
    for (const callbacks of this.subscriptions.values()) {
      for (const cleanup of callbacks.values()) cleanup();
    }
    this.subscriptions.clear();
    marketWS.disconnect();
  }
}

export const BROKER_ADAPTERS: Record<BrokerId, new (credentials?: BrokerCredentials) => BrokerAdapter> = {
  dhan: DhanAdapter,
  zerodha: ZerodhaAdapter,
  angel_one: AngelOneAdapter,
  upstox: UpstoxAdapter,
  fivepaisa: FivePaisaAdapter,
  fyers: FyersAdapter,
  aliceblue: AliceBlueAdapter,
};

export interface BrokerRouter {
  getActiveProvider(): BrokerId | null;
  getAdapter(provider?: BrokerId): BrokerAdapter | null;
  getCapabilities(provider?: BrokerId): BrokerCapabilities;
}

export function createBrokerRouter(configuredCredentials?: BrokerCredentials[]): BrokerRouter {
  const getCredentials = () => configuredCredentials ?? getSavedCredentials();
  return {
    getActiveProvider: () => {
      const credentials = getCredentials();
      const active = credentials.find((entry) => entry.isActive) ?? credentials[0];
      return active?.brokerId === "angelone" ? "angel_one" : (active?.brokerId as BrokerId | undefined) ?? "dhan";
    },
    getAdapter: (provider) => {
      const credentials = getCredentials();
      const active = credentials.find((entry) => entry.isActive) ?? credentials[0];
      const id = provider ?? (active?.brokerId === "angelone" ? "angel_one" : active?.brokerId as BrokerId | undefined) ?? "dhan";
      if (!id || !BROKER_ADAPTERS[id]) return null;
      return new BROKER_ADAPTERS[id](credentials.find((entry) => entry.brokerId === id));
    },
    getCapabilities: (provider) => {
      const id = provider ?? (getCredentials().find((entry) => entry.isActive)?.brokerId as BrokerId | undefined) ?? "dhan";
      return id ? BROKER_CAPABILITIES[id] ?? {} : {};
    },
  };
}

function getSavedCredentials(): BrokerCredentials[] {
  if (typeof window === "undefined") return [];
  return getActiveBroker() ? [getActiveBroker()!] : [];
}

export const brokerRouter = createBrokerRouter();

export async function getPreferredMarketAdapter(): Promise<BrokerAdapter | null> {
  if (typeof window !== "undefined") {
    try {
      const proxyBase = import.meta.env.VITE_PROXY_URL || "http://localhost:4002";
      const response = await fetch(`${proxyBase}/api/kite/status`, { credentials: "include" });
      const status = await response.json() as { authenticated?: boolean };
      if (status.authenticated) return brokerRouter.getAdapter("zerodha");
    } catch {
      // Fall back to the explicitly selected broker when session status is unavailable.
    }
  }
  return brokerRouter.getAdapter();
}