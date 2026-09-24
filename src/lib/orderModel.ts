export const ORDER_STATUSES = [
  "requested",
  "pending",
  "open",
  "partially_filled",
  "filled",
  "cancel_requested",
  "cancelled",
  "rejected",
  "failed",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type OrderSide = "BUY" | "SELL";
export type OrderType = "MARKET" | "LIMIT" | "SL" | "SL-M";
export type TimeInForce = "DAY" | "IOC" | "GTC";

export interface CanonicalOrder {
  id: string;
  accountId: string;
  ownerUserId: string | null;
  clientOrderId: string | null;
  idempotencyFingerprint?: string | null;
  brokerOrderId: string | null;
  instrumentId: string | null;
  symbol: string;
  exchange: string | null;
  segment: string | null;
  instrumentType: string | null;
  side: OrderSide;
  orderType: OrderType;
  quantity: number;
  filledQuantity: number;
  price: number | null;
  averageFillPrice: number | null;
  triggerPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  timeInForce: TimeInForce | null;
  status: OrderStatus;
  rejectionReason: string | null;
  cancellationReason: string | null;
  parentOrderId: string | null;
  replacesOrderId: string | null;
  createdAt: string;
  submittedAt: string | null;
  updatedAt: string;
  cancelRequestedAt: string | null;
  cancelledAt: string | null;
  completedAt: string | null;
}

export interface OrderInput {
  id: string;
  accountId: string;
  ownerUserId?: string | null;
  clientOrderId?: string | null;
  idempotencyFingerprint?: string | null;
  brokerOrderId?: string | null;
  instrumentId?: string | null;
  symbol: string;
  exchange?: string | null;
  segment?: string | null;
  instrumentType?: string | null;
  side: OrderSide | string;
  orderType: OrderType | string;
  quantity: number;
  filledQuantity?: number;
  price?: number | null;
  averageFillPrice?: number | null;
  triggerPrice?: number | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
  timeInForce?: TimeInForce | string | null;
  status?: OrderStatus | string;
  rejectionReason?: string | null;
  cancellationReason?: string | null;
  parentOrderId?: string | null;
  replacesOrderId?: string | null;
  createdAt?: string;
  submittedAt?: string | null;
  updatedAt?: string;
  cancelRequestedAt?: string | null;
  cancelledAt?: string | null;
  completedAt?: string | null;
}

export interface CanonicalOrderRow {
  id: string;
  account_id: string;
  owner_user_id: string | null;
  external_order_id: string | null;
  client_order_id: string | null;
  idempotency_fingerprint: string | null;
  symbol: string;
  instrument_id: string | null;
  exchange: string | null;
  segment: string | null;
  instrument_type: string | null;
  side: "buy" | "sell";
  order_type: OrderType;
  quantity: number;
  filled_quantity: number;
  price: number | null;
  average_fill_price: number | null;
  trigger_price: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  time_in_force: TimeInForce | null;
  parent_order_id: string | null;
  replaces_order_id: string | null;
  status: OrderStatus;
  rejection_reason: string | null;
  cancellation_reason: string | null;
  created_at: string;
  submitted_at: string | null;
  updated_at: string;
  cancel_requested_at: string | null;
  cancelled_at: string | null;
  completed_at: string | null;
}

export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  requested: ["pending", "rejected", "failed"],
  pending: ["open", "partially_filled", "filled", "cancel_requested", "cancelled", "rejected", "failed"],
  open: ["partially_filled", "filled", "cancel_requested", "cancelled", "failed"],
  partially_filled: ["filled", "cancel_requested", "cancelled", "failed"],
  filled: [],
  cancel_requested: ["cancelled", "failed"],
  cancelled: [],
  rejected: [],
  failed: [],
};

export const ORDER_TERMINAL_STATES = ["filled", "cancelled", "rejected", "failed"] as const;

const PRECISION = 8;

function round(value: number): number { return Number(value.toFixed(PRECISION)); }

function requiredText(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} is required`);
  return value.trim();
}

function optionalText(value: unknown): string | null { return value == null || value === "" ? null : requiredText(value, "text value"); }

function finiteNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${name} must be finite`);
  return value;
}

function optionalPositive(value: unknown, name: string): number | null {
  if (value == null) return null;
  const number = finiteNumber(value, name);
  if (number <= 0) throw new Error(`${name} must be positive`);
  return round(number);
}

