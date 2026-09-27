import { describe, expect, it } from "vitest";
import { InstrumentMaster, normalizeProviderInstrument } from "@/lib/instrumentMaster";
import { normalizeQuote, QuoteService } from "@/lib/quoteService";
import { normalizeDhanQuotePayload } from "@/lib/marketApi";

function makeMaster() {
  const master = new InstrumentMaster();
  const instrument = normalizeProviderInstrument({ securityId: "13", exchangeSegment: "IDX_I", tradingSymbol: "NIFTY 50", symbol: "NIFTY", instrumentType: "INDEX", lotSize: 1, tickSize: 0.05 }, "dhan").instrument!;
  master.add(instrument);
  return master;
}

const base = { provider: "dhan" as const, providerInstrumentId: "13", payload: { data: { IDX_I: [{ last_price: 22000, previous_close: 21900, open: 21950, high: 22100, low: 21800, volume: 100, timestamp: "2026-09-24T10:00:00.000Z" }] } }, now: Date.parse("2026-09-24T10:01:00.000Z") };

describe("Task 36 canonical quote service", () => {
  it("normalizes a valid Dhan payload and preserves provider fields", () => {
    const result = normalizeQuote(base, makeMaster());
    expect(result.freshness).toBe("fresh");
    expect(result.quote).toMatchObject({ instrumentId: "13", providerInstrumentId: "13", symbol: "NIFTY", lastTradedPrice: 22000, previousClose: 21900, timestamp: "2026-09-24T10:00:00.000Z" });
  });
  it("rejects missing and unknown instrument identities", () => {
    expect(normalizeQuote({ ...base, providerInstrumentId: undefined }, makeMaster()).error?.code).toBe("MISSING_INSTRUMENT");
    expect(normalizeQuote({ ...base, providerInstrumentId: "999" }, makeMaster()).error?.code).toBe("UNKNOWN_INSTRUMENT");
  });
  it("rejects invalid prices, timestamps, quantities, and OHLC", () => {
    expect(normalizeQuote({ ...base, payload: { data: { IDX_I: [{ last_price: -1, timestamp: "2026-09-24T10:00:00.000Z" }] } } }, makeMaster()).error?.code).toBe("INVALID_PRICE");
    expect(normalizeQuote({ ...base, payload: { data: { IDX_I: [{ last_price: 10, timestamp: "bad" }] } } }, makeMaster()).error?.code).toBe("INVALID_TIMESTAMP");
    expect(normalizeQuote({ ...base, payload: { data: { IDX_I: [{ last_price: 10, volume: -1, timestamp: "2026-09-24T10:00:00.000Z" }] } } }, makeMaster()).error?.code).toBe("INVALID_QUANTITY");
    expect(normalizeQuote({ ...base, payload: { data: { IDX_I: [{ last_price: 10, high: 9, low: 10, timestamp: "2026-09-24T10:00:00.000Z" }] } } }, makeMaster()).error?.code).toBe("INVALID_OHLC");
  });
  it("marks stale quotes without presenting them as fresh", () => {
    const result = normalizeQuote({ ...base, now: Date.parse("2026-09-24T11:00:00.000Z") }, makeMaster());
    expect(result.freshness).toBe("stale");
    expect(result.error?.code).toBe("STALE_QUOTE");
  });
  it("keeps the newest quote and ignores older and duplicate updates", () => {
    const service = new QuoteService(makeMaster());
    expect(service.ingest(base).quote?.lastTradedPrice).toBe(22000);
    expect(service.ingest({ ...base, payload: { data: { IDX_I: [{ last_price: 22100, timestamp: "2026-09-24T10:02:00.000Z" }] } } }).quote?.lastTradedPrice).toBe(22100);
    expect(service.ingest({ ...base, payload: { data: { IDX_I: [{ last_price: 21900, timestamp: "2026-09-24T09:59:00.000Z" }] } } }).quote?.lastTradedPrice).toBe(22100);
    expect(service.ingest({ ...base, payload: { data: { IDX_I: [{ last_price: 22100, timestamp: "2026-09-24T10:02:00.000Z" }] } } }).quote?.lastTradedPrice).toBe(22100);
    expect(service.getLatest("13")?.lastTradedPrice).toBe(22100);
  });
  it("resolves exchange and symbol identity through the master", () => {
    const result = normalizeQuote({ ...base, providerInstrumentId: undefined, exchange: "NSE", symbol: "NIFTY 50" }, makeMaster());
    expect(result.quote?.instrumentId).toBe("13");
  });
  it("keeps the legacy adapter fields when normalizing a Dhan payload", () => {
    const result = normalizeDhanQuotePayload(base.payload, "NIFTY 50", makeMaster(), base.now);
    expect(result.quote).toMatchObject({ symbol: "NIFTY", ltp: 22000, change: 100, changePercent: expect.closeTo(100 / 219, 5) });
  });
});