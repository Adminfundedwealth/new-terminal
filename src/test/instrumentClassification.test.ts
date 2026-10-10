import { describe, expect, it } from "vitest";
import { canonicalIndexSymbol, classifyInstrument, isCashEquityListing, isProductionInstrument, isTradableContract, validateInstrumentForOrder } from "@/lib/instrumentClassification";
import type { Instrument } from "@/lib/localDatabase";

const instrument = (overrides: Partial<Instrument>): Instrument => ({
  securityId: "1",
  symbol: "RELIANCE",
  tradingSymbol: "RELIANCE-EQ",
  exchangeSegment: "NSE_EQ",
  instrumentType: "EQUITY",
  lotSize: 1,
  ...overrides,
});

describe("instrument classification", () => {
  it("keeps cash stocks separate from all derivatives", () => {
    expect(classifyInstrument(instrument({}))).toBe("stocks");
    expect(classifyInstrument(instrument({ exchangeSegment: "IDX_I", instrumentType: "INDEX", symbol: "NIFTY" }))).toBe("indices");
    expect(classifyInstrument(instrument({ exchangeSegment: "NSE_FNO", instrumentType: "FUTSTK", expiryDate: "2099-01-01" }))).toBe("futures");
    expect(classifyInstrument(instrument({ exchangeSegment: "NSE_FNO", instrumentType: "FUTIDX", symbol: "NIFTY", expiryDate: "2099-01-01" }))).toBe("futures");
  });

  it("requires complete option metadata and supports stock/index options", () => {
    expect(classifyInstrument(instrument({ exchangeSegment: "NSE_FNO", instrumentType: "OPTSTK", expiryDate: "2099-01-01", strikePrice: 2500, optionType: "CE" }))).toBe("options");
    expect(classifyInstrument(instrument({ exchangeSegment: "NSE_FNO", instrumentType: "OPTIDX", symbol: "NIFTY", expiryDate: "2099-01-01", strikePrice: 25000, optionType: "PE" }))).toBe("options");
    expect(classifyInstrument(instrument({ exchangeSegment: "NSE_FNO", instrumentType: "OPTIDX", expiryDate: "2099-01-01", strikePrice: 25000 }))).toBeNull();
  });

  it("rejects a contract from the wrong category and expired derivatives", () => {
    const future = instrument({ exchangeSegment: "NSE_FNO", instrumentType: "FUTSTK", expiryDate: "2099-01-01" });
    expect(isTradableContract(future, "stocks")).toBe(false);
    expect(validateInstrumentForOrder(future, "futures")).toBeNull();
    expect(validateInstrumentForOrder({ ...future, expiryDate: "2020-01-01" }, "futures")).toBe("Instrument contract has expired");
  });

  it("filters synthetic test instruments from production lists", () => {
    expect(isProductionInstrument(instrument({ symbol: "011NSETEST", tradingSymbol: "NSETEST" }))).toBe(false);
    expect(isProductionInstrument(instrument({ symbol: "RELIANCE INDUSTRIES LTD", tradingSymbol: "RELIANCE" }))).toBe(true);
  });

  it("keeps cash shares while excluding debt securities from the stock directory", () => {
    expect(isCashEquityListing(instrument({ series: "EQ" }))).toBe(true);
    expect(isCashEquityListing(instrument({ exchange: "NSE", series: "IV" }))).toBe(true);
    expect(isCashEquityListing(instrument({ exchange: "NSE", series: "RR" }))).toBe(true);
    expect(isCashEquityListing(instrument({ exchange: "BSE", exchangeSegment: "BSE_EQ", series: "B" }))).toBe(true);
    expect(isCashEquityListing(instrument({ exchange: "BSE", exchangeSegment: "BSE_EQ", series: "IF" }))).toBe(true);
    expect(isCashEquityListing(instrument({ symbol: "ABCL 0% 2031 SR C2", tradingSymbol: "0ABCL31" }))).toBe(false);
    expect(isCashEquityListing(instrument({ symbol: "RELIANCE INDUSTRIES LTD", series: "N1" }))).toBe(false);
    expect(isCashEquityListing(instrument({ symbol: "Sri Lotus Developers and", tradingSymbol: "LOTUSDEV", series: "BE" }))).toBe(true);
    expect(isCashEquityListing(instrument({ symbol: "SRF LTD.", tradingSymbol: "SRF", series: "EQ" }))).toBe(true);
    expect(isCashEquityListing(instrument({ symbol: "SRM CONTRACTORS LIMITED", tradingSymbol: "SRM", series: "EQ" }))).toBe(true);
    expect(isCashEquityListing(instrument({ symbol: "TVS SRICHAKRA LIMITED", tradingSymbol: "TVSSRICHAK", series: "EQ" }))).toBe(true);
    expect(isCashEquityListing(instrument({ symbol: "RELIANCE 2030 SR C2", tradingSymbol: "REL30SR", series: "EQ" }))).toBe(false);
    expect(isCashEquityListing(instrument({ symbol: "ELECTROSTEEL CASTINGS LTD", tradingSymbol: "ELECTCAST", series: "W1" }))).toBe(false);
    expect(isCashEquityListing(instrument({ symbol: "3M INDIA LTD", tradingSymbol: "3MINDIA" }))).toBe(true);
    expect(isCashEquityListing(instrument({ symbol: "GOI T-BILL 182D-01/04/27", tradingSymbol: "GOITBILL182D" }))).toBe(false);
    expect(isCashEquityListing(instrument({ symbol: "GOI T-BILL 182D-01/04/27", tradingSymbol: "GOITBILL182D", series: "EQ" }))).toBe(false);
  });

  it("resolves gateway index trading symbols to their chart symbols", () => {
    expect(canonicalIndexSymbol("NIFTY 50")).toBe("NIFTY");
    expect(canonicalIndexSymbol("NIFTY BANK")).toBe("BANKNIFTY");
    expect(canonicalIndexSymbol("NIFTY MIDCAP 50")).toBe("NIFTY_MIDCAP_50");
  });
});
