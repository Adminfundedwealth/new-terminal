import { describe, expect, it } from "vitest";
import {
  canTransitionOrderStatus,
  normalizeBrokerOrder,
  normalizeOrder,
  serializeCanonicalOrder,
} from "@/lib/orderModel";

const timestamp = "2026-09-24T09:15:00.000Z";

function order(overrides: Record<string, unknown> = {}) {
  return normalizeOrder({
    id: "order-1",
    accountId: "account-1",
    ownerUserId: "user-1",
    clientOrderId: "client-1",
    symbol: "NIFTY",
    exchange: "NSE",
    segment: "NSE_FNO",
    side: "BUY",
    orderType: "MARKET",
    quantity: 2,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  });
}

describe("canonical order model", () => {
  it("normalizes market buy and sell orders", () => {
    expect(order()).toMatchObject({ accountId: "account-1", side: "BUY", orderType: "MARKET", quantity: 2, filledQuantity: 0, status: "requested" });
    expect(order({ id: "order-2", side: "sell" })).toMatchObject({ side: "SELL" });
  });

  it("requires applicable prices and supports limit and stop orders", () => {
    expect(order({ orderType: "LIMIT", price: 23050, timeInForce: "IOC" })).toMatchObject({ orderType: "LIMIT", price: 23050, timeInForce: "IOC" });
    expect(order({ orderType: "STOP", triggerPrice: 23100 })).toMatchObject({ orderType: "SL", triggerPrice: 23100 });
    expect(order({ orderType: "STOP_LIMIT", triggerPrice: 23100, price: 23110 })).toMatchObject({ orderType: "SL-M", triggerPrice: 23100, price: 23110 });
    expect(() => order({ orderType: "LIMIT" })).toThrow("require price");
    expect(() => order({ orderType: "SL" })).toThrow("require triggerPrice");
  });

  it("validates quantities, prices, identities, and malformed objects", () => {
    expect(() => order({ quantity: 0 })).toThrow("quantity must be positive");
    expect(() => order({ quantity: 2, filledQuantity: 3 })).toThrow("filledQuantity");
    expect(() => order({ price: -1 })).toThrow("price must be positive");
    expect(() => order({ side: "HOLD" })).toThrow("Unsupported order side");
    expect(() => order({ orderType: "UNKNOWN" })).toThrow("Unsupported order type");
    expect(() => order({ accountId: "" })).toThrow("accountId is required");
    expect(() => order({ createdAt: "invalid-date" })).toThrow("valid timestamps");
  });

  it("normalizes state transitions and partial fills", () => {
    expect(order({ status: "submitted", filledQuantity: 0 }).status).toBe("pending");
    expect(order({ status: "PARTIALLY_FILLED", filledQuantity: 1 }).status).toBe("partially_filled");
    expect(canTransitionOrderStatus("requested", "pending")).toBe(true);
    expect(canTransitionOrderStatus("pending", "partially_filled")).toBe(true);
    expect(canTransitionOrderStatus("partially_filled", "filled")).toBe(true);
    expect(canTransitionOrderStatus("filled", "open")).toBe(false);
    expect(canTransitionOrderStatus("cancelled", "open")).toBe(false);
  });

  it("preserves cancel, rejection, replacement, and parent-child relationships", () => {
    const value = order({ status: "cancel_requested", cancellationReason: "user request", cancelRequestedAt: timestamp, parentOrderId: "parent-1", replacesOrderId: "order-0" });
    expect(value).toMatchObject({ status: "cancel_requested", cancellationReason: "user request", cancelRequestedAt: timestamp, parentOrderId: "parent-1", replacesOrderId: "order-0" });
    expect(order({ status: "rejected", rejectionReason: "risk" }).rejectionReason).toBe("risk");
    expect(order({ status: "failed" }).status).toBe("failed");
  });

  it("keeps platform and broker identifiers distinct and serializes to the canonical row", () => {
    const value = order({ brokerOrderId: "broker-7", orderType: "LIMIT", price: 23050, timeInForce: "DAY" });
    const row = serializeCanonicalOrder(value);
    expect(row).toMatchObject({ id: "order-1", external_order_id: "broker-7", client_order_id: "client-1", account_id: "account-1", side: "buy", order_type: "LIMIT", time_in_force: "DAY" });
    expect(() => serializeCanonicalOrder({ ...value, ownerUserId: null })).toThrow("ownerUserId");
  });

  it("normalizes broker orders without making broker ids canonical", () => {
    const value = normalizeBrokerOrder({ orderId: "platform-order-1", brokerOrderId: "broker-1", clientOrderId: "client-1", accountId: "account-1", symbol: "NIFTY", exchange: "NSE", side: "SELL", quantity: 1, filledQuantity: 1, orderType: "market", status: "FILLED", placedAt: timestamp });
    expect(value).toMatchObject({ id: "platform-order-1", brokerOrderId: "broker-1", side: "SELL", status: "filled" });
  });
});