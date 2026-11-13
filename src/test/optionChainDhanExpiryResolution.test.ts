import { describe, expect, it } from "vitest";
import { findDhanOptionInstrument } from "@/lib/marketInstrumentResolver";
import { detectUnusualActivity, summarizeChain, toOptionRowViews } from "@/lib/optionChainAnalytics";
import type { Instrument } from "@/lib/localDatabase";

const option = (expiryDate: string, optionType: "CE" | "PE", securityId: string): Instrument => ({
  securityId, providerInstrumentId: securityId, provider: "dhan", symbol: "NIFTY",
  tradingSymbol: `NIFTY-Nov2026-25150-${optionType}`, exchange: "NSE", exchangeSegment: "NSE_FNO",
  instrumentType: "OPTIDX", lotSize: 65, expiryDate, strikePrice: 25150, optionType,
});

describe("Dhan option contract resolution", () => {
  it("matches the chain's YYYY-MM-DD expiry against the master's timestamped expiry", () => {
    const master = [option("2026-12-08 14:30:00", "CE", "1"), option("2026-11-17 14:30:00", "CE", "2"), option("2026-11-17 14:30:00", "PE", "3")];
    expect(findDhanOptionInstrument(master, { underlying: "NIFTY", expiry: "2026-11-17", strike: 25150, optionType: "CE" })?.securityId).toBe("2");
    expect(findDhanOptionInstrument(master, { underlying: "NIFTY", expiry: "2026-11-17", strike: 25150, optionType: "PE" })?.securityId).toBe("3");
  });
});

describe("option chain view model", () => {
  const legacy = { ltp: 0, oi: 0, oiChange: 0, volume: 0, iv: 0, delta: 0, gamma: 0, theta: 0, vega: 0, bidPrice: 0, askPrice: 0 };
  it("renders untraded zero legs as unavailable instead of 0", () => {
    const [row] = toOptionRowViews([{ strikePrice: 17350, ce: legacy, pe: legacy, call: { ltp: 0, oi: 0, volume: 0, iv: 10.7, greeks: { delta: 0, theta: 0 } }, put: null }], { greeksAvailable: true, oiChangeAvailable: true });
    expect(row.ce).toMatchObject({ present: true, ltp: null, oi: null, delta: null, theta: null, iv: 10.7 });
    expect(row.pe.present).toBe(false);
  });

  it("computes PCR, ATM straddle and volume spikes only from reported values", () => {
    const rows = toOptionRowViews([25000, 25050, 25100, 25150, 25200].map((strike) => ({
      strikePrice: strike, ce: legacy, pe: legacy,
      call: { ltp: 100, oi: 1000, volume: strike === 25100 ? 100000 : 10 },
      put: { ltp: 80, oi: 2000, volume: 10 },
    })), { greeksAvailable: false, oiChangeAvailable: false });
    const summary = summarizeChain(rows, 25110);
    expect(summary).toMatchObject({ atmStrike: 25100, straddle: 180, pcr: 2 });
    expect(detectUnusualActivity(rows)).toEqual([expect.objectContaining({ strike: 25100, side: "CE", kind: "VOLUME_SPIKE" })]);
  });
});
