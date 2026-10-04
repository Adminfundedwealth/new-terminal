import type { AccountMetrics } from "./accountMetrics";
export type RiskDecision = "ALLOW" | "REJECT";
export type RiskState = "ACTIVE" | "WARNING" | "LOCKED" | "BREACHED";
export type RiskSide = "BUY" | "SELL";
export type RiskReasonCode = "ACCOUNT_NOT_ACTIVE" | "TRADING_PERMISSION_DISABLED" | "INSTRUMENT_NOT_ALLOWED" | "TRADING_SESSION_CLOSED" | "OVERNIGHT_NOT_ALLOWED" | "QUANTITY_EXCEEDED" | "MAX_OPEN_POSITIONS_EXCEEDED" | "MAX_DAILY_TRADES_EXCEEDED" | "DAILY_LOSS_EXCEEDED" | "DRAWDOWN_EXCEEDED" | "RISK_PER_TRADE_EXCEEDED" | "MARGIN_REQUIREMENT_EXCEEDED" | "RULE_CONFIGURATION_MISSING" | "MARKET_DATA_STALE" | "PRICE_NOT_VERIFIABLE" | "MARGIN_NOT_VERIFIABLE" | "ACCOUNT_LOCKED" | "ACCOUNT_BREACHED";
export interface RiskRules {
    trading_permission?: boolean;
    allowed_segments?: string[];
    allowed_instruments?: string[];
    trading_hours?: {
        start: string;
        end: string;
        timezone?: string;
    }[];
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
export declare function calculateDailyLoss(state: RiskStateInput): number;
export declare function calculateDrawdown(state: RiskStateInput, rules: RiskRules): {
    amount: number;
    percentage: number;
    base: number;
};
export declare function calculateProfitTarget(state: RiskStateInput, rules: RiskRules): {
    configured: boolean;
    currentProfit: number;
    target: number;
    remaining: number;
    progressPercentage: number;
    reached: boolean;
};
export declare function evaluateRisk(input: RiskRequest, state: RiskStateInput, rules: RiskRules): RiskEvaluation;
