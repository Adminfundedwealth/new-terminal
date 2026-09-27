import { describe, expect, it } from "vitest";
import {
  classifyMismatch,
  resolveBrokerCanonicalMismatch,
  resolveMismatch,
  type MismatchClassification,
} from "@/lib/brokerReconciliation";

describe("Task 30 mismatch resolution", () => {
  it("matching state requires no resolution", () => {
    const result = resolveMismatch({
      mismatchType: "MATCH",
      accountReference: "acct-1",
      previousCanonicalState: { status: "matched" },
      brokerState: { status: "matched" },
      allowAutoResolution: true,
      resolutionSupport: "canonical_safe_no_op",
    });

    expect(result.classification).toBe("MATCH");
    expect(result.resolutionDecision).toBe("safe");
    expect(result.resolutionStatus).toBe("RESOLVED");
    expect(result.action).toBe("NO_ACTION");
  });

  it("classifies broker-only and canonical-only states deterministically", () => {
    expect(classifyMismatch("broker_only")).toBe("BROKER_ONLY");
    expect(classifyMismatch("canonical_only")).toBe("CANONICAL_ONLY");
  });

  it("classifies status, quantity, price, and identifier mismatches deterministically", () => {
    expect(classifyMismatch("status_mismatch")).toBe("STATUS_MISMATCH");
    expect(classifyMismatch("quantity_mismatch")).toBe("QUANTITY_MISMATCH");
    expect(classifyMismatch("price_mismatch")).toBe("PRICE_MISMATCH");
    expect(classifyMismatch("identifier_mismatch")).toBe("IDENTIFIER_MISMATCH");
  });

  it("supports safe resolution only when the architecture explicitly permits it", () => {
    const result = resolveBrokerCanonicalMismatch({
      mismatchType: "BROKER_ONLY",
      accountReference: "acct-1",
      previousCanonicalState: { orders: [] },
      brokerState: { orders: [{ orderId: "b-1", accountId: "acct-1", symbol: "NIFTY", side: "BUY", quantity: 10, status: "OPEN" }] },
      allowAutoResolution: true,
      resolutionSupport: "canonical_safe_no_op",
    });

    expect(result.classification).toBe("BROKER_ONLY");
    expect(result.resolutionDecision).toBe("safe");
    expect(result.resolutionStatus).toBe("RESOLVED");
    expect(result.action).toBe("RECORD_BROKER_ONLY");
  });

  it("keeps ambiguous or unsafe mismatches unresolved instead of overwriting canonical state", () => {
    const result = resolveBrokerCanonicalMismatch({
      mismatchType: "STATUS_MISMATCH",
      accountReference: "acct-1",
      previousCanonicalState: { orders: [{ id: "c-1", accountId: "acct-1", status: "open", symbol: "NIFTY", side: "BUY", quantity: 10 }] },
      brokerState: { orders: [{ orderId: "b-1", accountId: "acct-1", symbol: "NIFTY", side: "BUY", quantity: 10, status: "FILLED" }] },
      allowAutoResolution: false,
    });

    expect(result.resolutionDecision).toBe("unsafe");
    expect(result.resolutionStatus).toBe("UNRESOLVED");
    expect(result.updatedCanonicalState).toEqual(result.previousCanonicalState);
  });

  it("is idempotent across repeated resolution requests", () => {
    const first = resolveBrokerCanonicalMismatch({
      mismatchReference: "mismatch-1",
      mismatchType: "QUANTITY_MISMATCH",
      accountReference: "acct-1",
      previousCanonicalState: { orders: [{ id: "c-1", accountId: "acct-1", status: "open", symbol: "NIFTY", side: "BUY", quantity: 10 }] },
      brokerState: { orders: [{ orderId: "b-1", accountId: "acct-1", symbol: "NIFTY", side: "BUY", quantity: 12, status: "OPEN" }] },
      allowAutoResolution: true,
      resolutionSupport: "canonical_safe_no_op",
    });

    const second = resolveBrokerCanonicalMismatch({
      mismatchReference: "mismatch-1",
      mismatchType: "QUANTITY_MISMATCH",
      accountReference: "acct-1",
      previousCanonicalState: { orders: [{ id: "c-1", accountId: "acct-1", status: "open", symbol: "NIFTY", side: "BUY", quantity: 10 }] },
      brokerState: { orders: [{ orderId: "b-1", accountId: "acct-1", symbol: "NIFTY", side: "BUY", quantity: 12, status: "OPEN" }] },
      allowAutoResolution: true,
      resolutionSupport: "canonical_safe_no_op",
    });

    expect(first.idempotencyReference).toBe(second.idempotencyReference);
    expect(first.resolutionStatus).toBe(second.resolutionStatus);
    expect(first.action).toBe(second.action);
  });

  it("preserves account isolation and does not bypass risk controls", () => {
    const result = resolveBrokerCanonicalMismatch({
      mismatchType: "IDENTIFIER_MISMATCH",
      accountReference: "acct-1",
      previousCanonicalState: { orders: [{ id: "c-1", accountId: "acct-1", status: "open", symbol: "NIFTY", side: "BUY", quantity: 10 }] },
      brokerState: { orders: [{ orderId: "b-1", accountId: "acct-2", symbol: "NIFTY", side: "BUY", quantity: 10, status: "OPEN" }] },
      allowAutoResolution: true,
      resolutionSupport: "canonical_safe_no_op",
      riskContext: { accountId: "acct-1", symbol: "NIFTY", side: "BUY", quantity: 10, ruleEvaluation: { decision: "REJECT", reason: "account mismatch" } },
    });

    expect(result.resolutionDecision).toBe("unsafe");
    expect(result.resolutionStatus).toBe("UNRESOLVED");
    expect(result.reason).toContain("account");
  });
});

it("keeps type-level classification deterministic for the full supported set", () => {
  const values: MismatchClassification[] = [
    "MATCH",
    "BROKER_ONLY",
    "CANONICAL_ONLY",
    "STATUS_MISMATCH",
    "QUANTITY_MISMATCH",
    "PRICE_MISMATCH",
    "IDENTIFIER_MISMATCH",
  ];

  expect(values).toHaveLength(7);
  expect(classifyMismatch("MATCH")).toBe("MATCH");
});
