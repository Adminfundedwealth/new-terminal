import { describe, expect, it } from "vitest";
import { createMockBrokerRuntime, type BrokerRuntime } from "@/lib/brokerRuntime";
import { RecoveryWorkflow } from "@/lib/recoveryWorkflow";
import type { CanonicalStateLike } from "@/lib/brokerReconciliation";

const state = (overrides: Partial<CanonicalStateLike> = {}): CanonicalStateLike => ({
  orders: [{ id: "local-1", accountId: "acct-1", ownerUserId: "user-1", symbol: "NIFTY", exchange: "NSE", side: "BUY", orderType: "MARKET", quantity: 2, filledQuantity: 0, status: "pending", brokerOrderId: "broker-1", clientOrderId: "client-1" }],
  executions: [],
  positions: [],
  ...overrides,
});

function runtime(status: "OPEN" | "FILLED" | "REJECTED" | "UNKNOWN" = "FILLED", fills = [{ brokerExecutionId: "fill-1", brokerOrderId: "broker-1", localOrderId: "client-1", accountId: "acct-1", symbol: "NIFTY", side: "BUY" as const, quantity: 2, price: 23000, executedAt: "2026-09-24T10:00:00.000Z" }]): BrokerRuntime & { calls: Array<Record<string, unknown>> } {
  return createMockBrokerRuntime({ calls: [], orderStatusMap: { "broker-1": { status, brokerOrderId: "broker-1", clientOrderId: "client-1", fills: status === "REJECTED" || status === "UNKNOWN" ? [] : fills } } });
}

describe("Task 31 recovery workflow", () => {
  it("completes interrupted processing after authoritative broker confirmation", async () => {
    const workflow = new RecoveryWorkflow(runtime("FILLED"));
    const result = await workflow.recover({ accountId: "acct-1", authUserId: "user-1", brokerOrderId: "broker-1", canonicalState: state() });
    expect(result.status).toBe("COMPLETED");
    expect(result.canonicalState.orders[0].status).toBe("filled");
    expect(result.canonicalState.executions).toHaveLength(1);
  });

  it("confirms rejection without inventing an execution", async () => {
    const result = await new RecoveryWorkflow(runtime("REJECTED")).recover({ accountId: "acct-1", authUserId: "user-1", brokerOrderId: "broker-1", canonicalState: state() });
    expect(result.status).toBe("COMPLETED");
    expect(result.canonicalState.orders[0].status).toBe("rejected");
    expect(result.canonicalState.executions).toHaveLength(0);
  });

  it("keeps unknown submission outcomes unresolved and never retries", async () => {
    const broker = runtime("UNKNOWN");
    const result = await new RecoveryWorkflow(broker).recover({ accountId: "acct-1", authUserId: "user-1", brokerOrderId: "broker-1", canonicalState: state() });
    expect(result.status).toBe("UNRESOLVED");
    expect(result.reason).toContain("no order is retried");
    expect(broker.calls).toHaveLength(0);
  });

  it("keeps broker-unavailable and insufficient-evidence states unresolved", async () => {
    const unavailable = { ...runtime(), getBrokerOrderStatus: async () => null };
    const first = await new RecoveryWorkflow(unavailable).recover({ accountId: "acct-1", authUserId: "user-1", brokerOrderId: "broker-1", canonicalState: state() });
    const second = await new RecoveryWorkflow(runtime()).recover({ accountId: "acct-1", authUserId: "user-1", brokerOrderId: "broker-missing", canonicalState: state() });
    expect(first.evidence).toBe("BROKER_UNAVAILABLE");
    expect(second.status).toBe("UNRESOLVED");
    expect(second.canonicalState).toEqual(state());
  });

  it("does not resolve execution evidence without a canonical order", async () => {
    const result = await new RecoveryWorkflow(runtime()).recover({ accountId: "acct-1", authUserId: "user-1", brokerOrderId: "broker-1", canonicalState: state({ orders: [] }) });
    expect(result.status).toBe("UNRESOLVED");
    expect(result.canonicalState.executions).toHaveLength(0);
  });

  it("does not create duplicate executions or positions and replay is idempotent", async () => {
    const workflow = new RecoveryWorkflow(runtime());
    const request = { accountId: "acct-1", authUserId: "user-1", brokerOrderId: "broker-1", recoveryReference: "recovery-1", canonicalState: state() };
    const first = await workflow.recover(request);
    const second = await workflow.recover({ ...request, canonicalState: first.canonicalState });
    expect(first.appliedExecutionIds).toEqual(["fill-1"]);
    expect(second.appliedExecutionIds).toEqual(["fill-1"]);
    expect(second.canonicalState.executions).toHaveLength(1);
    expect(second.canonicalState.positions).toHaveLength(0);
    expect(second.canonicalState).toEqual(first.canonicalState);
  });

  it("isolates accounts and preserves risk controls", async () => {
    const otherAccount = await new RecoveryWorkflow(runtime()).recover({ accountId: "acct-2", authUserId: "user-1", brokerOrderId: "broker-1", canonicalState: state() });
    const riskBlocked = await new RecoveryWorkflow(runtime()).recover({ accountId: "acct-1", authUserId: "user-1", brokerOrderId: "broker-1", riskAllowed: false, canonicalState: state() });
    expect(otherAccount.status).toBe("UNRESOLVED");
    expect(riskBlocked.status).toBe("UNRESOLVED");
    expect(riskBlocked.canonicalState).toEqual(state());
  });

  it("uses broker read/reconciliation/resolution evidence in the integration path", async () => {
    const result = await new RecoveryWorkflow(runtime("OPEN")).recover({ accountId: "acct-1", authUserId: "user-1", brokerOrderId: "broker-1", canonicalState: state() });
    expect(result.reconciliation).not.toBeNull();
    expect(result.mismatchResolution?.resolutionStatus).toBe("RESOLVED");
    expect(result.evidence).toBe("BROKER_CONFIRMED");
  });
});