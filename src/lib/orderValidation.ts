import { normalizeOrder, type CanonicalOrder } from "./orderModel";
import type { Instrument } from "./localDatabase";

export type OrderValidationCode =
  | "INVALID_ACCOUNT" | "UNAUTHORIZED_ACCOUNT" | "INVALID_INSTRUMENT" | "INVALID_EXCHANGE"
  | "INVALID_SIDE" | "INVALID_ORDER_TYPE" | "INVALID_QUANTITY" | "INVALID_PRICE"
  | "INVALID_TRIGGER_PRICE" | "INVALID_PRODUCT" | "LIFECYCLE_RESTRICTION"
  | "REQUIRED_FIELD" | "UNKNOWN_FIELD" | "RULE_VIOLATION";

export interface OrderValidationError { code: OrderValidationCode; message: string; }
export type OrderValidationResult =
  | { ok: true; order: CanonicalOrder; instrument: Instrument | null }
  | { ok: false; error: OrderValidationError };

export interface OrderValidationAccount { ownerUserId: string; status: string; isActive: boolean; }

export interface OrderValidationRequest {
  id: string; accountId: string; ownerUserId?: string; authUserId?: string; symbol: string;
  instrumentId?: string; exchange: string; segment?: string; side: string; quantity: number;
  orderType: string; price?: number; triggerPrice?: number; timeInForce?: string;
  stopLoss?: number; takeProfit?: number; product?: string; [key: string]: unknown;
}

export interface OrderValidationOptions {
  account?: OrderValidationAccount | null;
  instrument?: Instrument | null;
  requireAccount: boolean;
  requireInstrument: boolean;
  allowedProducts?: string[];
}

const ALLOWED_FIELDS = new Set([
  "id", "accountId", "ownerUserId", "authUserId", "symbol", "instrumentId", "exchange", "segment",
  "side", "quantity", "orderType", "price", "triggerPrice", "timeInForce", "stopLoss", "takeProfit", "product",
]);

function failure(code: OrderValidationCode, message: string): OrderValidationResult { return { ok: false, error: { code, message } }; }
function finitePositive(value: unknown): boolean { return typeof value === "number" && Number.isFinite(value) && value > 0; }

function exchangeMatches(exchange: string, segment: string): boolean {
  const normalizedExchange = exchange.trim().toUpperCase();
  const normalizedSegment = segment.trim().toUpperCase();
  if (!["NSE", "BSE", "MCX"].includes(normalizedExchange)) return false;
  return normalizedSegment.startsWith(normalizedExchange) || (normalizedExchange === "NSE" && normalizedSegment === "NFO");
}

function productIsCompatible(product: string, instrument: Instrument): boolean {
  return product === "CNC" ? instrument.instrumentType.trim().toUpperCase() === "EQUITY" : product === "MIS" || product === "NRML";
}

