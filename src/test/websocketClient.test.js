import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { marketWS, resolveWebSocketUrl } from "@/lib/websocketClient";
class FakeWebSocket {
    constructor() {
        Object.defineProperty(this, "readyState", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: FakeWebSocket.CONNECTING
        });
        Object.defineProperty(this, "onopen", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        Object.defineProperty(this, "onmessage", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        Object.defineProperty(this, "onclose", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        Object.defineProperty(this, "onerror", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        Object.defineProperty(this, "sent", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: []
        });
        FakeWebSocket.instances.push(this);
    }
    send(data) {
        this.sent.push(data);
    }
    close() {
        this.readyState = 3;
        this.onclose?.();
    }
    open() {
        this.readyState = FakeWebSocket.OPEN;
        this.onopen?.();
    }
    message(data) {
        this.onmessage?.({ data: JSON.stringify(data) });
    }
}
Object.defineProperty(FakeWebSocket, "instances", {
    enumerable: true,
    configurable: true,
    writable: true,
    value: []
});
Object.defineProperty(FakeWebSocket, "OPEN", {
    enumerable: true,
    configurable: true,
    writable: true,
    value: 1
});
Object.defineProperty(FakeWebSocket, "CONNECTING", {
    enumerable: true,
    configurable: true,
    writable: true,
    value: 0
});
describe("market websocket lifecycle", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        FakeWebSocket.instances = [];
        vi.stubGlobal("WebSocket", FakeWebSocket);
        marketWS.stop();
    });
    afterEach(() => {
        marketWS.stop();
        vi.useRealTimers();
    });
    it("resolves a production websocket URL from the deployed environment", () => {
        vi.stubEnv("VITE_WS_URL", "https://terminal-production.up.railway.app/ws");
        expect(resolveWebSocketUrl()).toBe("wss://terminal-production.up.railway.app/ws");
        vi.unstubAllEnvs();
    });
    it("does not connect when the module is imported", () => {
        expect(FakeWebSocket.instances).toHaveLength(0);
        expect(marketWS.state).toBe("DISCONNECTED");
    });
    it("connects explicitly and does not create duplicate sockets", () => {
        marketWS.start();
        marketWS.start();
        expect(FakeWebSocket.instances).toHaveLength(1);
        FakeWebSocket.instances[0].open();
        expect(marketWS.state).toBe("CONNECTED");
    });
    it("disconnects cleanly and clears reconnect timers", () => {
        marketWS.start();
        const socket = FakeWebSocket.instances[0];
        socket.onclose?.();
        expect(marketWS.hasReconnectTimer).toBe(true);
        marketWS.stop();
        expect(marketWS.state).toBe("DISCONNECTED");
        expect(marketWS.hasReconnectTimer).toBe(false);
        vi.advanceTimersByTime(20000);
        expect(FakeWebSocket.instances).toHaveLength(1);
    });
    it("cleans up tick subscriptions and suppresses duplicate ticks", () => {
        marketWS.start();
        const socket = FakeWebSocket.instances[0];
        socket.open();
        const received = [];
        const unsubscribe = marketWS.subscribe(13, (tick) => received.push(tick));
        const tick = { type: "ticker", securityId: 13, symbol: "NIFTY", exchangeSegment: "NSE", ltp: 23050, timestamp: 1000 };
        socket.message(tick);
        socket.message(tick);
        expect(received).toHaveLength(1);
        unsubscribe();
        socket.message({ ...tick, timestamp: 1001, ltp: 23051 });
        expect(received).toHaveLength(1);
    });
    it("does not fabricate missing timestamps or accept invalid prices", () => {
        marketWS.start();
        const socket = FakeWebSocket.instances[0];
        socket.open();
        const received = [];
        marketWS.subscribe(13, (tick) => received.push(tick));
        socket.message({ type: "ticker", securityId: 13, symbol: "NIFTY", exchangeSegment: "NSE", ltp: 23050 });
        socket.message({ type: "ticker", securityId: 13, symbol: "NIFTY", exchangeSegment: "NSE", ltp: -1, timestamp: 1000 });
        expect(received).toHaveLength(0);
    });
});
