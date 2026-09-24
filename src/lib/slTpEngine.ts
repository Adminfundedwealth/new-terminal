export type ProtectionType = "STOP_LOSS" | "TAKE_PROFIT";
export type ProtectionSide = "LONG" | "SHORT";
export type SlTpDecision = "ALLOW" | "REJECT";
export type SlTpStatus = "ACTIVE" | "INACTIVE" | "TRIGGERED";
export type SlTpReasonCode =
  | "INVALID_STOP_PRICE"
  | "INVALID_TARGET_PRICE"
  | "NO_POSITION"
  | "INVALID_QUANTITY"
  | "ACCOUNT_LOCKED"
  | "ACCOUNT_BREACHED"
  | "UNAUTHORIZED_POSITION"
  | "INVALID_SIDE"
  | "INVALID_PRICE"
  | "MARKET_DATA_UNAVAILABLE"
  | "ACCOUNT_NOT_ACTIVE"
  | "TRADING_PERMISSION_DISABLED"
  | "INVALID_PROTECTION";

export interface SlTpAccountContext {
  accountId: string;
  ownerUserId: string;
  status: "ACTIVE" | "WARNING" | "LOCKED" | "BREACHED";
  tradingPermission: boolean;
}

export interface PositionSnapshot {
  accountId: string;
  ownerUserId: string;
  symbol: string;
  side: ProtectionSide;
  quantity: number;
  price: number;
  currentPrice: number;
}

export interface ProtectionRequest {
  accountId: string;
  ownerUserId: string;
  symbol: string;
  side: ProtectionSide;
  type: ProtectionType;
  quantity: number;
  price: number;
}

export interface ProtectionRecord {
  id: string;
  accountId: string;
  ownerUserId: string;
  symbol: string;
  side: ProtectionSide;
  type: ProtectionType;
  quantity: number;
  price: number;
  createdAt: string;
  updatedAt: string;
  status: SlTpStatus;
  triggeredAt?: string | null;
}

export interface ProtectionDecision {
  decision: SlTpDecision;
  reasonCode: SlTpReasonCode | null;
  reason: string;
  protection: ProtectionRecord | null;
  timestamp: string;
}

export interface MarketPriceInput {
  symbol: string;
  price: number | null;
  asOf?: string;
  staleAfterMs?: number;
}

export interface MarketPriceEvaluation {
  status: "SAFE" | "SAFE_REJECT" | "STALE" | "INVALID";
  reasonCode: SlTpReasonCode | null;
  triggerCount: number;
  triggered: ProtectionRecord[];
  timestamp: string;
}

export interface ReconciliationInput {
  accountId: string;
  symbol: string;
  orderState: { id: string; status: string; qty: number };
  executionState: { executions: Array<{ id: string; orderId: string; qty: number; price: number }> };
  positionState: { qty: number; avgPrice: number; realizedPnl: number; unrealizedPnl: number; stale: boolean };
  pnlState: { realizedPnl: number; unrealizedPnl: number };
  protectionState: { activeProtections: number };
}

export interface ReconciliationResult {
  accountId: string;
  symbol: string;
  status: "RECONCILED" | "MISMATCH";
  discrepancyType: string | null;
  severity: "LOW" | "MEDIUM" | "HIGH";
  expectedState: string;
  actualState: string;
  timestamp: string;
}

export class SlTpEngine {
  private readonly account: SlTpAccountContext;
  private readonly protections = new Map<string, ProtectionRecord>();
  private readonly now: () => Date;
  private position: PositionSnapshot | null = null;

  constructor(account: SlTpAccountContext, now: (() => Date) = () => new Date()) {
    this.account = { ...account };
    this.now = now;
  }

  setPosition(position: PositionSnapshot): void {
    this.position = { ...position };
  }

  getProtection(id: string): ProtectionRecord | null {
    const protection = this.protections.get(id);
    return protection ? { ...protection } : null;
  }

