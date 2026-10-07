import type { AccountMetrics } from "./accountMetrics";

export type RiskDecision = "ALLOW" | "REJECT";
export type RiskState = "ACTIVE" | "WARNING" | "LOCKED" | "BREACHED";
export type RiskSide = "BUY" | "SELL";

export type RiskReasonCode =
  | "ACCOUNT_NOT_ACTIVE"
  | "TRADING_PERMISSION_DISABLED"
  | "INSTRUMENT_NOT_ALLOWED"
  | "TRADING_SESSION_CLOSED"
  | "OVERNIGHT_NOT_ALLOWED"
  | "QUANTITY_EXCEEDED"
  | "MAX_OPEN_POSITIONS_EXCEEDED"
  | "MAX_DAILY_TRADES_EXCEEDED"
  | "DAILY_LOSS_EXCEEDED"
  | "DRAWDOWN_EXCEEDED"
  | "RISK_PER_TRADE_EXCEEDED"
  | "MARGIN_REQUIREMENT_EXCEEDED"
  | "RULE_CONFIGURATION_MISSING"
  | "MARKET_DATA_STALE"
  | "PRICE_NOT_VERIFIABLE"
  | "MARGIN_NOT_VERIFIABLE"
  | "ACCOUNT_LOCKED"
  | "ACCOUNT_BREACHED";

export interface RiskRules {
  trading_permission?: boolean;
  allowed_segments?: string[];
  allowed_instruments?: string[];
  trading_hours?: { start: string; end: string; timezone?: string }[];
  overnight_allowed?: boolean;
  daily_loss_limit?: number;
  maximum_drawdown?: number;
  drawdown_model?: "static" | "trailing";
  max_open_positions?: number;
  max_position_quantity?: number;
  max_position_lots?: number;
  max_daily_trades?: number;
  risk_per_trade?: number;
  margin_requirement?: number;
  margin_verified?: boolean;
  price_verification_required?: boolean;
  profit_target?: number;
  stale_market_policy?: "reject" | "allow_without_unrealized";
}

export interface RiskPosition {
  symbol: string;
  quantity: number;
  segment?: string;
  is_open: boolean;
}

export interface RiskStateInput {
  status: string;
  risk_state: RiskState;
  initial_balance: number;
  starting_balance: number;
  current_balance: number;
  available_margin?: number | null;
  used_margin?: number | null;
  margin_verified?: boolean;
  current_equity: number;
  peak_equity?: number | null;
  daily_starting_equity: number;
  realized_pnl_today: number;
  unrealized_pnl_today?: number | null;
  fees_today?: number;
  daily_trade_count: number;
  open_positions: RiskPosition[];
  market_data_fresh: boolean;
  trusted_market_price?: number | null;
  account_metrics?: AccountMetrics;
}

export interface RiskRequest {
  account_id: string;
  symbol: string;
  segment?: string;
  side: RiskSide;
  quantity: number;
  order_type: string;
  requested_price?: number | null;
  trusted_price?: number | null;
  estimated_loss?: number | null;
  stop_loss?: number | null;
  take_profit?: number | null;
  is_overnight?: boolean;
  is_reduce_only?: boolean;
  exposure_direction?: "increasing" | "reducing";
  margin_verified?: boolean;
  now?: Date;
}

export interface RiskEvaluation {
  decision: RiskDecision;
  reason_code: RiskReasonCode | null;
  reason: string;
  account_id: string;
  rule_evaluated: string | null;
  current_value: number | string | boolean | null;
  configured_limit: number | string | boolean | null;
  risk_state: RiskState;
  timestamp: string;
}

function reject(input: RiskRequest, state: RiskStateInput, code: RiskReasonCode, reason: string, rule: string | null, current: number | string | boolean | null, limit: number | string | boolean | null): RiskEvaluation {
  return { decision: "REJECT", reason_code: code, reason, account_id: input.account_id, rule_evaluated: rule, current_value: current, configured_limit: limit, risk_state: state.risk_state, timestamp: (input.now ?? new Date()).toISOString() };
}

function missing(input: RiskRequest, state: RiskStateInput, rule: string): RiskEvaluation {
  return reject(input, state, "RULE_CONFIGURATION_MISSING", `Required rule is not configured: ${rule}`, rule, null, null);
}

