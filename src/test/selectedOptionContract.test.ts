import { describe, expect, it } from "vitest";
import type { Instrument } from "@/lib/localDatabase";
import {
  buildOptionWorkspaceUrl,
  createSelectedOptionContract,
  resolveOptionContract,
  resolveSelectedOptionFromParams,
} from "@/lib/selectedOptionContract";

const niftyCall: Instrument = {
  securityId: "12345",
  symbol: "NIFTY",
  tradingSymbol: "NIFTY28NOV24500CE",
  exchange: "NSE",
  exchangeSegment: "NSE_FNO",
  instrumentType: "OPTIDX",
  lotSize: 25,
  expiryDate: "2024-11-28",
  strikePrice: 24500,
  optionType: "CE",
};

describe("selected option contract navigation", () => {
  it("resolves an exact contract and retains its full identity in the workspace URL", () => {
    const resolved = resolveOptionContract([niftyCall], {
      underlying: "NIFTY",
      expiry: "2024-11-28",
      strike: 24500,
      optionType: "CE",
    });
    expect(resolved).toEqual(niftyCall);

    const contract = createSelectedOptionContract(resolved!);
    expect(contract).toBeDefined();
    const url = new URL(buildOptionWorkspaceUrl(contract!, "chart"), "https://terminal.example");
    expect(url.pathname).toBe("/stocks");
    expect(url.searchParams.get("symbol")).toBe(niftyCall.tradingSymbol);
    expect(url.searchParams.get("securityId")).toBe(niftyCall.securityId);
    expect(url.searchParams.get("optionType")).toBe("CE");
    expect(url.searchParams.get("tab")).toBe("Charts");
  });

  it("rejects ambiguous or stale selections instead of substituting a contract", () => {
    expect(resolveOptionContract([niftyCall, { ...niftyCall, securityId: "67890" }], {
      underlying: "NIFTY",
      expiry: "2024-11-28",
      strike: 24500,
      optionType: "CE",
    })).toBeUndefined();

    const url = new URL(buildOptionWorkspaceUrl(createSelectedOptionContract(niftyCall)!, "buy"), "https://terminal.example");
    url.searchParams.set("securityId", "67890");
    expect(resolveSelectedOptionFromParams([niftyCall], url.searchParams)).toBeUndefined();
  });

  it("adds a side only for Buy and Sell workspaces", () => {
    const contract = createSelectedOptionContract(niftyCall)!;
    const buy = new URL(buildOptionWorkspaceUrl(contract, "buy"), "https://terminal.example");
    const sell = new URL(buildOptionWorkspaceUrl(contract, "sell"), "https://terminal.example");
    expect(buy.searchParams.get("side")).toBe("BUY");
    expect(sell.searchParams.get("side")).toBe("SELL");
  });
});