function normalizeOrderType(value: unknown): OrderType {
  const type = requiredText(value, "orderType").toUpperCase().replace(/[-_ ]/g, "-");
  if (type === "STOP") return "SL";
  if (type === "STOP-LIMIT") return "SL-M";
  if (type === "MARKET" || type === "LIMIT" || type === "SL" || type === "SL-M") return type;
  throw new Error(`Unsupported order type: ${type}`);
}

function normalizeStatus(value: unknown): OrderStatus {
  const status = requiredText(value ?? "requested", "status").toLowerCase().replace(/[- ]/g, "_");
  const aliases: Record<string, OrderStatus> = {
    new: "requested", client_created: "requested", requested: "requested",
    submitted: "pending", pending: "pending", ack: "pending", accepted: "open", open: "open",
    partially_filled: "partially_filled", partial: "partially_filled", filled: "filled",
    cancel_requested: "cancel_requested", cancelled: "cancelled", canceled: "cancelled",
    rejected: "rejected", failed: "failed", error: "failed",
  };
  const normalized = aliases[status];
  if (!normalized) throw new Error(`Unsupported order status: ${status}`);
  return normalized;
}

function normalizeTimeInForce(value: unknown): TimeInForce | null {
  if (value == null || value === "") return null;
  const normalized = requiredText(value, "timeInForce").toUpperCase();
  if (normalized === "DAY" || normalized === "IOC" || normalized === "GTC") return normalized;
  throw new Error(`Unsupported time in force: ${normalized}`);
}

export function normalizeOrder(input: OrderInput): CanonicalOrder {
  const id = requiredText(input.id, "id");
  const accountId = requiredText(input.accountId, "accountId");
  const symbol = requiredText(input.symbol, "symbol");
  const side = requiredText(input.side, "side").toUpperCase();
  if (side !== "BUY" && side !== "SELL") throw new Error(`Unsupported order side: ${side}`);
  const orderType = normalizeOrderType(input.orderType);
  const quantity = finiteNumber(input.quantity, "quantity");
  if (quantity <= 0) throw new Error("quantity must be positive");
  const filledQuantity = input.filledQuantity == null ? 0 : finiteNumber(input.filledQuantity, "filledQuantity");
  if (filledQuantity < 0 || filledQuantity > quantity) throw new Error("filledQuantity must be between zero and quantity");
  const price = optionalPositive(input.price, "price");
  const triggerPrice = optionalPositive(input.triggerPrice, "triggerPrice");
  if (orderType === "LIMIT" && price == null) throw new Error("LIMIT orders require price");
  if ((orderType === "SL" || orderType === "SL-M") && triggerPrice == null) throw new Error("stop orders require triggerPrice");
  const status = normalizeStatus(input.status);
  const createdAt = input.createdAt ?? new Date().toISOString();
  const updatedAt = input.updatedAt ?? createdAt;
  if (!Number.isFinite(new Date(createdAt).getTime()) || !Number.isFinite(new Date(updatedAt).getTime())) throw new Error("createdAt and updatedAt must be valid timestamps");
  return {
    id,
    accountId,
    ownerUserId: optionalText(input.ownerUserId),
    clientOrderId: optionalText(input.clientOrderId),
    idempotencyFingerprint: optionalText(input.idempotencyFingerprint),
    brokerOrderId: optionalText(input.brokerOrderId),
    instrumentId: optionalText(input.instrumentId),
    symbol,
    exchange: optionalText(input.exchange),
    segment: optionalText(input.segment),
    instrumentType: optionalText(input.instrumentType),
    side,
    orderType,
    quantity: round(quantity),
    filledQuantity: round(filledQuantity),
    price,
    averageFillPrice: optionalPositive(input.averageFillPrice, "averageFillPrice"),
    triggerPrice,
    stopLoss: optionalPositive(input.stopLoss, "stopLoss"),
    takeProfit: optionalPositive(input.takeProfit, "takeProfit"),
    timeInForce: normalizeTimeInForce(input.timeInForce),
    status,
    rejectionReason: optionalText(input.rejectionReason),
    cancellationReason: optionalText(input.cancellationReason),
    parentOrderId: optionalText(input.parentOrderId),
    replacesOrderId: optionalText(input.replacesOrderId),
    createdAt,
    submittedAt: optionalText(input.submittedAt),
    updatedAt,
    cancelRequestedAt: optionalText(input.cancelRequestedAt),
    cancelledAt: optionalText(input.cancelledAt),
    completedAt: optionalText(input.completedAt),
  };
}

