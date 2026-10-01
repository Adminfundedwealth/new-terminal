import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requestTicket } = vi.hoisted(() => ({ requestTicket: vi.fn() }));
vi.mock("@/lib/terminalApi", () => ({ requestTerminalRealtimeTicket: requestTicket }));

import { marketWS, type RealtimeScope } from "@/lib/terminalRealtimeClient";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;
  static CONNECTING = 0;
  readyState = FakeWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: Array<Record<string, unknown>> = [];
  url: string;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string) { this.sent.push(JSON.parse(data) as Record<string, unknown>); }
  open() { this.readyState = FakeWebSocket.OPEN; this.onopen?.(); }
  message(data: Record<string, unknown>) { this.onmessage?.({ data: JSON.stringify(data) }); }
  close() { this.readyState = 3; this.onclose?.(); }
}

const scope: RealtimeScope = {
  accountId: "22222222-2222-4222-8222-222222222222",
  provider: "dhan",
  environment: "paper",
};

async function waitForSocket(): Promise<FakeWebSocket> {
  await vi.waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0));
  return FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
}

describe("authenticated Terminal OS realtime client", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
    requestTicket.mockResolvedValue({ ticket: "scope-only-ticket", expires_at: "2026-10-01T10:01:30.000Z" });
    marketWS.stop();
  });

  afterEach(() => {
    marketWS.stop();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("requests a scoped ticket, authenticates, subscribes, and accepts only matching account events", async () => {
    const onTick = vi.fn();
    const unsubscribe = marketWS.subscribe(13, onTick);
    marketWS.start(scope);
    const socket = await waitForSocket();
    expect(requestTicket).toHaveBeenCalledWith(scope.accountId, "dhan", "paper");
    expect(socket.url).toBe("ws://localhost:4012/ws");

    socket.open();
    expect(socket.sent[0]).toEqual({ type: "connection", action: "authenticate", ticket: "scope-only-ticket", protocol_version: 1 });
    socket.message({ type: "connection", status: "ready" });
    expect(marketWS.isConnected).toBe(true);
    expect(socket.sent[1]).toMatchObject({ type: "subscription", action: "subscribe", account_id: scope.accountId, provider: "dhan", environment: "paper" });
    expect(JSON.stringify(socket.sent)).not.toMatch(/access_token|api_key|credentials/i);

    socket.message({
      type: "index", provider: "dhan", account_id: scope.accountId,
      instrument: { providerInstrumentId: "13", symbol: "NIFTY", exchange: "NSE", segment: "IDX_I" },
      timestamp: "2026-10-01T10:00:00.000Z", ltp: 25000, change: 10, change_percent: 0.04, bid: null, ask: null, volume: 0,
    });
    socket.message({
      type: "index", provider: "dhan", account_id: "44444444-4444-4444-8444-444444444444",
      instrument: { providerInstrumentId: "13", symbol: "NIFTY", exchange: "NSE", segment: "IDX_I" },
      timestamp: "2026-10-01T10:00:01.000Z", ltp: 25001, change: 11, change_percent: 0.04, bid: null, ask: null, volume: 0,
    });
    expect(onTick).toHaveBeenCalledTimes(1);
    expect(onTick.mock.calls[0][0]).toMatchObject({ source: "terminal-os", ltp: 25000, timestamp: Date.parse("2026-10-01T10:00:00.000Z") });
    unsubscribe();
  });

  it("clears cached data when the active account changes", async () => {
    marketWS.start(scope);
    const first = await waitForSocket();
    first.open();
    first.message({ type: "connection", status: "ready" });
    first.message({
      type: "index", provider: "dhan", account_id: scope.accountId,
      instrument: { providerInstrumentId: "13", symbol: "NIFTY", exchange: "NSE", segment: "IDX_I" },
      timestamp: "2026-10-01T10:00:00.000Z", ltp: 25000, change: null, change_percent: null, bid: null, ask: null, volume: null,
    });
    expect(marketWS.getLatest(13)?.ltp).toBe(25000);

    marketWS.start({ ...scope, accountId: "44444444-4444-4444-8444-444444444444" });
    expect(marketWS.getLatest(13)).toBeUndefined();
    await vi.waitFor(() => expect(requestTicket).toHaveBeenCalledTimes(2));
  });

  it("marks heartbeat loss stale and closes the connection", async () => {
    marketWS.start(scope);
    const socket = await waitForSocket();
    socket.open();
    socket.message({ type: "connection", status: "ready" });
    vi.advanceTimersByTime(50_000);
    expect(socket.readyState).toBe(3);
    expect(marketWS.isConnected).toBe(false);
  });
});