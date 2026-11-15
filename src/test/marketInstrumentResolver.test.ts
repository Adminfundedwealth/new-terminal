import { describe, expect, it } from "vitest";
import {
  findDhanOptionInstrument,
  resolveCashEquityUniverse,
  resolveIndianIndexUniverse,
  resolveOptionChainUnderlyings,
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
  it("includes eligible cash equities beyond the former approved list", () => {
    const newListing = instrument({
      securityId: "900001",
      providerInstrumentId: "900001",
      symbol: "NEW LISTING LIMITED",
      tradingSymbol: "NEWLISTING",
    });

    expect(resolveCashEquityUniverse([newListing])).toEqual([newListing]);
  });

  it("preserves distinct NSE and BSE listings but deduplicates repeated provider identities", () => {
    const bseListing = instrument({
      securityId: "500180",
      providerInstrumentId: "500180",
      symbol: "HDFC BANK LTD.",
      exchange: "BSE",
      exchangeSegment: "BSE_EQ",
      series: "A",
    });
    const nseListing = instrument();

    expect(resolveCashEquityUniverse([bseListing, nseListing, nseListing])).toEqual([bseListing, nseListing]);
  });

  it("includes all provider-backed NSE and BSE indices", () => {
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

    expect(resolveIndianIndexUniverse([nseIndex, bseIndex])).toEqual([nseIndex, bseIndex]);
  });

  it("derives option-chain search underlyings from active catalog contracts", () => {
    const stockOption = instrument({
      symbol: "NEWLISTING",
      tradingSymbol: "NEWLISTING-Nov2099-250-CE",
      exchangeSegment: "NSE_FNO",
      instrumentType: "OPTSTK",
      expiryDate: "2099-11-26",
      strikePrice: 250,
      optionType: "CE",
    });
    const indexOption = instrument({
      symbol: "NIFTY",
      tradingSymbol: "NIFTY-Nov2099-25000-PE",
      exchangeSegment: "NSE_FNO",
      instrumentType: "OPTIDX",
      expiryDate: "2099-11-26",
      strikePrice: 25000,
      optionType: "PE",
    });
    const expiredOption = { ...stockOption, securityId: "99903", providerInstrumentId: "99903", expiryDate: "2000-01-27" };

    expect(resolveOptionChainUnderlyings([stockOption, indexOption, expiredOption], "OPTSTK")).toEqual(["NEWLISTING"]);
    expect(resolveOptionChainUnderlyings([stockOption, indexOption, expiredOption], "OPTIDX")).toEqual(["NIFTY"]);
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

  it("resolves non-curated stock options from their exact trading symbol prefix", () => {
    const option = instrument({
      securityId: "99902",
      providerInstrumentId: "99902",
      symbol: "NEW LISTING LIMITED",
      tradingSymbol: "NEWLISTING-Jul2026-250-CE",
      exchangeSegment: "NSE_FNO",
      instrumentType: "OPTSTK",
      expiryDate: "2026-07-30",
      strikePrice: 250,
      optionType: "CE",
    });

    expect(findDhanOptionInstrument([option], {
      underlying: "NEWLISTING",
      expiry: "2026-07-30",
      strike: 250,
      optionType: "CE",
    })).toBe(option);
  });

  it("uses the chain exchange when both exchanges list the same option contract", () => {
    const nseOption = instrument({
      securityId: "99911",
      providerInstrumentId: "99911",
      symbol: "HDFCBANK",
      tradingSymbol: "HDFCBANK-Nov2026-700-CE",
      exchange: "NSE",
      exchangeSegment: "NSE_FNO",
      instrumentType: "OPTSTK",
      expiryDate: "2026-11-26",
      strikePrice: 700,
      optionType: "CE",
    });
    const bseOption = { ...nseOption, securityId: "99912", providerInstrumentId: "99912", exchange: "BSE", exchangeSegment: "BSE_FNO" };

    expect(findDhanOptionInstrument([bseOption, nseOption], {
      underlying: "HDFCBANK",
      expiry: "2026-11-26",
      strike: 700,
      optionType: "CE",
      exchange: "NSE",
    })).toBe(nseOption);
  });
});
