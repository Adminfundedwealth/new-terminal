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

import type { NormalizedTick } from "./brokerAdapter";
import { operationsEventBus } from "./operationsEventBus";

// ── Types ──

export interface TickData {
  type: "ticker" | "quote" | "prevClose" | "oi" | "full" | "status";
  securityId: number;
  symbol: string;
  exchangeSegment: string;
  ltp?: number;
  change?: number;
  changePercent?: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  prevClose?: number;
  volume?: number;
  oi?: number;
  timestamp?: number;
  source?: "proxy-websocket" | "dhan" | "zerodha";
  // Status fields
  connected?: boolean;
  instrumentCount?: number;
  provider?: "dhan" | "zerodha";
  instrumentToken?: number;
  state?: ConnectionState | "UNAVAILABLE";
  unavailableUntil?: number;
  reason?: string;
}

export type TickListener = (data: TickData) => void;
export type StatusListener = (connected: boolean) => void;
export type NormalizedTickListener = (tick: NormalizedTick) => void;
export type ConnectionState = "CONNECTED" | "CONNECTING" | "DISCONNECTED" | "RECONNECTING" | "DEGRADED" | "STALE";
export type ConnectionStateListener = (state: ConnectionState) => void;

// ── Security ID ↔ Symbol mapping ──

const SYMBOL_TO_SECURITY_ID: Record<string, number> = {
  NIFTY: 13,
  BANKNIFTY: 25,
  FINNIFTY: 27,
  MIDCPNIFTY: 442,
  INDIAVIX: 26,
  SENSEX: 1,
};

const SECURITY_ID_TO_SYMBOL: Record<number, string> = {};
for (const [sym, id] of Object.entries(SYMBOL_TO_SECURITY_ID)) {
  SECURITY_ID_TO_SYMBOL[id] = sym;
}

export { SYMBOL_TO_SECURITY_ID, SECURITY_ID_TO_SYMBOL };

