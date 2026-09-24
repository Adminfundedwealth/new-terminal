import { describe, expect, it } from "vitest";
import { ExecutionLedger } from "@/lib/executionLedger";
import { ExecutionValidationError } from "@/lib/executionModel";
import type { CanonicalOrder } from "@/lib/orderModel";

const makeOrder = (overrides: Partial<CanonicalOrder> = {}): CanonicalOrder => ({
  id: "order-19",
  accountId: "account-19",
  ownerUserId: "user-19",
  clientOrderId: "client-19",
  brokerOrderId: "broker-19",
  instrumentId: "security-19",
  symbol: "NIFTY",
  exchange: "NSE",
  segment: "NFO",
  instrumentType: "INDEX",
  side: "BUY",
  orderType: "LIMIT",
  quantity: 100,
  filledQuantity: 0,
  price: 100,
  averageFillPrice: null,
  triggerPrice: null,
  stopLoss: null,
  takeProfit: null,
  timeInForce: "DAY",
  status: "open",
  rejectionReason: null,
  cancellationReason: null,
  parentOrderId: null,
  replacesOrderId: null,
  createdAt: "2026-09-24T09:15:00.000Z",
  submittedAt: "2026-09-24T09:15:00.000Z",
  updatedAt: "2026-09-24T09:15:00.000Z",
  cancelRequestedAt: null,
  cancelledAt: null,
  completedAt: null,
  ...overrides,
});

const input = (overrides: Record<string, unknown> = {}) => ({
  id: "execution-1",
  orderId: "order-19",
  accountId: "account-19",
  ownerUserId: "user-19",
  authUserId: "user-19",
  instrumentId: "security-19",
  symbol: "nifty",
  side: "buy",
  quantity: 100,
  executionPrice: 100.1,
  executedAt: "2026-09-24T09:16:00.000Z",
  externalExecutionId: " broker-fill-1 ",
  ...overrides,
});

describe("Task 19 canonical execution ledger", () => {
  it("records a valid full execution and preserves timestamp and normalized broker ID", () => {
    const result = new ExecutionLedger([makeOrder()]).recordExecution(input());
    expect(result.order).toMatchObject({ status: "filled", filledQuantity: 100, averageFillPrice: 100.1 });
    expect(result.execution).toMatchObject({ orderId: "order-19", externalExecutionId: "BROKER-FILL-1", symbol: "NIFTY", side: "BUY", executedAt: "2026-09-24T09:16:00.000Z" });
  });

  it("supports partial and multiple executions with a cumulative weighted price", () => {
    const ledger = new ExecutionLedger([makeOrder()]);
    ledger.recordExecution(input({ id: "execution-1", externalExecutionId: "fill-1", quantity: 40, executionPrice: 100.1 }));
    ledger.recordExecution(input({ id: "execution-2", externalExecutionId: "fill-2", quantity: 35, executionPrice: 100.2 }));
    const final = ledger.recordExecution(input({ id: "execution-3", externalExecutionId: "fill-3", quantity: 25, executionPrice: 100.15 }));
    expect(final.order).toMatchObject({ status: "filled", filledQuantity: 100, averageFillPrice: 100.1475 });
    expect(ledger.getCumulativeQuantity("order-19")).toBe(100);
    expect(ledger.getExecutions("order-19")).toHaveLength(3);
  });

  it.each([
    ["quantity", 0, "quantity must be positive"],
    ["price", 0, "executionPrice must be positive"],
  ])("rejects invalid execution %s", (_field, value, message) => {
    expect(() => new ExecutionLedger([makeOrder()]).recordExecution(input({ quantity: _field === "quantity" ? value : 1, executionPrice: _field === "price" ? value : 100 }))).toThrow(message);
  });

  it("rejects ownership mismatches and unknown orders", () => {
    const ledger = new ExecutionLedger([makeOrder()]);
    expect(() => ledger.recordExecution(input({ accountId: "other-account" }))).toThrow("ownership");
    expect(() => ledger.recordExecution(input({ orderId: "missing-order" }))).toThrow("was not found");
  });

  it("replays duplicate broker IDs and rejects conflicting duplicates", () => {
    const ledger = new ExecutionLedger([makeOrder()]);
    const first = ledger.recordExecution(input({ id: "local-1" }));
    const retry = ledger.recordExecution(input({ id: "local-retry" }));
    expect(retry.replayed).toBe(true);
    expect(retry.execution.id).toBe(first.execution.id);
    expect(ledger.getExecutions()).toHaveLength(1);
    expect(() => ledger.recordExecution(input({ id: "local-conflict", quantity: 2 }))).toThrow("different execution data");
  });

  it("rejects executions against cancelled and rejected orders", () => {
    for (const status of ["cancelled", "rejected"] as const) {
      expect(() => new ExecutionLedger([makeOrder({ status })]).recordExecution(input())).toThrow("cannot receive an execution");
    }
  });

  it("prevents over-fill after a partial execution", () => {
    const ledger = new ExecutionLedger([makeOrder()]);
    ledger.recordExecution(input({ quantity: 75 }));
    expect(ledger.getOrder("order-19")?.status).toBe("partially_filled");
    expect(() => ledger.recordExecution(input({ id: "execution-2", externalExecutionId: "fill-2", quantity: 26 }))).toThrow(ExecutionValidationError);
    expect(ledger.getCumulativeQuantity("order-19")).toBe(75);
  });

  it("supports a simulated fill without invoking a broker", () => {
    const ledger = new ExecutionLedger([makeOrder({ quantity: 2 })]);
    const result = ledger.recordExecution(input({ id: "simulated-1", externalExecutionId: null, quantity: 2, executionPrice: 101 }));
    expect(result.execution.externalExecutionId).toBeNull();
    expect(result.order.status).toBe("filled");
  });
});