function localTimeMinutes(now: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  return hour * 60 + minute;
}

function inTradingHours(now: Date, hours: NonNullable<RiskRules["trading_hours"]>): boolean {
  return hours.some(({ start, end, timezone = "Asia/Kolkata" }) => {
    const minute = localTimeMinutes(now, timezone);
    const [startHour, startMinute] = start.split(":").map(Number);
    const [endHour, endMinute] = end.split(":").map(Number);
    const from = startHour * 60 + startMinute;
    const to = endHour * 60 + endMinute;
    return from <= to ? minute >= from && minute <= to : minute >= from || minute <= to;
  });
}

function canonicalStartBalance(state: RiskStateInput): number {
  if (Number.isFinite(state.starting_balance)) return state.starting_balance;
  if (Number.isFinite(state.initial_balance)) return state.initial_balance;
  if (Number.isFinite(state.daily_starting_equity)) return state.daily_starting_equity;
  return 0;
}

function canonicalEquity(state: RiskStateInput): number {
  const realizedPnl = Number.isFinite(state.realized_pnl_today) ? state.realized_pnl_today : 0;
  const unrealizedPnl = Number.isFinite(state.unrealized_pnl_today) ? state.unrealized_pnl_today : 0;
  const fees = Number.isFinite(state.fees_today) ? state.fees_today : 0;
  const balanceBase = Number.isFinite(state.current_balance) ? state.current_balance : canonicalStartBalance(state);
  const derivedEquity = balanceBase + realizedPnl + unrealizedPnl - fees;

  if (!Number.isFinite(state.current_equity)) return derivedEquity;
  if (Number.isFinite(state.current_balance) && Math.abs(state.current_equity - state.current_balance) <= 1e-9 && (realizedPnl !== 0 || unrealizedPnl !== 0 || fees !== 0)) {
    return derivedEquity;
  }
  return state.current_equity;
}

export function calculateDailyLoss(state: RiskStateInput): number {
  if (state.account_metrics?.dailyLoss != null && Number.isFinite(state.account_metrics.dailyLoss)) return state.account_metrics.dailyLoss;
  const dailyStartingEquity = Number.isFinite(state.daily_starting_equity) ? state.daily_starting_equity : canonicalStartBalance(state);
  const currentEquity = canonicalEquity(state);
  if (Number.isFinite(dailyStartingEquity) && Number.isFinite(currentEquity)) {
    return Math.max(0, dailyStartingEquity - currentEquity);
  }
  const netDailyPnl = (Number.isFinite(state.realized_pnl_today) ? state.realized_pnl_today : 0)
    + (Number.isFinite(state.unrealized_pnl_today) ? state.unrealized_pnl_today : 0)
    - (Number.isFinite(state.fees_today) ? state.fees_today : 0);
  return Math.max(0, -netDailyPnl);
}

export function calculateDrawdown(state: RiskStateInput, rules: RiskRules): { amount: number; percentage: number; base: number } {
  if (state.account_metrics?.drawdown != null && Number.isFinite(state.account_metrics.drawdown) && state.account_metrics.drawdownPercentage != null && Number.isFinite(state.account_metrics.drawdownPercentage)) {
    return { amount: state.account_metrics.drawdown, percentage: state.account_metrics.drawdownPercentage, base: state.account_metrics.drawdownBase };
  }
  const startBalance = canonicalStartBalance(state);
  const peakEquity = Number.isFinite(state.peak_equity) ? state.peak_equity : startBalance;
  const currentEquity = canonicalEquity(state);
  const base = rules.drawdown_model === "trailing" ? peakEquity : startBalance;
  const amount = Number.isFinite(base) && Number.isFinite(currentEquity) ? Math.max(0, base - currentEquity) : 0;
  return { amount, percentage: base > 0 ? amount / base * 100 : 0, base };
}

export function calculateProfitTarget(state: RiskStateInput, rules: RiskRules) {
  const target = rules.profit_target;
  const startBalance = canonicalStartBalance(state);
  const currentProfit = state.account_metrics?.totalProfit ?? (Number.isFinite(state.current_equity) ? state.current_equity - startBalance : canonicalEquity(state) - startBalance);
  if (target == null) return { configured: false, currentProfit, target: null, remaining: null, progressPercentage: null, reached: false };
  return { configured: true, currentProfit, target, remaining: Math.max(0, target - currentProfit), progressPercentage: target > 0 ? Math.max(0, currentProfit / target * 100) : 0, reached: currentProfit >= target };
}

