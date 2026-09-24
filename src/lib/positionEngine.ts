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
  side: ExecutionSide;
  quantity: number;
  price: number;
  fees?: number;
  executedAt?: string;
}

export interface MarketPrice {
  instrumentKey?: string;
  symbol: string;
  price: number | null;
  asOf?: string;
  staleAfterMs?: number;
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
  private readonly now: () => Date;
  private readonly staleAfterMs: number;
  private accountRealizedPnl = 0;
  private accountFees = 0;

  constructor(private readonly accountId: string, options: PositionEngineOptions = {}) {
    if (!accountId) throw new Error("accountId is required");
    this.now = options.now ?? (() => new Date());
    this.staleAfterMs = options.staleAfterMs ?? 30_000;
  }

  applyExecution(execution: PositionExecution): Position | null {
    if (execution.accountId !== this.accountId) throw new Error("Execution belongs to a different account");
    if (this.executionIds.has(execution.id)) return this.getPosition(execution.instrumentKey ?? execution.symbol);
    if (execution.side !== "BUY" && execution.side !== "SELL") throw new Error("Execution side must be BUY or SELL");
    assertPositive(execution.quantity, "Execution quantity");
    assertPositive(execution.price, "Execution price");
    assertNonNegative(execution.fees ?? 0, "Execution fees");

    const key = execution.instrumentKey ?? execution.symbol;
    const current = this.positions.get(key);
    const timestamp = execution.executedAt ?? this.now().toISOString();
    const executionFees = round(execution.fees ?? 0);
    this.accountFees = round(this.accountFees + executionFees);

    if (!current) {
      const position: Position = {
        id: `position:${this.accountId}:${key}`,
        accountId: this.accountId,
        instrumentKey: key,
        symbol: execution.symbol,
        side: execution.side === "BUY" ? "LONG" : "SHORT",
        quantity: round(execution.quantity),
        averageEntryPrice: round(execution.price),
        currentPrice: round(execution.price),
        realizedPnl: 0,
        unrealizedPnl: 0,
        fees: executionFees,
        totalPnl: round(-executionFees),
        exposure: round(execution.quantity * execution.price),
        valuationStatus: "VALUED",
        lastValuedAt: timestamp,
        openedAt: timestamp,
        updatedAt: timestamp,
      };
      this.positions.set(key, position);
      this.executionIds.add(execution.id);
      return { ...position };
    }

    const sameDirection = (current.side === "LONG" && execution.side === "BUY") || (current.side === "SHORT" && execution.side === "SELL");
    if (sameDirection) {
      const totalQuantity = current.quantity + execution.quantity;
      current.averageEntryPrice = round((current.quantity * current.averageEntryPrice + execution.quantity * execution.price) / totalQuantity);
      current.quantity = round(totalQuantity);
    } else {
      const closeQuantity = Math.min(current.quantity, execution.quantity);
      const grossRealized = (execution.price - current.averageEntryPrice) * closeQuantity * (current.side === "LONG" ? 1 : -1);
      current.realizedPnl = round(current.realizedPnl + grossRealized);
      this.accountRealizedPnl = round(this.accountRealizedPnl + grossRealized);
      current.quantity = round(current.quantity - closeQuantity);
      if (current.quantity === 0) this.positions.delete(key);
      if (execution.quantity > closeQuantity) {
        const reversal: Position = {
          ...current,
          side: execution.side === "BUY" ? "LONG" : "SHORT",
          quantity: round(execution.quantity - closeQuantity),
          averageEntryPrice: round(execution.price),
          currentPrice: round(execution.price),
          unrealizedPnl: 0,
          exposure: round((execution.quantity - closeQuantity) * execution.price),
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
    this.executionIds.add(execution.id);
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
    position.updatedAt = this.now().toISOString();
    return { ...position };
  }

  getPosition(instrumentKey: string): Position | null {
    const position = this.positions.get(instrumentKey);
    return position ? { ...position } : null;
  }

  getPositions(): Position[] { return [...this.positions.values()].map((position) => ({ ...position })); }

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