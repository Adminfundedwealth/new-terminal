export type FundedWealthPlanCode = "FLASH" | "INSTANT" | "1-STEP" | "2-STEP";
export interface FundedWealthPlanRuleSet {
    code: FundedWealthPlanCode;
    name: string;
    rules: Record<string, unknown>;
}
export declare const FUNDEDWEALTH_PLAN_RULES: Record<FundedWealthPlanCode, FundedWealthPlanRuleSet>;
export declare const FUNDEDWEALTH_PLAN_ORDER: FundedWealthPlanCode[];
export declare function getFundedWealthPlanRules(code: FundedWealthPlanCode): Record<string, unknown>;
