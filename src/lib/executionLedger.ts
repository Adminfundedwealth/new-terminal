import { normalizeOrder, type CanonicalOrder } from "./orderModel";
import { normalizeExecution, ExecutionValidationError, type CanonicalExecution, type ExecutionInput } from "./executionModel";

export interface RecordedExecution {
  execution: CanonicalExecution;
  order: CanonicalOrder;
  replayed: boolean;
}

function sameExecution(left: CanonicalExecution, right: CanonicalExecution): boolean {
  const { id: leftId, ...leftPayload } = left;
  const { id: rightId, ...rightPayload } = right;
  return JSON.stringify(leftPayload) === JSON.stringify(rightPayload);
}

export class ExecutionLedger {
  private readonly orders = new Map<string, CanonicalOrder>();
  private readonly executions = new Map<string, CanonicalExecution>();
  private readonly externalIds = new Map<string, string>();

  constructor(orders: CanonicalOrder[] = []) {
    orders.forEach((order) => this.registerOrder(order));
  }

  registerOrder(order: CanonicalOrder): CanonicalOrder {
    const normalized = normalizeOrder(order);
    this.orders.set(normalized.id, normalized);
    return normalized;
  }

  getOrder(orderId: string): CanonicalOrder | null { return this.orders.get(orderId) ?? null; }

  getExecutions(orderId?: string): CanonicalExecution[] {
    return [...this.executions.values()].filter((execution) => !orderId || execution.orderId === orderId);
  }

  getCumulativeQuantity(orderId: string): number {
    return Number(this.getExecutions(orderId).reduce((total, execution) => total + execution.quantity, 0).toFixed(8));
  }

  recordExecution(input: ExecutionInput): RecordedExecution {
    const execution = normalizeExecution(input);
    const order = this.orders.get(execution.orderId);
    if (!order) throw new ExecutionValidationError("ORDER_NOT_FOUND", `Order ${execution.orderId} was not found`);
    if (input.authUserId !== order.ownerUserId || execution.ownerUserId !== order.ownerUserId || execution.accountId !== order.accountId) {
      throw new ExecutionValidationError("UNAUTHORIZED_EXECUTION", "Execution and order ownership do not match");
    }
    if (execution.symbol !== order.symbol.toUpperCase() || execution.side !== order.side || execution.instrumentId !== order.instrumentId) {
      throw new ExecutionValidationError("ORDER_EXECUTION_MISMATCH", "Execution does not match the canonical order instrument or side");
    }

    const externalKey = execution.externalExecutionId ? `${execution.accountId}:${execution.externalExecutionId.toUpperCase()}` : null;
    const existingId = this.executions.has(execution.id) ? execution.id : externalKey ? this.externalIds.get(externalKey) : undefined;
    if (existingId) {
      const existing = this.executions.get(existingId);
      if (existing && sameExecution(existing, execution)) return { execution: existing, order, replayed: true };
      throw new ExecutionValidationError("DUPLICATE_EXECUTION", "Execution identifier was already used for different execution data");
    }
    if (["cancelled", "rejected", "failed", "filled"].includes(order.status)) {
      throw new ExecutionValidationError("INVALID_ORDER_STATE", `Order ${order.id} cannot receive an execution from state ${order.status}`);
    }

    const cumulative = this.getCumulativeQuantity(order.id);
    if (cumulative + execution.quantity > order.quantity) throw new ExecutionValidationError("OVER_FILL", "Execution quantity exceeds the canonical order quantity");
    const nextFilledQuantity = Number((cumulative + execution.quantity).toFixed(8));
    const previousValue = (order.averageFillPrice ?? 0) * cumulative;
    const averageFillPrice = Number(((previousValue + execution.executionPrice * execution.quantity) / nextFilledQuantity).toFixed(8));
    const updatedOrder = normalizeOrder({ ...order, filledQuantity: nextFilledQuantity, averageFillPrice, status: nextFilledQuantity === order.quantity ? "filled" : "partially_filled", completedAt: nextFilledQuantity === order.quantity ? execution.executedAt : order.completedAt, updatedAt: execution.executedAt });
    this.executions.set(execution.id, execution);
    if (externalKey) this.externalIds.set(externalKey, execution.id);
    this.orders.set(updatedOrder.id, updatedOrder);
    return { execution, order: updatedOrder, replayed: false };
  }
}