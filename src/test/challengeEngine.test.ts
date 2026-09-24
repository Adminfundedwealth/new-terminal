import { describe, expect, it } from "vitest";
import { evaluateChallengeRules, type ChallengeMetrics, type ChallengeRules } from "@/lib/challengeEngine";

const rules: ChallengeRules = {
  starting_balance: 10_000,
  profit_target: 1_000,
  maximum_drawdown: 500,
  daily_loss_limit: 250,
  minimum_trading_days: 5,
  drawdown_model: "static",
};

function metrics(overrides: Partial<ChallengeMetrics> = {}): ChallengeMetrics {
  return { account_status: "active", current_equity: 10_000, peak_equity: 10_000, daily_loss: 0, trading_days: 0, ...overrides };
}

describe("challenge rules engine", () => {
  it("passes at exact target once minimum trading days are met", () => {
    expect(evaluateChallengeRules(rules, metrics({ current_equity: 11_000, trading_days: 5 })).outcome).toBe("PASS");
  });

  it("remains in progress when the target is not reached", () => {
    expect(evaluateChallengeRules(rules, metrics({ current_equity: 10_999, trading_days: 5 })).outcome).toBe("IN_PROGRESS");
  });

  it("requires minimum trading days after reaching the target", () => {
    const result = evaluateChallengeRules(rules, metrics({ current_equity: 11_000, trading_days: 4 }));
    expect(result).toMatchObject({ outcome: "IN_PROGRESS", reasons: ["MINIMUM_TRADING_DAYS_NOT_REACHED"] });
  });

  it("breaches at the exact daily loss limit", () => {
    expect(evaluateChallengeRules(rules, metrics({ daily_loss: 250 })).outcome).toBe("BREACH");
  });

  it("breaches at the exact maximum drawdown limit", () => {
    expect(evaluateChallengeRules(rules, metrics({ current_equity: 9_500 })).outcome).toBe("BREACH");
  });

  it("reports all simultaneous breach conditions deterministically", () => {
    const result = evaluateChallengeRules(rules, metrics({ current_equity: 9_500, daily_loss: 250 }));
    expect(result.reasons).toEqual(["DAILY_LOSS_LIMIT_REACHED", "MAXIMUM_DRAWDOWN_REACHED"]);
    expect(result.lifecycle_action).toBe("TRANSITION_TO_BREACHED");
  });

  it("uses trailing equity for drawdown", () => {
    expect(evaluateChallengeRules({ ...rules, drawdown_model: "trailing" }, metrics({ peak_equity: 11_000, current_equity: 10_500 })).outcome).toBe("BREACH");
  });

  it("handles floating point boundary values", () => {
    expect(evaluateChallengeRules(rules, metrics({ daily_loss: 250 - 1e-10 })).outcome).toBe("BREACH");
  });

  it.each(["inactive", "suspended", "breached", "closed"])('does not evaluate %s accounts as passable', (account_status) => {
    expect(evaluateChallengeRules(rules, metrics({ account_status, current_equity: 11_000, trading_days: 5 })).outcome).toBe("NOT_ELIGIBLE");
  });

  it("rejects invalid rule configuration", () => {
    expect(evaluateChallengeRules({ ...rules, maximum_drawdown: -1 }, metrics()).outcome).toBe("CONFIGURATION_ERROR");
    expect(evaluateChallengeRules({ ...rules, profit_target: undefined as never }, metrics()).outcome).toBe("CONFIGURATION_ERROR");
  });

  it("is deterministic across repeated evaluations", () => {
    const input = metrics({ current_equity: 10_750, daily_loss: 10, trading_days: 3 });
    expect(evaluateChallengeRules(rules, input)).toEqual(evaluateChallengeRules(rules, input));
  });
});