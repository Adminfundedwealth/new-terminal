import { calculateRealizedPnl } from "./realizedPnl";

export type PositionSide = "LONG" | "SHORT";
export type ExecutionSide = "BUY" | "SELL";
export type ValuationStatus = "VALUED" | "UNAVAILABLE" | "STALE";

const PRECISION = 8;

function round(value: number): number {
  return Number(value.toFixed(PRECISION));
}

function assertPositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a finite positive number`);
}

function assertNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a finite non-negative number`);
}

function normalizeExternalExecutionId(value?: string | null): string | null {
  if (value == null) return null;
  const normalized = value.trim().toUpperCase();
  return normalized === "" ? null : normalized;
}

export interface Position {
  id: string;
  accountId: string;
  instrumentKey: string;
  symbol: string;
  side: PositionSide;
  quantity: number;
  averageEntryPrice: number;
  currentPrice: number | null;
  realizedPnl: number;
  unrealizedPnl: number | null;
  fees: number;
  totalPnl: number | null;
  exposure: number | null;
  valuationStatus: ValuationStatus;
  lastValuedAt: string | null;
  openedAt: string;
  updatedAt: string;
}

export interface PositionExecution {
  id: string;
  accountId: string;
  symbol: string;
  instrumentKey?: string;
  instrumentId?: string | null;
  side: ExecutionSide;
  quantity: number;
  price: number;
  fees?: number;
  executedAt?: string;
  externalExecutionId?: string | null;
  ownerUserId?: string;
}

export type CanonicalPositionExecution = Omit<PositionExecution, "price"> & {
  executionPrice?: number;
  price?: number;
  orderId?: string;
};

export interface MarketPrice {
  instrumentKey?: string;
  symbol: string;
  price: number | null;
  asOf?: string;
  staleAfterMs?: number;
  preserveUpdatedAt?: boolean;
}

export interface AccountValuation {
  accountId: string;
  balance: number;
  equity: number | null;
  realizedPnl: number;
  unrealizedPnl: number | null;
  fees: number;
  exposure: number | null;
  openPositionCount: number;
  marketDataStatus: ValuationStatus;
}

export interface RiskPositionSnapshot {
  symbol: string;
  quantity: number;
  side: PositionSide;
  exposure: number | null;
  realizedPnl: number;
  unrealizedPnl: number | null;
  isOpen: boolean;
}

export interface PositionEngineOptions {
  now?: () => Date;
  staleAfterMs?: number;
}

export class PositionEngine {
  private readonly positions = new Map<string, Position>();
  private readonly executionIds = new Set<string>();
  private readonly externalExecutionIds = new Map<string, string>();
  private readonly executionPayloads = new Map<string, string>();
  private readonly now: () => Date;
  private readonly staleAfterMs: number;
  private accountRealizedPnl = 0;
  private accountFees = 0;

  constructor(private readonly accountId: string, options: PositionEngineOptions = {}) {
    if (!accountId) throw new Error("accountId is required");
    this.now = options.now ?? (() => new Date());
    this.staleAfterMs = options.staleAfterMs ?? 30_000;
  }

  private normalizeExecution(execution: PositionExecution | CanonicalPositionExecution): Required<Pick<PositionExecution, "id" | "accountId" | "symbol" | "instrumentKey" | "side" | "quantity" | "price" | "fees" | "executedAt" | "externalExecutionId">> & { ownerUserId?: string; instrumentId?: string | null } {
    const executionPrice = "executionPrice" in execution ? execution.executionPrice ?? execution.price : execution.price;
    const normalized = {
      id: String(execution.id),
      accountId: String(execution.accountId),
      symbol: String(execution.symbol),
      instrumentKey: String(execution.instrumentKey ?? execution.instrumentId ?? execution.symbol),
      instrumentId: execution.instrumentId ?? null,
      side: (execution.side ?? "BUY") as ExecutionSide,
      quantity: Number(execution.quantity),
      price: Number(executionPrice),
      fees: Number(execution.fees ?? 0),
      executedAt: execution.executedAt ?? this.now().toISOString(),
      externalExecutionId: normalizeExternalExecutionId(execution.externalExecutionId ?? null),
      ownerUserId: execution.ownerUserId,
    };
    if (normalized.side !== "BUY" && normalized.side !== "SELL") throw new Error("Execution side must be BUY or SELL");
    assertPositive(normalized.quantity, "Execution quantity");
    assertPositive(normalized.price, "Execution price");
    assertNonNegative(normalized.fees, "Execution fees");
    return normalized;
  }

