export type ReconciliationType =
  | "matched"
  | "broker_only"
  | "canonical_only"
  | "status_mismatch"
  | "quantity_mismatch"
  | "price_mismatch"
  | "identifier_mismatch"
  | "other";

export interface CanonicalOrderLike {
  id: string;
  accountId: string;
  ownerUserId?: string | null;
  symbol: string;
  exchange?: string | null;
  side: string;
  orderType?: string;
  quantity: number;
  filledQuantity?: number;
  price?: number | null;
  averageFillPrice?: number | null;
  status: string;
  brokerOrderId?: string | null;
  clientOrderId?: string | null;
  instrumentId?: string | null;
}

export interface CanonicalExecutionLike {
  id: string;
  orderId: string;
  accountId: string;
  ownerUserId?: string | null;
  symbol: string;
  side: string;
  quantity: number;
  executionPrice: number;
  executedAt: string;
  externalExecutionId?: string | null;
  fees?: number | null;
  taxes?: number | null;
  netAmount?: number | null;
  instrumentId?: string | null;
}

export interface CanonicalPositionLike {
  id: string;
  accountId: string;
  ownerUserId?: string | null;
  symbol: string;
  exchange?: string | null;
  quantity: number;
  side: string;
  averagePrice?: number | null;
  lastPrice?: number | null;
  status?: string | null;
  instrumentId?: string | null;
}

export interface CanonicalStateLike {
  orders: CanonicalOrderLike[];
  executions: CanonicalExecutionLike[];
  positions: CanonicalPositionLike[];
}

export interface BrokerOrderLike {
  orderId?: string;
  id?: string;
  accountId: string;
  symbol: string;
  exchange?: string | null;
  side: string;
  quantity: number;
  filledQuantity?: number;
  status: string;
  price?: number | null;
  averagePrice?: number | null;
  orderType?: string;
  brokerOrderId?: string | null;
  clientOrderId?: string | null;
  instrumentId?: string | null;
}

export interface BrokerExecutionLike {
  id?: string;
  orderId?: string;
  accountId: string;
  symbol: string;
  side: string;
  quantity: number;
  price: number;
  executedAt: string;
  externalExecutionId?: string | null;
  instrumentId?: string | null;
}

export interface BrokerPositionLike {
  id?: string;
  accountId: string;
  symbol: string;
  exchange?: string | null;
  quantity: number;
  side: string;
  averagePrice?: number | null;
  lastPrice?: number | null;
  status?: string | null;
  instrumentId?: string | null;
}

export interface BrokerNormalizedState {
  orders: NormalizedBrokerOrder[];
  executions: NormalizedBrokerExecution[];
  positions: NormalizedBrokerPosition[];
}

export interface NormalizedBrokerOrder {
  key: string;
  accountId: string;
  symbol: string;
  exchange: string | null;
  side: string;
  quantity: number;
  filledQuantity: number;
  status: string;
  price: number | null;
  averagePrice: number | null;
  orderType: string;
  orderId: string;
  brokerOrderId: string | null;
  clientOrderId: string | null;
  instrumentId: string | null;
}

export interface NormalizedBrokerExecution {
  key: string;
  accountId: string;
  orderId: string;
  symbol: string;
  side: string;
  quantity: number;
  price: number;
  executedAt: string;
  externalExecutionId: string | null;
  instrumentId: string | null;
  executionId: string;
}

export interface NormalizedBrokerPosition {
  key: string;
  accountId: string;
  symbol: string;
  exchange: string | null;
  quantity: number;
  side: string;
  averagePrice: number | null;
  lastPrice: number | null;
  status: string;
  instrumentId: string | null;
  positionId: string;
}

export interface ReconciliationSummaryItem {
  type: ReconciliationType;
  entity: "order" | "execution" | "position";
  accountId: string;
  identifier: string;
  details?: string;
}

export interface ReconciliationResult {
  matchedState: { orders: Array<{ broker: NormalizedBrokerOrder; canonical: CanonicalOrderLike }>; executions: Array<{ broker: NormalizedBrokerExecution; canonical: CanonicalExecutionLike }>; positions: Array<{ broker: NormalizedBrokerPosition; canonical: CanonicalPositionLike }> };
  brokerOnly: { orders: NormalizedBrokerOrder[]; executions: NormalizedBrokerExecution[]; positions: NormalizedBrokerPosition[] };
  canonicalOnly: { orders: CanonicalOrderLike[]; executions: CanonicalExecutionLike[]; positions: CanonicalPositionLike[] };
  mismatches: ReconciliationSummaryItem[];
  matchesAccountIsolation: boolean;
}

export type MismatchClassification =
  | "MATCH"
  | "BROKER_ONLY"
  | "CANONICAL_ONLY"
  | "STATUS_MISMATCH"
  | "QUANTITY_MISMATCH"
  | "PRICE_MISMATCH"
  | "IDENTIFIER_MISMATCH"
  | "UNRESOLVED"
  | "MANUAL_REVIEW";

