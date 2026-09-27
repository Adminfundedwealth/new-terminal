import { normalizeExecution, type CanonicalExecution, type ExecutionInput } from "./executionModel";
import type { Position as EnginePosition } from "./positionEngine";

export type CanonicalPositionSide = "long" | "short";
export type CanonicalPositionStatus = "open" | "closed";

export interface CanonicalPositionRow {
  id: string;
  account_id: string;
  owner_user_id: string;
  instrument_id: string | null;
  symbol: string;
  exchange: string | null;
  quantity: number;
  side: CanonicalPositionSide;
  average_price: number;
  last_price: number | null;
  unrealized_pnl: number;
  realized_pnl: number;
  stop_loss: number | null;
  take_profit: number | null;
  position_status: CanonicalPositionStatus;
  opened_at: string | null;
  closed_at: string | null;
  updated_at: string;
}

export interface PositionPersistenceContext {
  accountId: string;
  ownerUserId: string;
  instrumentId?: string | null;
  exchange?: string | null;
}

export interface PositionPersistedResult {
  position: CanonicalPositionRow | null;
  replayed: boolean;
  created: boolean;
}

function round(value: number): number {
  return Number(value.toFixed(8));
}

function clampQuantity(value: number): number {
  return Number.isFinite(value) ? round(Math.max(0, value)) : value;
}

function normalizeSide(side: string): CanonicalPositionSide {
  const normalized = side.trim().toLowerCase();
  if (normalized === "long") return "long";
  if (normalized === "short") return "short";
  if (normalized === "buy") return "long";
  if (normalized === "sell") return "short";
  throw new Error("Position side must be long or short");
}

function normalizeStatus(status: string | null | undefined, quantity: number): CanonicalPositionStatus {
  const candidate = (status ?? (quantity > 0 ? "open" : "closed")).trim().toLowerCase();
  if (candidate === "open" || candidate === "closed") return candidate;
  throw new Error("Position status must be open or closed");
}

