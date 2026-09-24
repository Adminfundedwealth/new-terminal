import { describe, expect, it } from "vitest";
import { TradingStateHarness } from "@/lib/tradingStateHarness";

describe("non-live trading state harness", () => {
  it("propagates order -> execution -> position -> pnl -> risk -> performance", () => {
    const harness = new TradingStateHarness({ id: "account-1", balance: 10000 });
    harness.createOrder({ id: "order-1", account_id: "account-1", symbol: "NIFTY", side: "BUY", qty: 2, price: 100, provider: "dhan", idempotency_key: "client-1" });
    harness.acceptOrder("order-1");
    harness.applyExecution({ id: "execution-1", account_id: "account-1", order_id: "order-1", symbol: "NIFTY", side: "BUY", qty: 2, price: 100 });
    harness.markToMarket("NIFTY", 110);
    expect(harness.metrics().unrealized_pnl).toBe(20);
    expect(harness.risk().status).toBe("NORMAL");
    expect(harness.metrics().ending_balance).toBe(10020);
  });

  it("calculates realized pnl when a position closes", () => {
    const harness = new TradingStateHarness({ id: "account-1", balance: 10000 });
    harness.createOrder({ id: "buy", account_id: "account-1", symbol: "INFY", side: "BUY", qty: 1, price: 100, provider: "dhan", idempotency_key: "buy" });
    harness.applyExecution({ id: "fill-buy", account_id: "account-1", order_id: "buy", symbol: "INFY", side: "BUY", qty: 1, price: 100 });
    harness.createOrder({ id: "sell", account_id: "account-1", symbol: "INFY", side: "SELL", qty: 1, price: 125, provider: "dhan", idempotency_key: "sell" });
    harness.applyExecution({ id: "fill-sell", account_id: "account-1", order_id: "sell", symbol: "INFY", side: "SELL", qty: 1, price: 125 });
    expect(harness.metrics().realized_pnl).toBe(25);
    expect(harness.positions.get("position:account-1:INFY")?.is_open).toBe(false);
  });

  it("is idempotent and does not fail over unknown orders", () => {
    const harness = new TradingStateHarness({ id: "account-1", balance: 10000 });
    harness.createOrder({ id: "order-1", account_id: "account-1", symbol: "NIFTY", side: "BUY", qty: 1, price: 100, provider: "dhan", idempotency_key: "client-1" });
    harness.markUnknown("order-1");
    harness.applyExecution({ id: "execution-1", account_id: "account-1", order_id: "order-1", symbol: "NIFTY", side: "BUY", qty: 1, price: 100 });
    harness.applyExecution({ id: "execution-1", account_id: "account-1", order_id: "order-1", symbol: "NIFTY", side: "BUY", qty: 1, price: 100 });
    expect(harness.executions.size).toBe(1);
    expect(harness.positions.get("position:account-1:NIFTY")?.qty).toBe(1);
  });
});
