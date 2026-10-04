import { describe, expect, it } from "vitest";
import { handleBrokerResponse, normalizeBrokerResponse } from "@/lib/brokerResponseHandler";
import { normalizeOrder } from "@/lib/orderModel";

function order(status: "requested" | "pending" | "rejected" | "filled" = "requested") {
  return normalizeOrder({
    id: "order-1",
    accountId: "account-1",
    ownerUserId: "user-1",
    clientOrderId: "client-1",
    symbol: "NIFTY",
    exchange: "NSE",
    side: "BUY",
    orderType: "MARKET",
    quantity: 1,
    status,
  });
}

const context = { accountId: "account-1", authUserId: "user-1", expectedOrderId: "order-1", expectedClientOrderId: "client-1" };

describe("authoritative broker response handling", () => {
  it("normalizes an accepted response and transitions requested to pending", () => {
    const result = handleBrokerResponse(order(), { ok: true, state: "ACK", brokerOrderId: "broker-1", clientOrderId: "client-1", message: "accepted" }, context);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.order).toMatchObject({ status: "pending", brokerOrderId: "broker-1" });
  });

  it("normalizes rejection and preserves the broker reason", () => {
    const result = handleBrokerResponse(order(), { ok: false, state: "REJECTED", brokerOrderId: "broker-2", code: "MARGIN", message: "Insufficient margin" }, context);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.order).toMatchObject({ status: "rejected", rejectionReason: "Insufficient margin" });
  });

  it.each([
    ["transport", { state: "transport_error", message: "connection lost" }],
    ["timeout", { state: "timeout", message: "broker did not respond" }],
    ["unknown", { state: "UNKNOWN", message: "outcome unavailable" }],
    ["pending with a negative transport flag", { ok: false, state: "PENDING", message: "submission outcome unknown" }],
    ["timeout with a negative transport flag", { ok: false, state: "TIMEOUT", message: "submission outcome unknown" }],
  ])("keeps %s outcomes non-rejected and pending", (_name, raw) => {
    const result = handleBrokerResponse(order(), raw, context);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.order.status).toBe("pending");
  });

  it("rejects missing id, missing status, and malformed responses deterministically", () => {
    expect(handleBrokerResponse(order(), { ok: true, state: "ACK" }, context)).toMatchObject({ ok: false, error: { code: "MISSING_BROKER_ORDER_ID" } });
    expect(handleBrokerResponse(order(), { ok: true, brokerOrderId: "broker-3" }, context)).toMatchObject({ ok: false, error: { code: "MALFORMED_BROKER_RESPONSE" } });
    expect(normalizeBrokerResponse(null).outcome).toBe("malformed");
  });

  it("blocks responses for another account or order", () => {
    expect(handleBrokerResponse(order(), { state: "ACK", brokerOrderId: "broker-4" }, { ...context, accountId: "account-2" })).toMatchObject({ ok: false, error: { code: "ORDER_NOT_AUTHORIZED" } });
    expect(handleBrokerResponse(order(), { state: "ACK", brokerOrderId: "broker-4", clientOrderId: "other-client" }, context)).toMatchObject({ ok: false, error: { code: "ORDER_NOT_AUTHORIZED" } });
  });

  it("does not move terminal orders backwards and makes duplicate responses deterministic", () => {
    const accepted = handleBrokerResponse(order("pending"), { state: "ACK", brokerOrderId: "broker-1" }, context);
    expect(accepted).toMatchObject({ ok: true, kind: "duplicate" });
    const terminal = handleBrokerResponse(order("filled"), { state: "REJECTED", brokerOrderId: "broker-1", message: "late rejection" }, context);
    expect(terminal).toMatchObject({ ok: true, kind: "duplicate" });
  });
});