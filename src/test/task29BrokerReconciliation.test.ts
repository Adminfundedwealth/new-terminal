import { describe, it, expect } from "vitest";
import {
  reconcileBrokerCanonicalState,
  normalizeBrokerState,
  type BrokerNormalizedState,
  type CanonicalOrderLike,
  type CanonicalPositionLike,
} from "@/lib/brokerReconciliation";

const order = (overrides: Partial<CanonicalOrderLike> = {}): CanonicalOrderLike => ({
  id: "c-1",
  accountId: "acct-1",
  ownerUserId: "user-1",
  symbol: "NIFTY",
  exchange: "NSE",
  side: "BUY",
  orderType: "LIMIT",
  quantity: 100,
  filledQuantity: 50,
  price: 18100,
  averageFillPrice: 18090,
  status: "partially_filled",
  brokerOrderId: "broker-order-1",
  clientOrderId: "client-1",
  instrumentId: "inst-1",
  ...overrides,
});

const position = (overrides: Partial<CanonicalPositionLike> = {}): CanonicalPositionLike => ({
  id: "pos-1",
  accountId: "acct-1",
  ownerUserId: "user-1",
  symbol: "NIFTY",
  exchange: "NSE",
  quantity: 50,
  side: "long",
  averagePrice: 18100,
  lastPrice: 18120,
  status: "open",
  instrumentId: "inst-1",
  ...overrides,
});

