import { calculateAccountMetrics, type AccountMetrics } from "./accountMetrics";
import { createRiskEventFromRiskEvaluation, type CanonicalRiskEvent } from "./riskEvent";
import { calculateDailyLoss, calculateDrawdown, type RiskEvaluation, type RiskRules, type RiskState, type RiskStateInput } from "./riskEngine";
import type { AccountValuation, RiskPositionSnapshot } from "./positionEngine";

export interface RiskRecoveryInput {
  accountId: string;
  accountState: RiskStateInput;
  rules: RiskRules;
  valuation: AccountValuation;
  positions: RiskPositionSnapshot[];
  asOf?: Date;
}

export interface RecoveredRiskState {
  accountId: string;
  metrics: AccountMetrics;
  riskState: RiskStateInput;
  dailyLoss: number;
  drawdown: ReturnType<typeof calculateDrawdown>;
  remainingLimits: { dailyLoss: number | null; maximumDrawdown: number | null; openPositions: number | null; positionQuantity: number | null };
  eligible: boolean;
  breachReasonCode: RiskEvaluation["reason_code"];
  riskEvent: CanonicalRiskEvent | null;
}

function finiteOr(value: number | null | undefined, fallback: number): number {
  return Number.isFinite(value) ? value as number : fallback;
}

function breachEvaluation(input: RiskRecoveryInput, state: RiskStateInput, dailyLoss: number, drawdown: ReturnType<typeof calculateDrawdown>): RiskEvaluation | null {
  const timestamp = (input.asOf ?? new Date()).toISOString();
  if (drawdown.amount >= (input.rules.maximum_drawdown ?? Number.POSITIVE_INFINITY)) return { decision: "REJECT", reason_code: "DRAWDOWN_EXCEEDED", reason: "Maximum drawdown reached", account_id: input.accountId, rule_evaluated: "maximum_drawdown", current_value: drawdown.amount, configured_limit: input.rules.maximum_drawdown ?? null, risk_state: state.risk_state, timestamp };
  if (dailyLoss >= (input.rules.daily_loss_limit ?? Number.POSITIVE_INFINITY)) return { decision: "REJECT", reason_code: "DAILY_LOSS_EXCEEDED", reason: "Daily loss limit reached", account_id: input.accountId, rule_evaluated: "daily_loss_limit", current_value: dailyLoss, configured_limit: input.rules.daily_loss_limit ?? null, risk_state: state.risk_state, timestamp };
  if (state.risk_state === "LOCKED") return { decision: "REJECT", reason_code: "ACCOUNT_LOCKED", reason: "Account is locked", account_id: input.accountId, rule_evaluated: "risk_state", current_value: state.risk_state, configured_limit: "ACTIVE", risk_state: state.risk_state, timestamp };
  if (state.risk_state === "BREACHED") return { decision: "REJECT", reason_code: "ACCOUNT_BREACHED", reason: "Account has breached a configured rule", account_id: input.accountId, rule_evaluated: "risk_state", current_value: state.risk_state, configured_limit: "ACTIVE", risk_state: state.risk_state, timestamp };
  return null;
}

export function recoverRiskState(input: RiskRecoveryInput): RecoveredRiskState {
  const state = input.accountState;
  const recoveryTime = input.asOf ?? new Date(0);
  const metrics = calculateAccountMetrics({
    accountId: input.accountId,
    status: state.status,
    startingBalance: finiteOr(state.starting_balance, state.initial_balance),
    balance: input.valuation.balance,
    realizedPnl: input.valuation.realizedPnl,
    positions: input.positions.map((position) => ({ unrealizedPnl: position.unrealizedPnl, isOpen: position.isOpen })),
    equity: input.valuation.equity,
    dailyStartingEquity: finiteOr(state.daily_starting_equity, state.starting_balance),
    previousHighWaterMark: state.peak_equity,
    drawdownModel: input.rules.drawdown_model,
    fees: input.valuation.fees,
    snapshotAt: recoveryTime.toISOString(),
  });
  const recoveredState: RiskStateInput = {
    ...state,
    initial_balance: finiteOr(state.initial_balance, metrics.balance),
    starting_balance: finiteOr(state.starting_balance, metrics.balance),
    current_balance: metrics.balance,
    current_equity: metrics.equity ?? metrics.balance,
    peak_equity: metrics.highWaterMark,
    realized_pnl_today: (metrics.dailyPnl ?? 0) - (metrics.unrealizedPnl ?? 0),
    unrealized_pnl_today: metrics.unrealizedPnl,
    fees_today: metrics.fees,
    open_positions: input.positions.map((position) => ({ symbol: position.symbol, quantity: position.quantity, is_open: position.isOpen })),
    account_metrics: metrics,
  };
  const dailyLoss = calculateDailyLoss(recoveredState);
  const drawdown = calculateDrawdown(recoveredState, input.rules);
  const breach = breachEvaluation(input, recoveredState, dailyLoss, drawdown);
  const nextRiskState: RiskState = state.risk_state === "LOCKED" || state.risk_state === "BREACHED" ? state.risk_state : breach ? "BREACHED" : state.risk_state;
  recoveredState.risk_state = nextRiskState;
  const riskEvent = breach ? createRiskEventFromRiskEvaluation({ ...breach, risk_state: nextRiskState }, { source: "execution_service", metadata: { recovery: true, accountId: input.accountId } }) : null;
  return {
    accountId: input.accountId,
    metrics,
    riskState: recoveredState,
    dailyLoss,
    drawdown,
    remainingLimits: {
      dailyLoss: input.rules.daily_loss_limit == null ? null : Math.max(0, input.rules.daily_loss_limit - dailyLoss),
      maximumDrawdown: input.rules.maximum_drawdown == null ? null : Math.max(0, input.rules.maximum_drawdown - drawdown.amount),
      openPositions: input.rules.max_open_positions == null ? null : Math.max(0, input.rules.max_open_positions - recoveredState.open_positions.length),
      positionQuantity: input.rules.max_position_quantity == null ? null : Math.max(0, input.rules.max_position_quantity - recoveredState.open_positions.reduce((sum, position) => sum + position.quantity, 0)),
    },
    eligible: recoveredState.status === "active" && nextRiskState !== "LOCKED" && nextRiskState !== "BREACHED" && !breach,
    breachReasonCode: breach?.reason_code ?? (nextRiskState === "LOCKED" ? "ACCOUNT_LOCKED" : nextRiskState === "BREACHED" ? "ACCOUNT_BREACHED" : null),
    riskEvent,
  };
}