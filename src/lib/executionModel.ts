import type { CanonicalOrder, OrderSide } from "./orderModel";

export interface CanonicalExecution {
  id: string;
  orderId: string;
  accountId: string;
  ownerUserId: string;
  instrumentId: string | null;
  symbol: string;
  side: OrderSide;
  quantity: number;
  executionPrice: number;
  executedAt: string;
  externalExecutionId: string | null;
  fees: number;
  taxes: number;
  netAmount: number | null;
}

export interface ExecutionInput {
  id?: string;
  orderId: string;
  accountId: string;
  ownerUserId: string;
  authUserId: string;
  instrumentId?: string | null;
  symbol: string;
  side: string;
  quantity: number;
  executionPrice: number;
  executedAt: string | Date;
  externalExecutionId?: string | null;
  fees?: number;
  taxes?: number;
  netAmount?: number | null;
}

export type ExecutionErrorCode =
  | "INVALID_EXECUTION"
  | "UNAUTHORIZED_EXECUTION"
  | "ORDER_NOT_FOUND"
  | "INVALID_ORDER_STATE"
  | "ORDER_EXECUTION_MISMATCH"
  | "OVER_FILL"
  | "DUPLICATE_EXECUTION";

export class ExecutionValidationError extends Error {
  constructor(public readonly code: ExecutionErrorCode, message: string) {
    super(message);
    this.name = "ExecutionValidationError";
  }
}

function text(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new ExecutionValidationError("INVALID_EXECUTION", `${name} is required`);
  return value.trim();
}

function positive(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new ExecutionValidationError("INVALID_EXECUTION", `${name} must be positive`);
  return Number(value.toFixed(8));
}

function nonNegative(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new ExecutionValidationError("INVALID_EXECUTION", `${name} must be non-negative`);
  return Number(value.toFixed(8));
}

export function normalizeExecution(input: ExecutionInput): CanonicalExecution {
  const side = text(input.side, "side").toUpperCase();
  if (side !== "BUY" && side !== "SELL") throw new ExecutionValidationError("INVALID_EXECUTION", "side must be BUY or SELL");
  const executedAt = input.executedAt instanceof Date ? input.executedAt.toISOString() : text(input.executedAt, "executedAt");
  if (!Number.isFinite(new Date(executedAt).getTime())) throw new ExecutionValidationError("INVALID_EXECUTION", "executedAt must be a valid timestamp");
  const externalExecutionId = input.externalExecutionId == null || input.externalExecutionId === "" ? null : text(input.externalExecutionId, "externalExecutionId").toUpperCase();
  return {
    id: text(input.id ?? `execution:${input.orderId}:${externalExecutionId ?? `${executedAt}:${input.quantity}:${input.executionPrice}`}`, "id"),
    orderId: text(input.orderId, "orderId"),
    accountId: text(input.accountId, "accountId"),
    ownerUserId: text(input.ownerUserId, "ownerUserId"),
    instrumentId: input.instrumentId == null || input.instrumentId === "" ? null : text(input.instrumentId, "instrumentId"),
    symbol: text(input.symbol, "symbol").toUpperCase(),
    side,
    quantity: positive(input.quantity, "quantity"),
    executionPrice: positive(input.executionPrice, "executionPrice"),
    executedAt,
    externalExecutionId,
    fees: nonNegative(input.fees ?? 0, "fees"),
    taxes: nonNegative(input.taxes ?? 0, "taxes"),
    netAmount: input.netAmount == null ? null : nonNegative(input.netAmount, "netAmount"),
  };
}

export function executionRow(execution: CanonicalExecution) {
  return {
    id: execution.id,
    order_id: execution.orderId,
    account_id: execution.accountId,
    owner_user_id: execution.ownerUserId,
    instrument_id: execution.instrumentId,
    symbol: execution.symbol,
    side: execution.side.toLowerCase(),
    quantity: execution.quantity,
    execution_price: execution.executionPrice,
    executed_at: execution.executedAt,
    external_execution_id: execution.externalExecutionId,
    fees: execution.fees,
    taxes: execution.taxes,
    net_amount: execution.netAmount,
  };
}

export type ExecutionOrderSnapshot = Pick<CanonicalOrder, "id" | "accountId" | "ownerUserId" | "quantity" | "filledQuantity" | "averageFillPrice" | "status" | "symbol" | "instrumentId" | "side">;