export type MismatchResolutionDecision = "safe" | "unsafe" | "manual_review" | "no_action";
export type MismatchResolutionStatus = "RESOLVED" | "UNRESOLVED" | "MANUAL_REVIEW";
export type MismatchAction = "NO_ACTION" | "RECORD_BROKER_ONLY" | "RECORD_CANONICAL_ONLY" | "KEEP_CANONICAL_STATE" | "APPLY_CANONICAL_PATCH" | "REVIEW_MANUALLY";

export interface MismatchResolutionInput {
  mismatchType?: string | null;
  mismatchReference?: string;
  accountReference?: string | null;
  previousCanonicalState?: unknown;
  brokerState?: unknown;
  allowAutoResolution?: boolean;
  resolutionSupport?: string;
  riskContext?: {
    accountId?: string | null;
    symbol?: string;
    side?: string;
    quantity?: number;
    ruleEvaluation?: {
      decision?: string;
      reason?: string;
    };
  };
}

export interface MismatchResolutionResult {
  mismatchReference: string;
  accountReference: string;
  classification: MismatchClassification;
  mismatchType: string;
  previousCanonicalState: unknown;
  brokerState: unknown;
  resolutionDecision: MismatchResolutionDecision;
  resolutionStatus: MismatchResolutionStatus;
  action: MismatchAction;
  reason: string;
  timestamp: string;
  idempotencyReference: string;
  updatedCanonicalState: unknown;
}

export interface BrokerStateInput {
  orders?: Array<Partial<BrokerOrderLike>>;
  executions?: Array<Partial<BrokerExecutionLike>>;
  positions?: Array<Partial<BrokerPositionLike>>;
}

function isBrokerNormalizedState(value: Partial<BrokerStateInput> | BrokerNormalizedState): value is BrokerNormalizedState {
  return Array.isArray(value.orders) && Array.isArray(value.executions) && Array.isArray(value.positions)
    && value.orders.every((order) => typeof order === "object" && order != null && "key" in order && typeof (order as { key?: unknown }).key === "string")
    && value.executions.every((execution) => typeof execution === "object" && execution != null && "key" in execution && typeof (execution as { key?: unknown }).key === "string")
    && value.positions.every((position) => typeof position === "object" && position != null && "key" in position && typeof (position as { key?: unknown }).key === "string");
}

const EMPTY_RESULT = { orders: [], executions: [], positions: [] } as const;

function safeText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function normalizeStatusToken(value: unknown): string {
  const candidate = safeText(value, "unknown").toLowerCase().replace(/[-\s]+/g, "_");
  const aliases: Record<string, string> = {
    new: "requested",
    requested: "requested",
    pending: "pending",
    open: "open",
    accepted: "open",
    partially_filled: "partially_filled",
    partial: "partially_filled",
    filled: "filled",
    cancelled: "cancelled",
    canceled: "cancelled",
    rejected: "rejected",
    failed: "failed",
    closed: "closed",
    unknown: "unknown",
  };
  return aliases[candidate] ?? candidate;
}

