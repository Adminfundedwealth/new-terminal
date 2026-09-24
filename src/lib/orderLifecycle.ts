import { normalizeOrder, ORDER_TERMINAL_STATES, type CanonicalOrder } from "./orderModel";
import { createOrderStateMachine } from "./orderStateMachine";
import { validateOrder } from "./orderValidation";
import { evaluateRisk, type RiskRequest, type RiskEvaluation } from "./riskEngine";
import { normalizeBrokerResponse } from "./brokerResponseHandler";

export type CanonicalOrderForLifecycle = CanonicalOrder;

export type OrderLifecycleErrorCode =
  | "UNAUTHORIZED_USER"
  | "INVALID_ACCOUNT"
  | "ORDER_NOT_FOUND"
  | "INVALID_ORDER_STATE"
  | "INVALID_ORDER_TRANSITION"
  | "INVALID_MODIFICATION"
  | "RISK_REJECTED"
  | "BROKER_REJECTION"
  | "BROKER_TIMEOUT"
  | "BROKER_MALFORMED"
  | "UNKNOWN_ERROR";

export interface BaseLifecycleRequest {
  order: CanonicalOrderForLifecycle;
  authUserId: string | null | undefined;
  accountId: string;
  now?: Date;
}

export interface CancelOrderRequest extends BaseLifecycleRequest {
  brokerAdapter?: {
    cancelOrder?: (orderId: string) => Promise<{ state?: string; message?: string; brokerOrderId?: string; provider?: string; capability?: string } | unknown>;
  };
}

export interface ModifyOrderRequest extends BaseLifecycleRequest {
  updates: Partial<Pick<CanonicalOrderForLifecycle, "quantity" | "price" | "triggerPrice" | "stopLoss" | "takeProfit" | "timeInForce" | "orderType">>;
  brokerAdapter?: {
    modifyOrder?: (orderId: string, update: Record<string, unknown>) => Promise<{ state?: string; message?: string; brokerOrderId?: string; provider?: string; capability?: string } | unknown>;
  };
  riskGate?: (request: RiskRequest) => Promise<RiskEvaluation | null> | RiskEvaluation | null;
}

export interface CancelAllOrdersRequest {
  orders: CanonicalOrderForLifecycle[];
  authUserId: string | null | undefined;
  accountId: string;
  brokerAdapter?: {
    cancelOrder?: (orderId: string) => Promise<{ state?: string; message?: string; brokerOrderId?: string; provider?: string; capability?: string } | unknown>;
  };
}

export type LifecycleResult<TOrder extends CanonicalOrderForLifecycle> =
  | { ok: true; order: TOrder; brokerOutcome?: string; message?: string }
  | { ok: false; error: { code: OrderLifecycleErrorCode; message: string }; order?: TOrder };

type LifecycleOrderPatch = Partial<Pick<CanonicalOrderForLifecycle, "quantity" | "price" | "triggerPrice" | "stopLoss" | "takeProfit" | "timeInForce" | "orderType">>;

function fail<TOrder extends CanonicalOrderForLifecycle>(code: OrderLifecycleErrorCode, message: string, order?: TOrder): LifecycleResult<TOrder> {
  return { ok: false, error: { code, message }, order };
}

export function authorizeOrderAccess(order: CanonicalOrderForLifecycle | null | undefined, accountId: string, authUserId?: string | null): { ok: true } | { ok: false; error: { code: OrderLifecycleErrorCode; message: string } } {
  if (!order) return { ok: false, error: { code: "ORDER_NOT_FOUND", message: "Order not found" } };
  if (!authUserId) return { ok: false, error: { code: "UNAUTHORIZED_USER", message: "Authenticated user is required" } };
  if (order.accountId !== accountId) return { ok: false, error: { code: "INVALID_ACCOUNT", message: "Account does not match the authenticated order owner" } };
  if (order.ownerUserId && authUserId !== order.ownerUserId) return { ok: false, error: { code: "UNAUTHORIZED_USER", message: "Authenticated user does not own this order" } };
  return { ok: true };
}