  private executionPayloadKey(execution: { accountId: string; instrumentKey: string; side: ExecutionSide; quantity: number; price: number; executedAt: string; externalExecutionId?: string | null }): string {
    return JSON.stringify({
      accountId: execution.accountId,
      instrumentKey: execution.instrumentKey,
      side: execution.side,
      quantity: Number(execution.quantity.toFixed(8)),
      price: Number(execution.price.toFixed(8)),
      executedAt: execution.executedAt,
      externalExecutionId: normalizeExternalExecutionId(execution.externalExecutionId ?? null),
    });
  }

  private getDuplicateExecutionState(execution: ReturnType<typeof this.normalizeExecution>): { replayed: boolean; positionKey: string } | null {
    if (this.executionIds.has(execution.id)) {
      const previousPayload = this.executionPayloads.get(execution.id);
      if (previousPayload && previousPayload !== this.executionPayloadKey(execution)) {
        throw new Error("Duplicate execution ID conflicts with an existing execution");
      }
      return { replayed: true, positionKey: execution.instrumentKey };
    }

    const externalKey = execution.externalExecutionId ? `${execution.accountId}:${execution.externalExecutionId}` : null;
    if (externalKey) {
      const existingId = this.externalExecutionIds.get(externalKey);
      if (existingId) {
        const previousPayload = this.executionPayloads.get(existingId);
        const nextPayload = this.executionPayloadKey(execution);
        if (previousPayload && previousPayload !== nextPayload) {
          throw new Error("Duplicate external execution ID conflicts with an existing execution");
        }
        return { replayed: true, positionKey: execution.instrumentKey };
      }
    }
    return null;
  }

  applyCanonicalExecution(execution: CanonicalPositionExecution): Position | null {
    return this.applyExecution(execution as PositionExecution);
  }

  applyExecution(execution: PositionExecution | CanonicalPositionExecution): Position | null {
    const normalized = this.normalizeExecution(execution);
    if (normalized.accountId !== this.accountId) throw new Error("Execution belongs to a different account");

    const duplicateState = this.getDuplicateExecutionState(normalized);
    if (duplicateState) return this.getPosition(duplicateState.positionKey);

    const key = normalized.instrumentKey;
    const current = this.positions.get(key);
    const timestamp = normalized.executedAt;
    const executionFees = round(normalized.fees);
    this.accountFees = round(this.accountFees + executionFees);

    this.executionIds.add(normalized.id);
    this.executionPayloads.set(normalized.id, this.executionPayloadKey(normalized));
    if (normalized.externalExecutionId) {
      const externalKey = `${normalized.accountId}:${normalized.externalExecutionId}`;
      const previousId = this.externalExecutionIds.get(externalKey);
      if (previousId && previousId !== normalized.id) {
        const previousPayload = this.executionPayloads.get(previousId);
        const nextPayload = this.executionPayloadKey(normalized);
        if (previousPayload && previousPayload !== nextPayload) {
          throw new Error("Duplicate external execution ID conflicts with an existing execution");
        }
      }
      this.externalExecutionIds.set(externalKey, normalized.id);
    }

    if (!current) {
      const position: Position = {
        id: `position:${this.accountId}:${key}`,
        accountId: this.accountId,
        instrumentKey: key,
        symbol: normalized.symbol,
        side: normalized.side === "BUY" ? "LONG" : "SHORT",
        quantity: round(normalized.quantity),
        averageEntryPrice: round(normalized.price),
        currentPrice: round(normalized.price),
        realizedPnl: 0,
        unrealizedPnl: 0,
        fees: executionFees,
        totalPnl: round(-executionFees),
        exposure: round(normalized.quantity * normalized.price),
        valuationStatus: "VALUED",
        lastValuedAt: timestamp,
        openedAt: timestamp,
        updatedAt: timestamp,
      };
      this.positions.set(key, position);
      return { ...position };
    }

    const sameDirection = (current.side === "LONG" && normalized.side === "BUY") || (current.side === "SHORT" && normalized.side === "SELL");
    if (sameDirection) {
      const totalQuantity = current.quantity + normalized.quantity;
      current.averageEntryPrice = round((current.quantity * current.averageEntryPrice + normalized.quantity * normalized.price) / totalQuantity);
      current.quantity = round(totalQuantity);
    } else {
      const closeQuantity = Math.min(current.quantity, normalized.quantity);
      const grossRealized = calculateRealizedPnl({
        positionSide: current.side,
        entryPrice: current.averageEntryPrice,
        exitPrice: normalized.price,
        closedQuantity: closeQuantity,
      });
      current.realizedPnl = round(current.realizedPnl + grossRealized);
      this.accountRealizedPnl = round(this.accountRealizedPnl + grossRealized);
      current.quantity = round(current.quantity - closeQuantity);
      if (current.quantity === 0) this.positions.delete(key);
      if (normalized.quantity > closeQuantity) {
        const reversal: Position = {
          ...current,
          side: normalized.side === "BUY" ? "LONG" : "SHORT",
          quantity: round(normalized.quantity - closeQuantity),
          averageEntryPrice: round(normalized.price),
          currentPrice: round(normalized.price),
          unrealizedPnl: 0,
          exposure: round((normalized.quantity - closeQuantity) * normalized.price),
          valuationStatus: "VALUED",
          lastValuedAt: timestamp,
          updatedAt: timestamp,
        };
        this.positions.set(key, reversal);
      }
    }

    const result = this.positions.get(key);
    if (result) {
      result.fees = round(result.fees + executionFees);
      result.totalPnl = result.unrealizedPnl == null ? null : round(result.realizedPnl + result.unrealizedPnl - result.fees);
      result.updatedAt = timestamp;
    }
    return result ? { ...result } : null;
  }

