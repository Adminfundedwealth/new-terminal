import { describe, expect, it } from "vitest";
import { findDhanOptionInstrument } from "@/lib/marketInstrumentResolver";
import type { Instrument } from "@/lib/localDatabase";

function optionInstrument(overrides: Partial<Instrument> = {}): Instrument {
  return {
    securityId: "4001",
    providerInstrumentId: "4001",
    provider: "dhan",
    symbol: "NIFTY",
    tradingSymbol: "NIFTY-2026-SEP-25000-CE",
    exchange: "NSE",
    exchangeSegment: "NSE_FNO",
    instrumentType: "OPTIDX",
    lotSize: 75,
    tickSize: 0.05,
    expiryDate: "2026-09-24",
    strikePrice: 25000,
    optionType: "CE",
    underlyingSecurityId: "13",
    ...overrides,
  };
}

describe("option-chain contract resolution", () => {
  it("resolves exact underlying, expiry, strike, option type, security ID, segment, and lot size", () => {
    const call = optionInstrument();
    const put = optionInstrument({
      securityId: "4002",
      providerInstrumentId: "4002",
      tradingSymbol: "NIFTY-2026-SEP-25000-PE",
      optionType: "PE",
    });

    expect(findDhanOptionInstrument([put, call], {
      underlying: "NIFTY",
      underlyingSecurityId: "13",
      expiry: "2026-09-24",
      strike: 25000,
      optionType: "CE",
    })).toMatchObject({
      providerInstrumentId: "4001",
      tradingSymbol: "NIFTY-2026-SEP-25000-CE",
      exchangeSegment: "NSE_FNO",
      lotSize: 75,
      optionType: "CE",
    });
    expect(findDhanOptionInstrument([put, call], {
      underlying: "NIFTY",
      underlyingSecurityId: "13",
      expiry: "2026-09-24",
      strike: 25000,
      optionType: "PE",
    })?.providerInstrumentId).toBe("4002");
  });

  it("rejects a matching-looking option when its underlying security ID conflicts", () => {
    const sameNameWrongUnderlying = optionInstrument({ underlyingSecurityId: "25" });

    expect(findDhanOptionInstrument([sameNameWrongUnderlying], {
      underlying: "NIFTY",
      underlyingSecurityId: "13",
      expiry: "2026-09-24",
      strike: 25000,
      optionType: "CE",
    })).toBeUndefined();
  });
});