export function canCancelStatus(status: string): boolean {
  return ["requested", "pending", "open", "partially_filled"].includes(status);
}

export function canModifyStatus(status: string): boolean {
  return ["requested", "pending", "open", "partially_filled"].includes(status);
}

function brokerOutcomeFromResult(result: unknown): string {
  if (!result || typeof result !== "object") return "unknown";
  const record = result as Record<string, unknown>;
  if (typeof record.state === "string") return record.state.toLowerCase();
  if (typeof record.outcome === "string") return record.outcome.toLowerCase();
  const normalized = normalizeBrokerResponse(result);
  return normalized.outcome;
}

function brokerRejected(result: unknown): boolean {
  const outcome = brokerOutcomeFromResult(result);
  return outcome === "rejected" || outcome === "failed" || outcome === "error" || outcome === "malformed";
}

function brokerTimedOut(result: unknown): boolean {
  const outcome = brokerOutcomeFromResult(result);
  return outcome === "timeout" || outcome === "transport_error";
}

function ensureValidUpdatePatch(order: CanonicalOrderForLifecycle, updates: LifecycleOrderPatch): LifecycleOrderPatch {
  const keys = Object.keys(updates);
  if (keys.length === 0) {
    throw new Error("No order fields were provided for update");
  }
  const forbidden = ["id", "accountId", "ownerUserId", "clientOrderId", "brokerOrderId", "instrumentId", "symbol", "exchange", "segment", "instrumentType", "side", "filledQuantity", "averageFillPrice", "status", "rejectionReason", "cancelRequestedAt", "cancelledAt", "completedAt", "createdAt", "submittedAt", "updatedAt", "parentOrderId", "replacesOrderId"] as const;
  const invalid = keys.filter((key) => forbidden.includes(key as (typeof forbidden)[number]));
  if (invalid.length > 0) {
    throw new Error(`Cannot modify immutable order fields: ${invalid.join(", ")}`);
  }
  return updates;
}

export async function cancelOrder(request: CancelOrderRequest): Promise<LifecycleResult<CanonicalOrderForLifecycle>> {
  const { order, authUserId, accountId, brokerAdapter } = request;
  const authorization = authorizeOrderAccess(order, accountId, authUserId);
  if (authorization.ok === false) {
    const { error } = authorization;
    return fail(error.code, error.message, order);
  }

  if (!canCancelStatus(order.status)) {
    return fail("INVALID_ORDER_STATE", `Order ${order.id} cannot be cancelled from state ${order.status}`, order);
  }

  const machine = createOrderStateMachine();
  const transition = machine.transition(order, "cancel_requested", {
    actorAccountId: accountId,
    actorUserId: authUserId ?? order.ownerUserId ?? null,
    reason: "Customer requested cancellation",
  });

  if ("error" in transition) {
    return fail("INVALID_ORDER_TRANSITION", transition.error.message, order);
  }

  let brokerOutcome = "not_required";
  if (brokerAdapter?.cancelOrder) {
    try {
      const result = await brokerAdapter.cancelOrder(order.id);
      brokerOutcome = brokerOutcomeFromResult(result);
      const reason = (typeof result === "object" && result && "message" in result && typeof result.message === "string" ? result.message : "Broker cancellation result") || "Broker cancellation result";

      if (brokerOutcome === "cancelled") {
        const cancelledTransition = createOrderStateMachine().transition(transition.order, "cancelled", {
          actorAccountId: accountId,
          actorUserId: authUserId ?? order.ownerUserId ?? null,
          reason: reason || "Broker confirmed cancellation",
        });
        if ("error" in cancelledTransition) {
          return fail("INVALID_ORDER_TRANSITION", cancelledTransition.error.message, transition.order);
        }
        return { ok: true, order: cancelledTransition.order, brokerOutcome, message: "Order cancellation confirmed by broker" };
      }

      if (brokerRejected(result)) {
        const failedTransition = createOrderStateMachine().transition(transition.order, "failed", {
          actorAccountId: accountId,
          actorUserId: authUserId ?? order.ownerUserId ?? null,
          reason,
        });
        return fail("BROKER_REJECTION", reason || "Broker rejected the cancellation request", failedTransition.ok ? failedTransition.order : transition.order);
      }
      if (brokerTimedOut(result)) {
        const failedTransition = createOrderStateMachine().transition(transition.order, "failed", {
          actorAccountId: accountId,
          actorUserId: authUserId ?? order.ownerUserId ?? null,
          reason: "Broker cancellation request timed out or network failed",
        });
        return fail("BROKER_TIMEOUT", "Broker cancellation request timed out or network failed", failedTransition.ok ? failedTransition.order : transition.order);
      }
    } catch (error) {
      const failedTransition = createOrderStateMachine().transition(transition.order, "failed", {
        actorAccountId: accountId,
        actorUserId: authUserId ?? order.ownerUserId ?? null,
        reason: error instanceof Error ? error.message : "Broker cancellation request failed",
      });
      return fail("BROKER_TIMEOUT", error instanceof Error ? error.message : "Broker cancellation request failed", failedTransition.ok ? failedTransition.order : transition.order);
    }
  }

  return { ok: true, order: transition.order, brokerOutcome, message: brokerOutcome === "not_required" ? "Cancellation requested" : `Cancellation request sent to broker: ${brokerOutcome}` };
}