  createProtection(request: ProtectionRequest): ProtectionDecision {
    const timestamp = this.now().toISOString();
    if (this.account.status === "LOCKED") {
      return this.reject(request, "ACCOUNT_LOCKED", "Account is locked", timestamp);
    }
    if (this.account.status === "BREACHED") {
      return this.reject(request, "ACCOUNT_BREACHED", "Account has breached a configured rule", timestamp);
    }
    if (!this.account.tradingPermission) {
      return this.reject(request, "TRADING_PERMISSION_DISABLED", "Trading permission is disabled", timestamp);
    }
    if (!this.position) {
      return this.reject(request, "NO_POSITION", "No position is available for protection", timestamp);
    }
    if (this.position.accountId !== request.accountId || this.position.ownerUserId !== request.ownerUserId) {
      return this.reject(request, "UNAUTHORIZED_POSITION", "Position does not belong to the requesting account owner", timestamp);
    }
    if (request.symbol !== this.position.symbol) {
      return this.reject(request, "NO_POSITION", "Protection symbol does not match the open position", timestamp);
    }
    if (this.position.side !== request.side) {
      return this.reject(request, "INVALID_SIDE", "Protection side does not match the current position side", timestamp);
    }
    if (!Number.isFinite(request.quantity) || request.quantity <= 0) {
      return this.reject(request, "INVALID_QUANTITY", "Protection quantity must be greater than zero", timestamp);
    }
    if (request.quantity > this.position.quantity) {
      return this.reject(request, "INVALID_QUANTITY", "Protection quantity exceeds the open position quantity", timestamp);
    }
    if (!Number.isFinite(request.price) || request.price <= 0) {
      return this.reject(request, "INVALID_PRICE", "Protection price must be a valid positive number", timestamp);
    }
    if (request.type === "STOP_LOSS" && request.side === "LONG" && request.price >= this.position.price) {
      return this.reject(request, "INVALID_STOP_PRICE", "Long stop loss must be below the entry price", timestamp);
    }
    if (request.type === "STOP_LOSS" && request.side === "SHORT" && request.price <= this.position.price) {
      return this.reject(request, "INVALID_STOP_PRICE", "Short stop loss must be above the entry price", timestamp);
    }
    if (request.type === "TAKE_PROFIT" && request.side === "LONG" && request.price <= this.position.price) {
      return this.reject(request, "INVALID_TARGET_PRICE", "Long take profit must be above the entry price", timestamp);
    }
    if (request.type === "TAKE_PROFIT" && request.side === "SHORT" && request.price >= this.position.price) {
      return this.reject(request, "INVALID_TARGET_PRICE", "Short take profit must be below the entry price", timestamp);
    }

    const protection: ProtectionRecord = {
      id: `sltp:${request.accountId}:${request.symbol}:${request.type}:${Date.now()}`,
      accountId: request.accountId,
      ownerUserId: request.ownerUserId,
      symbol: request.symbol,
      side: request.side,
      type: request.type,
      quantity: request.quantity,
      price: request.price,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: "ACTIVE",
      triggeredAt: null,
    };
    this.protections.set(protection.id, protection);
    return { decision: "ALLOW", reasonCode: null, reason: `${request.type} protection created successfully`, protection, timestamp };
  }

  modifyProtection(id: string, patch: Partial<Pick<ProtectionRecord, "price" | "quantity">>): { decision: SlTpDecision; reasonCode: SlTpReasonCode | null; reason: string; protection: ProtectionRecord | null; timestamp: string } {
    const protection = this.protections.get(id);
    if (!protection) {
      return { decision: "REJECT", reasonCode: "INVALID_PROTECTION", reason: "Protection does not exist", protection: null, timestamp: this.now().toISOString() };
    }
    if (this.account.status === "LOCKED") return { decision: "REJECT", reasonCode: "ACCOUNT_LOCKED", reason: "Account is locked", protection: null, timestamp: this.now().toISOString() };
    if (this.account.status === "BREACHED") return { decision: "REJECT", reasonCode: "ACCOUNT_BREACHED", reason: "Account has breached a configured rule", protection: null, timestamp: this.now().toISOString() };
    if (patch.quantity != null && (!Number.isFinite(patch.quantity) || patch.quantity <= 0)) {
      return { decision: "REJECT", reasonCode: "INVALID_QUANTITY", reason: "Protection quantity must be greater than zero", protection: null, timestamp: this.now().toISOString() };
    }
    if (patch.price != null && (!Number.isFinite(patch.price) || patch.price <= 0)) {
      return { decision: "REJECT", reasonCode: protection.type === "STOP_LOSS" ? "INVALID_STOP_PRICE" : "INVALID_TARGET_PRICE", reason: "Protection price must be a valid positive number", protection: null, timestamp: this.now().toISOString() };
    }
    const updated = { ...protection, ...patch, updatedAt: this.now().toISOString() };
    this.protections.set(id, updated);
    return { decision: "ALLOW", reasonCode: null, reason: "Protection updated successfully", protection: updated, timestamp: this.now().toISOString() };
  }

