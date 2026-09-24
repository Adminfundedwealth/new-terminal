import { describe, expect, it } from "vitest";
import { ingestBrokerExecution, normalizeBrokerExecutionEvent, type ExecutionPersistence } from "@/lib/executionIngestion";
import type { CanonicalExecution, ExecutionInput } from "@/lib/executionModel";

const event = (overrides: Record<string, unknown> = {}) => ({
  brokerExecutionId: "broker-fill-1",
  brokerOrderId: "broker-order-1",
  localOrderId: "order-20",
  accountId: "account-20",
  ownerUserId: "user-20",
  symbol: "NIFTY",
  side: "BUY",
  quantity: 5,
  price: 100.25,
  executedAt: "2026-09-24T09:16:00.000Z",
  ...overrides,
});

function persistence(): ExecutionPersistence & { rows: CanonicalExecution[] } {
  const rows: CanonicalExecution[] = [];
  return {
    rows,
    async persistExecution(input: ExecutionInput, context) {
      const normalized = normalizeBrokerExecutionEvent({
        brokerExecutionId: input.externalExecutionId,
        brokerOrderId: "broker-order-1",
        localOrderId: input.orderId,
        accountId: input.accountId,
        ownerUserId: input.ownerUserId,
        symbol: input.symbol,
        side: input.side,
        quantity: input.quantity,
        price: input.executionPrice,
        executedAt: input.executedAt,
        instrumentId: input.instrumentId,
      }, context);
      const existing = rows.find((row) => row.accountId === normalized.accountId && row.externalExecutionId === normalized.externalExecutionId);
      if (existing) return { execution: existing, replayed: true };
      const execution = { ...normalized, id: `execution:${rows.length + 1}` } as CanonicalExecution;
      rows.push(execution);
      return { execution, replayed: false };
    },
  };
}

describe("Task 20 execution ingestion boundary", () => {
  it("normalizes a valid broker fill and supports full, partial, and multiple fills", async () => {
    const store = persistence();
    const first = await ingestBrokerExecution(event({ quantity: 5 }), { authUserId: "user-20", source: "broker" }, store);
    const second = await ingestBrokerExecution(event({ brokerExecutionId: "broker-fill-2", quantity: 3, price: 101 }), { authUserId: "user-20", source: "broker" }, store);
    expect(first.execution).toMatchObject({ externalExecutionId: "BROKER-FILL-1", quantity: 5, executionPrice: 100.25 });
    expect(second.replayed).toBe(false);
    expect(store.rows).toHaveLength(2);
  });

  it("returns the existing execution for retries and concurrent duplicates", async () => {
    const store = persistence();
    const results = await Promise.all(Array.from({ length: 8 }, () => ingestBrokerExecution(event(), { authUserId: "user-20", source: "broker" }, store)));
    expect(store.rows).toHaveLength(1);
    expect(results.filter((result) => !result.replayed)).toHaveLength(1);
    expect(results.slice(1).every((result) => result.execution.id === results[0].execution.id)).toBe(true);
  });

  it.each([
    ["unknown broker execution ID", { brokerExecutionId: "" }, "brokerExecutionId is required"],
    ["unknown order", { localOrderId: "" }, "localOrderId is required"],
    ["invalid quantity", { quantity: 0 }, "quantity must be positive"],
    ["invalid price", { price: 0 }, "executionPrice must be positive"],
    ["invalid instrument", { symbol: "" }, "symbol is required"],
    ["invalid side", { side: "HOLD" }, "side must be BUY or SELL"],
    ["malformed event", null, "Malformed broker execution payload"],
  ])("rejects %s", async (_name, overrides, message) => {
    const payload = overrides === null ? null : event(overrides);
    await expect(ingestBrokerExecution(payload, { authUserId: "user-20", source: "broker" }, persistence())).rejects.toThrow(message);
  });

  it("rejects customer-side or ownership-forged sources", async () => {
    await expect(ingestBrokerExecution(event({ ownerUserId: "other-user" }), { authUserId: "user-20", source: "broker" }, persistence())).rejects.toThrow("owner");
    expect(() => normalizeBrokerExecutionEvent(event(), { authUserId: "user-20", source: "internal" })).not.toThrow();
  });

  it("keeps deterministic normalized output for delayed and out-of-order events", () => {
    const delayed = normalizeBrokerExecutionEvent(event({ executedAt: "2026-09-24T09:15:59.000Z" }), { authUserId: "user-20", source: "broker" });
    const replay = normalizeBrokerExecutionEvent(event(), { authUserId: "user-20", source: "broker" });
    expect(delayed.externalExecutionId).toBe("BROKER-FILL-1");
    expect(replay).toEqual(normalizeBrokerExecutionEvent(event(), { authUserId: "user-20", source: "broker" }));
  });
});