describe("Task 29 broker reconciliation", () => {
  it("matches completely matching broker and canonical state", () => {
    const brokerState: BrokerNormalizedState = normalizeBrokerState({
      orders: [{
        orderId: "broker-order-1",
        symbol: "NIFTY",
        exchange: "NSE",
        side: "BUY",
        quantity: 100,
        filledQuantity: 50,
        status: "PARTIALLY_FILLED",
        averagePrice: 18090,
        price: 18100,
        orderType: "LIMIT",
        accountId: "acct-1",
        brokerOrderId: "broker-order-1",
        clientOrderId: "client-1",
      }],
      executions: [{
        id: "e-1",
        orderId: "broker-order-1",
        externalExecutionId: "fill-1",
        symbol: "NIFTY",
        side: "BUY",
        quantity: 50,
        price: 18090,
        accountId: "acct-1",
        executedAt: "2026-09-24T10:00:00.000Z",
      }],
      positions: [{
        id: "pos-1",
        symbol: "NIFTY",
        exchange: "NSE",
        quantity: 50,
        averagePrice: 18100,
        lastPrice: 18120,
        side: "long",
        status: "open",
        accountId: "acct-1",
      }],
    });

    const canonical = {
      orders: [order()],
      executions: [{
        id: "exec-1",
        orderId: "c-1",
        accountId: "acct-1",
        ownerUserId: "user-1",
        symbol: "NIFTY",
        side: "BUY",
        quantity: 50,
        executionPrice: 18090,
        executedAt: "2026-09-24T10:00:00.000Z",
        externalExecutionId: "fill-1",
        fees: 0,
        taxes: 0,
        netAmount: null,
      }],
      positions: [position()],
    };

    const result = reconcileBrokerCanonicalState({ brokerState, canonicalState: canonical });
    expect(result.matchedState.orders).toHaveLength(1);
    expect(result.brokerOnly.orders).toHaveLength(0);
    expect(result.canonicalOnly.orders).toHaveLength(0);
    expect(result.mismatches).toHaveLength(0);
  });

  it("identifies broker-only and canonical-only orders", () => {
    const brokerState = normalizeBrokerState({
      orders: [{
        orderId: "broker-only-1",
        symbol: "BANKNIFTY",
        exchange: "NSE",
        side: "SELL",
        quantity: 25,
        filledQuantity: 0,
        status: "OPEN",
        averagePrice: 0,
        price: 43000,
        orderType: "LIMIT",
        accountId: "acct-1",
        brokerOrderId: "broker-only-1",
      }],
      executions: [],
      positions: [],
    });

    const result = reconcileBrokerCanonicalState({
      brokerState,
      canonicalState: {
        orders: [order({ id: "c-2", brokerOrderId: "canonical-only-1", quantity: 40, symbol: "BANKNIFTY" })],
        executions: [],
        positions: [],
      },
    });

    expect(result.brokerOnly.orders).toHaveLength(1);
    expect(result.canonicalOnly.orders).toHaveLength(1);
    expect(result.matchedState.orders).toHaveLength(0);
  });

  it("detects broker-only and canonical-only executions", () => {
    const result = reconcileBrokerCanonicalState({
      brokerState: normalizeBrokerState({
        orders: [],
        executions: [{
          id: "e-broker",
          orderId: "broker-order-1",
          externalExecutionId: "fill-broker",
          symbol: "NIFTY",
          side: "BUY",
          quantity: 20,
          price: 18080,
          accountId: "acct-1",
          executedAt: "2026-09-24T10:05:00.000Z",
        }],
        positions: [],
      }),
      canonicalState: {
        orders: [],
        executions: [{
          id: "e-canonical",
          orderId: "c-1",
          accountId: "acct-1",
          ownerUserId: "user-1",
          symbol: "NIFTY",
          side: "BUY",
          quantity: 10,
          executionPrice: 18090,
          executedAt: "2026-09-24T10:06:00.000Z",
          externalExecutionId: "fill-canonical",
          fees: 0,
          taxes: 0,
          netAmount: null,
        }],
        positions: [],
      },
    });

    expect(result.brokerOnly.executions).toHaveLength(1);
    expect(result.canonicalOnly.executions).toHaveLength(1);
  });

  it("detects quantity and price mismatches for orders and positions", () => {
    const result = reconcileBrokerCanonicalState({
      brokerState: normalizeBrokerState({
        orders: [{
          orderId: "broker-order-1",
          symbol: "NIFTY",
          exchange: "NSE",
          side: "BUY",
          quantity: 200,
          filledQuantity: 50,
          status: "PARTIALLY_FILLED",
          averagePrice: 18120,
          price: 18150,
          orderType: "LIMIT",
          accountId: "acct-1",
          brokerOrderId: "broker-order-1",
        }],
        executions: [],
        positions: [{
          id: "pos-1",
          symbol: "NIFTY",
          exchange: "NSE",
          quantity: 40,
          averagePrice: 18130,
          lastPrice: 18150,
          side: "long",
          status: "open",
          accountId: "acct-1",
        }],
      }),
      canonicalState: {
        orders: [order({ id: "c-1", quantity: 100, filledQuantity: 50, averageFillPrice: 18090, brokerOrderId: "broker-order-1" })],
        executions: [],
        positions: [position({ id: "pos-1", quantity: 50, averagePrice: 18100 })],
      },
    });

    expect(result.mismatches.some((entry) => entry.type === "quantity_mismatch")).toBe(true);
    expect(result.mismatches.some((entry) => entry.type === "price_mismatch")).toBe(true);
  });

  it("detects status mismatches for orders and positions when supported", () => {
    const result = reconcileBrokerCanonicalState({
      brokerState: normalizeBrokerState({
        orders: [{
          orderId: "broker-order-1",
          symbol: "NIFTY",
          exchange: "NSE",
          side: "BUY",
          quantity: 100,
          filledQuantity: 100,
          status: "FILLED",
          averagePrice: 18100,
          price: 18100,
          orderType: "LIMIT",
          accountId: "acct-1",
          brokerOrderId: "broker-order-1",
        }],
        executions: [],
        positions: [{
          id: "pos-1",
          symbol: "NIFTY",
          exchange: "NSE",
          quantity: 50,
          averagePrice: 18100,
          lastPrice: 18120,
          side: "long",
          status: "closed",
          accountId: "acct-1",
        }],
      }),
      canonicalState: {
        orders: [order({ id: "c-1", status: "partially_filled", brokerOrderId: "broker-order-1" })],
        executions: [],
        positions: [position({ id: "pos-1", quantity: 50, status: "open" })],
      },
    });

    expect(result.mismatches.some((entry) => entry.type === "status_mismatch")).toBe(true);
  });

  it("matches by stable identifiers and keeps multiple accounts isolated", () => {
    const result = reconcileBrokerCanonicalState({
      brokerState: normalizeBrokerState({
        orders: [{
          orderId: "broker-order-1",
          symbol: "NIFTY",
          exchange: "NSE",
          side: "BUY",
          quantity: 100,
          filledQuantity: 100,
          status: "FILLED",
          averagePrice: 18095,
          price: 18095,
          orderType: "LIMIT",
          accountId: "acct-1",
          brokerOrderId: "broker-order-1",
        }],
        executions: [],
        positions: [],
      }),
      canonicalState: {
        orders: [order({ id: "c-1", accountId: "acct-2", brokerOrderId: "broker-order-1" })],
        executions: [],
        positions: [],
      },
    });

    expect(result.brokerOnly.orders).toHaveLength(1);
    expect(result.canonicalOnly.orders).toHaveLength(1);
    expect(result.matchesAccountIsolation).toBe(true);
  });

  it("handles empty broker responses safely and deduplicates duplicate broker records", () => {
    const brokerState = normalizeBrokerState({ orders: [], executions: [], positions: [] });
    const result = reconcileBrokerCanonicalState({
      brokerState,
      canonicalState: {
        orders: [order({ id: "c-1" })],
        executions: [],
        positions: [position()],
      },
    });
    expect(result.canonicalOnly.orders).toHaveLength(1);
    expect(result.canonicalOnly.positions).toHaveLength(1);

    const deduped = reconcileBrokerCanonicalState({
      brokerState: normalizeBrokerState({
        orders: [
          { orderId: "broker-order-1", symbol: "NIFTY", exchange: "NSE", side: "BUY", quantity: 100, filledQuantity: 100, status: "FILLED", averagePrice: 18090, price: 18090, orderType: "LIMIT", accountId: "acct-1", brokerOrderId: "broker-order-1" },
          { orderId: "broker-order-1", symbol: "NIFTY", exchange: "NSE", side: "BUY", quantity: 100, filledQuantity: 100, status: "FILLED", averagePrice: 18090, price: 18090, orderType: "LIMIT", accountId: "acct-1", brokerOrderId: "broker-order-1" },
        ],
        executions: [],
        positions: [],
      }),
      canonicalState: {
        orders: [order({ id: "c-1", brokerOrderId: "broker-order-1" })],
        executions: [],
        positions: [],
      },
    });

    expect(deduped.matchedState.orders).toHaveLength(1);
  });

  it("returns deterministic results for unchanged state", () => {
    const brokerState = normalizeBrokerState({
      orders: [{
        orderId: "broker-order-1",
        symbol: "NIFTY",
        exchange: "NSE",
        side: "BUY",
        quantity: 100,
        filledQuantity: 100,
        status: "FILLED",
        averagePrice: 18100,
        price: 18100,
        orderType: "LIMIT",
        accountId: "acct-1",
        brokerOrderId: "broker-order-1",
      }],
      executions: [{
        id: "e-1",
        orderId: "broker-order-1",
        externalExecutionId: "fill-1",
        symbol: "NIFTY",
        side: "BUY",
        quantity: 100,
        price: 18100,
        accountId: "acct-1",
        executedAt: "2026-09-24T10:00:00.000Z",
      }],
      positions: [{
        id: "pos-1",
        symbol: "NIFTY",
        exchange: "NSE",
        quantity: 100,
        averagePrice: 18100,
        lastPrice: 18120,
        side: "long",
        status: "open",
        accountId: "acct-1",
      }],
    });
    const canonicalState = {
      orders: [order({ id: "c-1", brokerOrderId: "broker-order-1", quantity: 100, filledQuantity: 100, status: "filled" })],
      executions: [{
        id: "exec-1",
        orderId: "c-1",
        accountId: "acct-1",
        ownerUserId: "user-1",
        symbol: "NIFTY",
        side: "BUY",
        quantity: 100,
        executionPrice: 18100,
        executedAt: "2026-09-24T10:00:00.000Z",
        externalExecutionId: "fill-1",
        fees: 0,
        taxes: 0,
        netAmount: null,
      }],
      positions: [position({ id: "pos-1", quantity: 100, status: "open" })],
    };

    const first = reconcileBrokerCanonicalState({ brokerState, canonicalState });
    const second = reconcileBrokerCanonicalState({ brokerState, canonicalState });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