  removeProtection(id: string): { removed: boolean; reason: string; timestamp: string } {
    const protection = this.protections.get(id);
    if (!protection) {
      return { removed: false, reason: "Protection does not exist", timestamp: this.now().toISOString() };
    }
    const updated = { ...protection, status: "INACTIVE" as const, updatedAt: this.now().toISOString() };
    this.protections.set(id, updated);
    return { removed: true, reason: "Protection removed", timestamp: this.now().toISOString() };
  }

  evaluateMarketPrice(input: MarketPriceInput): MarketPriceEvaluation {
    const timestamp = this.now().toISOString();
    if (input.price == null || !Number.isFinite(input.price) || input.price <= 0) {
      return { status: "SAFE_REJECT", reasonCode: "MARKET_DATA_UNAVAILABLE", triggerCount: 0, triggered: [], timestamp };
    }

    const triggered: ProtectionRecord[] = [];
    for (const protection of this.protections.values()) {
      if (protection.status !== "ACTIVE") continue;
      if (protection.symbol !== input.symbol) continue;
      if (protection.side === "LONG") {
        if (protection.type === "STOP_LOSS" && input.price <= protection.price) {
          triggered.push({ ...protection, status: "TRIGGERED", triggeredAt: timestamp, updatedAt: timestamp });
        }
        if (protection.type === "TAKE_PROFIT" && input.price >= protection.price) {
          triggered.push({ ...protection, status: "TRIGGERED", triggeredAt: timestamp, updatedAt: timestamp });
        }
      } else {
        if (protection.type === "STOP_LOSS" && input.price >= protection.price) {
          triggered.push({ ...protection, status: "TRIGGERED", triggeredAt: timestamp, updatedAt: timestamp });
        }
        if (protection.type === "TAKE_PROFIT" && input.price <= protection.price) {
          triggered.push({ ...protection, status: "TRIGGERED", triggeredAt: timestamp, updatedAt: timestamp });
        }
      }
    }

    for (const protection of triggered) {
      const clone = this.protections.get(protection.id);
      if (clone) {
        this.protections.set(protection.id, { ...clone, status: "TRIGGERED", triggeredAt: timestamp, updatedAt: timestamp });
      }
    }

    return { status: "SAFE", reasonCode: null, triggerCount: triggered.length, triggered, timestamp };
  }

  applyPositionAdjustment(symbol: string, quantity: number, side: ProtectionSide): void {
    if (!this.position || this.position.symbol !== symbol) return;
    const remainingPosition = Math.max(0, this.position.quantity - quantity);
    this.position.quantity = remainingPosition;

    if (side !== this.position.side) {
      for (const protection of this.protections.values()) {
        if (protection.symbol === symbol && protection.status === "ACTIVE") {
          protection.status = "INACTIVE";
          protection.updatedAt = this.now().toISOString();
        }
      }
      return;
    }

    for (const protection of this.protections.values()) {
      if (protection.symbol === symbol && protection.status === "ACTIVE" && protection.quantity > 0) {
        protection.quantity = Math.min(protection.quantity, remainingPosition);
        if (protection.quantity === 0) {
          protection.status = "INACTIVE";
        }
        protection.updatedAt = this.now().toISOString();
      }
    }
  }