export async function modifyOrder(request: ModifyOrderRequest): Promise<LifecycleResult<CanonicalOrderForLifecycle>> {
  const { order, authUserId, accountId, updates, brokerAdapter, riskGate } = request;
  const authorization = authorizeOrderAccess(order, accountId, authUserId);
  if (authorization.ok === false) {
    const { error } = authorization;
    return fail(error.code, error.message, order);
  }

  if (!canModifyStatus(order.status)) {
    return fail("INVALID_ORDER_STATE", `Order ${order.id} cannot be modified from state ${order.status}`, order);
  }

  let patch: LifecycleOrderPatch;
  try {
    patch = ensureValidUpdatePatch(order, { ...updates } as LifecycleOrderPatch);
  } catch (error) {
    return fail("INVALID_MODIFICATION", error instanceof Error ? error.message : "Invalid modification payload", order);
  }

  const normalizedPatch: LifecycleOrderPatch = {
    quantity: patch.quantity ?? order.quantity,
    price: patch.price ?? order.price,
    triggerPrice: patch.triggerPrice ?? order.triggerPrice,
    stopLoss: patch.stopLoss ?? order.stopLoss,
    takeProfit: patch.takeProfit ?? order.takeProfit,
    timeInForce: patch.timeInForce ?? order.timeInForce,
    orderType: patch.orderType ?? order.orderType,
  };

  const nextOrder = normalizeOrder({
    ...order,
    ...normalizedPatch,
    id: order.id,
    accountId: order.accountId,
    ownerUserId: order.ownerUserId,
    symbol: order.symbol,
    exchange: order.exchange,
    segment: order.segment,
    side: order.side,
    quantity: normalizedPatch.quantity ?? order.quantity,
    price: normalizedPatch.price ?? order.price,
    triggerPrice: normalizedPatch.triggerPrice ?? order.triggerPrice,
    stopLoss: normalizedPatch.stopLoss ?? order.stopLoss,
    takeProfit: normalizedPatch.takeProfit ?? order.takeProfit,
    timeInForce: normalizedPatch.timeInForce ?? order.timeInForce,
    orderType: normalizedPatch.orderType ?? order.orderType,
    status: order.status,
    createdAt: order.createdAt,
    submittedAt: order.submittedAt,
    updatedAt: new Date().toISOString(),
  });

  const validation = validateOrder({
    id: nextOrder.id,
    accountId: nextOrder.accountId,
    authUserId: authUserId ?? order.ownerUserId ?? undefined,
    ownerUserId: order.ownerUserId ?? authUserId ?? undefined,
    symbol: nextOrder.symbol,
    exchange: nextOrder.exchange ?? "NSE",
    segment: nextOrder.segment ?? undefined,
    side: nextOrder.side,
    quantity: nextOrder.quantity,
    orderType: nextOrder.orderType,
    price: nextOrder.price ?? undefined,
    triggerPrice: nextOrder.triggerPrice ?? undefined,
    timeInForce: nextOrder.timeInForce ?? undefined,
    stopLoss: nextOrder.stopLoss ?? undefined,
    takeProfit: nextOrder.takeProfit ?? undefined,
  }, { account: { ownerUserId: authUserId ?? order.ownerUserId ?? "", status: "ACTIVE", isActive: true }, instrument: null, requireAccount: false, requireInstrument: false });

  if (validation.ok === false) {
    const { error } = validation;
    return fail("INVALID_MODIFICATION", error.message, order);
  }

  if (riskGate) {
    const riskRequest: RiskRequest = {
      account_id: order.accountId,
      symbol: order.symbol,
      segment: order.segment ?? order.exchange ?? undefined,
      side: order.side,
      quantity: nextOrder.quantity,
      order_type: nextOrder.orderType,
      requested_price: nextOrder.price ?? null,
      estimated_loss: nextOrder.price == null ? null : Math.max(0, nextOrder.quantity * nextOrder.price * 0.01),
      is_overnight: false,
      now: request.now ?? new Date(),
    };
    const riskEvaluation = await riskGate(riskRequest);
    if (riskEvaluation && riskEvaluation.decision === "REJECT") {
      return fail("RISK_REJECTED", riskEvaluation.reason || "Risk policy rejected the order modification", order);
    }
  }

  let brokerOutcome = "not_required";
  if (brokerAdapter?.modifyOrder) {
    try {
      const result = await brokerAdapter.modifyOrder(order.id, { ...patch, accountId: order.accountId, authUserId: authUserId ?? order.ownerUserId ?? undefined });
      brokerOutcome = brokerOutcomeFromResult(result);
      if (brokerRejected(result)) {
        return fail("BROKER_REJECTION", (typeof result === "object" && result && "message" in result && typeof result.message === "string" ? result.message : "Broker rejected the modification"), order);
      }
      if (brokerTimedOut(result)) {
        return fail("BROKER_TIMEOUT", "Broker modification request timed out or network failed", order);
      }
    } catch (error) {
      return fail("BROKER_TIMEOUT", error instanceof Error ? error.message : "Broker modification request failed", order);
    }
  }

  const updated = { ...order, ...normalizedPatch, updatedAt: new Date().toISOString() };
  return { ok: true, order: normalizeOrder(updated), brokerOutcome, message: brokerOutcome === "not_required" ? "Order update applied" : `Broker accepted modification: ${brokerOutcome}` };
}

