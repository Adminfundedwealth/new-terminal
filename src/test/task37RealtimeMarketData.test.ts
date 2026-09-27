import { describe, expect, it, vi } from "vitest";
import { InstrumentMaster, normalizeProviderInstrument } from "@/lib/instrumentMaster";
import { RealtimeMarketDataService, normalizeRealtimeQuote, type RealtimeProviderTransport } from "@/lib/realtimeMarketData";

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

describe("Task 37 canonical realtime market data", () => {
  it("maps provider tokens and normalizes valid payloads without inventing values", () => {
    const { nifty } = setup();
    const master = new InstrumentMaster(); master.add(nifty);
    const result = normalizeRealtimeQuote(master, "dhan", { securityId: "13", exchangeSegment: "IDX_I", ltt: 100, ltp: 23000, volume: 12 });
    expect(result.quote).toMatchObject({ instrumentId: "13", providerInstrumentId: "13", exchange: "NSE", symbol: "NIFTY 50", providerTimestamp: 100000, ltp: 23000, volume: 12 });
    expect(result.quote?.change).toBeUndefined();
  });

  it("rejects malformed and unknown payloads", () => {
    const { nifty } = setup();
    const master = new InstrumentMaster(); master.add(nifty);
    expect(normalizeRealtimeQuote(master, "dhan", { securityId: "13", ltp: 10 }).error).toContain("timestamp");
    expect(normalizeRealtimeQuote(master, "dhan", { securityId: "999", timestamp: 1, ltp: 10 }).error).toContain("Unknown");
    expect(normalizeRealtimeQuote(master, "dhan", { securityId: "13", timestamp: 1, exchangeSegment: "NSE_EQ", ltp: 10 }).error).toContain("segment");
  });

  it("deduplicates subscriptions, safely unsubscribes, and cleans provider tokens", () => {
    const { nifty } = setup();
    const transport: RealtimeProviderTransport = { subscribe: vi.fn(() => undefined), unsubscribe: vi.fn(() => undefined) };
    const service = new RealtimeMarketDataService([nifty], transport);
    const listener = vi.fn();
    const first = service.subscribe("13", listener);
    const second = service.subscribe("13", listener);
    expect(transport.subscribe).toHaveBeenCalledTimes(1);
    expect(service.getSubscriberCount("13")).toBe(1);
    first(); second(); service.unsubscribe("13", listener);
    expect(transport.unsubscribe).toHaveBeenCalledTimes(1);
    expect(service.getSubscriberCount("13")).toBe(0);
  });

  it("isolates instruments and protects against duplicates and out-of-order updates", () => {
    const { nifty, bank, option } = setup();
    const service = new RealtimeMarketDataService([nifty, bank, option]);
    const niftyUpdates: number[] = []; const bankUpdates: number[] = []; const optionUpdates: number[] = [];
    service.subscribe("13", (quote) => niftyUpdates.push(quote.ltp!));
    service.subscribe("25", (quote) => bankUpdates.push(quote.ltp!));
    service.subscribe("3001", (quote) => optionUpdates.push(quote.ltp!));
    const update = (securityId: string, ltp: number, timestamp: number, exchangeSegment = "IDX_I") => service.ingest("dhan", { securityId, ltp, timestamp, exchangeSegment });
    update("13", 23000, 2000); update("13", 23000, 2000); update("13", 22900, 1000); update("25", 51000, 2000); update("3001", 100, 2000, "NSE_FNO");
    expect(niftyUpdates).toEqual([23000]); expect(bankUpdates).toEqual([51000]); expect(optionUpdates).toEqual([100]);
  });

  it("exposes deterministic connection state and provider errors remain observable", () => {
    const service = new RealtimeMarketDataService();
    const states: string[] = []; service.onState((state, error) => states.push(error ? `${state}:${error}` : state));
    service.setState("connecting"); service.setState("connected"); service.setState("error", "provider unavailable");
    expect(states).toEqual(["disconnected", "connecting", "connected", "error:provider unavailable"]);
  });
});