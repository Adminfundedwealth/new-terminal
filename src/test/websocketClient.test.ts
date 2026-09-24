import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { marketWS, type TickData } from "@/lib/websocketClient";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;
  static CONNECTING = 0;
  readyState = FakeWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];

  constructor() {
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
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

  message(data: TickData) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

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
    vi.advanceTimersByTime(20_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("cleans up tick subscriptions and suppresses duplicate ticks", () => {
    marketWS.start();
    const socket = FakeWebSocket.instances[0];
    socket.open();
    const received: TickData[] = [];
    const unsubscribe = marketWS.subscribe(13, (tick) => received.push(tick));
    const tick = { type: "ticker", securityId: 13, symbol: "NIFTY", exchangeSegment: "NSE", ltp: 23050, timestamp: 1000 } as TickData;

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
    const received: TickData[] = [];
    marketWS.subscribe(13, (tick) => received.push(tick));

    socket.message({ type: "ticker", securityId: 13, symbol: "NIFTY", exchangeSegment: "NSE", ltp: 23050 } as TickData);
    socket.message({ type: "ticker", securityId: 13, symbol: "NIFTY", exchangeSegment: "NSE", ltp: -1, timestamp: 1000 });
    expect(received).toHaveLength(0);
  });
});
