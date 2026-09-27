export type PositionProtectionField = "stop_loss" | "take_profit";
export type PositionProtectionSide = "long" | "short";

export interface PositionProtectionSnapshot {
  side: PositionProtectionSide;
  entryPrice: number;
  currentPrice: number;
  tickSize: number;
  stopLoss: number | null;
  takeProfit: number | null;
}

export interface PositionProtectionValidation {
  valid: boolean;
  message?: string;
}

function roundToTick(price: number, tickSize: number): number {
  return Number((Math.round(price / tickSize) * tickSize).toFixed(8));
}

export function derivePositionProtectionPrice(
  field: PositionProtectionField,
  position: PositionProtectionSnapshot,
): number {
  const { tickSize, currentPrice, entryPrice, side, stopLoss, takeProfit } = position;
  const tick = Number.isFinite(tickSize) && tickSize > 0 ? tickSize : 0.05;
  const current = Number.isFinite(currentPrice) && currentPrice > 0 ? currentPrice : entryPrice;
  const entry = Number.isFinite(entryPrice) && entryPrice > 0 ? entryPrice : current;

  if (field === "stop_loss") {
    if (side === "long") {
      const fallback = roundToTick(entry - tick, tick);
      if (takeProfit != null && fallback >= takeProfit) {
        return roundToTick(Math.min(takeProfit - tick, entry - tick), tick);
      }
      return fallback;
    }

    const fallback = roundToTick(Math.max(entry, current) + tick, tick);
    if (takeProfit != null && fallback <= takeProfit) {
      return roundToTick(Math.max(takeProfit + tick, Math.max(entry, current) + tick), tick);
    }
    return fallback;
  }

  if (side === "long") {
    const fallback = roundToTick(Math.max(entry, current) + tick, tick);
    if (stopLoss != null && fallback <= stopLoss) {
      return roundToTick(Math.max(stopLoss + tick, Math.max(entry, current) + tick), tick);
    }
    return fallback;
  }

  const fallback = roundToTick(Math.min(entry, current) - tick, tick);
  if (stopLoss != null && fallback >= stopLoss) {
    return roundToTick(Math.min(stopLoss - tick, Math.min(entry, current) - tick), tick);
  }
  return fallback;
}

export function validatePositionProtectionPrice(
  field: PositionProtectionField,
  price: number,
  position: PositionProtectionSnapshot,
): PositionProtectionValidation {
  if (!Number.isFinite(price) || price <= 0) {
    return { valid: false, message: "Protection price must be greater than zero." };
  }
  if (!Number.isFinite(position.tickSize) || position.tickSize <= 0) {
    return { valid: false, message: "Instrument tick size is unavailable." };
  }
  if (Math.abs(price / position.tickSize - Math.round(price / position.tickSize)) > 1e-8) {
    return { valid: false, message: `Price must match the instrument tick size (${position.tickSize}).` };
  }
  if (!Number.isFinite(position.entryPrice) || position.entryPrice <= 0 || !Number.isFinite(position.currentPrice) || position.currentPrice <= 0) {
    return { valid: false, message: "A valid entry and current market price are required." };
  }

  if (field === "stop_loss") {
    const invalidLong = position.side === "long" && (price >= position.entryPrice || price >= position.currentPrice);
    const invalidShort = position.side === "short" && (price <= position.entryPrice || price <= position.currentPrice);
    if (invalidLong || invalidShort) {
      return { valid: false, message: `Stop loss must remain beyond entry and current price for this ${position.side.toUpperCase()} position.` };
    }
    if (position.takeProfit != null && (position.side === "long" ? price >= position.takeProfit : price <= position.takeProfit)) {
      return { valid: false, message: "Stop loss cannot cross the existing take-profit level." };
    }
  } else {
    const invalidLong = position.side === "long" && (price <= position.entryPrice || price <= position.currentPrice);
    const invalidShort = position.side === "short" && (price >= position.entryPrice || price >= position.currentPrice);
    if (invalidLong || invalidShort) {
      return { valid: false, message: `Take profit must remain beyond entry and current price for this ${position.side.toUpperCase()} position.` };
    }
    if (position.stopLoss != null && (position.side === "long" ? price <= position.stopLoss : price >= position.stopLoss)) {
      return { valid: false, message: "Take profit cannot cross the existing stop-loss level." };
    }
  }

  return { valid: true };
}

export interface PositionProtectionFields {
  id: string;
  stop_loss?: number | null;
  take_profit?: number | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
  stop_loss_removed?: boolean;
  take_profit_removed?: boolean;
}

export function mergeCanonicalProtectionFields<T extends PositionProtectionFields>(
  previous: readonly PositionProtectionFields[],
  incoming: readonly T[],
): Array<T & { stop_loss?: number | null; take_profit?: number | null }> {
  const previousById = new Map(previous.map((position) => [position.id, position]));
  return incoming.map((position) => {
    const prior = previousById.get(position.id);
    if (!prior) return position;
    const merged = { ...position };
    if (position.stop_loss_removed) merged.stop_loss = null;
    else if (position.stop_loss == null && position.stopLoss == null) merged.stop_loss = prior.stop_loss ?? prior.stopLoss ?? null;
    if (position.take_profit_removed) merged.take_profit = null;
    else if (position.take_profit == null && position.takeProfit == null) merged.take_profit = prior.take_profit ?? prior.takeProfit ?? null;
    return merged;
  }) as Array<T & { stop_loss?: number | null; take_profit?: number | null }>;
}