export function resolveWebSocketUrl(url?: string): string {
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
  private ws: WebSocket | null = null;
  private url: string;
  private tickListeners = new Map<number, Set<TickListener>>(); // securityId → listeners
  private globalListeners = new Set<TickListener>(); // all ticks
  private statusListeners = new Set<StatusListener>();
  private latestData = new Map<number, TickData>(); // securityId → latest merged data
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private _connected = false;
  private _dhanConnected = false;
  private _kiteConnected = false;
  private intentionalClose = false;
  private providerUnavailableUntil = 0;
  private connectionState: ConnectionState = "DISCONNECTED";
  private connectionStateListeners = new Set<ConnectionStateListener>();
  private latestSourceTimestamp = new Map<number, number>();
  private latestTickFingerprint = new Map<number, string>();

  constructor(url?: string) {
    this.url = resolveWebSocketUrl(url);
  }

  /** Is an authenticated market-data upstream connected? */
  get isConnected(): boolean {
    return this._dhanConnected || this._kiteConnected;
  }

  get state(): ConnectionState {
    return this.connectionState;
  }

  /** Is the Dhan WebSocket relay active (live ticks flowing)? */
  get isDhanConnected(): boolean {
    return this._dhanConnected;
  }

  get isKiteConnected(): boolean {
    return this._kiteConnected;
  }

  /** Get latest cached tick for a security */
  getLatest(securityId: number): TickData | undefined {
    return this.latestData.get(securityId);
  }

  /** Get latest by symbol name */
  getLatestBySymbol(symbol: string): TickData | undefined {
    const id = SYMBOL_TO_SECURITY_ID[symbol];
    return id ? this.latestData.get(id) : undefined;
  }

  /** Get all latest ticks */
  getAllLatest(): Map<number, TickData> {
    return this.latestData;
  }

  /** Connect to the proxy WebSocket server */
  connect(_provider: "dhan" | "zerodha" = "dhan"): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.intentionalClose = false;
    this.setConnectionState(this.reconnectTimer ? "RECONNECTING" : "CONNECTING");

    try {
      this.ws = new WebSocket(this.url);
    } catch (err) {
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
        const data: TickData = JSON.parse(event.data);

        if (data.type === "status") {
          if (data.provider === "zerodha") this._kiteConnected = data.connected || false;
          if (data.provider === "dhan") {
            this._dhanConnected = data.connected || false;
            this.providerUnavailableUntil = typeof data.unavailableUntil === "number" ? data.unavailableUntil : 0;
          }
          this.notifyStatus(this.isConnected);
          return;
        }

        if (typeof data.timestamp !== "number" || !Number.isFinite(data.timestamp) || data.timestamp <= 0) return;
        if (data.ltp !== undefined && (typeof data.ltp !== "number" || !Number.isFinite(data.ltp) || data.ltp <= 0)) return;
        const sourceTimestamp = data.timestamp;
        const previousTimestamp = this.latestSourceTimestamp.get(data.securityId);
        const fingerprint = JSON.stringify({ ...data, timestamp: sourceTimestamp });
        if (previousTimestamp !== undefined && sourceTimestamp < previousTimestamp) return;
        if (this.latestTickFingerprint.get(data.securityId) === fingerprint) return;

        // Preserve the provider timestamp so stale data cannot look fresh.
        const existing = this.latestData.get(data.securityId) || ({} as TickData);
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
      } catch {
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

  start(provider: "dhan" | "zerodha" = "dhan"): void {
    this.connect(provider);
  }

  /** Subscribe to ticks for a specific security ID */
  subscribe(securityId: number, callback: TickListener): () => void {
    if (!this.tickListeners.has(securityId)) {
      this.tickListeners.set(securityId, new Set());
    }
    this.tickListeners.get(securityId)!.add(callback);

    // Immediately deliver cached data
    const cached = this.latestData.get(securityId);
    if (cached) {
      setTimeout(() => callback(cached), 0);
    }

    return () => {
      this.tickListeners.get(securityId)?.delete(callback);
    };
  }

  subscribeSymbol(symbol: string, callback: NormalizedTickListener): () => void {
    const securityId = SYMBOL_TO_SECURITY_ID[symbol.toUpperCase()];
    if (!securityId) return () => undefined;
    return this.subscribe(securityId, (tick) => {
      if (typeof tick.ltp !== "number") return;
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
  subscribeAll(callback: TickListener): () => void {
    this.globalListeners.add(callback);
    return () => {
      this.globalListeners.delete(callback);
    };
  }

  /** Subscribe to connection status changes */
  onStatus(callback: StatusListener): () => void {
    this.statusListeners.add(callback);
    // Immediately report current status
    setTimeout(() => callback(this.isConnected), 0);
    return () => {
      this.statusListeners.delete(callback);
    };
  }

  /** Send a message to the proxy */
  private send(data: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  /** Disconnect */
  disconnect(): void {
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

  stop(): void {
    this.disconnect();
  }

  get hasReconnectTimer(): boolean {
    return this.reconnectTimer !== null;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const providerBackoff = Math.max(0, this.providerUnavailableUntil - Date.now());
    this.reconnectDelay = Math.min(Math.max(this.reconnectDelay * 1.5, providerBackoff), 120000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      console.log("[MarketWS] Reconnecting...");
      this.connect();
    }, this.reconnectDelay);
  }

  onConnectionState(callback: ConnectionStateListener): () => void {
    this.connectionStateListeners.add(callback);
    setTimeout(() => callback(this.connectionState), 0);
    return () => this.connectionStateListeners.delete(callback);
  }

  private setConnectionState(state: ConnectionState): void {
    if (this.connectionState === state) return;
    this.connectionState = state;
    operationsEventBus.publish({
      id: `connection:market:${state}:${Date.now()}`,
      category: "CONNECTION_STATUS",
      occurredAt: new Date().toISOString(),
      payload: { service: "market-websocket", state },
    });
    this.connectionStateListeners.forEach((callback) => callback(state));
  }

  private notifyStatus(connected: boolean): void {
    this.statusListeners.forEach((cb) => cb(connected));
  }
}

// ── Singleton Export ──

export const marketWS = new MarketWebSocket();