export function validateOrder(request: OrderValidationRequest, options: OrderValidationOptions): OrderValidationResult {
  const unknownField = Object.keys(request).find((key) => !ALLOWED_FIELDS.has(key));
  if (unknownField) return failure("UNKNOWN_FIELD", "Order contains an unsupported field");
  if (options.requireAccount) {
    if (!options.account) return failure("INVALID_ACCOUNT", "Trading account is not available");
    if (!request.authUserId) return failure("UNAUTHORIZED_ACCOUNT", "Authenticated user is required");
    if (options.account.ownerUserId !== request.authUserId) return failure("UNAUTHORIZED_ACCOUNT", "Trading account is not owned by the authenticated user");
    if (options.account.status.toUpperCase() !== "ACTIVE" || !options.account.isActive) return failure("LIFECYCLE_RESTRICTION", "Trading account is not active");
  }
  if (options.requireInstrument && !options.instrument) return failure("INVALID_INSTRUMENT", "Instrument is not available in the instrument master");
  if (options.instrument) {
    const symbol = request.symbol.trim().toUpperCase();
    const matchesSymbol = [options.instrument.symbol, options.instrument.tradingSymbol].some((value) => value.trim().toUpperCase() === symbol);
    if (!matchesSymbol || (request.instrumentId && request.instrumentId !== options.instrument.securityId)) return failure("INVALID_INSTRUMENT", "Instrument does not match the requested symbol");
    if (!exchangeMatches(request.exchange, options.instrument.exchangeSegment)) return failure("INVALID_EXCHANGE", "Exchange does not match the instrument segment");
    if (request.segment && request.segment.trim().toUpperCase() !== options.instrument.exchangeSegment.trim().toUpperCase()) return failure("INVALID_EXCHANGE", "Segment does not match the instrument");
    if (!Number.isFinite(options.instrument.lotSize) || options.instrument.lotSize <= 0) return failure("INVALID_INSTRUMENT", "Instrument has no valid lot size");
    if (options.instrument.expiryDate && new Date(options.instrument.expiryDate).getTime() < Date.now()) return failure("INVALID_INSTRUMENT", "Instrument contract has expired");
  }
  const side = String(request.side ?? "").toUpperCase();
  if (side !== "BUY" && side !== "SELL") return failure("INVALID_SIDE", "Side must be BUY or SELL");
  const normalizedType = String(request.orderType ?? "").toUpperCase().replace(/[-_ ]/g, "-");
  if (!["MARKET", "LIMIT", "SL", "SL-M", "STOP", "STOP-LIMIT"].includes(normalizedType)) return failure("INVALID_ORDER_TYPE", "Order type is not supported");
  if (!finitePositive(request.quantity) || !Number.isInteger(request.quantity)) return failure("INVALID_QUANTITY", "Quantity must be a positive whole number");
  if (options.instrument && request.quantity % options.instrument.lotSize !== 0) return failure("INVALID_QUANTITY", "Quantity must be a multiple of the instrument lot size");
  const canonicalType = normalizedType === "STOP" ? "SL" : normalizedType === "STOP-LIMIT" ? "SL-M" : normalizedType;
  if (canonicalType === "LIMIT" && !finitePositive(request.price)) return failure("INVALID_PRICE", "Limit orders require a positive price");
  if (canonicalType === "SL-M" && !finitePositive(request.price)) return failure("INVALID_PRICE", "Stop-limit orders require a positive price");
  if (canonicalType === "SL" && !finitePositive(request.triggerPrice)) return failure("INVALID_TRIGGER_PRICE", "Stop-market orders require a positive trigger price");
  if (canonicalType === "SL-M" && !finitePositive(request.triggerPrice)) return failure("INVALID_TRIGGER_PRICE", "Stop-limit orders require a positive trigger price");
  if (request.price != null && !finitePositive(request.price)) return failure("INVALID_PRICE", "Price must be positive");
  if (request.triggerPrice != null && !finitePositive(request.triggerPrice)) return failure("INVALID_TRIGGER_PRICE", "Trigger price must be positive");
  if (request.product != null) {
    const product = request.product.trim().toUpperCase();
    if (!["CNC", "MIS", "NRML"].includes(product) || (options.instrument && !productIsCompatible(product, options.instrument))) return failure("INVALID_PRODUCT", "Product is not compatible with the instrument");
    if (options.allowedProducts && !options.allowedProducts.includes(product)) return failure("RULE_VIOLATION", "Product is not allowed for this account");
  }
  try {
    const order = normalizeOrder({ id: request.id, accountId: request.accountId, ownerUserId: request.authUserId ?? request.ownerUserId, instrumentId: request.instrumentId, symbol: request.symbol, exchange: request.exchange, segment: request.segment, side: request.side, quantity: request.quantity, orderType: request.orderType, price: request.price, triggerPrice: request.triggerPrice, stopLoss: request.stopLoss, takeProfit: request.takeProfit, timeInForce: request.timeInForce });
    return { ok: true, order, instrument: options.instrument ?? null };
  } catch (error) {
    return failure("REQUIRED_FIELD", error instanceof Error ? error.message : "Order failed canonical validation");
  }
}