  private reject(request: Partial<ProtectionRequest>, code: SlTpReasonCode, message: string, timestamp: string): ProtectionDecision {
    return {
      decision: "REJECT",
      reasonCode: code,
      reason: message,
      protection: null,
      timestamp,
    };
  }
}

export class ReconciliationEngine {
  private readonly now: () => Date;

  constructor(now: (() => Date) = () => new Date()) {
    this.now = now;
  }

  reconcile(input: ReconciliationInput): ReconciliationResult {
    const now = this.now().toISOString();
    const orderQty = input.orderState.qty;
    const executionQty = input.executionState.executions.reduce((sum, execution) => sum + execution.qty, 0);
    const executionIds = new Set(input.executionState.executions.map((execution) => execution.id));

    if (input.positionState.stale) {
      return { accountId: input.accountId, symbol: input.symbol, status: "MISMATCH", discrepancyType: "STALE_POSITION", severity: "HIGH", expectedState: `position fresh for ${input.symbol}`, actualState: "stale position state", timestamp: now };
    }
    if (executionIds.size !== input.executionState.executions.length) {
      return { accountId: input.accountId, symbol: input.symbol, status: "MISMATCH", discrepancyType: "DUPLICATE_EXECUTION", severity: "HIGH", expectedState: `unique executions for ${input.symbol}`, actualState: "duplicate execution detected", timestamp: now };
    }
    if (orderQty !== executionQty) {
      return { accountId: input.accountId, symbol: input.symbol, status: "MISMATCH", discrepancyType: "POSITION_QUANTITY_MISMATCH", severity: "HIGH", expectedState: `order qty ${orderQty} matches execution qty`, actualState: `execution qty ${executionQty} differs`, timestamp: now };
    }
    if (Math.abs(input.positionState.avgPrice - ((input.executionState.executions[0]?.price ?? 0))) > 0.0001) {
      return { accountId: input.accountId, symbol: input.symbol, status: "MISMATCH", discrepancyType: "AVERAGE_PRICE_MISMATCH", severity: "MEDIUM", expectedState: `average price ${input.positionState.avgPrice}`, actualState: `execution price ${input.executionState.executions[0]?.price ?? 0}`, timestamp: now };
    }
    if (Math.abs(input.positionState.realizedPnl - input.pnlState.realizedPnl) > 0.0001) {
      return { accountId: input.accountId, symbol: input.symbol, status: "MISMATCH", discrepancyType: "REALIZED_PNL_MISMATCH", severity: "HIGH", expectedState: `realized P&L ${input.pnlState.realizedPnl}`, actualState: `position realized P&L ${input.positionState.realizedPnl}`, timestamp: now };
    }
    if (Math.abs(input.positionState.unrealizedPnl - input.pnlState.unrealizedPnl) > 0.0001) {
      return { accountId: input.accountId, symbol: input.symbol, status: "MISMATCH", discrepancyType: "UNREALIZED_PNL_MISMATCH", severity: "MEDIUM", expectedState: `unrealized P&L ${input.pnlState.unrealizedPnl}`, actualState: `position unrealized P&L ${input.positionState.unrealizedPnl}`, timestamp: now };
    }
    if (input.executionState.executions.some((execution) => execution.orderId !== input.orderState.id)) {
      return { accountId: input.accountId, symbol: input.symbol, status: "MISMATCH", discrepancyType: "ORDER_EXECUTION_MISMATCH", severity: "HIGH", expectedState: `execution order aligns with ${input.orderState.id}`, actualState: "execution order mismatch", timestamp: now };
    }
    if (input.protectionState.activeProtections === 0 && input.positionState.qty > 0) {
      return { accountId: input.accountId, symbol: input.symbol, status: "MISMATCH", discrepancyType: "INVALID_PROTECTION", severity: "MEDIUM", expectedState: "protection state is valid for the active position", actualState: "invalid or missing protection state", timestamp: now };
    }

    return { accountId: input.accountId, symbol: input.symbol, status: "RECONCILED", discrepancyType: null, severity: "LOW", expectedState: "orders, executions, positions, P&L, and protections align", actualState: "state matches expected reconciliation model", timestamp: now };
  }
}
