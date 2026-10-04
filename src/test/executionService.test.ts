import { describe, expect, it } from "vitest";
import { ExecutionService } from "@/lib/executionService";
import { createBrokerRouter } from "@/lib/brokerRouter";
import { setExecutionMode } from "@/lib/brokerConfig";
import { createMockBrokerRuntime } from "@/lib/brokerRuntime";
import type { RiskEvaluation } from "@/lib/riskEngine";

const allowRisk = async (): Promise<RiskEvaluation> => ({
  decision: "ALLOW",
  reason_code: null,
  reason: "test risk approval",
  account_id: "acct-1",
  rule_evaluated: "test",
  current_value: null,
  configured_limit: null,
  risk_state: "ACTIVE",
  timestamp: new Date().toISOString(),
});

describe("ExecutionService", () => {
  it("uses simulated execution by default and honors idempotency", async () => {
    const service = new ExecutionService(createBrokerRouter([]), { mode: "SIMULATED" });
    const first = await service.placeOrder({
      accountId: "acct-1",
      brokerId: "dhan",
      symbol: "NIFTY",
      exchange: "NSE",
      side: "BUY",
      quantity: 1,
      orderType: "MARKET",
      idempotencyKey: "client-1",
    });
    const second = await service.placeOrder({
      accountId: "acct-1",
      brokerId: "dhan",
      symbol: "NIFTY",
      exchange: "NSE",
      side: "BUY",
      quantity: 1,
      orderType: "MARKET",
      idempotencyKey: "client-1",
    });

    expect(first.state).toBe("SIMULATED");
    expect(second.state).toBe("SIMULATED");
    expect(second.brokerOrderId).toBe(first.brokerOrderId);
  });

  it("rejects a conflicting request that reuses an idempotency key", async () => {
    const service = new ExecutionService(createBrokerRouter([]), { mode: "SIMULATED" });
    await service.placeOrder({ accountId: "acct-1", brokerId: "dhan", symbol: "NIFTY", exchange: "NSE", side: "BUY", quantity: 1, orderType: "MARKET", idempotencyKey: "conflict-1" });
    const result = await service.placeOrder({ accountId: "acct-1", brokerId: "dhan", symbol: "NIFTY", exchange: "NSE", side: "BUY", quantity: 2, orderType: "MARKET", idempotencyKey: "conflict-1" });
    expect(result.state).toBe("REJECTED");
    expect(result.reasonCode).toBe("IDEMPOTENCY_KEY_CONFLICT");
  });

  it("uses the canonical risk gate even in simulated trading mode", async () => {
    const service = new ExecutionService(createBrokerRouter([]), {
      mode: "SIMULATED",
      riskRules: {
        trading_permission: true,
        allowed_segments: ["NSE"],
        allowed_instruments: ["NIFTY"],
        trading_hours: [{ start: "09:15", end: "15:30" }],
        overnight_allowed: false,
        daily_loss_limit: 200,
        maximum_drawdown: 1000,
        max_open_positions: 5,
        max_position_quantity: 10,
        max_daily_trades: 20,
        risk_per_trade: 500,
        margin_requirement: 500,
        stale_market_policy: "reject",
      },
      riskState: {
        status: "active",
        risk_state: "ACTIVE",
        initial_balance: 10000,
        starting_balance: 10000,
        current_balance: 10000,
        current_equity: 9000,
        daily_starting_equity: 10000,
        realized_pnl_today: 0,
        unrealized_pnl_today: 0,
        daily_trade_count: 0,
        open_positions: [],
        market_data_fresh: true,
      },
    });

    const result = await service.placeOrder({
      accountId: "acct-1",
      brokerId: "dhan",
      symbol: "NIFTY",
      exchange: "NSE",
      side: "BUY",
      quantity: 2,
      orderType: "MARKET",
      idempotencyKey: "sim-risk-1",
      now: new Date("2026-09-22T10:00:00.000Z"),
    });

    expect(result.state).toBe("REJECTED");
    expect(result.reasonCode).toBe("DRAWDOWN_EXCEEDED");
  });

  it("emits a canonical risk event from the authoritative risk decision path", async () => {
    const emitted: Array<{ accountId: string; reasonCode: string | null; riskEvent?: { accountId: string; eventType: string; metricName: string | null; metricValue: number | string | null; source: string } }> = [];
    const service = new ExecutionService(createBrokerRouter([]), {
      mode: "SIMULATED",
      riskRules: {
        trading_permission: true,
        allowed_segments: ["NSE"],
        allowed_instruments: ["NIFTY"],
        trading_hours: [{ start: "09:15", end: "15:30" }],
        overnight_allowed: false,
        daily_loss_limit: 200,
        maximum_drawdown: 1000,
        max_open_positions: 5,
        max_position_quantity: 10,
        max_daily_trades: 20,
        risk_per_trade: 500,
        margin_requirement: 500,
        stale_market_policy: "reject",
      },
      riskState: {
        status: "active",
        risk_state: "ACTIVE",
        initial_balance: 10000,
        starting_balance: 10000,
        current_balance: 10000,
        current_equity: 9000,
        daily_starting_equity: 10000,
        realized_pnl_today: 0,
        unrealized_pnl_today: 0,
        daily_trade_count: 0,
        open_positions: [],
        market_data_fresh: true,
      },
      onRiskEvent: (event) => emitted.push(event as typeof emitted[number]),
    });

    const result = await service.placeOrder({
      accountId: "acct-1",
      brokerId: "dhan",
      symbol: "NIFTY",
      exchange: "NSE",
      side: "BUY",
      quantity: 2,
      orderType: "MARKET",
      idempotencyKey: "risk-event-1",
      now: new Date("2026-09-22T10:00:00.000Z"),
    });

    expect(result.state).toBe("REJECTED");
    expect(result.reasonCode).toBe("DRAWDOWN_EXCEEDED");
    expect(emitted).toHaveLength(1);
    expect(emitted[0].accountId).toBe("acct-1");
    expect(emitted[0].reasonCode).toBe("DRAWDOWN_EXCEEDED");
    expect(emitted[0].riskEvent).toMatchObject({
      accountId: "acct-1",
      eventType: "MAX_DRAWDOWN_BREACH",
      metricName: "maximum_drawdown",
      source: "execution_service",
    });
  });

  it("serializes concurrent duplicate requests and submits to the broker once", async () => {
    const runtime = createMockBrokerRuntime({ calls: [] });
    const originalPlace = runtime.placeBrokerOrder;
    runtime.placeBrokerOrder = async (request) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return originalPlace(request);
    };
    const service = new ExecutionService(createBrokerRouter([]), {
      mode: "REAL", realOrderEnabled: true, authUserId: "user-1", brokerRuntime: runtime,
      preTradeRiskGate: allowRisk,
      accountResolver: async (accountId) => ({ id: accountId, ownerUserId: "user-1", status: "ACTIVE", isActive: true, brokerProvider: "dhan", brokerAccountRef: "dhan-acct-1" }),
      brokerMappingResolver: async (accountId) => ({ id: "map-1", accountId, ownerUserId: "user-1", brokerProvider: "dhan", brokerAccountRef: "dhan-acct-1", enabled: true, active: true }),
      riskRules: { trading_permission: true, allowed_segments: ["NSE"], allowed_instruments: ["NIFTY"], trading_hours: [{ start: "09:15", end: "15:30" }], overnight_allowed: false, daily_loss_limit: 100, maximum_drawdown: 200, max_open_positions: 5, max_position_quantity: 10, max_daily_trades: 20, risk_per_trade: 1000, margin_requirement: 500, stale_market_policy: "reject" },
      riskState: { status: "active", risk_state: "ACTIVE", initial_balance: 100000, starting_balance: 100000, current_balance: 100000, current_equity: 100000, daily_starting_equity: 100000, realized_pnl_today: 0, unrealized_pnl_today: 0, daily_trade_count: 0, open_positions: [], market_data_fresh: true },
    });
    const request = { accountId: "acct-1", brokerId: "dhan" as const, symbol: "NIFTY", exchange: "NSE", side: "BUY" as const, quantity: 1, orderType: "MARKET", idempotencyKey: "concurrent-1", authUserId: "user-1" };
    const [first, second] = await Promise.all([service.placeOrder(request), service.placeOrder(request)]);
    expect(runtime.calls).toHaveLength(1);
    expect(first.brokerOrderId).toBe(second.brokerOrderId);
    expect(second.replay).toBe(true);
  });

  it("replays deterministic timeout and failed results without retrying the broker", async () => {
    const runtime = createMockBrokerRuntime({ calls: [], orderAcks: { "timeout-1": { ok: false, state: "PENDING", brokerOrderId: "broker-timeout-1", message: "timeout" } } });
    const service = new ExecutionService(createBrokerRouter([]), { mode: "REAL", realOrderEnabled: true, authUserId: "user-1", brokerRuntime: runtime, preTradeRiskGate: allowRisk });
    const request = { accountId: "acct-1", brokerId: "dhan" as const, symbol: "NIFTY", exchange: "NSE", side: "BUY" as const, quantity: 1, orderType: "MARKET", idempotencyKey: "timeout-1", authUserId: "user-1" };
    const first = await service.placeOrder(request);
    const second = await service.placeOrder(request);
    expect(first.state).toBe("PENDING");
    expect(second.brokerOrderId).toBe(first.brokerOrderId);
    expect(runtime.calls).toHaveLength(1);
  });

  it("rejects real orders unless the explicit execution gate is enabled", async () => {
    setExecutionMode("SIMULATED");
    const service = new ExecutionService(createBrokerRouter([]), { mode: "REAL" });

    const result = await service.placeOrder({
      accountId: "acct-1",
      brokerId: "dhan",
      symbol: "NIFTY",
      exchange: "NSE",
      side: "BUY",
      quantity: 2,
      orderType: "LIMIT",
      price: 23050,
      idempotencyKey: "real-1",
    });

    expect(result.state).toBe("REJECTED");
    expect(result.reasonCode).toBe("REAL_EXECUTION_DISABLED");
  });

  it("blocks a real order when risk checks fail", async () => {
    const runtime = createMockBrokerRuntime({ calls: [] });
    const service = new ExecutionService(createBrokerRouter([]), {
      mode: "REAL",
      realOrderEnabled: true,
      authUserId: "user-1",
      brokerRuntime: runtime,
      riskRules: {
        trading_permission: true,
        allowed_segments: ["NSE"],
        allowed_instruments: ["NIFTY"],
        trading_hours: [{ start: "09:15", end: "15:30" }],
        overnight_allowed: false,
        daily_loss_limit: 100,
        maximum_drawdown: 200,
        max_open_positions: 5,
        max_position_quantity: 1,
        max_daily_trades: 20,
        risk_per_trade: 50,
        margin_requirement: 5000,
        stale_market_policy: "reject",
      },
      riskState: {
        status: "active",
        risk_state: "ACTIVE",
        initial_balance: 100000,
        starting_balance: 100000,
        current_balance: 1000,
        current_equity: 1000,
        daily_starting_equity: 100000,
        realized_pnl_today: 0,
        unrealized_pnl_today: 0,
        daily_trade_count: 0,
        open_positions: [],
        market_data_fresh: true,
      },
    });

    const result = await service.placeOrder({
      accountId: "acct-1",
      brokerId: "dhan",
      symbol: "NIFTY",
      exchange: "NSE",
      side: "BUY",
      quantity: 2,
      orderType: "MARKET",
      idempotencyKey: "risk-block-1",
      now: new Date("2026-09-22T10:00:00.000Z"),
    });

    expect(result.state).toBe("REJECTED");
    expect(result.reasonCode).toBe("QUANTITY_EXCEEDED");
    expect(runtime.calls).toHaveLength(0);
  });

  it("uses mocked broker runtime for a real execution flow and fills position only after broker ACK + fill", async () => {
    const runtime = createMockBrokerRuntime({
      brokerAccountRef: "dhan-acct-1",
      calls: [],
      orderAcks: { "order-7": { ok: true, state: "ACK", brokerOrderId: "broker-order-7", message: "accepted" } },
      orderStatusMap: {
        "broker-order-7": {
          status: "OPEN",
          brokerOrderId: "broker-order-7",
          clientOrderId: "order-7",
          fills: [{
            brokerExecutionId: "fill-7",
            brokerOrderId: "broker-order-7",
            localOrderId: "order-7",
            accountId: "acct-1",
            symbol: "NIFTY",
            side: "BUY",
            quantity: 2,
            price: 23050,
            executedAt: "2026-09-22T09:15:00.000Z",
            fees: 0,
          }],
        },
      },
    });

    const service = new ExecutionService(createBrokerRouter([]), {
      mode: "REAL",
      realOrderEnabled: true,
      authUserId: "user-1",
      accountResolver: async (accountId) => ({
        id: accountId,
        ownerUserId: "user-1",
        status: "ACTIVE",
        isActive: true,
        brokerProvider: "dhan",
        brokerAccountRef: "dhan-acct-1",
      }),
      brokerMappingResolver: async (accountId) => ({
        id: "map-1",
        accountId,
        ownerUserId: "user-1",
        brokerProvider: "dhan",
        brokerAccountRef: "dhan-acct-1",
        enabled: true,
        active: true,
      }),
      brokerRuntime: runtime,
      riskRules: {
        trading_permission: true,
        allowed_segments: ["NSE"],
        allowed_instruments: ["NIFTY"],
        trading_hours: [{ start: "09:15", end: "15:30" }],
        overnight_allowed: false,
        daily_loss_limit: 100,
        maximum_drawdown: 200,
        max_open_positions: 5,
        max_position_quantity: 10,
        max_daily_trades: 20,
        risk_per_trade: 1000,
        margin_requirement: 500,
        stale_market_policy: "reject",
      },
      riskState: {
        status: "active",
        risk_state: "ACTIVE",
        initial_balance: 100000,
        starting_balance: 100000,
        current_balance: 100000,
        current_equity: 100000,
        daily_starting_equity: 100000,
        realized_pnl_today: 0,
        unrealized_pnl_today: 0,
        daily_trade_count: 0,
        open_positions: [],
        market_data_fresh: true,
      },
    });

    const result = await service.placeOrder({
      accountId: "acct-1",
      brokerId: "dhan",
      symbol: "NIFTY",
      exchange: "NSE",
      side: "BUY",
      quantity: 2,
      orderType: "MARKET",
      price: 23050,
      idempotencyKey: "order-7",
      authUserId: "user-1",
      now: new Date("2026-09-22T09:15:00+05:30"),
    });

    expect(result.state).toBe("REAL");
    expect(runtime.calls.length).toBe(1);

    const synced = await service.syncBrokerOrder(result.brokerOrderId, "acct-1", "user-1");
    expect(synced.position?.quantity).toBe(2);
    expect(synced.pnl).toBeGreaterThanOrEqual(0);
  });
});
