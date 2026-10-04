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
declare const SYMBOL_TO_SECURITY_ID: Record<string, number>;
declare const SECURITY_ID_TO_SYMBOL: Record<number, string>;
export { SYMBOL_TO_SECURITY_ID, SECURITY_ID_TO_SYMBOL };
export declare function resolveWebSocketUrl(url?: string): string;
declare class MarketWebSocket {
    private ws;
    private url;
    private tickListeners;
    private globalListeners;
    private statusListeners;
    private latestData;
    private reconnectTimer;
    private reconnectDelay;
    private _connected;
    private _dhanConnected;
    private _kiteConnected;
    private intentionalClose;
    private providerUnavailableUntil;
    private connectionState;
    private connectionStateListeners;
    private latestSourceTimestamp;
    private latestTickFingerprint;
    constructor(url?: string);
    /** Is an authenticated market-data upstream connected? */
    get isConnected(): boolean;
    get state(): ConnectionState;
    /** Is the Dhan WebSocket relay active (live ticks flowing)? */
    get isDhanConnected(): boolean;
    get isKiteConnected(): boolean;
    /** Get latest cached tick for a security */
    getLatest(securityId: number): TickData | undefined;
    /** Get latest by symbol name */
    getLatestBySymbol(symbol: string): TickData | undefined;
    /** Get all latest ticks */
    getAllLatest(): Map<number, TickData>;
    /** Connect to the proxy WebSocket server */
    connect(_provider?: "dhan" | "zerodha"): void;
    start(provider?: "dhan" | "zerodha"): void;
    /** Subscribe to ticks for a specific security ID */
    subscribe(securityId: number, callback: TickListener): () => void;
    subscribeSymbol(symbol: string, callback: NormalizedTickListener): () => void;
    /** Subscribe to ALL ticks */
    subscribeAll(callback: TickListener): () => void;
    /** Subscribe to connection status changes */
    onStatus(callback: StatusListener): () => void;
    /** Send a message to the proxy */
    private send;
    /** Disconnect */
    disconnect(): void;
    stop(): void;
    get hasReconnectTimer(): boolean;
    private scheduleReconnect;
    onConnectionState(callback: ConnectionStateListener): () => void;
    private setConnectionState;
    private notifyStatus;
}
export declare const marketWS: MarketWebSocket;
