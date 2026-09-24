export type ChallengeOutcome = "PASS" | "BREACH" | "IN_PROGRESS" | "NOT_ELIGIBLE" | "CONFIGURATION_ERROR";

export interface ChallengeRules {
  starting_balance: number;
  profit_target: number;
  maximum_drawdown: number;
  daily_loss_limit: number;
  minimum_trading_days?: number;
  drawdown_model?: "static" | "trailing";
}

export interface ChallengeMetrics {
  account_status: string;
  risk_state?: string | null;
  current_equity: number;
  peak_equity?: number | null;
  daily_loss: number;
  trading_days: number;
}

export interface ChallengeEvaluation {
  outcome: ChallengeOutcome;
  lifecycle_action: "NONE" | "TRANSITION_TO_BREACHED";
  account_status: string;
  profit: number;
  drawdown: number;
  daily_loss: number;
  trading_days: number;
  reasons: string[];
}

const EPSILON = 1e-9;

function atLeast(value: number, limit: number): boolean {
  return value + EPSILON >= limit;
}

function finite(value: number): boolean {
  return Number.isFinite(value);
}

export function evaluateChallengeRules(rules: ChallengeRules, metrics: ChallengeMetrics): ChallengeEvaluation {
  const profit = metrics.current_equity - rules.starting_balance;
  const drawdownBase = rules.drawdown_model === "trailing"
    ? (metrics.peak_equity ?? rules.starting_balance)
    : rules.starting_balance;
  const drawdown = Math.max(0, drawdownBase - metrics.current_equity);
  const reasons: string[] = [];

  if (metrics.account_status !== "active" || metrics.risk_state === "BREACHED" || metrics.risk_state === "LOCKED") {
    return {
      outcome: "NOT_ELIGIBLE",
      lifecycle_action: "NONE",
      account_status: metrics.account_status,
      profit,
      drawdown,
      daily_loss: metrics.daily_loss,
      trading_days: metrics.trading_days,
      reasons: [`Account status is ${metrics.account_status}`],
    };
  }

  const requiredRules: Array<[string, number]> = [
    ["starting_balance", rules.starting_balance],
    ["profit_target", rules.profit_target],
    ["maximum_drawdown", rules.maximum_drawdown],
    ["daily_loss_limit", rules.daily_loss_limit],
  ];
  const missing = requiredRules
    .filter(([, value]) => !finite(value) || value < 0)
    .map(([key]) => key);
  if (!finite(metrics.current_equity) || !finite(metrics.daily_loss) || !Number.isInteger(metrics.trading_days) || metrics.trading_days < 0) {
    missing.push("account_metrics");
  }
  if (rules.minimum_trading_days != null && (!Number.isInteger(rules.minimum_trading_days) || rules.minimum_trading_days < 0)) {
    missing.push("minimum_trading_days");
  }
  if (missing.length > 0) {
    return {
      outcome: "CONFIGURATION_ERROR",
      lifecycle_action: "NONE",
      account_status: metrics.account_status,
      profit,
      drawdown,
      daily_loss: metrics.daily_loss,
      trading_days: metrics.trading_days,
      reasons: missing.map((key) => `Invalid rule configuration: ${key}`),
    };
  }

  if (atLeast(metrics.daily_loss, rules.daily_loss_limit)) reasons.push("DAILY_LOSS_LIMIT_REACHED");
  if (atLeast(drawdown, rules.maximum_drawdown)) reasons.push("MAXIMUM_DRAWDOWN_REACHED");
  if (reasons.length > 0) {
    return {
      outcome: "BREACH",
      lifecycle_action: "TRANSITION_TO_BREACHED",
      account_status: metrics.account_status,
      profit,
      drawdown,
      daily_loss: metrics.daily_loss,
      trading_days: metrics.trading_days,
      reasons,
    };
  }

  const targetReached = atLeast(profit, rules.profit_target);
  const minimumDays = rules.minimum_trading_days ?? 0;
  if (targetReached && metrics.trading_days >= minimumDays) {
    return {
      outcome: "PASS",
      lifecycle_action: "NONE",
      account_status: metrics.account_status,
      profit,
      drawdown,
      daily_loss: metrics.daily_loss,
      trading_days: metrics.trading_days,
      reasons: ["PROFIT_TARGET_REACHED", ...(minimumDays > 0 ? ["MINIMUM_TRADING_DAYS_REACHED"] : [])],
    };
  }

  if (targetReached && metrics.trading_days < minimumDays) reasons.push("MINIMUM_TRADING_DAYS_NOT_REACHED");
  else reasons.push("PROFIT_TARGET_NOT_REACHED");
  return {
    outcome: "IN_PROGRESS",
    lifecycle_action: "NONE",
    account_status: metrics.account_status,
    profit,
    drawdown,
    daily_loss: metrics.daily_loss,
    trading_days: metrics.trading_days,
    reasons,
  };
}