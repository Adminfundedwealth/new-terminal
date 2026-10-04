import { describe, expect, it } from "vitest";
import { classifyInstrument, isTradableContract, validateInstrumentForOrder } from "@/lib/instrumentClassification";
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
});
