import { requestTerminalRealtimeTicket } from "./terminalApi";
import { operationsEventBus } from "./operationsEventBus";
const SYMBOL_TO_SECURITY_ID = {
    NIFTY: 13,
    BANKNIFTY: 25,
    FINNIFTY: 27,
    MIDCPNIFTY: 442,
    INDIAVIX: 26,
    SENSEX: 1,
};
const SECURITY_ID_TO_SYMBOL = Object.fromEntries(Object.entries(SYMBOL_TO_SECURITY_ID).map(([symbol, id]) => [id, symbol]));
const INSTRUMENTS = {
    13: { symbol: "NIFTY", exchange: "NSE", dhanId: "13", kiteId: "256265", kiteSegment: "INDICES" },
    25: { symbol: "BANKNIFTY", exchange: "NSE", dhanId: "25", kiteId: "260105", kiteSegment: "INDICES" },
    27: { symbol: "FINNIFTY", exchange: "NSE", dhanId: "27", kiteId: "257801", kiteSegment: "INDICES" },
    442: { symbol: "MIDCPNIFTY", exchange: "NSE", dhanId: "442", kiteId: "288009", kiteSegment: "INDICES" },
    26: { symbol: "INDIAVIX", exchange: "NSE", dhanId: "26", kiteId: "264969", kiteSegment: "INDICES" },
    1: { symbol: "SENSEX", exchange: "BSE", dhanId: "1", kiteId: "265", kiteSegment: "INDICES" },
};
const SYMBOL_ALIASES = {
    "NIFTY 50": 13,
    "NIFTY BANK": 25,
    "NIFTY FINANCIAL SERVICES": 27,
    "NIFTY FIN SERVICE": 27,
    "NIFTY MIDCAP 50": 442,
    "NIFTY MID SELECT": 442,
    "INDIA VIX": 26,
};
export { SYMBOL_TO_SECURITY_ID, SECURITY_ID_TO_SYMBOL };
export function resolveRealtimeWebSocketUrl(url) {
    const configuredUrl = url ?? (typeof import.meta !== "undefined" ? import.meta.env?.VITE_REALTIME_URL : undefined);
    if (configuredUrl?.trim()) {
        const trimmed = configuredUrl.trim();
        if (/^https?:\/\//i.test(trimmed))
            return trimmed.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:");
        if (/^wss?:\/\//i.test(trimmed))
            return trimmed;
        return trimmed;
    }
    if (typeof window === "undefined")
        return undefined;
    if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
        return "ws://localhost:4012/ws";
    return undefined;
}
function requestId() {
    if (typeof globalThis.crypto?.randomUUID === "function")
        return globalThis.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
        const random = Math.floor(Math.random() * 16);
        return (character === "x" ? random : (random & 0x3) | 0x8).toString(16);
    });
}
function securityIdForEvent(providerInstrumentId, provider, symbol) {
    const matchedId = Object.entries(INSTRUMENTS).find(([, instrument]) => instrument[provider === "dhan" ? "dhanId" : "kiteId"] === providerInstrumentId)?.[0];
    if (matchedId)
        return Number(matchedId);
    const normalized = symbol.trim().toUpperCase();
    return SYMBOL_TO_SECURITY_ID[normalized] ?? SYMBOL_ALIASES[normalized] ?? Number(providerInstrumentId);
}
class TerminalRealtimeClient {
    constructor() {
        Object.defineProperty(this, "ws", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        Object.defineProperty(this, "scope", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        Object.defineProperty(this, "tickListeners", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new Map()
        });
        Object.defineProperty(this, "globalListeners", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new Set()
        });
        Object.defineProperty(this, "statusListeners", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new Set()
        });
        Object.defineProperty(this, "connectionStateListeners", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new Set()
        });
        Object.defineProperty(this, "latestData", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new Map()
        });
        Object.defineProperty(this, "reconnectTimer", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        Object.defineProperty(this, "heartbeatTimer", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        Object.defineProperty(this, "reconnectAttempt", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 0
        });
        Object.defineProperty(this, "generation", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 0
        });
        Object.defineProperty(this, "intentionalClose", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: false
        });
        Object.defineProperty(this, "authenticated", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: false
        });
        Object.defineProperty(this, "lastHeartbeatAt", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 0
        });
        Object.defineProperty(this, "connectionState", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: "DISCONNECTED"
        });
    }
    get isConnected() { return this.authenticated; }
    get isDhanConnected() { return this.authenticated && this.scope?.provider === "dhan"; }
    get isKiteConnected() { return this.authenticated && this.scope?.provider === "kite"; }
    get state() { return this.connectionState; }
    get heartbeatTimestamp() { return this.lastHeartbeatAt; }
    get hasReconnectTimer() { return this.reconnectTimer !== null; }
    getLatest(securityId) { return this.latestData.get(securityId); }
    getLatestBySymbol(symbol) {
        const securityId = SYMBOL_TO_SECURITY_ID[symbol.toUpperCase()] ?? SYMBOL_ALIASES[symbol.toUpperCase()];
        return securityId ? this.latestData.get(securityId) : undefined;
    }
    getAllLatest() { return this.latestData; }
    start(scope) {
        if (scope) {
            const nextScope = { ...scope, environment: scope.environment ?? "production" };
            const sameScope = this.scope?.accountId === nextScope.accountId && this.scope?.provider === nextScope.provider && this.scope?.environment === nextScope.environment;
            if (sameScope && (this.authenticated || this.connectionState === "CONNECTING" || this.connectionState === "RECONNECTING"))
                return;
            this.disconnect(true);
            this.scope = nextScope;
            this.latestData.clear();
        }
        if (!this.scope) {
            this.setConnectionState("DEGRADED");
            return;
        }
        this.intentionalClose = false;
        void this.connect();
    }
    connect(_provider) {
        if (!this.scope) {
            this.setConnectionState("DEGRADED");
            return;
        }
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING))
            return;
        void this.openAuthenticatedSocket();
    }
    async openAuthenticatedSocket() {
        const currentGeneration = ++this.generation;
        this.intentionalClose = false;
        this.setConnectionState(this.reconnectAttempt > 0 ? "RECONNECTING" : "CONNECTING");
        const url = resolveRealtimeWebSocketUrl();
        if (!url) {
            this.setConnectionState("DEGRADED");
            this.notifyStatus(false);
            return;
        }
        try {
            const scope = this.scope;
            if (!scope)
                return;
            const ticket = await requestTerminalRealtimeTicket(scope.accountId, scope.provider, scope.environment);
            if (currentGeneration !== this.generation || this.intentionalClose)
                return;
            const socket = new WebSocket(url);
            this.ws = socket;
            socket.onopen = () => {
                if (currentGeneration !== this.generation)
                    return;
                socket.send(JSON.stringify({ type: "connection", action: "authenticate", ticket: ticket.ticket, protocol_version: 1 }));
            };
            socket.onmessage = (event) => this.handleMessage(socket, currentGeneration, event.data);
            socket.onclose = () => {
                if (currentGeneration !== this.generation)
                    return;
                this.ws = null;
                this.authenticated = false;
                this.clearHeartbeatMonitor();
                this.setConnectionState(this.intentionalClose ? "DISCONNECTED" : "RECONNECTING");
                this.notifyStatus(false);
                if (!this.intentionalClose)
                    this.scheduleReconnect();
            };
            socket.onerror = () => {
                if (currentGeneration === this.generation)
                    this.setConnectionState("DEGRADED");
            };
        }
        catch {
            if (currentGeneration !== this.generation)
                return;
            this.authenticated = false;
            this.setConnectionState("DEGRADED");
            this.notifyStatus(false);
            this.scheduleReconnect();
        }
    }
    handleMessage(socket, generation, raw) {
        if (generation !== this.generation || typeof raw !== "string")
            return;
        let message;
        try {
            message = JSON.parse(raw);
        }
        catch {
            return;
        }
        if (message.type === "connection") {
            if (message.status !== "ready") {
                this.setConnectionState("DEGRADED");
                socket.close();
                return;
            }
            this.authenticated = true;
            this.reconnectAttempt = 0;
            this.lastHeartbeatAt = Date.now();
            this.setConnectionState("CONNECTED");
            this.notifyStatus(true);
            this.startHeartbeatMonitor(socket, generation);
            for (const securityId of this.tickListeners.keys())
                this.sendSubscription(securityId, "subscribe");
            return;
        }
        if (message.type === "heartbeat") {
            this.lastHeartbeatAt = Date.now();
            return;
        }
        if (message.type === "disconnect") {
            if (message.code === "AUTH_EXPIRED" || message.code === "ACCOUNT_REVOKED")
                this.setConnectionState("STALE");
            socket.close();
            return;
        }
        if (message.type !== "quote" && message.type !== "index")
            return;
        const instrument = message.instrument;
        if (!instrument || typeof instrument.providerInstrumentId !== "string" || typeof instrument.symbol !== "string" ||
            typeof instrument.segment !== "string" || typeof message.timestamp !== "string" ||
            typeof message.ltp !== "number" || !Number.isFinite(message.ltp) || message.ltp <= 0 ||
            message.account_id !== this.scope?.accountId || message.provider !== this.scope?.provider)
            return;
        const securityId = securityIdForEvent(instrument.providerInstrumentId, this.scope.provider, instrument.symbol);
        if (!Number.isFinite(securityId))
            return;
        const timestamp = Date.parse(message.timestamp);
        if (!Number.isFinite(timestamp))
            return;
        const tick = {
            type: message.type === "index" ? "ticker" : "quote",
            securityId,
            symbol: instrument.symbol,
            exchangeSegment: instrument.segment,
            ltp: message.ltp,
            change: typeof message.change === "number" ? message.change : undefined,
            changePercent: typeof message.change_percent === "number" ? message.change_percent : undefined,
            volume: typeof message.volume === "number" ? message.volume : undefined,
            timestamp,
            source: "terminal-os",
        };
        this.latestData.set(securityId, tick);
        operationsEventBus.publish({
            id: `market:${securityId}:${timestamp}:${message.ltp}`,
            category: "MARKET_DATA",
            occurredAt: new Date(timestamp).toISOString(),
            payload: tick,
        });
        this.tickListeners.get(securityId)?.forEach((listener) => listener(tick));
        this.globalListeners.forEach((listener) => listener(tick));
    }
    startHeartbeatMonitor(socket, generation) {
        this.clearHeartbeatMonitor();
        this.heartbeatTimer = setInterval(() => {
            if (generation !== this.generation || !this.authenticated)
                return;
            if (Date.now() - this.lastHeartbeatAt > 45000) {
                this.setConnectionState("STALE");
                socket.close();
            }
        }, 5000);
    }
    clearHeartbeatMonitor() {
        if (this.heartbeatTimer)
            clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
    }
    instrumentFor(securityId) {
        const instrument = INSTRUMENTS[securityId];
        if (!instrument || !this.scope)
            return null;
        return {
            providerInstrumentId: this.scope.provider === "dhan" ? instrument.dhanId : instrument.kiteId,
            symbol: instrument.symbol,
            exchange: instrument.exchange,
            segment: this.scope.provider === "dhan" ? "IDX_I" : instrument.kiteSegment,
        };
    }
    sendSubscription(securityId, action) {
        if (!this.authenticated || !this.scope || !this.ws || this.ws.readyState !== WebSocket.OPEN)
            return;
        const instrument = this.instrumentFor(securityId);
        if (!instrument)
            return;
        this.ws.send(JSON.stringify({
            type: "subscription",
            action,
            request_id: requestId(),
            account_id: this.scope.accountId,
            provider: this.scope.provider,
            environment: this.scope.environment ?? "production",
            instruments: [instrument],
        }));
    }
    subscribe(securityId, callback) {
        const listeners = this.tickListeners.get(securityId) ?? new Set();
        const wasEmpty = listeners.size === 0;
        listeners.add(callback);
        this.tickListeners.set(securityId, listeners);
        const cached = this.latestData.get(securityId);
        if (cached)
            setTimeout(() => callback(cached), 0);
        if (wasEmpty)
            this.sendSubscription(securityId, "subscribe");
        return () => {
            const current = this.tickListeners.get(securityId);
            current?.delete(callback);
            if (current?.size === 0) {
                this.tickListeners.delete(securityId);
                this.sendSubscription(securityId, "unsubscribe");
            }
        };
    }
    subscribeSymbol(symbol, callback) {
        const securityId = SYMBOL_TO_SECURITY_ID[symbol.toUpperCase()] ?? SYMBOL_ALIASES[symbol.toUpperCase()];
        if (!securityId)
            return () => undefined;
        return this.subscribe(securityId, (tick) => {
            if (typeof tick.ltp !== "number")
                return;
            callback({
                symbol: tick.symbol || SECURITY_ID_TO_SYMBOL[securityId] || symbol.toUpperCase(),
                securityId,
                exchangeSegment: tick.exchangeSegment,
                ltp: tick.ltp,
                change: tick.change || 0,
                changePercent: tick.changePercent || 0,
                timestamp: new Date(tick.timestamp || Date.now()).toISOString(),
                volume: tick.volume,
                openInterest: tick.oi,
            });
        });
    }
    subscribeAll(callback) {
        this.globalListeners.add(callback);
        return () => this.globalListeners.delete(callback);
    }
    onStatus(callback) {
        this.statusListeners.add(callback);
        setTimeout(() => callback(this.isConnected), 0);
        return () => this.statusListeners.delete(callback);
    }
    onConnectionState(callback) {
        this.connectionStateListeners.add(callback);
        setTimeout(() => callback(this.connectionState), 0);
        return () => this.connectionStateListeners.delete(callback);
    }
    disconnect(clearScope = false) {
        this.intentionalClose = true;
        this.generation += 1;
        this.authenticated = false;
        this.clearHeartbeatMonitor();
        if (this.reconnectTimer)
            clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
        if (this.ws) {
            this.ws.onclose = null;
            this.ws.close();
            this.ws = null;
        }
        if (clearScope) {
            this.scope = null;
            this.latestData.clear();
        }
        this.notifyStatus(false);
        this.setConnectionState("DISCONNECTED");
    }
    stop() { this.disconnect(true); }
    scheduleReconnect() {
        if (this.reconnectTimer || this.intentionalClose)
            return;
        const baseDelay = Math.min(1000 * (2 ** Math.min(this.reconnectAttempt, 7)), 120000);
        const delay = Math.round(baseDelay * (0.8 + Math.random() * 0.4));
        this.reconnectAttempt += 1;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            void this.openAuthenticatedSocket();
        }, delay);
    }
    setConnectionState(state) {
        if (this.connectionState === state)
            return;
        this.connectionState = state;
        operationsEventBus.publish({
            id: `connection:market:${state}:${Date.now()}`,
            category: "CONNECTION_STATUS",
            occurredAt: new Date().toISOString(),
            payload: { service: "terminal-os-realtime", state },
        });
        this.connectionStateListeners.forEach((callback) => callback(state));
    }
    notifyStatus(connected) {
        this.statusListeners.forEach((listener) => listener(connected));
    }
}
export const marketWS = new TerminalRealtimeClient();