  valueMarketPrice(input: MarketPrice): Position | null {
    const key = input.instrumentKey ?? input.symbol;
    const position = this.positions.get(key);
    if (!position) return null;
    if (input.price == null || !Number.isFinite(input.price) || input.price <= 0) {
      position.currentPrice = null;
      position.unrealizedPnl = null;
      position.totalPnl = null;
      position.exposure = null;
      position.valuationStatus = "UNAVAILABLE";
      position.lastValuedAt = null;
      return { ...position };
    }
    const asOf = input.asOf ? new Date(input.asOf) : this.now();
    const staleAfterMs = input.staleAfterMs ?? this.staleAfterMs;
    if (!Number.isFinite(asOf.getTime()) || this.now().getTime() - asOf.getTime() > staleAfterMs) {
      position.valuationStatus = "STALE";
      position.unrealizedPnl = null;
      position.totalPnl = null;
      position.exposure = null;
      return { ...position };
    }
    position.currentPrice = round(input.price);
    position.unrealizedPnl = round((input.price - position.averageEntryPrice) * position.quantity * (position.side === "LONG" ? 1 : -1));
    position.totalPnl = round(position.realizedPnl + position.unrealizedPnl - position.fees);
    position.exposure = round(position.quantity * input.price);
    position.valuationStatus = "VALUED";
    position.lastValuedAt = asOf.toISOString();
    position.updatedAt = input.preserveUpdatedAt ? asOf.toISOString() : this.now().toISOString();
    return { ...position };
  }

  getPosition(instrumentKey: string): Position | null {
    const position = this.positions.get(instrumentKey);
    return position ? { ...position } : null;
  }

  getPositions(): Position[] { return [...this.positions.values()].map((position) => ({ ...position })); }

  reset(): void {
    this.positions.clear();
    this.executionIds.clear();
    this.externalExecutionIds.clear();
    this.executionPayloads.clear();
    this.accountRealizedPnl = 0;
    this.accountFees = 0;
  }

  accountValuation(balance: number): AccountValuation {
    assertNonNegative(balance, "Account balance");
    const positions = this.getPositions();
    const unrealized = positions.every((position) => position.unrealizedPnl != null) ? round(positions.reduce((sum, position) => sum + (position.unrealizedPnl ?? 0), 0)) : null;
    const realized = this.accountRealizedPnl;
    const fees = this.accountFees;
    const exposure = positions.every((position) => position.exposure != null) ? round(positions.reduce((sum, position) => sum + (position.exposure ?? 0), 0)) : null;
    return { accountId: this.accountId, balance, equity: unrealized == null ? null : round(balance + unrealized), realizedPnl: realized, unrealizedPnl: unrealized, fees, exposure, openPositionCount: positions.length, marketDataStatus: positions.some((position) => position.valuationStatus === "STALE") ? "STALE" : positions.some((position) => position.valuationStatus === "UNAVAILABLE") ? "UNAVAILABLE" : "VALUED" };
  }

  riskSnapshot(): RiskPositionSnapshot[] {
    return this.getPositions().map((position) => ({ symbol: position.symbol, quantity: position.quantity, side: position.side, exposure: position.exposure, realizedPnl: position.realizedPnl, unrealizedPnl: position.unrealizedPnl, isOpen: position.quantity > 0 }));
  }
}