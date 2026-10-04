import { getActiveBroker } from "./brokerConfig";
import { BaseBrokerAdapter, BROKER_CAPABILITIES, } from "./brokerAdapter";
import { fetchDhanQuote, fetchHistoricalCandles, fetchInstrumentMaster, testDhanConnection } from "./marketApi";
import { marketWS } from "./terminalRealtimeClient";
import { ZerodhaAdapter } from "./zerodhaAdapter";
import { AngelOneAdapter } from "./angelOneAdapter";
import { UpstoxAdapter } from "./upstoxAdapter";
import { FivePaisaAdapter } from "./fivePaisaAdapter";
import { FyersAdapter } from "./fyersAdapter";
import { AliceBlueAdapter } from "./aliceBlueAdapter";
export class DhanAdapter extends BaseBrokerAdapter {
    constructor() {
        super(...arguments);
        Object.defineProperty(this, "id", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: "dhan"
        });
        Object.defineProperty(this, "name", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: "Dhan"
        });
        Object.defineProperty(this, "capabilities", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: BROKER_CAPABILITIES.dhan
        });
        Object.defineProperty(this, "subscriptions", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new Map()
        });
    }
    async authenticate() {
        const result = await testDhanConnection();
        return {
            provider: this.id,
            capability: "authenticate",
            state: result.status === "success" ? "available" : "not_verified",
            data: result.status === "success" ? true : undefined,
            message: result.message,
        };
    }
    async getInstruments() {
        const result = await fetchInstrumentMaster();
        const instruments = Array.isArray(result) ? result : result.instruments;
        return { provider: this.id, capability: "instruments", state: "not_verified", data: instruments ?? [] };
    }
    async getQuote(symbol) {
        const data = await fetchDhanQuote(symbol);
        return { provider: this.id, capability: "quote", state: "not_verified", data };
    }
    async getHistoricalData(symbol, interval = "5", request) {
        const securityIds = { NIFTY: "13", BANKNIFTY: "25", FINNIFTY: "27", MIDCPNIFTY: "442", INDIAVIX: "26" };
        const response = await fetchHistoricalCandles(securityIds[symbol.toUpperCase()] ?? symbol, request?.exchangeSegment ?? "IDX_I", request?.instrument ?? "INDEX", interval, request?.fromDate, request?.toDate);
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
    async getOptionChain(_symbol, _expiry) {
        return {
            provider: this.id,
            capability: "optionChain",
            state: "not_supported",
            message: "Live option chains require the authenticated Kite provider.",
        };
    }
    async connectWebSocket() {
        marketWS.connect();
        return {
            provider: this.id,
            capability: "websocket",
            state: marketWS.isDhanConnected ? "not_verified" : "not_verified",
            data: true,
            message: "Connection initiated; live Dhan ticks require valid credentials.",
        };
    }
    subscribe(symbol, onTick) {
        const cleanup = marketWS.subscribeSymbol(symbol, onTick);
        const callbacks = this.subscriptions.get(symbol.toUpperCase()) ?? new Map();
        callbacks.set(onTick, cleanup);
        this.subscriptions.set(symbol.toUpperCase(), callbacks);
        return () => this.unsubscribe(symbol, onTick);
    }
    unsubscribe(symbol, onTick) {
        const callbacks = this.subscriptions.get(symbol.toUpperCase());
        const cleanup = callbacks?.get(onTick);
        cleanup?.();
        callbacks?.delete(onTick);
        if (callbacks?.size === 0)
            this.subscriptions.delete(symbol.toUpperCase());
    }
    disconnectWebSocket() {
        for (const callbacks of this.subscriptions.values()) {
            for (const cleanup of callbacks.values())
                cleanup();
        }
        this.subscriptions.clear();
        marketWS.disconnect();
    }
}
export const BROKER_ADAPTERS = {
    dhan: DhanAdapter,
    zerodha: ZerodhaAdapter,
    angel_one: AngelOneAdapter,
    upstox: UpstoxAdapter,
    fivepaisa: FivePaisaAdapter,
    fyers: FyersAdapter,
    aliceblue: AliceBlueAdapter,
};
export function createBrokerRouter(configuredCredentials) {
    const getCredentials = () => configuredCredentials ?? getSavedCredentials();
    return {
        getActiveProvider: () => {
            const credentials = getCredentials();
            const active = credentials.find((entry) => entry.isActive) ?? credentials[0];
            return active?.brokerId === "angelone" ? "angel_one" : active?.brokerId ?? "dhan";
        },
        getAdapter: (provider) => {
            const credentials = getCredentials();
            const active = credentials.find((entry) => entry.isActive) ?? credentials[0];
            const id = provider ?? (active?.brokerId === "angelone" ? "angel_one" : active?.brokerId) ?? "dhan";
            if (!id || !BROKER_ADAPTERS[id])
                return null;
            return new BROKER_ADAPTERS[id](credentials.find((entry) => entry.brokerId === id));
        },
        getCapabilities: (provider) => {
            const id = provider ?? getCredentials().find((entry) => entry.isActive)?.brokerId ?? "dhan";
            return id ? BROKER_CAPABILITIES[id] ?? {} : {};
        },
    };
}
function getSavedCredentials() {
    if (typeof window === "undefined")
        return [];
    return getActiveBroker() ? [getActiveBroker()] : [];
}
export const brokerRouter = createBrokerRouter();
export async function getPreferredMarketAdapter() {
    if (typeof window !== "undefined") {
        try {
            const proxyBase = import.meta.env.VITE_PROXY_URL || "";
            const response = await fetch(`${proxyBase}/api/kite/status`, { credentials: "include" });
            const status = await response.json();
            if (status.authenticated)
                return brokerRouter.getAdapter("zerodha");
        }
        catch {
            // Fall back to the explicitly selected broker when session status is unavailable.
        }
    }
    return brokerRouter.getAdapter();
}
