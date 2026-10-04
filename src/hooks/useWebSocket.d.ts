import type { ConnectionState, TickData } from "@/lib/terminalRealtimeClient";
export declare function useWebSocketStatus(): boolean;
export declare function useWebSocketConnectionState(): ConnectionState;
export declare function useWebSocketTick(symbol: string): TickData | null;
export interface WebSocketIndexData {
    symbol: string;
    name: string;
    ltp: number;
    change: number;
    changePercent: number;
    open: number;
    high: number;
    low: number;
    prevClose: number;
}
export declare function useWebSocketIndices(): {
    indices: WebSocketIndexData[];
    isConnected: boolean;
};
export interface WebSocketVixData {
    value: number;
    change: number;
    changePercent: number;
    high: number;
    low: number;
}
export declare function useWebSocketVix(): {
    vix: WebSocketVixData | null;
    isConnected: boolean;
};
export declare function useWebSocketReconnect(): () => void;
