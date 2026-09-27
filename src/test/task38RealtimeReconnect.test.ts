import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstrumentMaster, normalizeProviderInstrument } from "@/lib/instrumentMaster";
import { RealtimeMarketDataService, normalizeRealtimeQuote } from "@/lib/realtimeMarketData";

function instrument(overrides: Record<string, unknown> = {}) {
  return normalizeProviderInstrument({
    SEM_SMST_SECURITY_ID: "13",
    SEM_EXM: "IDX_I",
    SEM_TRADING_SYMBOL: "NIFTY 50",
    SEM_CUSTOM_SYMBOL: "NIFTY 50",
    SEM_INSTRUMENT_NAME: "INDEX",
    SEM_LOT_SIZE: "1",
    SEM_TICK_SIZE: "0.05",
    ...overrides,
  }, "dhan").instrument!;
}

function setup() {
  const nifty = instrument();
  const bank = instrument({ SEM_SMST_SECURITY_ID: "25", SEM_TRADING_SYMBOL: "NIFTY BANK", SEM_CUSTOM_SYMBOL: "NIFTY BANK" });
  const option = instrument({ SEM_SMST_SECURITY_ID: "3001", SEM_EXM: "NSE_FNO", SEM_TRADING_SYMBOL: "NIFTY26SEP25000CE", SEM_CUSTOM_SYMBOL: "NIFTY 25000 CE", SEM_INSTRUMENT_NAME: "OPTIDX", SEM_EXPIRY_DATE: "2026-09-24", SEM_STRIKE_PRICE: "25000", SEM_OPTION_TYPE: "CE", SEM_LOT_SIZE: "65" });
  return { nifty, bank, option };
}

describe("Task 38 deterministic reconnect and recovery", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("initial connection transitions deterministically", () => {
    const { nifty } = setup();
    const transport = { subscribe: vi.fn(), unsubscribe: vi.fn(), connect: vi.fn() };
    const service = new RealtimeMarketDataService([nifty], transport);
    expect(service.state).toBe("disconnected");
    service.connect();
    expect(transport.connect).toHaveBeenCalledTimes(1);
    expect(service.state).toBe("connected");
  });

  it("preserves last-known quote and marks it stale during disconnect", () => {
    const { nifty } = setup();
    const service = new RealtimeMarketDataService([nifty]);
    service.ingest("dhan", { securityId: "13", exchangeSegment: "IDX_I", ltp: 23000, timestamp: 5000 });
    service.connectionLost("provider disconnect");
    expect(service.state).toBe("reconnecting");
    expect(service.getLatest("13")?.ltp).toBe(23000);
    expect(service.getLatest("13")?.freshness).toBe("stale");
  });

  it("restores active subscriptions exactly once after reconnect and avoids duplicates", () => {
    const { nifty } = setup();
    const transport = { subscribe: vi.fn(), unsubscribe: vi.fn(), connect: vi.fn() };
    const service = new RealtimeMarketDataService([nifty], transport, { reconnectDelaysMs: [10, 20] });
    const listener = vi.fn();
    service.subscribe("13", listener);
    service.connect();
    expect(transport.subscribe).toHaveBeenCalledTimes(1);
    service.connectionLost();
    service.connect(true);
    expect(transport.subscribe).toHaveBeenCalledTimes(1);
    expect(service.activeSubscriptionIds).toEqual(["13"]);
    expect(service.getSubscriberCount("13")).toBe(1);
  });

  it("restores independent subscriptions across multiple instruments", () => {
    const { nifty, bank } = setup();
    const transport = { subscribe: vi.fn(), unsubscribe: vi.fn(), connect: vi.fn() };
    const service = new RealtimeMarketDataService([nifty, bank], transport);
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    service.subscribe("13", listenerA);
    service.subscribe("25", listenerB);
    service.connect();
    service.connectionLost();
    service.connect(true);
    expect(transport.subscribe).toHaveBeenCalledTimes(2);
    expect(service.activeSubscriptionIds).toEqual(["13", "25"]);
  });

  it("ignores stale socket generation events", () => {
    const { nifty } = setup();
    const service = new RealtimeMarketDataService([nifty]);
    const listener = vi.fn();
    service.subscribe("13", listener);
    service.connect();
    const staleGeneration = (service as any).connectionGeneration + 1;
    const result = service.ingest("dhan", { securityId: "13", exchangeSegment: "IDX_I", ltp: 24000, timestamp: 6000 }, staleGeneration);
    expect(result.ignored).toBe(true);
    expect(listener).toHaveBeenCalledTimes(0);
  });

  it("reaches failed state after bounded retry exhaustion", () => {
    const { nifty } = setup();
    const transport = {
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      connect: vi.fn(() => {
        throw new Error("provider unavailable");
      }),
    };
    const service = new RealtimeMarketDataService([nifty], transport, { maxReconnectAttempts: 2, reconnectDelaysMs: [10, 20] });
    service.connect();
    service.connectionLost();
    vi.advanceTimersByTime(1000);
    expect(service.state).toBe("failed");
    expect(service.reconnectAttemptCount).toBeGreaterThanOrEqual(2);
  });

  it("cleans up reconnect timers and does not create duplicate timers", () => {
    const { nifty } = setup();
    const transport = { subscribe: vi.fn(), unsubscribe: vi.fn(), connect: vi.fn() };
    const service = new RealtimeMarketDataService([nifty], transport, { maxReconnectAttempts: 3, reconnectDelaysMs: [10, 20, 30] });
    service.connectionLost();
    expect(service.hasReconnectTimer).toBe(true);
    service.connectionLost();
    expect(service.hasReconnectTimer).toBe(true);
    service.disconnect();
    expect(service.hasReconnectTimer).toBe(false);
  });

  it("maintains quote flow and freshness after reconnect", () => {
    const { nifty } = setup();
    const service = new RealtimeMarketDataService([nifty]);
    const listener = vi.fn();
    service.subscribe("13", listener);
    service.ingest("dhan", { securityId: "13", exchangeSegment: "IDX_I", ltp: 23000, timestamp: 5000 });
    service.connectionLost();
    expect(service.getLatest("13")?.freshness).toBe("stale");
    service.ingest("dhan", { securityId: "13", exchangeSegment: "IDX_I", ltp: 23050, timestamp: 6000 });
    expect(service.getLatest("13")?.ltp).toBe(23050);
    expect(service.getLatest("13")?.freshness).toBe("fresh");
  });

  it("reports partial restore failure without duplicating successful subscriptions", () => {
    const { nifty, bank } = setup();
    const transport = {
      subscribe: vi.fn((instruments) => {
        if (instruments[0].providerInstrumentId === "13") throw new Error("fail");
      }),
      unsubscribe: vi.fn(),
      connect: vi.fn(),
    };
    const service = new RealtimeMarketDataService([nifty, bank], transport, { reconnectDelaysMs: [10] });
    service.subscribe("13", vi.fn());
    service.subscribe("25", vi.fn());
    service.connect();
    expect(service.failedRestoreIds).toContain("13");
    expect(service.activeSubscriptionIds).toEqual(["13", "25"]);
  });

  it("supports controlled reconnect without creating parallel connections", () => {
    const { nifty } = setup();
    const transport = { subscribe: vi.fn(), unsubscribe: vi.fn(), connect: vi.fn() };
    const service = new RealtimeMarketDataService([nifty], transport, { reconnectDelaysMs: [10] });
    service.reconnect();
    service.reconnect();
    expect(transport.connect).toHaveBeenCalledTimes(1);
  });
});
