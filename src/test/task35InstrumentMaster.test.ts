import { describe, expect, it } from "vitest";
import { InstrumentMaster, normalizeInstrumentMaster, normalizeProviderInstrument } from "@/lib/instrumentMaster";
import { isCashEquityListing } from "@/lib/instrumentClassification";

describe("Task 35 instrument master", () => {
  const row = (overrides: Record<string, unknown> = {}) => ({
    SEM_SMST_SECURITY_ID: "1001",
    SEM_EXM: "NSE_EQ",
    SEM_TRADING_SYMBOL: "RELIANCE",
    SEM_CUSTOM_SYMBOL: "Reliance Industries",
    SEM_INSTRUMENT_NAME: "EQUITY",
    SEM_LOT_SIZE: "1",
    SEM_TICK_SIZE: "0.05",
    ...overrides,
  });

  it("normalizes equity and index instruments", () => {
    expect(normalizeProviderInstrument(row(), "dhan").instrument).toMatchObject({ securityId: "1001", exchange: "NSE", exchangeSegment: "NSE_EQ", symbol: "Reliance Industries", displayName: "Reliance Industries", instrumentType: "EQUITY", lotSize: 1, tickSize: 0.05, provider: "dhan", providerInstrumentId: "1001" });
    expect(normalizeProviderInstrument(row({ SEM_SMST_SECURITY_ID: "13", SEM_EXM: "IDX_I", SEM_TRADING_SYMBOL: "NIFTY 50", SEM_CUSTOM_SYMBOL: "NIFTY 50", SEM_INSTRUMENT_NAME: "INDEX" }), "dhan").instrument).toMatchObject({ exchange: "NSE", exchangeSegment: "IDX_I", instrumentType: "INDEX", lotSize: 1 });
  });

  it("preserves NSE series metadata so debt-series listings do not enter cash equities", () => {
    const linkedNote = normalizeProviderInstrument(row({
      SEM_SMST_SECURITY_ID: "23669",
      SEM_TRADING_SYMBOL: "AAFS27C",
      SEM_CUSTOM_SYMBOL: "AAFS MARKET LINKED 2027",
      SEM_SERIES: "N4",
    }), "dhan").instrument!;
    const ordinaryEquity = normalizeProviderInstrument(row({
      SEM_SMST_SECURITY_ID: "2885",
      SEM_TRADING_SYMBOL: "RELIANCE",
      SEM_CUSTOM_SYMBOL: "RELIANCE INDUSTRIES LTD",
      SEM_SERIES: "EQ",
    }), "dhan").instrument!;

    expect(linkedNote.series).toBe("N4");
    expect(isCashEquityListing(linkedNote)).toBe(false);
    expect(ordinaryEquity.series).toBe("EQ");
    expect(isCashEquityListing(ordinaryEquity)).toBe(true);
  });

  it("normalizes futures and options with expiry, strike, and option type", () => {
    const future = normalizeProviderInstrument(row({ SEM_SMST_SECURITY_ID: "2001", SEM_EXM: "NSE_FNO", SEM_TRADING_SYMBOL: "RELIANCE26JANFUT", SEM_INSTRUMENT_NAME: "FUTSTK", SEM_EXPIRY_DATE: "2026-01-29", SEM_LOT_SIZE: "250" }), "dhan").instrument;
    const call = normalizeProviderInstrument(row({ SEM_SMST_SECURITY_ID: "3001", SEM_EXM: "NSE_FNO", SEM_TRADING_SYMBOL: "RELIANCE26JAN2500CE", SEM_INSTRUMENT_NAME: "OPTSTK", SEM_EXPIRY_DATE: "2026-01-29", SEM_STRIKE_PRICE: "2500", SEM_OPTION_TYPE: "CE", SEM_LOT_SIZE: "250", SEM_UNDERLYING_SECURITY_ID: "1001" }), "dhan").instrument;
    const put = normalizeProviderInstrument(row({ SEM_SMST_SECURITY_ID: "3002", SEM_EXM: "NSE_FNO", SEM_TRADING_SYMBOL: "RELIANCE26JAN2500PE", SEM_INSTRUMENT_NAME: "OPTSTK", SEM_EXPIRY_DATE: "2026-01-29", SEM_STRIKE_PRICE: "2500", SEM_OPTION_TYPE: "PE", SEM_LOT_SIZE: "250", SEM_UNDERLYING_SECURITY_ID: "1001" }), "dhan").instrument;
    expect(future).toMatchObject({ instrumentType: "FUTSTK", expiryDate: "2026-01-29", lotSize: 250, tickSize: 0.05 });
    expect(call).toMatchObject({ instrumentType: "OPTSTK", expiryDate: "2026-01-29", strikePrice: 2500, optionType: "CE", underlyingSecurityId: "1001" });
    expect(put).toMatchObject({ instrumentType: "OPTSTK", expiryDate: "2026-01-29", strikePrice: 2500, optionType: "PE" });
  });

  it("preserves supported BSE, MCX, and currency segments", () => {
    expect(normalizeProviderInstrument(row({ SEM_EXM: "BSE_EQ", SEM_TRADING_SYMBOL: "500325" }), "dhan").instrument?.exchangeSegment).toBe("BSE_EQ");
    expect(normalizeProviderInstrument(row({ SEM_EXM: "MCX_COMM", SEM_TRADING_SYMBOL: "GOLD26JANFUT", SEM_INSTRUMENT_NAME: "FUTCOM", SEM_EXPIRY_DATE: "2026-01-29", SEM_LOT_SIZE: "100" }), "dhan").instrument?.exchange).toBe("MCX");
    expect(normalizeProviderInstrument(row({ SEM_EXM: "NSE_CDS", SEM_TRADING_SYMBOL: "USDINR26JANFUT", SEM_INSTRUMENT_NAME: "FUTCUR", SEM_EXPIRY_DATE: "2026-01-29", SEM_LOT_SIZE: "1" }), "dhan").instrument?.exchangeSegment).toBe("NSE_CDS");
  });

  it("detects duplicate identifiers and conflicting metadata without overwriting", () => {
    const report = normalizeInstrumentMaster([row(), row(), row({ SEM_SMST_SECURITY_ID: "1001", SEM_TICK_SIZE: "0.1" })], "dhan");
    expect(report.instruments).toHaveLength(1);
    expect(report.issues.map((issue) => issue.code)).toEqual(["DUPLICATE_IDENTIFIER", "CONFLICTING_METADATA"]);
  });

  it("preserves provider identifiers reused across exchange segments", () => {
    const report = normalizeInstrumentMaster([
      row({ SEM_SMST_SECURITY_ID: "13", SEM_EXM: "NSE_EQ", SEM_TRADING_SYMBOL: "ABB", SEM_CUSTOM_SYMBOL: "ABB INDIA LIMITED" }),
      row({ SEM_SMST_SECURITY_ID: "13", SEM_EXM: "IDX_I", SEM_TRADING_SYMBOL: "NIFTY", SEM_CUSTOM_SYMBOL: "NIFTY 50", SEM_INSTRUMENT_NAME: "INDEX", SEM_TICK_SIZE: "0.05" }),
    ], "dhan");

    expect(report.instruments).toHaveLength(2);
    expect(report.instruments.map((instrument) => [instrument.exchangeSegment, instrument.securityId])).toEqual([
      ["NSE_EQ", "13"],
      ["IDX_I", "13"],
    ]);
    expect(report.issues).toEqual([]);
  });

  it("isolates exchange-symbol keys and keeps expiries and strikes distinguishable", () => {
    const first = normalizeProviderInstrument(row({ SEM_SMST_SECURITY_ID: "4001", SEM_TRADING_SYMBOL: "ABC", SEM_EXM: "NSE_EQ" }), "dhan").instrument!;
    const second = normalizeProviderInstrument(row({ SEM_SMST_SECURITY_ID: "4002", SEM_TRADING_SYMBOL: "ABC", SEM_EXM: "BSE_EQ" }), "dhan").instrument!;
    const optionA = normalizeProviderInstrument(row({ SEM_SMST_SECURITY_ID: "4003", SEM_TRADING_SYMBOL: "NIFTY26JAN20000CE", SEM_EXM: "NSE_FNO", SEM_INSTRUMENT_NAME: "OPTIDX", SEM_EXPIRY_DATE: "2026-01-29", SEM_STRIKE_PRICE: "20000", SEM_OPTION_TYPE: "CE", SEM_LOT_SIZE: "65" }), "dhan").instrument!;
    const optionB = normalizeProviderInstrument({ ...optionA, securityId: "4004", tradingSymbol: "NIFTY26FEB20000CE", expiryDate: "2026-02-26" }, "dhan").instrument!;
    const master = new InstrumentMaster();
    expect(master.add(first)).toBeUndefined();
    expect(master.add(second)).toBeUndefined();
    expect(master.add(optionA)).toBeUndefined();
    expect(master.add(optionB)).toBeUndefined();
    expect(master.getById("4001")).toBe(first);
    expect(master.getByExchangeSymbol("BSE", "ABC")).toBe(second);
    expect(master.values()).toHaveLength(4);
  });

  it("rejects unknown, malformed, and incomplete contracts", () => {
    expect(normalizeProviderInstrument(row({ SEM_EXM: "UNKNOWN" }), "dhan").issue?.code).toBe("INVALID_VALUE");
    expect(normalizeProviderInstrument(row({ SEM_INSTRUMENT_NAME: "OPTSTK", SEM_EXM: "NSE_FNO", SEM_LOT_SIZE: "250" }), "dhan").issue?.code).toBe("INVALID_VALUE");
    expect(normalizeProviderInstrument(row({ SEM_TICK_SIZE: "" }), "dhan").issue?.code).toBe("MISSING_FIELD");
  });

  it("maps provider identifiers stably and normalizes deterministically", () => {
    const input = row({ SEM_SMST_SECURITY_ID: "5001", SEM_UNDERLYING_SECURITY_ID: "99" });
    const first = normalizeProviderInstrument(input, "dhan").instrument;
    const second = normalizeProviderInstrument(input, "dhan").instrument;
    const master = new InstrumentMaster();
    master.add(first!);
    expect(second).toEqual(first);
    expect(master.getByProviderId("dhan", "5001")).toEqual(first);
  });

  it("handles lot-size and tick-size values as numeric canonical fields", () => {
    const result = normalizeProviderInstrument(row({ SEM_LOT_SIZE: "75", SEM_TICK_SIZE: "0.05" }), "dhan").instrument!;
    expect(result.lotSize).toBe(75);
    expect(result.tickSize).toBe(0.05);
  });
});
