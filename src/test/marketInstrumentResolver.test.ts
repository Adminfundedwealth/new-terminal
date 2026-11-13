import { describe, expect, it } from "vitest";
import { APPROVED_200_STOCKS } from "@/lib/approvedInstruments";
import {
  findApprovedIndexInstrument,
  findDhanOptionInstrument,
  resolveApprovedStockUniverse,
} from "@/lib/marketInstrumentResolver";
import type { Instrument } from "@/lib/localDatabase";

function instrument(overrides: Partial<Instrument> = {}): Instrument {
  return {
    securityId: "1333",
    providerInstrumentId: "1333",
    provider: "dhan",
    symbol: "HDFC BANK LTD",
    tradingSymbol: "HDFCBANK",
    exchange: "NSE",
    exchangeSegment: "NSE_EQ",
    instrumentType: "EQUITY",
    lotSize: 1,
    tickSize: 0.05,
    series: "EQ",
    ...overrides,
  };
}

describe("canonical market instrument resolution", () => {
  it("preserves all 200 approved stock rows when some instruments are unmapped", () => {
    const stocks = resolveApprovedStockUniverse([instrument()]);

    expect(stocks).toHaveLength(200);
    expect(stocks.map(({ stock }) => stock.symbol)).toEqual(APPROVED_200_STOCKS.map(({ symbol }) => symbol));
    expect(stocks.find(({ stock }) => stock.symbol === "HDFCBANK")?.instrument?.securityId).toBe("1333");
    expect(stocks.find(({ stock }) => stock.symbol === "RELIANCE")?.instrument).toBeUndefined();
  });

  it("prefers the NSE listing when the Dhan master returns the BSE listing first", () => {
    const bseListing = instrument({
      securityId: "500180",
      providerInstrumentId: "500180",
      symbol: "HDFC BANK LTD.",
      exchange: "BSE",
      exchangeSegment: "BSE_EQ",
      series: "A",
    });
    const nseListing = instrument();

    expect(resolveApprovedStockUniverse([bseListing, nseListing])
      .find(({ stock }) => stock.symbol === "HDFCBANK")?.instrument?.providerInstrumentId).toBe("1333");
  });

  it("resolves renamed Dhan trading symbols for approved stocks", () => {
    const stocks = resolveApprovedStockUniverse([
      instrument({ securityId: "3456", symbol: "TATA MOTORS PASS VEH LTD", tradingSymbol: "TMPV" }),
    ]);

    expect(stocks.find(({ stock }) => stock.symbol === "TATAMOTORS")?.instrument).toMatchObject({
      securityId: "3456",
      tradingSymbol: "TMPV",
    });
  });

  it("resolves index aliases only in the approved exchange segment", () => {
    const nseIndex = instrument({
      securityId: "13",
      symbol: "NIFTY 50",
      tradingSymbol: "NIFTY",
      exchange: "NSE",
      exchangeSegment: "IDX_I",
      instrumentType: "INDEX",
      lotSize: 1,
    });
    const bseIndex = instrument({
      securityId: "1",
      symbol: "SENSEX",
      tradingSymbol: "SENSEX",
      exchange: "BSE",
      exchangeSegment: "BSE_IDX",
      instrumentType: "INDEX",
      lotSize: 1,
    });

    expect(findApprovedIndexInstrument([nseIndex], { symbol: "NIFTY", segment: "IDX_I" })).toBe(nseIndex);
    expect(findApprovedIndexInstrument([nseIndex], { symbol: "NSE:NIFTY50", segment: "IDX_I" })).toBe(nseIndex);
    expect(findApprovedIndexInstrument([nseIndex], { symbol: "NIFTY", segment: "BSE_IDX" })).toBeUndefined();
    expect(findApprovedIndexInstrument([bseIndex], { symbol: "SENSEX", segment: "BSE_IDX" })).toBe(bseIndex);
  });

  it("uses the verified option contract identity from the Dhan instrument master", () => {
    const option = instrument({
      securityId: "99901",
      providerInstrumentId: "99901",
      symbol: "NIFTY",
      tradingSymbol: "NIFTY-2026-SEP-25000-CE",
      exchangeSegment: "NSE_FNO",
      instrumentType: "OPTIDX",
      expiryDate: "2026-09-24",
      strikePrice: 25000,
      optionType: "CE",
      underlyingSecurityId: "13",
    });

    expect(findDhanOptionInstrument([option], {
      underlying: "NIFTY",
      expiry: "2026-09-24",
      strike: 25000,
      optionType: "CE",
      underlyingSecurityId: "13",
    })).toBe(option);
    expect(findDhanOptionInstrument([option], {
      underlying: "BANKNIFTY",
      expiry: "2026-09-24",
      strike: 25000,
      optionType: "CE",
      underlyingSecurityId: "25",
    })).toBeUndefined();
  });
});
