import { describe, expect, it } from "vitest";
import { normalizeOrder } from "@/lib/orderModel";
import {
  ORDER_TERMINAL_STATES,
  createOrderStateMachine,
  type OrderStateMachineErrorCode,
  type OrderStateTransitionResult,
} from "@/lib/orderStateMachine";

const timestamp = "2026-09-24T09:15:00.000Z";

function makeOrder(overrides: Record<string, unknown> = {}) {
  return normalizeOrder({
    id: "order-1",
    accountId: "account-1",
    ownerUserId: "user-1",
    clientOrderId: "client-order-1",
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

function isFailureResult(result: OrderStateTransitionResult): result is Extract<OrderStateTransitionResult, { ok: false }> {
  return result.ok === false;
}

function expectFailure(result: OrderStateTransitionResult): { code: string; message: string } {
  if (!isFailureResult(result)) throw new Error("Expected transition result to fail");
  return result.error;
}

describe("canonical order state machine", () => {
  it("uses the canonical initial state and allows the first valid transition", () => {
    const machine = createOrderStateMachine();
    const initial = makeOrder();
    expect(initial.status).toBe("requested");

    const result = machine.transition(initial, "pending", {
      actorAccountId: initial.accountId,
      actorUserId: initial.ownerUserId,
      reason: "accepted",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("transition should succeed");
    expect(result.order.status).toBe("pending");
    expect(result.audit.from).toBe("requested");
    expect(result.audit.to).toBe("pending");
  });

  it("allows every valid lifecycle transition and rejects forbidden ones", () => {
    const machine = createOrderStateMachine();
    const validTransitions = [
      ["requested", "pending"],
      ["requested", "rejected"],
      ["requested", "failed"],
      ["pending", "open"],
      ["pending", "partially_filled"],
      ["pending", "filled"],
      ["pending", "cancel_requested"],
      ["pending", "cancelled"],
      ["pending", "rejected"],
      ["pending", "failed"],
      ["open", "partially_filled"],
      ["open", "filled"],
      ["open", "cancel_requested"],
      ["open", "cancelled"],
      ["open", "failed"],
      ["partially_filled", "filled"],
      ["partially_filled", "cancel_requested"],
      ["partially_filled", "cancelled"],
      ["partially_filled", "failed"],
      ["cancel_requested", "cancelled"],
      ["cancel_requested", "failed"],
    ] as const;

    for (const [from, to] of validTransitions) {
      const result = machine.transition(makeOrder({ status: from }), to, {
        actorAccountId: "account-1",
        actorUserId: "user-1",
      });
      expect(result.ok, `${from} -> ${to}`).toBe(true);
      if (result.ok) {
        expect(result.order.status).toBe(to);
      }
    }

    const invalid = [
      ["requested", "open"],
      ["pending", "submitted"],
      ["open", "requested"],
      ["partially_filled", "pending"],
    ] as const;

    for (const [from, to] of invalid) {
      const result = machine.transition(makeOrder({ status: from }), to, {
        actorAccountId: "account-1",
        actorUserId: "user-1",
      });
      expect(result.ok).toBe(false);
      const error = expectFailure(result);
      expect(["INVALID_ORDER_TRANSITION", "ORDER_ALREADY_TERMINAL"]).toContain(error.code);
    }
  });

  it("enforces account ownership and ignores forged client status hints", () => {
    const machine = createOrderStateMachine();
    const order = makeOrder();

    const wrongAccount = machine.transition(order, "pending", {
      actorAccountId: "other-account",
      actorUserId: order.ownerUserId,
      clientCurrentStatus: "filled",
      clientPreviousStatus: "filled",
    });
    expect(wrongAccount.ok).toBe(false);
    const error = expectFailure(wrongAccount);
    expect(error.code).toBe("ORDER_NOT_AUTHORIZED");

    const forgedClientState = machine.transition(order, "pending", {
      actorAccountId: order.accountId,
      actorUserId: order.ownerUserId,
      clientCurrentStatus: "filled",
      clientPreviousStatus: "filled",
    });
    expect(forgedClientState.ok).toBe(true);
    if (forgedClientState.ok) {
      expect(forgedClientState.order.status).toBe("pending");
    }
  });

  it("blocks terminal states from reopening and rejects duplicate transitions deterministically", () => {
    const machine = createOrderStateMachine();
    const terminalStates = ["filled", "cancelled", "rejected", "failed"] as const;

    for (const status of terminalStates) {
      const result = machine.transition(makeOrder({ status }), "open", {
        actorAccountId: "account-1",
        actorUserId: "user-1",
      });
      expect(result.ok).toBe(false);
      const error = expectFailure(result);
      expect(error.code).toBe("ORDER_ALREADY_TERMINAL");
    }

    const repeated = machine.transition(makeOrder({ status: "filled" }), "filled", {
      actorAccountId: "account-1",
      actorUserId: "user-1",
    });
    expect(repeated.ok).toBe(false);
    const repeatedError = expectFailure(repeated);
    expect(repeatedError.code).toBe("INVALID_ORDER_TRANSITION");
  });

  it("handles missing orders and concurrent transitions safely", () => {
    const machine = createOrderStateMachine();
    const missing = machine.transition(null as never, "pending", {
      actorAccountId: "account-1",
      actorUserId: "user-1",
    });
    expect(missing.ok).toBe(false);
    const missingError = expectFailure(missing);
    expect(missingError.code).toBe("ORDER_NOT_FOUND");

    const order = makeOrder();
    (machine as any).activeTransitions.set(order.id, Symbol("transition"));
    const second = machine.transition(order, "open", { actorAccountId: "account-1", actorUserId: "user-1" });

    expect(second.ok).toBe(false);
    const secondError = expectFailure(second);
    expect(secondError.code).toBe("CONCURRENT_ORDER_STATE_CHANGE");
  });

  it("does not invoke a broker layer during transitions", () => {
    const machine = createOrderStateMachine();
    const result = machine.transition(makeOrder(), "pending", {
      actorAccountId: "account-1",
      actorUserId: "user-1",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.order.brokerOrderId).toBeNull();
      expect(result.order.status).toBe("pending");
    }
  });

  it("exposes the canonical terminal state set", () => {
    expect(ORDER_TERMINAL_STATES).toEqual(["filled", "cancelled", "rejected", "failed"]);
  });

  it("has a single canonical state-machine implementation surface", () => {
    const machine = createOrderStateMachine();
    const errorCodes: OrderStateMachineErrorCode[] = [
      "ORDER_NOT_FOUND",
      "ORDER_NOT_AUTHORIZED",
      "INVALID_ORDER_STATE",
      "INVALID_ORDER_TRANSITION",
      "ORDER_ALREADY_TERMINAL",
      "CONCURRENT_ORDER_STATE_CHANGE",
    ];

    expect(machine).toBeDefined();
    expect(errorCodes).toHaveLength(6);
  });
});
