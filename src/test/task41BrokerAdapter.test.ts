import { describe, expect, it } from "vitest";
import {
  BaseBrokerAdapter,
  normalizeBrokerError,
  normalizeBrokerOrderStatus,
  type BrokerResult,
  type NormalizedInstrument,
  type NormalizedQuote,
} from "@/lib/brokerAdapter";

const instrument: NormalizedInstrument = {
  securityId: "dhan-13",
  symbol: "NIFTY",
  tradingSymbol: "NIFTY 50",
  displayName: "NIFTY 50",
  exchange: "NSE",
  exchangeSegment: "IDX_I",
  instrumentType: "INDEX",
  lotSize: 1,
  tickSize: 0.05,
  provider: "dhan",
  providerInstrumentId: "13",
};

class ReadOnlyAdapter extends BaseBrokerAdapter {
  readonly id = "dhan" as const;
  readonly name = "Dhan test adapter";
  readonly capabilities = { instruments: "available" as const, quote: "available" as const };

  override async authenticate(): Promise<BrokerResult<true>> {
    return { provider: this.id, capability: "authenticate", state: "available", data: true };
  }

  override async getInstruments(): Promise<BrokerResult<NormalizedInstrument[]>> {
    return { provider: this.id, capability: "instruments", state: "available", data: [instrument] };
  }

  override async getQuote(symbol: string): Promise<BrokerResult<NormalizedQuote>> {
    return { provider: this.id, capability: "quote", state: "available", data: { symbol, ltp: 22000, change: 0, changePercent: 0, timestamp: "2026-09-25T10:00:00.000Z" } };
  }
}

describe("Task 41 canonical broker adapter", () => {
  it("exposes connected state and deterministic instrument lookup/search", async () => {
    const adapter = new ReadOnlyAdapter();
    await expect(adapter.getConnectionStatus()).resolves.toMatchObject({ provider: "dhan", state: "connected" });
    await expect(adapter.getInstrument("13")).resolves.toMatchObject({ data: { securityId: "dhan-13" } });
    await expect(adapter.searchInstruments("nifty")).resolves.toMatchObject({ data: [instrument] });
  });

  it("supports canonical quote batches and historical aliasing without a second quote model", async () => {
    const adapter = new ReadOnlyAdapter();
    await expect(adapter.getQuotes(["NIFTY", "BANKNIFTY"])).resolves.toMatchObject({ data: [{ symbol: "NIFTY" }, { symbol: "BANKNIFTY" }] });
    await expect(adapter.getHistoricalCandles("NIFTY")).resolves.toMatchObject({ state: "not_supported", capability: "historical" });
  });

  it("keeps unsupported account and order history capabilities explicit", async () => {
    const adapter = new ReadOnlyAdapter();
    await expect(adapter.getAccount()).resolves.toMatchObject({ state: "not_supported", capability: "profile" });
    await expect(adapter.getOrderHistory()).resolves.toMatchObject({ state: "not_supported", capability: "orders" });
  });

  it.each([
    ["OPEN", "open"], ["COMPLETE", "filled"], ["PARTIALLY FILLED", "partially_filled"],
    ["TRIGGER PENDING", "trigger_pending"], ["CANCELLED", "cancelled"], ["provider-added-state", "unknown"],
  ] as const)("maps provider order status %s explicitly", (providerStatus, expected) => {
    expect(normalizeBrokerOrderStatus(providerStatus)).toBe(expected);
  });

  it("normalizes provider errors without exposing secrets", () => {
    const error = normalizeBrokerError("zerodha", new Error("authentication failed for apiKey=secret-token"), "401");
    expect(error).toMatchObject({ provider: "zerodha", category: "authentication_failure", code: "401", retryable: false });
    expect(error.message).not.toContain("secret-token");
    expect(error.message).toContain("[REDACTED]");
  });
});
