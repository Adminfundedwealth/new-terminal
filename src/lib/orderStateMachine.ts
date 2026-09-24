import {
  ORDER_TERMINAL_STATES,
  ORDER_TRANSITIONS,
  canTransitionOrderStatus,
  normalizeOrder,
  type CanonicalOrder,
  type OrderStatus,
} from "./orderModel";

export type OrderStateMachineErrorCode =
  | "ORDER_NOT_FOUND"
  | "ORDER_NOT_AUTHORIZED"
  | "INVALID_ORDER_STATE"
  | "INVALID_ORDER_TRANSITION"
  | "ORDER_ALREADY_TERMINAL"
  | "CONCURRENT_ORDER_STATE_CHANGE";

export interface OrderStateTransitionAudit {
  at: string;
  from: OrderStatus;
  to: OrderStatus;
  reason?: string | null;
  actorAccountId: string;
  actorUserId: string | null;
  clientCurrentStatus?: string | null;
  clientPreviousStatus?: string | null;
}

export interface OrderStateTransitionOptions {
  actorAccountId: string;
  actorUserId?: string | null;
  reason?: string | null;
  clientCurrentStatus?: string | null;
  clientPreviousStatus?: string | null;
}

export type OrderStateTransitionResult =
  | { ok: true; order: CanonicalOrder; audit: OrderStateTransitionAudit }
  | { ok: false; error: { code: OrderStateMachineErrorCode; message: string } };

function fail(code: OrderStateMachineErrorCode, message: string): OrderStateTransitionResult {
  return { ok: false, error: { code, message } };
}

function isTerminalStatus(status: string): boolean {
  return ORDER_TERMINAL_STATES.includes(status as (typeof ORDER_TERMINAL_STATES)[number]);
}

function normalizeTransitionStatus(value: string | OrderStatus): OrderStatus {
  try {
    return normalizeOrder({
      id: "state-machine-probe",
      accountId: "probe-account",
      ownerUserId: "probe-user",
      symbol: "NIFTY",
      exchange: "NSE",
      side: "BUY",
      orderType: "MARKET",
      quantity: 1,
      status: value,
    }).status;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unsupported order state";
    throw new Error(message);
  }
}

export class OrderStateMachine {
  private readonly activeTransitions = new Map<string, symbol>();

  transition(order: CanonicalOrder | null | undefined, nextStatus: string | OrderStatus, options: OrderStateTransitionOptions): OrderStateTransitionResult {
    if (!order) return fail("ORDER_NOT_FOUND", "Order not found");
    if (!options.actorAccountId || options.actorAccountId !== order.accountId) {
      return fail("ORDER_NOT_AUTHORIZED", "Authenticated account does not own this order");
    }
    if (order.ownerUserId && options.actorUserId !== undefined && options.actorUserId !== order.ownerUserId) {
      return fail("ORDER_NOT_AUTHORIZED", "Authenticated user does not own this order");
    }
    if (order.ownerUserId && !options.actorUserId) {
      return fail("ORDER_NOT_AUTHORIZED", "Authenticated user is required to transition this order");
    }
    if (this.activeTransitions.has(order.id)) {
      return fail("CONCURRENT_ORDER_STATE_CHANGE", `Order ${order.id} is already being transitioned`);
    }
    if (!(order.status in ORDER_TRANSITIONS)) {
      return fail("INVALID_ORDER_STATE", `Unsupported current order state: ${order.status}`);
    }
    let normalizedNext: OrderStatus;
    try {
      normalizedNext = normalizeTransitionStatus(nextStatus);
    } catch (error) {
      return fail("INVALID_ORDER_STATE", error instanceof Error ? error.message : "Unsupported order status");
    }
    if (normalizedNext === order.status) {
      return fail("INVALID_ORDER_TRANSITION", `Order ${order.id} is already in state ${normalizedNext}`);
    }
    if (isTerminalStatus(order.status)) {
      return fail("ORDER_ALREADY_TERMINAL", `Order ${order.id} is already terminal in state ${order.status}`);
    }
    if (!canTransitionOrderStatus(order.status, normalizedNext)) {
      return fail("INVALID_ORDER_TRANSITION", `Order ${order.id} cannot transition from ${order.status} to ${normalizedNext}`);
    }

    const audit: OrderStateTransitionAudit = {
      at: new Date().toISOString(),
      from: order.status,
      to: normalizedNext,
      reason: options.reason ?? null,
      actorAccountId: options.actorAccountId,
      actorUserId: options.actorUserId ?? order.ownerUserId ?? null,
      clientCurrentStatus: options.clientCurrentStatus ?? null,
      clientPreviousStatus: options.clientPreviousStatus ?? null,
    };

    this.activeTransitions.set(order.id, Symbol("transition"));
    try {
      const updatedAt = audit.at;
      const updatedOrder: CanonicalOrder = {
        ...order,
        status: normalizedNext,
        updatedAt,
        submittedAt: normalizedNext === "pending" && !order.submittedAt ? updatedAt : order.submittedAt,
        cancelRequestedAt: normalizedNext === "cancel_requested" && !order.cancelRequestedAt ? updatedAt : order.cancelRequestedAt,
        cancelledAt: normalizedNext === "cancelled" ? order.cancelledAt ?? updatedAt : order.cancelledAt,
        completedAt: ["filled", "cancelled", "rejected", "failed"].includes(normalizedNext) ? order.completedAt ?? updatedAt : order.completedAt,
      };

      return { ok: true, order: updatedOrder, audit };
    } finally {
      this.activeTransitions.delete(order.id);
    }
  }
}

export function createOrderStateMachine(): OrderStateMachine {
  return new OrderStateMachine();
}

export function transitionOrderStatus(order: CanonicalOrder | null | undefined, nextStatus: string | OrderStatus, options: OrderStateTransitionOptions): OrderStateTransitionResult {
  return createOrderStateMachine().transition(order, nextStatus, options);
}

export { ORDER_TERMINAL_STATES } from "./orderModel";
export { ORDER_TRANSITIONS } from "./orderModel";