export async function cancelAllOrders(request: CancelAllOrdersRequest): Promise<{ ok: true; cancelled: CanonicalOrderForLifecycle[]; skipped: CanonicalOrderForLifecycle[] } | { ok: false; error: { code: OrderLifecycleErrorCode; message: string } }> {
  const { orders, authUserId, accountId, brokerAdapter } = request;
  if (!authUserId) return { ok: false, error: { code: "UNAUTHORIZED_USER", message: "Authenticated user is required" } };

  const cancelled: CanonicalOrderForLifecycle[] = [];
  const skipped: CanonicalOrderForLifecycle[] = [];

  for (const order of orders) {
    const authorization = authorizeOrderAccess(order, accountId, authUserId);
    if (authorization.ok === false) {
      skipped.push(order);
      continue;
    }
    if (!canCancelStatus(order.status) || ORDER_TERMINAL_STATES.includes(order.status as (typeof ORDER_TERMINAL_STATES)[number])) {
      skipped.push(order);
      continue;
    }
    const result = await cancelOrder({ order, accountId, authUserId, brokerAdapter });
    if (result.ok) {
      cancelled.push(result.order);
    } else {
      skipped.push(order);
    }
  }

  return { ok: true, cancelled, skipped };
}

export function createOrderLifecycleService() {
  return {
    cancelOrder,
    modifyOrder,
    cancelAllOrders,
    authorizeOrderAccess,
    canCancelStatus,
    canModifyStatus,
  };
}