export function canTransitionOrderStatus(current: OrderStatus, next: OrderStatus): boolean {
  return ORDER_TRANSITIONS[current].includes(next);
}

export function normalizeBrokerOrder(input: {
  orderId: string;
  clientOrderId?: string | null;
  brokerOrderId?: string | null;
  accountId: string;
  symbol: string;
  exchange?: string | null;
  side: string;
  quantity: number;
  filledQuantity?: number;
  orderType: string;
  price?: number | null;
  triggerPrice?: number | null;
  status: string;
  placedAt?: string;
}): CanonicalOrder {
  return normalizeOrder({
    id: input.orderId,
    accountId: input.accountId,
    clientOrderId: input.clientOrderId,
    brokerOrderId: input.brokerOrderId,
    symbol: input.symbol,
    exchange: input.exchange,
    side: input.side,
    quantity: input.quantity,
    filledQuantity: input.filledQuantity,
    orderType: input.orderType,
    price: input.price,
    triggerPrice: input.triggerPrice,
    status: input.status,
    createdAt: input.placedAt,
    updatedAt: input.placedAt,
  });
}

export function serializeCanonicalOrder(order: CanonicalOrder): CanonicalOrderRow {
  if (!order.ownerUserId) throw new Error("ownerUserId is required to serialize a canonical order row");
  return {
    id: order.id,
    account_id: order.accountId,
    owner_user_id: order.ownerUserId,
    external_order_id: order.brokerOrderId,
    client_order_id: order.clientOrderId,
    idempotency_fingerprint: order.idempotencyFingerprint ?? null,
    symbol: order.symbol,
    instrument_id: order.instrumentId,
    exchange: order.exchange,
    segment: order.segment,
    instrument_type: order.instrumentType,
    side: order.side.toLowerCase() as "buy" | "sell",
    order_type: order.orderType,
    quantity: order.quantity,
    filled_quantity: order.filledQuantity,
    price: order.price,
    average_fill_price: order.averageFillPrice,
    trigger_price: order.triggerPrice,
    stop_loss: order.stopLoss,
    take_profit: order.takeProfit,
    time_in_force: order.timeInForce,
    parent_order_id: order.parentOrderId,
    replaces_order_id: order.replacesOrderId,
    status: order.status,
    rejection_reason: order.rejectionReason,
    cancellation_reason: order.cancellationReason,
    created_at: order.createdAt,
    submitted_at: order.submittedAt,
    updated_at: order.updatedAt,
    cancel_requested_at: order.cancelRequestedAt,
    cancelled_at: order.cancelledAt,
    completed_at: order.completedAt,
  };
}

export function deserializeCanonicalOrder(row: CanonicalOrderRow): CanonicalOrder {
  return normalizeOrder({
    id: row.id,
    accountId: row.account_id,
    ownerUserId: row.owner_user_id,
    clientOrderId: row.client_order_id,
    idempotencyFingerprint: row.idempotency_fingerprint,
    brokerOrderId: row.external_order_id,
    instrumentId: row.instrument_id,
    symbol: row.symbol,
    exchange: row.exchange,
    segment: row.segment,
    instrumentType: row.instrument_type,
    side: row.side,
    orderType: row.order_type,
    quantity: Number(row.quantity),
    filledQuantity: Number(row.filled_quantity),
    price: row.price == null ? null : Number(row.price),
    averageFillPrice: row.average_fill_price == null ? null : Number(row.average_fill_price),
    triggerPrice: row.trigger_price == null ? null : Number(row.trigger_price),
    stopLoss: row.stop_loss == null ? null : Number(row.stop_loss),
    takeProfit: row.take_profit == null ? null : Number(row.take_profit),
    timeInForce: row.time_in_force,
    parentOrderId: row.parent_order_id,
    replacesOrderId: row.replaces_order_id,
    status: row.status,
    rejectionReason: row.rejection_reason,
    cancellationReason: row.cancellation_reason,
    createdAt: row.created_at,
    submittedAt: row.submitted_at,
    updatedAt: row.updated_at,
    cancelRequestedAt: row.cancel_requested_at,
    cancelledAt: row.cancelled_at,
    completedAt: row.completed_at,
  });
}