export function evaluateRisk(input: RiskRequest, state: RiskStateInput, rules: RiskRules): RiskEvaluation {
  const isReduceOnly = input.is_reduce_only === true || input.exposure_direction === "reducing";
  const orderType = String(input.order_type ?? "").toUpperCase().replace(/[-_ ]/g, "");
  const priceValue = Number.isFinite(input.trusted_price) ? input.trusted_price : input.requested_price;
  const hasTrustedPrice = Number.isFinite(priceValue) && priceValue > 0;
  const priceRequiredForType = ["LIMIT", "SL", "SLM", "STOP", "STOPLIMIT"].includes(orderType) || Boolean(rules.price_verification_required);

  if (state.status !== "active") return reject(input, state, "ACCOUNT_NOT_ACTIVE", `Account status is ${state.status}`, "account.status", state.status, "active");
  if (state.risk_state === "LOCKED") return reject(input, state, "ACCOUNT_LOCKED", "Account is locked", "risk_state", state.risk_state, "ACTIVE");
  if (state.risk_state === "BREACHED") return reject(input, state, "ACCOUNT_BREACHED", "Account has breached a configured rule", "risk_state", state.risk_state, "ACTIVE");
  if (rules.trading_permission == null) return missing(input, state, "trading_permission");
  if (!rules.trading_permission) return reject(input, state, "TRADING_PERMISSION_DISABLED", "Trading permission is disabled", "trading_permission", false, true);
  if (rules.allowed_segments == null) return missing(input, state, "allowed_segments");
  if (input.segment && !rules.allowed_segments.includes(input.segment)) return reject(input, state, "INSTRUMENT_NOT_ALLOWED", `Segment ${input.segment} is not allowed`, "allowed_segments", input.segment, rules.allowed_segments.join(","));
  if (rules.allowed_instruments == null) return missing(input, state, "allowed_instruments");
  if (!rules.allowed_instruments.includes(input.symbol)) return reject(input, state, "INSTRUMENT_NOT_ALLOWED", `Instrument ${input.symbol} is not allowed`, "allowed_instruments", input.symbol, rules.allowed_instruments.join(","));
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) return reject(input, state, "QUANTITY_EXCEEDED", "Quantity must be positive", "quantity", input.quantity, "> 0");
  if (priceRequiredForType && !hasTrustedPrice) return reject(input, state, "PRICE_NOT_VERIFIABLE", "Trusted market price is unavailable for this order type", "trusted_price", input.requested_price ?? input.trusted_price ?? null, "trusted_market_data");
  if (rules.trading_hours == null) return missing(input, state, "trading_hours");
  if (!inTradingHours(input.now ?? new Date(), rules.trading_hours)) return reject(input, state, "TRADING_SESSION_CLOSED", "Trading session is closed", "trading_hours", input.now?.toISOString() ?? new Date().toISOString(), JSON.stringify(rules.trading_hours));
  if (input.is_overnight) {
    if (rules.overnight_allowed == null) return missing(input, state, "overnight_allowed");
    if (!rules.overnight_allowed) return reject(input, state, "OVERNIGHT_NOT_ALLOWED", "Overnight trading is not allowed", "overnight_allowed", true, false);
  }
  if (rules.max_position_quantity == null) return missing(input, state, "max_position_quantity");
  const existingQuantity = state.open_positions
    .filter((position) => position.is_open && position.symbol === input.symbol)
    .reduce((total, position) => total + position.quantity, 0);
  const effectiveExposure = isReduceOnly ? Math.max(0, existingQuantity - input.quantity) : input.quantity + existingQuantity;
  if (!isReduceOnly && effectiveExposure > rules.max_position_quantity) return reject(input, state, "QUANTITY_EXCEEDED", "Resulting position exceeds the configured limit", "max_position_quantity", effectiveExposure, rules.max_position_quantity);
  if (isReduceOnly && input.quantity > existingQuantity) return reject(input, state, "QUANTITY_EXCEEDED", "Reduce-only order exceeds the current open quantity", "max_position_quantity", input.quantity, existingQuantity);
  if (rules.max_open_positions == null) return missing(input, state, "max_open_positions");
  const openPositions = state.open_positions.filter((position) => position.is_open).length;
  if (!isReduceOnly && openPositions >= rules.max_open_positions && !state.open_positions.some((position) => position.is_open && position.symbol === input.symbol)) return reject(input, state, "MAX_OPEN_POSITIONS_EXCEEDED", "Maximum open positions reached", "max_open_positions", openPositions, rules.max_open_positions);
  if (rules.max_daily_trades == null) return missing(input, state, "max_daily_trades");
  if (state.daily_trade_count >= rules.max_daily_trades) return reject(input, state, "MAX_DAILY_TRADES_EXCEEDED", "Maximum daily trades reached", "max_daily_trades", state.daily_trade_count, rules.max_daily_trades);
  if (!state.market_data_fresh && state.unrealized_pnl_today == null && rules.stale_market_policy !== "allow_without_unrealized") return reject(input, state, "MARKET_DATA_STALE", "Market data is stale and unrealized P&L cannot be evaluated safely", "stale_market_policy", "reject", rules.stale_market_policy ?? null);
  if (rules.maximum_drawdown == null) return missing(input, state, "maximum_drawdown");
  const drawdown = calculateDrawdown(state, rules);
  if (drawdown.amount >= rules.maximum_drawdown) return reject(input, state, "DRAWDOWN_EXCEEDED", "Maximum drawdown reached", "maximum_drawdown", drawdown.amount, rules.maximum_drawdown);
  if (rules.daily_loss_limit == null) return missing(input, state, "daily_loss_limit");
  const dailyLoss = calculateDailyLoss(state);
  if (dailyLoss >= rules.daily_loss_limit) return reject(input, state, "DAILY_LOSS_EXCEEDED", "Daily loss limit reached", "daily_loss_limit", dailyLoss, rules.daily_loss_limit);
  if (rules.risk_per_trade == null) return missing(input, state, "risk_per_trade");
  const estimatedLoss = Number.isFinite(input.estimated_loss) ? input.estimated_loss : (hasTrustedPrice ? input.quantity * Number(priceValue) * 0.01 : null);
  if (estimatedLoss == null) return missing(input, state, "estimated_loss");
  if (estimatedLoss > rules.risk_per_trade) return reject(input, state, "RISK_PER_TRADE_EXCEEDED", "Estimated trade risk exceeds the configured limit", "risk_per_trade", estimatedLoss, rules.risk_per_trade);
  if (rules.margin_requirement != null) {
    const verifiedMargin = state.margin_verified ?? (state.available_margin != null ? true : undefined);
    if (verifiedMargin === false || (verifiedMargin == null && state.used_margin == null && state.available_margin == null && state.current_balance == null)) {
      return reject(input, state, "MARGIN_NOT_VERIFIABLE", "Broker-derived margin is not available; live execution is blocked", "margin_requirement", state.available_margin ?? state.current_balance, rules.margin_requirement);
    }
    const availableMargin = state.available_margin ?? (state.current_balance - (state.used_margin ?? 0));
    if (availableMargin < rules.margin_requirement) return reject(input, state, "MARGIN_REQUIREMENT_EXCEEDED", "Available balance is below the configured margin requirement", "margin_requirement", availableMargin, rules.margin_requirement);
  }
  if (input.stop_loss != null && input.stop_loss <= 0) return reject(input, state, "RULE_CONFIGURATION_MISSING", "Protection stop loss must be positive when provided", "stop_loss", input.stop_loss, "> 0");
  if (input.take_profit != null && input.take_profit <= 0) return reject(input, state, "RULE_CONFIGURATION_MISSING", "Protection take profit must be positive when provided", "take_profit", input.take_profit, "> 0");
  return { decision: "ALLOW", reason_code: null, reason: "Order passed all configured risk checks", account_id: input.account_id, rule_evaluated: "pre_trade_pipeline", current_value: null, configured_limit: null, risk_state: state.risk_state, timestamp: (input.now ?? new Date()).toISOString() };
}
