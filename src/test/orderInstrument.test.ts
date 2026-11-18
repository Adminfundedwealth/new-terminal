import { describe, expect, it } from "vitest";
import { canonicalOrderSegment, resolveStockOrderInstrument } from "@/lib/orderInstrument";

const nse = {
  symbol: "RELIANCE",
  tradingSymbol: "RELIANCE",
  exchange: "NSE",
  exchangeSegment: "NSE_EQ",
};
const bse = {
  symbol: "RELIANCE",
  tradingSymbol: "RELIANCE",
  exchange: "BSE",
  exchangeSegment: "BSE_EQ",
};
const rows = [
  { symbol: "RELIANCE", chartSymbol: "NSE_EQ:RELIANCE", instrument: nse },
  { symbol: "RELIANCE", chartSymbol: "BSE_EQ:RELIANCE", instrument: bse },
];

describe("cash stock order instrument resolution", () => {
  it("preserves the exchange selected by the stock row", () => {
    expect(resolveStockOrderInstrument("BSE_EQ:RELIANCE", rows, [nse, bse])).toBe(bse);
    expect(resolveStockOrderInstrument("NSE_EQ:RELIANCE", rows, [nse, bse])).toBe(nse);
  });

  it("does not guess when an exchange-qualified symbol is unresolved", () => {
    expect(resolveStockOrderInstrument("BSE_EQ:UNKNOWN", rows, [nse])).toBeUndefined();
  });

  it("normalizes legacy derivative segment aliases", () => {
    expect(canonicalOrderSegment("NFO")).toBe("NSE_FNO");
    expect(canonicalOrderSegment("BFO")).toBe("BSE_FNO");
    expect(canonicalOrderSegment("BSE")).toBe("BSE_EQ");
  });
});
