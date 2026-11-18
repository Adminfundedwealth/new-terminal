import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.VITE_TERMINAL_OS_URL = "https://terminal.example.test";
});

import {
  createTerminalOrder,
  submitTerminalOrderCommand,
  subscribeToTerminalOrders,
  subscribeToTerminalTradingState,
  type CreateOrderRequest,
} from "@/lib/terminalApi";

const { getSession, channel, removeChannel } = vi.hoisted(() => ({
  getSession: vi.fn(),
  channel: vi.fn(),
  removeChannel: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession }, channel, removeChannel },
  SUPABASE_CONFIGURED: true,
}));

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.localStorage?.clear();
  getSession.mockResolvedValue({ data: { session: { access_token: "customer-jwt" } }, error: null });
});

describe("Main Terminal order command client", () => {
  it("sends only the customer command and bearer identity to Terminal OS", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { replayed: false, order: { id: "order-1", status: "requested" } } }), { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const command = { account_id: "11111111-1111-4111-8111-111111111111", client_order_id: "client-1", symbol: "NIFTY", exchange: "NSE", side: "BUY" as const, quantity: 1, order_type: "MARKET" as const };
    await submitTerminalOrderCommand(command);
    expect(fetchMock).toHaveBeenCalledWith("https://terminal.example.test/api/terminal/orders", expect.objectContaining({
      method: "POST",
      credentials: "omit",
      headers: expect.objectContaining({ Authorization: "Bearer customer-jwt" }),
      body: JSON.stringify({ ...command, time_in_force: "DAY", is_overnight: false }),
    }));
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("broker_connection_id");
  });

  it("whitelists the exported command boundary and normalizes its payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { replayed: false, order: { id: "order-1", status: "requested" } } }), { status: 202 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const request = {
      account_id: "11111111-1111-4111-8111-111111111111",
      client_order_id: "client-1",
      symbol: " nifty ",
      exchange: " nse ",
      side: "BUY" as const,
      quantity: 1,
      order_type: "STOP-LIMIT" as const,
      price: 101,
      trigger_price: 100,
      broker_connection_id: "untrusted-connection",
      access_token: "must-not-be-sent",
    } as unknown as Parameters<typeof submitTerminalOrderCommand>[0];

    await submitTerminalOrderCommand(request);

    const sentBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(sentBody).toMatchObject({
      account_id: request.account_id,
      client_order_id: "client-1",
      symbol: "NIFTY",
      exchange: "NSE",
      order_type: "SL",
      price: 101,
      trigger_price: 100,
    });
    expect(sentBody).not.toHaveProperty("broker_connection_id");
    expect(sentBody).not.toHaveProperty("access_token");
  });

  it("subscribes customer OMS updates to canonical orders", () => {
    const createChannel = () => {
      const current = { on: vi.fn(), subscribe: vi.fn() };
      current.on.mockReturnValue(current);
      current.subscribe.mockReturnValue(current);
      return current;
    };
    channel.mockImplementation(createChannel);
    const accountId = "11111111-1111-4111-8111-111111111111";
    const onChange = vi.fn();

    const unsubscribeOrders = subscribeToTerminalOrders(accountId, onChange);
    const unsubscribeState = subscribeToTerminalTradingState(accountId, onChange);

    const orderSubscriptions = channel.mock.results.flatMap((result) =>
      result.value.on.mock.calls.filter(([, filter]: [string, { table: string }]) => filter.table === "orders"),
    );
    expect(orderSubscriptions).toHaveLength(2);
    expect(orderSubscriptions.every(([, filter]: [string, { table: string; filter: string }]) =>
      filter.filter === `account_id=eq.${accountId}`)).toBe(true);
    const subscribedTables = channel.mock.results.flatMap((result) => result.value.on.mock.calls)
      .map(([, filter]: [string, { table: string }]) => filter.table);
    expect(subscribedTables).not.toContain("trading_orders");
    expect(subscribedTables).toEqual(expect.arrayContaining([
      "executions",
      "positions",
      "trading_accounts",
      "account_metric_snapshots",
      "daily_performance",
      "risk_events",
      "account_ledger_entries",
    ]));

    unsubscribeOrders();
    unsubscribeState();
    expect(removeChannel).toHaveBeenCalledTimes(2);
  });

  it("reuses the persisted client order ID after a lost response and browser refresh", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("Network response was lost after acceptance"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { replayed: true, order: { id: "order-1", status: "requested" } } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { replayed: false, order: { id: "order-2", status: "requested" } } }), { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const request: CreateOrderRequest = {
      account_id: "11111111-1111-4111-8111-111111111111",
      symbol: "nifty",
      exchange: "nse",
      segment: "nse_eq",
      side: "BUY" as const,
      quantity: 1,
      order_type: "MARKET" as const,
      instrument: {
        securityId: "13",
        symbol: "NIFTY",
        tradingSymbol: "NIFTY",
        displayName: "NIFTY",
        exchange: "NSE",
        exchangeSegment: "NSE_EQ",
        instrumentType: "INDEX",
        lotSize: 1,
        tickSize: 0.05,
        provider: "zerodha",
        providerInstrumentId: "client-only",
      },
    };

    await expect(createTerminalOrder(request)).rejects.toThrow("Network response was lost");
    const firstBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(firstBody.client_order_id).toEqual(expect.any(String));
    expect(firstBody).not.toHaveProperty("instrument");

    const retried = await createTerminalOrder(request);
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(secondBody.client_order_id).toBe(firstBody.client_order_id);
    expect(retried).toMatchObject({ ok: true, replayed: true, order: { id: "order-1", status: "requested" } });

    await createTerminalOrder(request);
    const nextOrderBody = JSON.parse(String(fetchMock.mock.calls[2][1]?.body));
    expect(nextOrderBody.client_order_id).not.toBe(firstBody.client_order_id);
  });

  it("normalizes aliases and strips untrusted routing and credential fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { replayed: false, order: { id: "order-2", status: "requested" } } }), { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const request = {
      account_id: "11111111-1111-4111-8111-111111111111",
      symbol: " nifty ",
      exchange: " nse ",
      side: "SELL" as const,
      quantity: 2,
      order_type: "STOP-LIMIT" as const,
      price: 101,
      trigger_price: 100,
      client_order_id: "retry-key",
      broker_connection_id: "untrusted-connection",
      access_token: "must-not-be-sent",
    } as unknown as Parameters<typeof createTerminalOrder>[0];

    await createTerminalOrder(request);
    const sentBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(sentBody).toMatchObject({ symbol: "NIFTY", exchange: "NSE", order_type: "SL", client_order_id: "retry-key" });
    expect(sentBody).not.toHaveProperty("broker_connection_id");
    expect(sentBody).not.toHaveProperty("access_token");
  });

  it("does not report success when the gateway omits the persisted order status", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { order: { id: "order-3" } } }), { status: 202 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const command = {
      account_id: "11111111-1111-4111-8111-111111111111",
      client_order_id: "client-3",
      symbol: "NIFTY",
      exchange: "NSE",
      side: "BUY" as const,
      quantity: 1,
      order_type: "MARKET" as const,
    };

    await expect(submitTerminalOrderCommand(command)).rejects.toThrow("persisted order status");
  });
});