function normalizeText(value: string | null | undefined, label: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} is required`);
  return value.trim();
}

function normalizeNonNegative(value: number | null | undefined, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`${label} must be a finite non-negative number`);
  return round(value);
}

function normalizeFinite(value: number | null | undefined, label: string, allowNegative = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || (!allowNegative && value < 0) || (allowNegative && value === Infinity)) {
    throw new Error(`${label} must be a finite ${allowNegative ? "number" : "non-negative number"}`);
  }
  return round(value);
}

function normalizeRow(row: CanonicalPositionRow): CanonicalPositionRow {
  const quantity = normalizeNonNegative(row.quantity, "quantity");
  if (quantity < 0) throw new Error("quantity must be non-negative");
  if (row.side !== "long" && row.side !== "short") throw new Error("side must be long or short");
  if (row.position_status !== "open" && row.position_status !== "closed") throw new Error("position_status must be open or closed");
  if (typeof row.symbol !== "string" || row.symbol.trim() === "") throw new Error("symbol is required");
  if (typeof row.account_id !== "string" || row.account_id.trim() === "") throw new Error("account_id is required");
  if (typeof row.owner_user_id !== "string" || row.owner_user_id.trim() === "") throw new Error("owner_user_id is required");

  return {
    ...row,
    symbol: row.symbol.toUpperCase(),
    quantity,
    average_price: normalizeNonNegative(row.average_price, "average_price"),
    last_price: row.last_price == null ? null : normalizeNonNegative(row.last_price, "last_price"),
    unrealized_pnl: normalizeFinite(row.unrealized_pnl, "unrealized_pnl", true),
    realized_pnl: normalizeFinite(row.realized_pnl, "realized_pnl", true),
    stop_loss: row.stop_loss == null ? null : normalizeNonNegative(row.stop_loss, "stop_loss"),
    take_profit: row.take_profit == null ? null : normalizeNonNegative(row.take_profit, "take_profit"),
    position_status: normalizeStatus(row.position_status, quantity),
    updated_at: row.updated_at || new Date().toISOString(),
  };
}

export function toCanonicalPositionRow(position: Partial<CanonicalPositionRow> & Pick<CanonicalPositionRow, "account_id" | "owner_user_id" | "symbol" | "side" | "quantity" | "average_price" | "updated_at">): CanonicalPositionRow {
  const normalized = normalizeRow({
    id: position.id ?? `position:${position.account_id}:${position.symbol}`,
    account_id: position.account_id,
    owner_user_id: position.owner_user_id,
    instrument_id: position.instrument_id ?? null,
    symbol: position.symbol,
    exchange: position.exchange ?? null,
    quantity: position.quantity,
    side: position.side,
    average_price: position.average_price,
    last_price: position.last_price ?? null,
    unrealized_pnl: position.unrealized_pnl ?? 0,
    realized_pnl: position.realized_pnl ?? 0,
    stop_loss: position.stop_loss ?? null,
    take_profit: position.take_profit ?? null,
    position_status: position.position_status ?? (position.quantity > 0 ? "open" : "closed"),
    opened_at: position.opened_at ?? null,
    closed_at: position.closed_at ?? null,
    updated_at: position.updated_at,
  });
  return normalized;
}

export function fromEnginePosition(position: EnginePosition, ownerUserId: string, context: PositionPersistenceContext): CanonicalPositionRow {
  const normalized = toCanonicalPositionRow({
    id: position.id,
    account_id: position.accountId,
    owner_user_id: ownerUserId,
    instrument_id: context.instrumentId ?? null,
    symbol: position.symbol,
    exchange: context.exchange ?? null,
    quantity: position.quantity,
    side: normalizeSide(position.side),
    average_price: position.averageEntryPrice,
    last_price: position.currentPrice,
    unrealized_pnl: position.unrealizedPnl ?? 0,
    realized_pnl: position.realizedPnl,
    stop_loss: null,
    take_profit: null,
    position_status: position.quantity > 0 ? "open" : "closed",
    opened_at: position.openedAt,
    closed_at: position.quantity === 0 ? position.lastValuedAt ?? position.updatedAt : null,
    updated_at: position.updatedAt,
  });

  return normalized;
}

export class PositionPersistence {
  private readonly rows = new Map<string, CanonicalPositionRow>();
  private readonly executionIndex = new Map<string, string>();
  private readonly externalExecutionIndex = new Map<string, string>();
  private readonly executionPayloads = new Map<string, string>();
  private readonly locks = new Map<string, Promise<void>>();

  constructor(initialRows: CanonicalPositionRow[] = []) {
    for (const row of initialRows) {
      const normalized = normalizeRow(row);
      const key = positionKey(normalized.account_id, normalized.symbol);
      this.rows.set(key, normalized);
      if (normalized.id) this.executionIndex.set(`id:${normalized.id}`, key);
    }
  }

  getPosition(accountId: string, symbol: string): CanonicalPositionRow | null {
    const key = positionKey(accountId, symbol);
    const row = this.rows.get(key);
    return row ? { ...row } : null;
  }

  getPositions(): CanonicalPositionRow[] {
    return [...this.rows.values()].map((row) => ({ ...row }));
  }

  exportRows(): CanonicalPositionRow[] {
    return this.getPositions();
  }

  async upsertRow(row: CanonicalPositionRow, context: PositionPersistenceContext): Promise<CanonicalPositionRow> {
    const normalized = normalizeRow(row);
    if (normalized.account_id !== context.accountId) throw new Error("Position account does not match the authoritative account context");
    if (normalized.owner_user_id !== context.ownerUserId) throw new Error("Position owner does not match the authoritative account owner");
    if (normalized.position_status === "open" && normalized.quantity === 0) normalized.position_status = "closed";
    if (normalized.position_status === "closed" && normalized.quantity > 0) normalized.position_status = "open";
    if (normalized.quantity === 0 && normalized.closed_at == null) normalized.closed_at = new Date().toISOString();
    if (normalized.quantity > 0 && normalized.closed_at != null) normalized.closed_at = null;
    const key = positionKey(normalized.account_id, normalized.symbol);
    const saved: CanonicalPositionRow = { ...normalized };
    this.rows.set(key, saved);
    this.executionIndex.set(`id:${saved.id}`, key);
    return { ...saved };
  }

  private toCanonicalExecution(input: CanonicalExecution | ExecutionInput): CanonicalExecution {
    const execution = input as Partial<CanonicalExecution & ExecutionInput>;
    return normalizeExecution({
      id: execution.id,
      orderId: execution.orderId ?? "",
      accountId: execution.accountId ?? "",
      ownerUserId: execution.ownerUserId ?? "",
      authUserId: execution.authUserId ?? execution.ownerUserId ?? "",
      instrumentId: execution.instrumentId ?? null,
      symbol: execution.symbol ?? "",
      side: execution.side ?? "BUY",
      quantity: execution.quantity ?? 0,
      executionPrice: execution.executionPrice ?? 0,
      executedAt: execution.executedAt ?? new Date().toISOString(),
      externalExecutionId: execution.externalExecutionId ?? null,
      fees: execution.fees ?? 0,
      taxes: execution.taxes ?? 0,
      netAmount: execution.netAmount ?? null,
    } as ExecutionInput);
  }

  private sameExecution(left: CanonicalExecution, right: CanonicalExecution): boolean {
    const { id: leftId, ...leftPayload } = left;
    const { id: rightId, ...rightPayload } = right;
    return JSON.stringify(leftPayload) === JSON.stringify(rightPayload);
  }

  private executionPayloadKey(execution: CanonicalExecution): string {
    return JSON.stringify({
      accountId: execution.accountId,
      instrumentId: execution.instrumentId,
      symbol: execution.symbol,
      side: execution.side,
      quantity: Number(execution.quantity.toFixed(8)),
      executionPrice: Number(execution.executionPrice.toFixed(8)),
      executedAt: execution.executedAt,
      externalExecutionId: execution.externalExecutionId,
    });
  }

  private findReplayRow(execution: CanonicalExecution): CanonicalPositionRow | null {
    const internalKey = `id:${execution.id}`;
    const rowKey = this.executionIndex.get(internalKey);
    if (rowKey) {
      const row = this.rows.get(rowKey);
      if (row) return { ...row };
    }

    if (execution.externalExecutionId) {
      const externalKey = `ext:${execution.accountId}:${execution.externalExecutionId.toUpperCase()}`;
      const duplicateExecutionId = this.externalExecutionIndex.get(externalKey);
      if (duplicateExecutionId) {
        const previousPayload = this.executionPayloads.get(duplicateExecutionId);
        const nextPayload = this.executionPayloadKey(execution);
        if (previousPayload && previousPayload !== nextPayload) {
          return null;
        }
        const row = this.rows.get(this.executionIndex.get(externalKey) ?? "");
        if (row) return { ...row };
      }
    }
    return null;
  }

  private async withLock<T>(accountId: string, symbol: string, task: () => Promise<T>): Promise<T> {
    const key = `${accountId}:${symbol.toUpperCase()}`;
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.locks.set(key, previous.then(() => current));
    await previous;

    try {
      return await task();
    } finally {
      release();
      if (this.locks.get(key) === current) this.locks.delete(key);
    }
  }

  private reconcilePosition(base: CanonicalPositionRow | null, execution: CanonicalExecution, context: PositionPersistenceContext, executedAt: string): CanonicalPositionRow {
    const nextSymbol = execution.symbol.toUpperCase();
    const side = normalizeSide(execution.side);
    const current = base ? normalizeRow(base) : null;

    if (!current) {
      const row: CanonicalPositionRow = {
        id: `position:${execution.accountId}:${nextSymbol}`,
        account_id: execution.accountId,
        owner_user_id: execution.ownerUserId,
        instrument_id: context.instrumentId ?? execution.instrumentId ?? null,
        symbol: nextSymbol,
        exchange: context.exchange ?? null,
        quantity: clampQuantity(execution.quantity),
        side,
        average_price: round(execution.executionPrice),
        last_price: round(execution.executionPrice),
        unrealized_pnl: 0,
        realized_pnl: 0,
        stop_loss: null,
        take_profit: null,
        position_status: "open",
        opened_at: executedAt,
        closed_at: null,
        updated_at: executedAt,
      };
      return row;
    }

    const sameDirection = (current.side === "long" && side === "long") || (current.side === "short" && side === "short");
    if (sameDirection) {
      const totalQuantity = clampQuantity(current.quantity + execution.quantity);
      const weightedAverage = totalQuantity === 0
        ? current.average_price
        : round((current.quantity * current.average_price + execution.quantity * execution.executionPrice) / totalQuantity);
      return {
        ...current,
        quantity: totalQuantity,
        side: current.side,
        average_price: weightedAverage,
        last_price: round(execution.executionPrice),
        unrealized_pnl: 0,
        realized_pnl: current.realized_pnl,
        stop_loss: current.stop_loss,
        take_profit: current.take_profit,
        position_status: totalQuantity > 0 ? "open" : "closed",
        opened_at: current.opened_at ?? executedAt,
        closed_at: totalQuantity === 0 ? executedAt : null,
        updated_at: executedAt,
      };
    }

    const closeQuantity = Math.min(current.quantity, execution.quantity);
    const grossRealized = round((execution.executionPrice - current.average_price) * closeQuantity * (current.side === "long" ? 1 : -1));
    const remainingQuantity = clampQuantity(current.quantity - closeQuantity);
    const nextSide = side;
    const nextQuantity = clampQuantity(Math.max(0, execution.quantity - closeQuantity));

    if (remainingQuantity > 0) {
      return {
        ...current,
        quantity: remainingQuantity,
        side: current.side,
        average_price: current.average_price,
        last_price: round(execution.executionPrice),
        unrealized_pnl: 0,
        realized_pnl: round(current.realized_pnl + grossRealized),
        position_status: "open",
        opened_at: current.opened_at ?? executedAt,
        closed_at: null,
        updated_at: executedAt,
      };
    }

    if (nextQuantity > 0) {
      return {
        ...current,
        id: current.id,
        account_id: current.account_id,
        owner_user_id: current.owner_user_id,
        instrument_id: current.instrument_id,
        symbol: current.symbol,
        exchange: current.exchange,
        quantity: nextQuantity,
        side: nextSide,
        average_price: round(execution.executionPrice),
        last_price: round(execution.executionPrice),
        unrealized_pnl: 0,
        realized_pnl: round(current.realized_pnl + grossRealized),
        stop_loss: current.stop_loss,
        take_profit: current.take_profit,
        position_status: "open",
        opened_at: current.opened_at ?? executedAt,
        closed_at: null,
        updated_at: executedAt,
      };
    }

    return {
      ...current,
      quantity: 0,
      side: current.side,
      last_price: round(execution.executionPrice),
      unrealized_pnl: 0,
      realized_pnl: round(current.realized_pnl + grossRealized),
      position_status: "closed",
      closed_at: executedAt,
      updated_at: executedAt,
    };
  }

  async persistExecution(execution: CanonicalExecution | ExecutionInput, context: PositionPersistenceContext = { accountId: "", ownerUserId: "" }): Promise<PositionPersistedResult> {
    const normalized = this.toCanonicalExecution(execution);
    if (!context.accountId || !context.ownerUserId) {
      context = { accountId: normalized.accountId, ownerUserId: normalized.ownerUserId, instrumentId: normalized.instrumentId ?? context.instrumentId ?? null, exchange: context.exchange ?? null };
    }
    if (normalized.accountId !== context.accountId) throw new Error("Execution account does not match the authoritative account context");
    if (normalized.ownerUserId !== context.ownerUserId) throw new Error("Execution owner does not match the authoritative account owner");

    const symbol = normalized.symbol.toUpperCase();
    const replayedRow = this.findReplayRow(normalized);
    if (replayedRow) {
      return { position: replayedRow, replayed: true, created: false };
    }

    if (normalized.externalExecutionId) {
      const externalKey = `ext:${normalized.accountId}:${normalized.externalExecutionId.toUpperCase()}`;
      const existingExecutionId = this.externalExecutionIndex.get(externalKey);
      if (existingExecutionId && existingExecutionId !== `id:${normalized.id}`) {
        const previousPayload = this.executionPayloads.get(existingExecutionId);
        const nextPayload = this.executionPayloadKey(normalized);
        if (previousPayload && previousPayload !== nextPayload) {
          throw new Error(`Duplicate external execution ID for account ${normalized.accountId}: ${normalized.externalExecutionId}`);
        }
      }
    }

    return this.withLock(normalized.accountId, symbol, async () => {
      const current = this.getPosition(normalized.accountId, symbol);
      const next = this.reconcilePosition(current, normalized, { ...context, accountId: normalized.accountId, ownerUserId: normalized.ownerUserId, instrumentId: normalized.instrumentId ?? context.instrumentId ?? null, exchange: context.exchange ?? null }, normalized.executedAt);
      const saved = await this.upsertRow(next, { accountId: normalized.accountId, ownerUserId: normalized.ownerUserId, instrumentId: normalized.instrumentId ?? context.instrumentId ?? null, exchange: context.exchange ?? null });
      this.executionIndex.set(`id:${normalized.id}`, positionKey(normalized.accountId, normalized.symbol));
      this.executionPayloads.set(`id:${normalized.id}`, this.executionPayloadKey(normalized));
      if (normalized.externalExecutionId) {
        const externalKey = `ext:${normalized.accountId}:${normalized.externalExecutionId.toUpperCase()}`;
        this.executionIndex.set(externalKey, positionKey(normalized.accountId, normalized.symbol));
        this.externalExecutionIndex.set(externalKey, `id:${normalized.id}`);
        this.executionPayloads.set(`ext:${normalized.accountId}:${normalized.externalExecutionId.toUpperCase()}`, this.executionPayloadKey(normalized));
      }
      return { position: saved, replayed: false, created: current == null };
    });
  }
}

export function positionKey(accountId: string, symbol: string): string {
  return `${accountId}:${symbol.toUpperCase()}`;
}
