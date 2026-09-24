export type MetricAccountStatus = "active" | "inactive" | "suspended" | "expired" | "breached" | "closed" | string;
export type DrawdownModel = "static" | "trailing";

export interface AccountMetricPosition {
  unrealizedPnl: number | null;
  isOpen?: boolean;
}

export interface AccountMetricsInput {
  accountId: string;
  status: MetricAccountStatus;
  startingBalance: number;
  balance: number;
  realizedPnl: number;
  positions?: readonly AccountMetricPosition[];
  equity?: number | null;
  dailyStartingEquity: number;
  previousHighWaterMark?: number | null;
  drawdownModel?: DrawdownModel;
  fees?: number;
  snapshotAt?: string;
}

export interface AccountMetrics {
  accountId: string;
  status: MetricAccountStatus;
  balance: number;
  equity: number | null;
  realizedPnl: number;
  unrealizedPnl: number | null;
  dailyPnl: number | null;
  dailyLoss: number | null;
  totalProfit: number | null;
  highWaterMark: number;
  drawdown: number | null;
  drawdownPercentage: number | null;
  drawdownBase: number;
  fees: number;
  snapshotAt: string | null;
}

const PRECISION = 8;

function round(value: number): number {
  return Number(value.toFixed(PRECISION));
}

function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
  return value;
}

function nonNegative(value: number, name: string): number {
  finite(value, name);
  if (value < 0) throw new Error(`${name} must be non-negative`);
  return value;
}

export function calculateAccountMetrics(input: AccountMetricsInput): AccountMetrics {
  if (!input.accountId) throw new Error("accountId is required");
  const startingBalance = finite(input.startingBalance, "startingBalance");
  const balance = nonNegative(input.balance, "balance");
  const realizedPnl = finite(input.realizedPnl, "realizedPnl");
  const dailyStartingEquity = finite(input.dailyStartingEquity, "dailyStartingEquity");
  const fees = nonNegative(input.fees ?? 0, "fees");
  const positions = (input.positions ?? []).filter((position) => position.isOpen !== false);
  const hasCompleteValuation = positions.every((position) => position.unrealizedPnl != null && Number.isFinite(position.unrealizedPnl));
  const unrealizedPnl = hasCompleteValuation
    ? round(positions.reduce((total, position) => total + (position.unrealizedPnl ?? 0), 0))
    : null;
  const equity = input.equity === undefined
    ? (unrealizedPnl == null ? null : round(balance + unrealizedPnl))
    : input.equity == null ? null : finite(input.equity, "equity");
  const dailyPnl = equity == null ? null : round(equity - dailyStartingEquity);
  const totalProfit = equity == null ? null : round(equity - startingBalance);
  const highWaterMark = round(Math.max(startingBalance, input.previousHighWaterMark ?? startingBalance, equity ?? startingBalance));
  const drawdownBase = input.drawdownModel === "trailing" ? highWaterMark : startingBalance;
  const drawdown = equity == null ? null : round(Math.max(0, drawdownBase - equity));

  return {
    accountId: input.accountId,
    status: input.status,
    balance: round(balance),
    equity,
    realizedPnl: round(realizedPnl),
    unrealizedPnl,
    dailyPnl,
    dailyLoss: dailyPnl == null ? null : round(Math.max(0, -dailyPnl)),
    totalProfit,
    highWaterMark,
    drawdown,
    drawdownPercentage: drawdown == null || drawdownBase <= 0 ? (drawdown == null ? null : 0) : round(drawdown / drawdownBase * 100),
    drawdownBase: round(drawdownBase),
    fees: round(fees),
    snapshotAt: input.snapshotAt ?? null,
  };
}