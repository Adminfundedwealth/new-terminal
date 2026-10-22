import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUser, from } = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getUser }, from },
  SUPABASE_CONFIGURED: true,
}));

import {
  fetchTerminalPerformance,
  fetchTerminalRisk,
  fetchTerminalWatchlists,
} from "@/lib/terminalApi";

type QueryResult = {
  data: Array<Record<string, unknown>> | null;
  error: { message: string } | null;
};

type QueryBuilder = {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  then: (
    onfulfilled?: ((value: QueryResult) => unknown) | null,
    onrejected?: ((reason: unknown) => unknown) | null,
  ) => Promise<unknown>;
};

function queryBuilder(result: QueryResult): QueryBuilder {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    then: (onfulfilled?: ((value: QueryResult) => unknown) | null, onrejected?: ((reason: unknown) => unknown) | null) =>
      Promise.resolve(result).then(onfulfilled, onrejected),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);
  builder.limit.mockReturnValue(builder);
  return builder;
}

describe("customer Terminal OS account reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: { id: "customer-1" } }, error: null });
  });

  it("reads risk events only for the authenticated owner and selected account", async () => {
    const query = queryBuilder({
      data: [
        { id: "event-1", account_id: "account-1", severity: "critical", breach_status: "open" },
        { id: "event-2", account_id: "account-1", severity: "warning", breach_status: "resolved" },
      ],
      error: null,
    });
    from.mockReturnValue(query);

    await expect(fetchTerminalRisk("account-1")).resolves.toMatchObject({
      data: { accounts_at_risk: 1, breached: 1, critical: 1, warning: 0 },
    });
    expect(from).toHaveBeenCalledWith("risk_events");
    expect(query.eq).toHaveBeenNthCalledWith(1, "owner_user_id", "customer-1");
    expect(query.eq).toHaveBeenNthCalledWith(2, "account_id", "account-1");
  });

  it("reads daily performance only for the authenticated owner and selected account", async () => {
    const query = queryBuilder({
      data: [{
        id: "day-1",
        account_id: "account-1",
        trading_date: "2026-10-08",
        opening_balance: "100000",
        closing_balance: "100250",
        realized_pnl: "250",
        trade_count: 2,
        winning_trades: 1,
        losing_trades: 1,
      }],
      error: null,
    });
    from.mockReturnValue(query);

    await expect(fetchTerminalPerformance("account-1")).resolves.toMatchObject({
      data: [{
        trading_account_id: "account-1",
        date: "2026-10-08",
        daily_pnl: 250,
        total_trades: 2,
      }],
    });
    expect(from).toHaveBeenCalledWith("daily_performance");
    expect(query.eq).toHaveBeenNthCalledWith(1, "owner_user_id", "customer-1");
    expect(query.eq).toHaveBeenNthCalledWith(2, "account_id", "account-1");
  });

  it("loads owner watchlists with their ordered items", async () => {
    const query = queryBuilder({
      data: [{
        id: "watchlist-1",
        owner_user_id: "customer-1",
        name: "My list",
        watchlist_items: [
          { symbol: "BANKNIFTY", display_order: 2 },
          { symbol: "NIFTY", display_order: 1 },
        ],
      }],
      error: null,
    });
    from.mockReturnValue(query);

    await expect(fetchTerminalWatchlists()).resolves.toMatchObject({
      data: [{ id: "watchlist-1", trader_id: "customer-1", items: ["NIFTY", "BANKNIFTY"] }],
    });
    expect(from).toHaveBeenCalledWith("watchlists");
    expect(query.eq).toHaveBeenCalledWith("owner_user_id", "customer-1");
  });

  it("rejects account reads without an authenticated customer", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });

    await expect(fetchTerminalRisk("account-1")).rejects.toThrow("Authentication required");
    expect(from).not.toHaveBeenCalled();
  });
});