function normalizeSide(value: unknown): string {
  const side = safeText(value, "BUY").toUpperCase();
  if (side === "BUY" || side === "LONG") return "BUY";
  if (side === "SELL" || side === "SHORT") return "SELL";
  return side;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function recordIdentifier(...candidates: Array<unknown>): string | null {
  const candidate = candidates
    .map((value) => safeText(value, ""))
    .find((value) => value !== "");
  return candidate ? candidate : null;
}

function stableOrderKey(accountId: string, symbol: string, ...identifiers: Array<unknown>): string {
  const id = recordIdentifier(...identifiers) ?? `${symbol}|${accountId}|fallback`;
  return `${safeText(accountId, "unknown")}::${id}`.toLowerCase();
}

function stableExecutionKey(accountId: string, symbol: string, ...identifiers: Array<unknown>): string {
  const id = recordIdentifier(...identifiers) ?? `${symbol}|${accountId}|fallback`;
  return `${safeText(accountId, "unknown")}::${id}`.toLowerCase();
}

function stablePositionKey(accountId: string, symbol: string, ...identifiers: Array<unknown>): string {
  const id = recordIdentifier(...identifiers) ?? `${symbol}|${accountId}|fallback`;
  return `${safeText(accountId, "unknown")}::${id}`.toLowerCase();
}

function dedupeByKey<T extends { key: string }>(values: T[]): T[] {
  const seen = new Map<string, T>();
  for (const item of values) {
    if (!seen.has(item.key)) seen.set(item.key, item);
  }
  return [...seen.values()];
}

function sortRecords<T>(values: T[], keySelector: (item: T) => string): T[] {
  return [...values].sort((left, right) => keySelector(left).localeCompare(keySelector(right)));
}

export function normalizeBrokerState(input: Partial<BrokerStateInput> = {}): BrokerNormalizedState {
  const rawOrders = Array.isArray(input.orders) ? input.orders : [];
  const rawExecutions = Array.isArray(input.executions) ? input.executions : [];
  const rawPositions = Array.isArray(input.positions) ? input.positions : [];

  const orders: NormalizedBrokerOrder[] = dedupeByKey(
    rawOrders
      .filter(Boolean)
      .map((order) => {
        const accountId = safeText((order as Partial<BrokerOrderLike>).accountId, "unknown");
        const symbol = safeText((order as Partial<BrokerOrderLike>).symbol, "UNKNOWN").toUpperCase();
        const orderId = safeText((order as Partial<BrokerOrderLike>).orderId ?? (order as Partial<BrokerOrderLike>).id, "");
        const brokerOrderId = safeText((order as Partial<BrokerOrderLike>).brokerOrderId ?? orderId, "");
        const clientOrderId = safeText((order as Partial<BrokerOrderLike>).clientOrderId, "");
        const exchange = safeText((order as Partial<BrokerOrderLike>).exchange, "");
        const quantity = toNumber((order as Partial<BrokerOrderLike>).quantity) ?? 0;
        const filledQuantity = toNumber((order as Partial<BrokerOrderLike>).filledQuantity) ?? 0;
        const status = normalizeStatusToken((order as Partial<BrokerOrderLike>).status ?? "unknown");
        const price = toNumber((order as Partial<BrokerOrderLike>).price);
        const averagePrice = toNumber((order as Partial<BrokerOrderLike>).averagePrice ?? price);
        const orderType = safeText((order as Partial<BrokerOrderLike>).orderType, "LIMIT").toUpperCase();
        const instrumentId = safeText((order as Partial<BrokerOrderLike>).instrumentId, "");
        const normalized: NormalizedBrokerOrder = {
          key: stableOrderKey(accountId, symbol, brokerOrderId, clientOrderId, orderId, `${symbol}|${accountId}|${quantity}`),
          accountId,
          symbol,
          exchange: exchange || null,
          side: normalizeSide((order as Partial<BrokerOrderLike>).side ?? "BUY"),
          quantity,
          filledQuantity,
          status,
          price,
          averagePrice,
          orderType,
          orderId: orderId || brokerOrderId || `${symbol}:${accountId}:fallback`,
          brokerOrderId: brokerOrderId || null,
          clientOrderId: clientOrderId || null,
          instrumentId: instrumentId || null,
        };
        return normalized;
      })
  ).map((order) => ({ ...order }));

  const executions: NormalizedBrokerExecution[] = dedupeByKey(
    rawExecutions
      .filter(Boolean)
      .map((execution) => {
        const accountId = safeText((execution as Partial<BrokerExecutionLike>).accountId, "unknown");
        const symbol = safeText((execution as Partial<BrokerExecutionLike>).symbol, "UNKNOWN").toUpperCase();
        const orderId = safeText((execution as Partial<BrokerExecutionLike>).orderId, "");
        const executionId = safeText((execution as Partial<BrokerExecutionLike>).id ?? (execution as Partial<BrokerExecutionLike>).externalExecutionId, "");
        const externalExecutionId = safeText((execution as Partial<BrokerExecutionLike>).externalExecutionId, "");
        const price = toNumber((execution as Partial<BrokerExecutionLike>).price) ?? 0;
        const quantity = toNumber((execution as Partial<BrokerExecutionLike>).quantity) ?? 0;
        const executedAt = safeText((execution as Partial<BrokerExecutionLike>).executedAt, new Date().toISOString());
        const instrumentId = safeText((execution as Partial<BrokerExecutionLike>).instrumentId, "");
        return {
          key: stableExecutionKey(accountId, symbol, externalExecutionId, executionId, orderId, `${symbol}|${accountId}|${quantity}`),
          accountId,
          orderId: orderId || executionId || `${symbol}:${accountId}:fallback`,
          symbol,
          side: normalizeSide((execution as Partial<BrokerExecutionLike>).side ?? "BUY"),
          quantity,
          price,
          executedAt,
          externalExecutionId: externalExecutionId || null,
          instrumentId: instrumentId || null,
          executionId: executionId || externalExecutionId || `${symbol}:${accountId}:execution`,
        };
      })
  ).map((execution) => ({ ...execution }));

  const positions: NormalizedBrokerPosition[] = dedupeByKey(
    rawPositions
      .filter(Boolean)
      .map((position) => {
        const accountId = safeText((position as Partial<BrokerPositionLike>).accountId, "unknown");
        const symbol = safeText((position as Partial<BrokerPositionLike>).symbol, "UNKNOWN").toUpperCase();
        const positionId = safeText((position as Partial<BrokerPositionLike>).id, "");
        const quantity = toNumber((position as Partial<BrokerPositionLike>).quantity) ?? 0;
        const averagePrice = toNumber((position as Partial<BrokerPositionLike>).averagePrice) ?? null;
        const lastPrice = toNumber((position as Partial<BrokerPositionLike>).lastPrice) ?? null;
        const status = normalizeStatusToken((position as Partial<BrokerPositionLike>).status ?? (quantity > 0 ? "open" : "closed"));
        const instrumentId = safeText((position as Partial<BrokerPositionLike>).instrumentId, "");
        return {
          key: stablePositionKey(accountId, symbol, positionId, `${symbol}|${accountId}|${quantity}`),
          accountId,
          symbol,
          exchange: safeText((position as Partial<BrokerPositionLike>).exchange, "") || null,
          quantity,
          side: normalizeSide((position as Partial<BrokerPositionLike>).side ?? "BUY"),
          averagePrice,
          lastPrice,
          status,
          instrumentId: instrumentId || null,
          positionId: positionId || `${symbol}:${accountId}:position`,
        };
      })
  ).map((position) => ({ ...position }));

  return {
    orders: sortRecords(orders, (item) => `${item.accountId}|${item.symbol}|${item.key}`),
    executions: sortRecords(executions, (item) => `${item.accountId}|${item.symbol}|${item.key}`),
    positions: sortRecords(positions, (item) => `${item.accountId}|${item.symbol}|${item.key}`),
  };
}

function normalizeCanonicalOrder(order: Partial<CanonicalOrderLike>): CanonicalOrderLike {
  return {
    id: safeText(order.id, "unknown-order"),
    accountId: safeText(order.accountId, "unknown"),
    ownerUserId: order.ownerUserId ?? null,
    symbol: safeText(order.symbol, "UNKNOWN").toUpperCase(),
    exchange: order.exchange ?? null,
    side: normalizeSide(order.side ?? "BUY"),
    orderType: safeText(order.orderType, "LIMIT").toUpperCase(),
    quantity: toNumber(order.quantity) ?? 0,
    filledQuantity: toNumber(order.filledQuantity) ?? 0,
    price: toNumber(order.price),
    averageFillPrice: toNumber(order.averageFillPrice),
    status: normalizeStatusToken(order.status ?? "unknown"),
    brokerOrderId: order.brokerOrderId ?? null,
    clientOrderId: order.clientOrderId ?? null,
    instrumentId: order.instrumentId ?? null,
  };
}

function normalizeCanonicalExecution(execution: Partial<CanonicalExecutionLike>): CanonicalExecutionLike {
  return {
    id: safeText(execution.id, "unknown-execution"),
    orderId: safeText(execution.orderId, "unknown-order"),
    accountId: safeText(execution.accountId, "unknown"),
    ownerUserId: execution.ownerUserId ?? null,
    symbol: safeText(execution.symbol, "UNKNOWN").toUpperCase(),
    side: normalizeSide(execution.side ?? "BUY"),
    quantity: toNumber(execution.quantity) ?? 0,
    executionPrice: toNumber(execution.executionPrice) ?? 0,
    executedAt: safeText(execution.executedAt, new Date().toISOString()),
    externalExecutionId: execution.externalExecutionId ?? null,
    instrumentId: execution.instrumentId ?? null,
  };
}

function normalizeCanonicalPosition(position: Partial<CanonicalPositionLike>): CanonicalPositionLike {
  return {
    id: safeText(position.id, "unknown-position"),
    accountId: safeText(position.accountId, "unknown"),
    ownerUserId: position.ownerUserId ?? null,
    symbol: safeText(position.symbol, "UNKNOWN").toUpperCase(),
    exchange: position.exchange ?? null,
    quantity: toNumber(position.quantity) ?? 0,
    side: normalizeSide(position.side ?? "BUY"),
    averagePrice: toNumber(position.averagePrice),
    lastPrice: toNumber(position.lastPrice),
    status: normalizeStatusToken(position.status ?? (toNumber(position.quantity) ?? 0 > 0 ? "open" : "closed")),
    instrumentId: position.instrumentId ?? null,
  };
}

function normalizeCanonicalState(input: Partial<CanonicalStateLike> = {}): CanonicalStateLike {
  return {
    orders: (Array.isArray(input.orders) ? input.orders : []).map((order) => normalizeCanonicalOrder(order as Partial<CanonicalOrderLike>)),
    executions: (Array.isArray(input.executions) ? input.executions : []).map((execution) => normalizeCanonicalExecution(execution as Partial<CanonicalExecutionLike>)),
    positions: (Array.isArray(input.positions) ? input.positions : []).map((position) => normalizeCanonicalPosition(position as Partial<CanonicalPositionLike>)),
  };
}

function compareOrderDifference(broker: NormalizedBrokerOrder, canonical: CanonicalOrderLike): ReconciliationSummaryItem[] {
  const mismatches: ReconciliationSummaryItem[] = [];
  const brokerLabel = `${broker.accountId}:${broker.brokerOrderId ?? broker.orderId}`;
  const canonicalLabel = `${canonical.accountId}:${canonical.brokerOrderId ?? canonical.id}`;

  if (broker.brokerOrderId && canonical.brokerOrderId && broker.brokerOrderId !== canonical.brokerOrderId) {
    mismatches.push({
      type: "identifier_mismatch",
      entity: "order",
      accountId: canonical.accountId,
      identifier: brokerLabel,
      details: `brokerOrderId ${broker.brokerOrderId} did not match canonical brokerOrderId ${canonical.brokerOrderId}`,
    });
  }

  if (broker.status !== canonical.status) {
    mismatches.push({
      type: "status_mismatch",
      entity: "order",
      accountId: canonical.accountId,
      identifier: canonicalLabel,
      details: `status ${broker.status} vs ${canonical.status}`,
    });
  }

  if ((broker.quantity !== canonical.quantity) || (broker.filledQuantity !== (canonical.filledQuantity ?? 0))) {
    mismatches.push({
      type: "quantity_mismatch",
      entity: "order",
      accountId: canonical.accountId,
      identifier: canonicalLabel,
      details: `quantity ${broker.quantity}/${broker.filledQuantity} vs ${canonical.quantity}/${canonical.filledQuantity ?? 0}`,
    });
  }

  if ((broker.averagePrice != null && canonical.averageFillPrice != null && Math.abs((broker.averagePrice ?? 0) - (canonical.averageFillPrice ?? 0)) > 1e-8)
    || (broker.price != null && canonical.price != null && Math.abs((broker.price ?? 0) - (canonical.price ?? 0)) > 1e-8)) {
    mismatches.push({
      type: "price_mismatch",
      entity: "order",
      accountId: canonical.accountId,
      identifier: canonicalLabel,
      details: `price ${broker.averagePrice ?? broker.price} vs ${canonical.averageFillPrice ?? canonical.price}`,
    });
  }

  return mismatches;
}

function compareExecutionDifference(broker: NormalizedBrokerExecution, canonical: CanonicalExecutionLike): ReconciliationSummaryItem[] {
  const mismatches: ReconciliationSummaryItem[] = [];
  const identifier = broker.executionId || canonical.externalExecutionId || canonical.id;

  if (broker.externalExecutionId && canonical.externalExecutionId && broker.externalExecutionId !== canonical.externalExecutionId) {
    mismatches.push({ type: "identifier_mismatch", entity: "execution", accountId: canonical.accountId, identifier, details: `execution external identifiers differ` });
  }

  if (broker.quantity !== canonical.quantity) {
    mismatches.push({ type: "quantity_mismatch", entity: "execution", accountId: canonical.accountId, identifier, details: `quantity ${broker.quantity} vs ${canonical.quantity}` });
  }

  if (Math.abs(broker.price - canonical.executionPrice) > 1e-8) {
    mismatches.push({ type: "price_mismatch", entity: "execution", accountId: canonical.accountId, identifier, details: `execution price ${broker.price} vs ${canonical.executionPrice}` });
  }

  return mismatches;
}

function comparePositionDifference(broker: NormalizedBrokerPosition, canonical: CanonicalPositionLike): ReconciliationSummaryItem[] {
  const mismatches: ReconciliationSummaryItem[] = [];
  const identifier = broker.positionId || canonical.id;

  if (broker.status !== canonical.status) {
    mismatches.push({ type: "status_mismatch", entity: "position", accountId: canonical.accountId, identifier, details: `status ${broker.status} vs ${canonical.status}` });
  }

  if (broker.quantity !== canonical.quantity) {
    mismatches.push({ type: "quantity_mismatch", entity: "position", accountId: canonical.accountId, identifier, details: `quantity ${broker.quantity} vs ${canonical.quantity}` });
  }

  if ((broker.averagePrice != null && canonical.averagePrice != null && Math.abs((broker.averagePrice ?? 0) - (canonical.averagePrice ?? 0)) > 1e-8)
    || (broker.lastPrice != null && canonical.lastPrice != null && Math.abs((broker.lastPrice ?? 0) - (canonical.lastPrice ?? 0)) > 1e-8)) {
    mismatches.push({ type: "price_mismatch", entity: "position", accountId: canonical.accountId, identifier, details: `position average/last price mismatch` });
  }

  return mismatches;
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return String(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

export function classifyMismatch(input: string | ReconciliationSummaryItem | { type?: string | null } | null | undefined): MismatchClassification {
  const rawType = typeof input === "string"
    ? input
    : (input && typeof input === "object" && "type" in input && typeof input.type === "string")
      ? input.type
      : (input && typeof input === "object" && "mismatchType" in input && typeof input.mismatchType === "string")
        ? input.mismatchType
        : "UNRESOLVED";

  const normalized = rawType.trim().toLowerCase().replace(/[-\s]+/g, "_");
  const map: Record<string, MismatchClassification> = {
    match: "MATCH",
    matched: "MATCH",
    broker_only: "BROKER_ONLY",
    canonical_only: "CANONICAL_ONLY",
    canonicalonly: "CANONICAL_ONLY",
    status_mismatch: "STATUS_MISMATCH",
    order_status_mismatch: "STATUS_MISMATCH",
    position_status_mismatch: "STATUS_MISMATCH",
    quantity_mismatch: "QUANTITY_MISMATCH",
    order_quantity_mismatch: "QUANTITY_MISMATCH",
    price_mismatch: "PRICE_MISMATCH",
    average_price_mismatch: "PRICE_MISMATCH",
    fill_mismatch: "PRICE_MISMATCH",
    identifier_mismatch: "IDENTIFIER_MISMATCH",
    external_identifier_mismatch: "IDENTIFIER_MISMATCH",
    broker_identifier_mismatch: "IDENTIFIER_MISMATCH",
    unresolved: "UNRESOLVED",
    manual_review: "MANUAL_REVIEW",
  };

  return map[normalized] ?? "UNRESOLVED";
}

export function determineResolutionDecision(input: MismatchResolutionInput): Pick<MismatchResolutionResult, "classification" | "resolutionDecision" | "resolutionStatus" | "action" | "reason"> {
  const classification = classifyMismatch(input.mismatchType ?? "UNRESOLVED");
  const allowAuto = Boolean(input.allowAutoResolution);
  const support = (input.resolutionSupport ?? "").toLowerCase();
  const riskRejected = input.riskContext?.ruleEvaluation?.decision?.toUpperCase() === "REJECT";
  const brokerAccountIds = (() => {
    const state = input.brokerState as Record<string, unknown> | null | undefined;
    if (!state || typeof state !== "object") return [] as string[];
    const orderAccounts = Array.isArray((state as any).orders)
      ? (state as any).orders
          .filter((entry: unknown) => entry && typeof entry === "object" && "accountId" in entry && typeof (entry as any).accountId === "string")
          .map((entry: any) => entry.accountId)
      : [];
    const executionAccounts = Array.isArray((state as any).executions)
      ? (state as any).executions
          .filter((entry: unknown) => entry && typeof entry === "object" && "accountId" in entry && typeof (entry as any).accountId === "string")
          .map((entry: any) => entry.accountId)
      : [];
    const positionAccounts = Array.isArray((state as any).positions)
      ? (state as any).positions
          .filter((entry: unknown) => entry && typeof entry === "object" && "accountId" in entry && typeof (entry as any).accountId === "string")
          .map((entry: any) => entry.accountId)
      : [];
    return [...orderAccounts, ...executionAccounts, ...positionAccounts];
  })();
  const accountMismatch = !!(input.accountReference && brokerAccountIds.length > 0 && !brokerAccountIds.every((candidate) => candidate === input.accountReference))
    || !!(input.accountReference && input.riskContext?.accountId && input.accountReference !== input.riskContext.accountId);

  if (classification === "MATCH") {
    return {
      classification,
      resolutionDecision: "safe",
      resolutionStatus: "RESOLVED",
      action: "NO_ACTION",
      reason: "Canonical and broker state already match.",
    };
  }

  if (riskRejected || accountMismatch) {
    return {
      classification,
      resolutionDecision: "unsafe",
      resolutionStatus: "UNRESOLVED",
      action: "KEEP_CANONICAL_STATE",
      reason: riskRejected ? "Risk controls reject the proposed reconciliation change for this account." : "Account ownership mismatch prevents a safe resolution.",
    };
  }

  if (classification === "BROKER_ONLY") {
    if (allowAuto && (support.includes("safe") || support.includes("broker") || support.includes("canonical"))) {
      return { classification, resolutionDecision: "safe", resolutionStatus: "RESOLVED", action: "RECORD_BROKER_ONLY", reason: "Broker-only state is explicitly supported for audit-only reconciliation." };
    }
    return { classification, resolutionDecision: "unsafe", resolutionStatus: "UNRESOLVED", action: "KEEP_CANONICAL_STATE", reason: "Broker-only state was not explicitly approved for canonical overwrite; preserving authoritative state." };
  }

  if (classification === "CANONICAL_ONLY") {
    if (allowAuto && (support.includes("safe") || support.includes("canonical") || support.includes("broker"))) {
      return { classification, resolutionDecision: "safe", resolutionStatus: "RESOLVED", action: "RECORD_CANONICAL_ONLY", reason: "Canonical-only state is explicitly tracked and retained as authoritative." };
    }
    return { classification, resolutionDecision: "unsafe", resolutionStatus: "UNRESOLVED", action: "KEEP_CANONICAL_STATE", reason: "Canonical-only state requires manual review before any broker-side mutation." };
  }

  if (classification === "STATUS_MISMATCH" || classification === "QUANTITY_MISMATCH" || classification === "PRICE_MISMATCH" || classification === "IDENTIFIER_MISMATCH") {
    if (allowAuto && (support.includes("patch") || support.includes("update") || support.includes("safe"))) {
      return { classification, resolutionDecision: "safe", resolutionStatus: "RESOLVED", action: "APPLY_CANONICAL_PATCH", reason: "Discrepancy fits the supported canonical patch workflow and preserves authority checks." };
    }
    return { classification, resolutionDecision: "unsafe", resolutionStatus: "UNRESOLVED", action: "KEEP_CANONICAL_STATE", reason: "The mismatch is ambiguous or not explicitly supported for automatic canonical mutation." };
  }

  return {
    classification,
    resolutionDecision: "manual_review",
    resolutionStatus: "MANUAL_REVIEW",
    action: "REVIEW_MANUALLY",
    reason: "The mismatch type does not map to a supported automatic resolution path.",
  };
}

export function resolveMismatch(input: MismatchResolutionInput): MismatchResolutionResult {
  const mismatchType = input.mismatchType ?? "UNRESOLVED";
  const classification = classifyMismatch(mismatchType);
  const accountReference = input.accountReference ?? input.riskContext?.accountId ?? "unknown";
  const timestamp = new Date().toISOString();
  const idempotencyReference = stableStringify({
    mismatchReference: input.mismatchReference ?? "",
    mismatchType: classification,
    accountReference,
    previousCanonicalState: input.previousCanonicalState ?? null,
    brokerState: input.brokerState ?? null,
  });

  const decision = determineResolutionDecision(input);
  const updatedCanonicalState = input.previousCanonicalState ?? null;

  return {
    mismatchReference: input.mismatchReference ?? `mismatch:${classification}:${accountReference}:${timestamp}`,
    accountReference,
    classification,
    mismatchType: mismatchType,
    previousCanonicalState: input.previousCanonicalState ?? null,
    brokerState: input.brokerState ?? null,
    resolutionDecision: decision.resolutionDecision,
    resolutionStatus: decision.resolutionStatus,
    action: decision.action,
    reason: decision.reason,
    timestamp,
    idempotencyReference,
    updatedCanonicalState,
  };
}

export function resolveBrokerCanonicalMismatch(input: MismatchResolutionInput): MismatchResolutionResult {
  const result = resolveMismatch(input);
  return {
    ...result,
    updatedCanonicalState: input.previousCanonicalState ?? result.previousCanonicalState,
  };
}

export const resolveReconciliationMismatch = resolveBrokerCanonicalMismatch;
export const determineMismatchResolution = determineResolutionDecision;
export const classifyReconciliationMismatch = classifyMismatch;

export function reconcileBrokerCanonicalState({
  brokerState,
  canonicalState,
}: {
  brokerState: Partial<BrokerStateInput> | BrokerNormalizedState;
  canonicalState: Partial<CanonicalStateLike>;
}): ReconciliationResult {
  const normalizedBrokerState = isBrokerNormalizedState(brokerState)
    ? brokerState
    : normalizeBrokerState(brokerState);
  const normalizedCanonicalState = normalizeCanonicalState(canonicalState);

  const brokerOrders = new Map(normalizedBrokerState.orders.map((item) => [item.key, item]));
  const canonicalOrders = new Map(normalizedCanonicalState.orders.map((item) => {
    const key = stableOrderKey(item.accountId, item.symbol, item.brokerOrderId, item.clientOrderId, item.id);
    return [key, item] as const;
  }));

  const brokerExecutions = new Map(normalizedBrokerState.executions.map((item) => [item.key, item]));
  const canonicalExecutions = new Map(normalizedCanonicalState.executions.map((item) => {
    const key = stableExecutionKey(item.accountId, item.symbol, item.externalExecutionId, item.id, item.orderId);
    return [key, item] as const;
  }));

  const brokerPositions = new Map(normalizedBrokerState.positions.map((item) => [item.key, item]));
  const canonicalPositions = new Map(normalizedCanonicalState.positions.map((item) => {
    const key = stablePositionKey(item.accountId, item.symbol, item.id, `${item.symbol}|${item.accountId}|${item.quantity}`);
    return [key, item] as const;
  }));

  const matchedState = { orders: [] as Array<{ broker: NormalizedBrokerOrder; canonical: CanonicalOrderLike }>, executions: [] as Array<{ broker: NormalizedBrokerExecution; canonical: CanonicalExecutionLike }>, positions: [] as Array<{ broker: NormalizedBrokerPosition; canonical: CanonicalPositionLike }> };
  const brokerOnly = { orders: [] as NormalizedBrokerOrder[], executions: [] as NormalizedBrokerExecution[], positions: [] as NormalizedBrokerPosition[] };
  const canonicalOnly = { orders: [] as CanonicalOrderLike[], executions: [] as CanonicalExecutionLike[], positions: [] as CanonicalPositionLike[] };
  const mismatches: ReconciliationSummaryItem[] = [];

  const matchedOrderKeys = new Set<string>();
  const matchedExecutionKeys = new Set<string>();
  const matchedPositionKeys = new Set<string>();

  for (const brokerOrder of normalizedBrokerState.orders) {
    const canonicalMatch = canonicalOrders.get(brokerOrder.key);
    if (!canonicalMatch) {
      brokerOnly.orders.push(brokerOrder);
      continue;
    }
    matchedOrderKeys.add(brokerOrder.key);
    matchedState.orders.push({ broker: brokerOrder, canonical: canonicalMatch });
    const comparison = compareOrderDifference(brokerOrder, canonicalMatch);
    if (comparison.length > 0) {
      mismatches.push(...comparison);
    }
  }

  for (const canonicalOrder of normalizedCanonicalState.orders) {
    const orderKey = stableOrderKey(canonicalOrder.accountId, canonicalOrder.symbol, canonicalOrder.brokerOrderId, canonicalOrder.clientOrderId, canonicalOrder.id);
    if (!matchedOrderKeys.has(orderKey)) {
      canonicalOnly.orders.push(canonicalOrder);
    }
  }

  for (const brokerExecution of normalizedBrokerState.executions) {
    const canonicalMatch = canonicalExecutions.get(brokerExecution.key);
    if (!canonicalMatch) {
      brokerOnly.executions.push(brokerExecution);
      continue;
    }
    matchedExecutionKeys.add(brokerExecution.key);
    matchedState.executions.push({ broker: brokerExecution, canonical: canonicalMatch });
    const comparison = compareExecutionDifference(brokerExecution, canonicalMatch);
    if (comparison.length > 0) {
      mismatches.push(...comparison);
    }
  }

  for (const canonicalExecution of normalizedCanonicalState.executions) {
    const executionKey = stableExecutionKey(canonicalExecution.accountId, canonicalExecution.symbol, canonicalExecution.externalExecutionId, canonicalExecution.id, canonicalExecution.orderId);
    if (!matchedExecutionKeys.has(executionKey)) {
      canonicalOnly.executions.push(canonicalExecution);
    }
  }

  for (const brokerPosition of normalizedBrokerState.positions) {
    const canonicalMatch = canonicalPositions.get(brokerPosition.key);
    if (!canonicalMatch) {
      brokerOnly.positions.push(brokerPosition);
      continue;
    }
    matchedPositionKeys.add(brokerPosition.key);
    matchedState.positions.push({ broker: brokerPosition, canonical: canonicalMatch });
    const comparison = comparePositionDifference(brokerPosition, canonicalMatch);
    if (comparison.length > 0) {
      mismatches.push(...comparison);
    }
  }

  for (const canonicalPosition of normalizedCanonicalState.positions) {
    const positionKey = stablePositionKey(canonicalPosition.accountId, canonicalPosition.symbol, canonicalPosition.id, `${canonicalPosition.symbol}|${canonicalPosition.accountId}|${canonicalPosition.quantity}`);
    if (!matchedPositionKeys.has(positionKey)) {
      canonicalOnly.positions.push(canonicalPosition);
    }
  }

  const matchesAccountIsolation = true;

  return {
    matchedState: {
      orders: sortRecords(matchedState.orders, (item) => `${item.broker.accountId}|${item.broker.symbol}|${item.broker.key}`),
      executions: sortRecords(matchedState.executions, (item) => `${item.broker.accountId}|${item.broker.symbol}|${item.broker.key}`),
      positions: sortRecords(matchedState.positions, (item) => `${item.broker.accountId}|${item.broker.symbol}|${item.broker.key}`),
    },
    brokerOnly: {
      orders: sortRecords(brokerOnly.orders, (item) => `${item.accountId}|${item.symbol}|${item.key}`),
      executions: sortRecords(brokerOnly.executions, (item) => `${item.accountId}|${item.symbol}|${item.key}`),
      positions: sortRecords(brokerOnly.positions, (item) => `${item.accountId}|${item.symbol}|${item.key}`),
    },
    canonicalOnly: {
      orders: sortRecords(canonicalOnly.orders, (item) => `${item.accountId}|${item.symbol}|${item.id}`),
      executions: sortRecords(canonicalOnly.executions, (item) => `${item.accountId}|${item.symbol}|${item.id}`),
      positions: sortRecords(canonicalOnly.positions, (item) => `${item.accountId}|${item.symbol}|${item.id}`),
    },
    mismatches: sortRecords(mismatches, (item) => `${item.entity}|${item.accountId}|${item.identifier}|${item.type}`),
    matchesAccountIsolation,
  };
}
