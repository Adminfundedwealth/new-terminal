export const FUNDEDWEALTH_PLAN_RULES = {
    FLASH: {
        code: "FLASH",
        name: "Flash",
        rules: {
            plan_name: "FLASH",
            duration_hours: 24,
            max_loss_per_trade_percent: 2,
            max_drawdown_percent: 4,
            profit_split_percent: 80,
            consistency_requirement_percent: 15,
            payout_threshold_percent: 3,
        },
    },
    INSTANT: {
        code: "INSTANT",
        name: "Instant",
        rules: {
            plan_name: "INSTANT",
            daily_drawdown_percent: 3,
            max_drawdown_percent: 5,
            profit_split_percent_min: 70,
            profit_split_percent_max: 80,
            trading_days: 7,
            consistency_requirement_percent: 15,
            leverage_ratio: 50,
        },
    },
    "1-STEP": {
        code: "1-STEP",
        name: "1-Step Evaluation",
        rules: {
            plan_name: "1-STEP",
            evaluation_rules: {
                max_drawdown_percent: 6,
                daily_drawdown_percent: 3,
                profit_target_percent: 10,
                max_risk_per_trade_percent: 1.5,
                minimum_trading_days: 5,
            },
            funded_rules: {
                max_drawdown_percent: 6,
                daily_drawdown_percent: 3,
                consistency_requirement_percent: 40,
                minimum_trading_days: 3,
                profit_split_percent_min: 80,
                profit_split_percent_max: 90,
                leverage_ratio: 30,
            },
        },
    },
    "2-STEP": {
        code: "2-STEP",
        name: "2-Step Evaluation",
        rules: {
            plan_name: "2-STEP",
            evaluation_rules: {
                max_drawdown_percent: 8,
                daily_drawdown_percent: 3,
                profit_target_percent: 8,
                max_risk_per_trade_percent: 1.5,
                minimum_trading_days: 5,
            },
            funded_rules: {
                max_drawdown_percent: 6,
                daily_drawdown_percent: 3,
                consistency_requirement_percent: 40,
                minimum_trading_days: 3,
                profit_split_percent_min: 80,
                profit_split_percent_max: 90,
                leverage_ratio: 30,
            },
        },
    },
};
export const FUNDEDWEALTH_PLAN_ORDER = ["FLASH", "INSTANT", "1-STEP", "2-STEP"];
export function getFundedWealthPlanRules(code) {
    return FUNDEDWEALTH_PLAN_RULES[code].rules;
}
