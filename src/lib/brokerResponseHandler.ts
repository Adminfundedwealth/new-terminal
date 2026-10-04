import {
  createOrderStateMachine,
  type OrderStateTransitionResult,
} from "./orderStateMachine";
import type { CanonicalOrder, OrderStatus } from "./orderModel";

export type BrokerResponseOutcome = "accepted" | "rejected" | "pending" | "cancelled" | "transport_error" | "timeout" | "malformed" | "unknown";

export interface NormalizedBrokerResponse {
  outcome: BrokerResponseOutcome;
  brokerOrderId: string | null;
  brokerStatus: string | null;
  brokerCode: string | null;
  brokerMessage: string | null;
  timestamp: string | null;
  clientOrderId: string | null;
}

export interface BrokerResponseContext {
  accountId: string;
  authUserId: string;
  expectedOrderId?: string;
  expectedClientOrderId?: string | null;
}

export type BrokerResponseResult =
  | { ok: true; kind: "transitioned" | "duplicate"; response: NormalizedBrokerResponse; order: CanonicalOrder; transition: OrderStateTransitionResult }
  | { ok: false; response: NormalizedBrokerResponse; error: { code: string; message: string }; order: CanonicalOrder };

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function firstText(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = text(source[key]);
    if (value) return value;
  }
  return null;
}

function statusOutcome(status: string | null, state: string | null, ok: boolean | null): BrokerResponseOutcome {
  const value = (status ?? state ?? "").toLowerCase().replace(/[\s-]/g, "_");
  if (["cancelled", "canceled", "cancelled_by_user", "cancelled_successfully"].includes(value)) return "cancelled";
  if (["rejected", "reject"].includes(value)) return "rejected";
  if (["pending", "queued", "processing"].includes(value)) return "pending";
  if (["timeout", "timed_out"].includes(value)) return "timeout";
  if (["transport_error", "network_error"].includes(value)) return "transport_error";
  if (["failed", "error"].includes(value) || ok === false) return "rejected";
  if (["ack", "accepted", "submitted", "open"].includes(value) || ok === true) return "accepted";
  return "unknown";
}

export function normalizeBrokerResponse(raw: unknown): NormalizedBrokerResponse {
  const source = objectValue(raw);
  if (!source) {
    return { outcome: "malformed", brokerOrderId: null, brokerStatus: null, brokerCode: null, brokerMessage: "Broker response was not an object", timestamp: null, clientOrderId: null };
  }
  const data = objectValue(source.data) ?? source;
  const brokerStatus = firstText(source, ["brokerStatus", "status"]) ?? firstText(data, ["brokerStatus", "status", "orderStatus"]);
  const state = firstText(source, ["state", "outcome"]);
  const brokerOrderId = firstText(source, ["brokerOrderId", "orderId", "id"]) ?? firstText(data, ["brokerOrderId", "orderId", "id"]);
  const brokerCode = firstText(source, ["brokerCode", "errorCode", "code"]) ?? firstText(data, ["brokerCode", "errorCode", "code"]);
  const brokerMessage = firstText(source, ["brokerMessage", "message", "statusMessage", "text"]) ?? firstText(data, ["brokerMessage", "message", "statusMessage", "text"]);
  const timestamp = firstText(source, ["timestamp", "brokerTimestamp", "placedAt"]) ?? firstText(data, ["timestamp", "brokerTimestamp", "placedAt"]);
  const clientOrderId = firstText(source, ["clientOrderId", "client_order_id"]) ?? firstText(data, ["clientOrderId", "client_order_id"]);
  const ok = typeof source.ok === "boolean" ? source.ok : null;
  const outcome = statusOutcome(brokerStatus, state, ok);
  if (!brokerStatus && !state) {
    return { outcome: "malformed", brokerOrderId, brokerStatus, brokerCode, brokerMessage: brokerMessage ?? "Broker response did not include a status", timestamp, clientOrderId };
  }
  return { outcome, brokerOrderId, brokerStatus, brokerCode, brokerMessage, timestamp, clientOrderId };
}

function targetStatus(order: CanonicalOrder, outcome: BrokerResponseOutcome): OrderStatus | null {
  if (outcome === "cancelled") return "cancelled";
  if (outcome === "accepted" || outcome === "pending" || outcome === "unknown" || outcome === "timeout" || outcome === "transport_error") {
    return order.status === "cancel_requested" ? "cancel_requested" : "pending";
  }
  if (outcome === "rejected") return order.status === "cancel_requested" ? "failed" : "rejected";
  return null;
}

export function handleBrokerResponse(order: CanonicalOrder, raw: unknown, context: BrokerResponseContext): BrokerResponseResult {
  const response = normalizeBrokerResponse(raw);
  if (order.accountId !== context.accountId || (context.expectedOrderId && order.id !== context.expectedOrderId)) {
    return { ok: false, response, order, error: { code: "ORDER_NOT_AUTHORIZED", message: "Broker response does not belong to this order or account" } };
  }
  if (context.expectedClientOrderId && response.clientOrderId && context.expectedClientOrderId !== response.clientOrderId) {
    return { ok: false, response, order, error: { code: "ORDER_NOT_AUTHORIZED", message: "Broker response client order does not match the submitted order" } };
  }
  if (response.outcome === "malformed") {
    return { ok: false, response, order, error: { code: "MALFORMED_BROKER_RESPONSE", message: response.brokerMessage ?? "Malformed broker response" } };
  }
  if (response.outcome === "accepted" && !response.brokerOrderId) {
    return { ok: false, response, order, error: { code: "MISSING_BROKER_ORDER_ID", message: "Accepted broker response did not include an order id" } };
  }

  const nextStatus = targetStatus(order, response.outcome);
  if (!nextStatus) return { ok: false, response, order, error: { code: "UNHANDLED_BROKER_RESPONSE", message: "Broker response cannot change canonical order state" } };
  const transition = createOrderStateMachine().transition(order, nextStatus, {
    actorAccountId: context.accountId,
    actorUserId: context.authUserId,
    reason: response.brokerMessage ?? response.brokerStatus ?? response.outcome,
  });
  if ("error" in transition) {
    if (transition.error.code === "ORDER_ALREADY_TERMINAL" || transition.error.code === "INVALID_ORDER_TRANSITION") {
      return { ok: true, kind: "duplicate", response, order, transition };
    }
    return { ok: false, response, order, error: transition.error };
  }
  const updatedOrder: CanonicalOrder = {
    ...transition.order,
    brokerOrderId: response.brokerOrderId ?? order.brokerOrderId,
    rejectionReason: response.outcome === "rejected" ? response.brokerMessage ?? response.brokerCode : order.rejectionReason,
  };
  return { ok: true, kind: "transitioned", response, order: updatedOrder, transition };
}