import { describe, expect, it } from "vitest";
import { InstrumentMaster, normalizeProviderInstrument } from "@/lib/instrumentMaster";
import {
  buildOptionChain,
  discoverOptionExpiries,
  normalizeOptionContract,
  OptionChainService,
  resolveUnderlyingInstrument,
  applyRealtimeOptionUpdate,
} from "@/lib/optionChain";

function optionInstrument(overrides: Record<string, unknown> = {}) {
  return normalizeProviderInstrument({
    SEM_SMST_SECURITY_ID: "4001",
    SEM_EXM: "NSE_FNO",
    SEM_TRADING_SYMBOL: "NIFTY26SEP25000CE",
    SEM_CUSTOM_SYMBOL: "NIFTY 25000 CE",
    SEM_INSTRUMENT_NAME: "OPTIDX",
    SEM_EXPIRY_DATE: "2026-09-24",
    SEM_STRIKE_PRICE: "25000",
    SEM_OPTION_TYPE: "CE",
    SEM_LOT_SIZE: "75",
    SEM_TICK_SIZE: "0.05",
    SEM_UNDERLYING_SECURITY_ID: "13",
    ...overrides,
  }, "dhan").instrument!;
}

function makeMaster() {
  const master = new InstrumentMaster();
  master.add(normalizeProviderInstrument({
    SEM_SMST_SECURITY_ID: "13",
    SEM_EXM: "IDX_I",
    SEM_TRADING_SYMBOL: "NIFTY 50",
    SEM_CUSTOM_SYMBOL: "NIFTY",
    SEM_INSTRUMENT_NAME: "INDEX",
    SEM_LOT_SIZE: "1",
    SEM_TICK_SIZE: "0.05",
  }, "dhan").instrument!);
  master.add(optionInstrument({ SEM_SMST_SECURITY_ID: "4001", SEM_OPTION_TYPE: "CE", SEM_STRIKE_PRICE: "25000", SEM_EXPIRY_DATE: "2026-09-24" }));
  master.add(optionInstrument({ SEM_SMST_SECURITY_ID: "4002", SEM_OPTION_TYPE: "PE", SEM_STRIKE_PRICE: "25000", SEM_EXPIRY_DATE: "2026-09-24" }));
  master.add(optionInstrument({ SEM_SMST_SECURITY_ID: "4003", SEM_OPTION_TYPE: "CE", SEM_STRIKE_PRICE: "25100", SEM_EXPIRY_DATE: "2026-09-24" }));
  master.add(optionInstrument({ SEM_SMST_SECURITY_ID: "4004", SEM_OPTION_TYPE: "PE", SEM_STRIKE_PRICE: "25100", SEM_EXPIRY_DATE: "2026-09-24" }));
  master.add(optionInstrument({ SEM_SMST_SECURITY_ID: "5001", SEM_OPTION_TYPE: "CE", SEM_STRIKE_PRICE: "25000", SEM_EXPIRY_DATE: "2026-10-29" }));
  return master;
}

describe("Task 40 canonical option-chain contract", () => {
  it("resolves supported underlying instruments and rejects unsupported ones", () => {
    const master = makeMaster();
    expect(resolveUnderlyingInstrument(master, "NIFTY")?.securityId).toBe("13");
    expect(resolveUnderlyingInstrument(master, "SENSEX")?.symbol).toBe("SENSEX");
    expect(resolveUnderlyingInstrument(master, "UNKNOWN")?.error?.code).toBe("UNKNOWN_UNDERLYING");
    expect(resolveUnderlyingInstrument(master, "ABCDEF")?.error?.code).toBe("UNKNOWN_UNDERLYING");
    expect(resolveUnderlyingInstrument(master, "")?.error?.code).toBe("MISSING_UNDERLYING");
  });

  it("discovers sorted unique expiries from canonical option instruments", () => {
    const master = makeMaster();
    const expiries = discoverOptionExpiries(master, "NIFTY");
    expect(expiries.map((day) => day.value)).toEqual(["2026-09-24", "2026-10-29"]);
    expect(expiries[0].daysToExpiry).toBeGreaterThanOrEqual(0);
  });

  it("builds a canonical option chain and pairs CE/PE contracts by strike", () => {
    const master = makeMaster();
    const chain = buildOptionChain(master, "NIFTY", "2026-09-24");
    expect(chain.rows.map((row) => row.strike)).toEqual([25000, 25100]);
    expect(chain.rows[0].ce?.optionType).toBe("CE");
    expect(chain.rows[0].pe?.optionType).toBe("PE");
    expect(chain.rows[0].ce?.providerInstrumentId).toBe("4001");
    expect(chain.rows[0].pe?.providerInstrumentId).toBe("4002");
  });

  it("normalizes option contracts and handles malformed or missing legs safely", () => {
    const normalized = normalizeOptionContract({
      underlyingInstrumentId: "13",
      underlyingSymbol: "NIFTY",
      exchange: "NSE",
      providerInstrumentId: "999",
      expiry: "2026-09-24",
      strike: 25000,
      optionType: "CE",
      lotSize: 75,
      tickSize: 0.05,
      tradingSymbol: "NIFTY26SEP25000CE",
      segment: "NSE_FNO",
      oi: 1200,
      oiChange: 150,
      volume: 405,
      quote: { lastTradedPrice: 210, change: 5 },
      greeks: { delta: 0.5, gamma: 0.01, theta: -8, vega: 12, iv: 15 },
    });
    expect(normalized.optionType).toBe("CE");
    expect(normalized.oi).toBe(1200);
    expect(normalized.greeks?.delta).toBe(0.5);
    expect(normalizeOptionContract({ optionType: "PE", strike: NaN as any })).toMatchObject({ error: { code: "INVALID_STRIKE" } });
  });

  it("keeps each option strike isolated and maps realtime updates to the correct leg", () => {
    const master = makeMaster();
    const chain = buildOptionChain(master, "NIFTY", "2026-09-24");
    applyRealtimeOptionUpdate(chain, { instrumentId: "4001", providerInstrumentId: "4001", ltp: 240, volume: 300, oi: 1500, timestamp: Date.now() });
    applyRealtimeOptionUpdate(chain, { instrumentId: "4002", providerInstrumentId: "4002", ltp: 170, volume: 210, oi: 1800, timestamp: Date.now() });
    expect(chain.rows[0].ceQuote?.lastTradedPrice).toBe(240);
    expect(chain.rows[0].peQuote?.lastTradedPrice).toBe(170);
    expect(chain.rows[1].ceQuote).toBeUndefined();
  });

  it("uses the canonical query cache and invalidates when the expiry changes", async () => {
    const master = makeMaster();
    const service = new OptionChainService(master);
    const first = await service.load({ underlying: "NIFTY", expiry: "2026-09-24" });
    const second = await service.load({ underlying: "NIFTY", expiry: "2026-09-24" });
    expect(first.rows.length).toBeGreaterThan(0);
    expect(second.ts).toBe(first.ts);
    const refreshed = await service.load({ underlying: "NIFTY", expiry: "2026-10-29" });
    expect(refreshed.selectedExpiry).toBe("2026-10-29");
  });
});
