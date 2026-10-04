/**
 * WebSocket Client — Singleton manager for real-time Dhan market feed
 *
 * Connects to the local proxy server's WebSocket endpoint (ws://localhost:4002/ws)
 * which relays parsed Dhan tick data as JSON. Provides a pub/sub interface for
 * React components to subscribe to specific instrument updates.
 *
 * Architecture:
 *   Dhan WS (binary) → proxy-server.mjs → this client (JSON) → React hooks
 */
import { operationsEventBus } from "./operationsEventBus";
// ── Security ID ↔ Symbol mapping ──
const SYMBOL_TO_SECURITY_ID = {
    NIFTY: 13,
    BANKNIFTY: 25,
    FINNIFTY: 27,
    MIDCPNIFTY: 442,
    INDIAVIX: 26,
    SENSEX: 1,
};
const SECURITY_ID_TO_SYMBOL = {};
for (const [sym, id] of Object.entries(SYMBOL_TO_SECURITY_ID)) {
    SECURITY_ID_TO_SYMBOL[id] = sym;
}
export { SYMBOL_TO_SECURITY_ID, SECURITY_ID_TO_SYMBOL };
export function resolveWebSocketUrl(url) {
    const configuredUrl = url ?? (typeof import.meta !== "undefined" ? import.meta.env?.VITE_WS_URL : undefined);
    if (configuredUrl && configuredUrl.trim()) {
        const trimmed = configuredUrl.trim();
        if (/^wss?:\/\//i.test(trimmed)) {
            return trimmed.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:");
        }
        if (/^https?:\/\//i.test(trimmed)) {
            return trimmed.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:");
        }
        return trimmed;
    }
    const hostname = typeof window !== "undefined" ? window.location.hostname : "localhost";
    const protocol = typeof window !== "undefined" && window.location.protocol === "https:" ? "wss" : "ws";
    const host = hostname === "localhost" || hostname === "127.0.0.1" ? `${hostname}:4002` : hostname;
    return `${protocol}://${host}/ws`;
}
// ── WebSocket Client Class ──
class MarketWebSocket {
    constructor(url) {
        Object.defineProperty(this, "ws", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        Object.defineProperty(this, "url", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "tickListeners", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new Map()
        }); // securityId → listeners
        Object.defineProperty(this, "globalListeners", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new Set()
        }); // all ticks
        Object.defineProperty(this, "statusListeners", {
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
        }); // securityId → latest merged data
        Object.defineProperty(this, "reconnectTimer", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        Object.defineProperty(this, "reconnectDelay", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 1000
        });
        Object.defineProperty(this, "_connected", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: false
        });
        Object.defineProperty(this, "_dhanConnected", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: false
        });
        Object.defineProperty(this, "_kiteConnected", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: false
        });
        Object.defineProperty(this, "intentionalClose", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: false
        });
        Object.defineProperty(this, "providerUnavailableUntil", {
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
        Object.defineProperty(this, "connectionStateListeners", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new Set()
        });
        Object.defineProperty(this, "latestSourceTimestamp", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new Map()
        });
        Object.defineProperty(this, "latestTickFingerprint", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new Map()
        });
        this.url = resolveWebSocketUrl(url);
    }
    /** Is an authenticated market-data upstream connected? */
    get isConnected() {
        return this._dhanConnected || this._kiteConnected;
    }
    get state() {
        return this.connectionState;
    }
    /** Is the Dhan WebSocket relay active (live ticks flowing)? */
    get isDhanConnected() {
        return this._dhanConnected;
    }
    get isKiteConnected() {
        return this._kiteConnected;
    }
    /** Get latest cached tick for a security */
    getLatest(securityId) {
        return this.latestData.get(securityId);
    }
    /** Get latest by symbol name */
    getLatestBySymbol(symbol) {
        const id = SYMBOL_TO_SECURITY_ID[symbol];
        return id ? this.latestData.get(id) : undefined;
    }
    /** Get all latest ticks */
    getAllLatest() {
        return this.latestData;
    }
    /** Connect to the proxy WebSocket server */
    connect(_provider = "dhan") {
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            return;
        }
        this.intentionalClose = false;
        this.setConnectionState(this.reconnectTimer ? "RECONNECTING" : "CONNECTING");
        try {
            this.ws = new WebSocket(this.url);
        }
        catch (err) {
            console.warn("[MarketWS] Connection error:", err);
            this.scheduleReconnect();
            return;
        }
        this.ws.onopen = () => {
            console.log("[MarketWS] Connected to proxy WebSocket");
            this._connected = true;
            this.reconnectDelay = 1000;
            this.setConnectionState("CONNECTED");
            this.notifyStatus(true);
        };
        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === "status") {
                    if (data.provider === "zerodha")
                        this._kiteConnected = data.connected || false;
                    if (data.provider === "dhan") {
                        this._dhanConnected = data.connected || false;
                        this.providerUnavailableUntil = typeof data.unavailableUntil === "number" ? data.unavailableUntil : 0;
                    }
                    this.notifyStatus(this.isConnected);
                    return;
                }
                if (typeof data.timestamp !== "number" || !Number.isFinite(data.timestamp) || data.timestamp <= 0)
                    return;
                if (data.ltp !== undefined && (typeof data.ltp !== "number" || !Number.isFinite(data.ltp) || data.ltp <= 0))
                    return;
                const sourceTimestamp = data.timestamp;
                const previousTimestamp = this.latestSourceTimestamp.get(data.securityId);
                const fingerprint = JSON.stringify({ ...data, timestamp: sourceTimestamp });
                if (previousTimestamp !== undefined && sourceTimestamp < previousTimestamp)
                    return;
                if (this.latestTickFingerprint.get(data.securityId) === fingerprint)
                    return;
                // Preserve the provider timestamp so stale data cannot look fresh.
                const existing = this.latestData.get(data.securityId) || {};
                const merged = { ...existing, ...data, source: data.source ?? "proxy-websocket", timestamp: sourceTimestamp };
                this.latestSourceTimestamp.set(data.securityId, sourceTimestamp);
                this.latestTickFingerprint.set(data.securityId, fingerprint);
                this.latestData.set(data.securityId, merged);
                operationsEventBus.publish({
                    id: `market:${data.securityId}:${sourceTimestamp}:${fingerprint}`,
                    category: "MARKET_DATA",
                    occurredAt: new Date(sourceTimestamp).toISOString(),
                    payload: merged,
                });
                // Notify specific listeners
                const listeners = this.tickListeners.get(data.securityId);
                if (listeners) {
                    listeners.forEach((cb) => cb(merged));
                }
                // Notify global listeners
                this.globalListeners.forEach((cb) => cb(merged));
            }
            catch {
                // Ignore malformed messages
            }
        };
        this.ws.onclose = () => {
            this._connected = false;
            this._dhanConnected = false;
            this._kiteConnected = false;
            this.setConnectionState(this.intentionalClose ? "DISCONNECTED" : "RECONNECTING");
            this.notifyStatus(false);
            if (!this.intentionalClose) {
                this.scheduleReconnect();
            }
        };
        this.ws.onerror = () => {
            // Error handler — close event will fire after this
            this._connected = false;
            this.setConnectionState("DEGRADED");
        };
    }
    start(provider = "dhan") {
        this.connect(provider);
    }
    /** Subscribe to ticks for a specific security ID */
    subscribe(securityId, callback) {
        if (!this.tickListeners.has(securityId)) {
            this.tickListeners.set(securityId, new Set());
        }
        this.tickListeners.get(securityId).add(callback);
        // Immediately deliver cached data
        const cached = this.latestData.get(securityId);
        if (cached) {
            setTimeout(() => callback(cached), 0);
        }
        return () => {
            this.tickListeners.get(securityId)?.delete(callback);
        };
    }
    subscribeSymbol(symbol, callback) {
        const securityId = SYMBOL_TO_SECURITY_ID[symbol.toUpperCase()];
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
    /** Subscribe to ALL ticks */
    subscribeAll(callback) {
        this.globalListeners.add(callback);
        return () => {
            this.globalListeners.delete(callback);
        };
    }
    /** Subscribe to connection status changes */
    onStatus(callback) {
        this.statusListeners.add(callback);
        // Immediately report current status
        setTimeout(() => callback(this.isConnected), 0);
        return () => {
            this.statusListeners.delete(callback);
        };
    }
    /** Send a message to the proxy */
    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }
    /** Disconnect */
    disconnect() {
        this.intentionalClose = true;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this._connected = false;
        this._dhanConnected = false;
        this._kiteConnected = false;
        this.setConnectionState("DISCONNECTED");
    }
    stop() {
        this.disconnect();
    }
    get hasReconnectTimer() {
        return this.reconnectTimer !== null;
    }
    scheduleReconnect() {
        if (this.reconnectTimer)
            clearTimeout(this.reconnectTimer);
        const providerBackoff = Math.max(0, this.providerUnavailableUntil - Date.now());
        this.reconnectDelay = Math.min(Math.max(this.reconnectDelay * 1.5, providerBackoff), 120000);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            console.log("[MarketWS] Reconnecting...");
            this.connect();
        }, this.reconnectDelay);
    }
    onConnectionState(callback) {
        this.connectionStateListeners.add(callback);
        setTimeout(() => callback(this.connectionState), 0);
        return () => this.connectionStateListeners.delete(callback);
    }
    setConnectionState(state) {
        if (this.connectionState === state)
            return;
        this.connectionState = state;
        operationsEventBus.publish({
            id: `connection:market:${state}:${Date.now()}`,
            category: "CONNECTION_STATUS",
            occurredAt: new Date().toISOString(),
            payload: { service: "market-websocket", state },
        });
        this.connectionStateListeners.forEach((callback) => callback(state));
    }
    notifyStatus(connected) {
        this.statusListeners.forEach((cb) => cb(connected));
    }
}
// ── Singleton Export ──
export const marketWS = new MarketWebSocket();
