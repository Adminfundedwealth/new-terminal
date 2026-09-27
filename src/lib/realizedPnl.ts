export type RealizedPnlPositionSide = "LONG" | "SHORT";

export interface RealizedPnlInput {
  positionSide: RealizedPnlPositionSide;
  entryPrice: number;
  exitPrice: number;
  closedQuantity: number;
  accountId?: string;
  symbol?: string;
  instrumentKey?: string;
  executionId?: string;
  externalExecutionId?: string | null;
  executedAt?: string;
}

export interface RealizedPnlAuditEvent extends RealizedPnlInput {
  realizedPnl: number;
}

const PRECISION = 8;

function round(value: number): number {
  return Number(value.toFixed(PRECISION));
}

export function calculateRealizedPnl(input: RealizedPnlInput): number {
  if (!Number.isFinite(input.entryPrice) || input.entryPrice <= 0) throw new Error("entryPrice must be a finite positive number");
  if (!Number.isFinite(input.exitPrice) || input.exitPrice <= 0) throw new Error("exitPrice must be a finite positive number");
  if (!Number.isFinite(input.closedQuantity) || input.closedQuantity <= 0) throw new Error("closedQuantity must be a finite positive number");
  if (input.positionSide !== "LONG" && input.positionSide !== "SHORT") throw new Error("positionSide must be LONG or SHORT");
  const delta = input.positionSide === "LONG"
    ? input.exitPrice - input.entryPrice
    : input.entryPrice - input.exitPrice;
  return round(delta * input.closedQuantity);
}

export function createRealizedPnlAudit(input: RealizedPnlInput): RealizedPnlAuditEvent {
  return { ...input, realizedPnl: calculateRealizedPnl(input) };
}
