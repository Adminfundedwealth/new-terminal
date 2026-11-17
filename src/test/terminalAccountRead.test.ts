import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUser, from } = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getUser }, from },
  SUPABASE_CONFIGURED: true,
}));

import { fetchTerminalAccounts } from "@/lib/terminalApi";

function queryBuilder(result: { data: unknown; error: null }) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    maybeSingle: vi.fn(),
    then: (onfulfilled?: (value: typeof result) => unknown, onrejected?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(onfulfilled, onrejected),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);
  return builder;
}

describe("trading account reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: { id: "customer-1" } }, error: null });
  });

  it("maps canonical owner and current balance fields into terminal account data", async () => {
    const accountsQuery = queryBuilder({
      data: [{
        id: "account-1",
        account_code: "FW-001",
        broker_provider: "simulated",
        current_balance: "250000",
        status: "active",
        available_margin: "250000",
        used_margin: "0",
        owner_user_id: "customer-1",
      }],
      error: null,
    });
    const settingsQuery = queryBuilder({ data: null, error: null });
    settingsQuery.maybeSingle.mockResolvedValue({
      data: { active_account_id: "account-1" },
      error: null,
    });
    from.mockReturnValueOnce(accountsQuery).mockReturnValueOnce(settingsQuery);

    await expect(fetchTerminalAccounts()).resolves.toMatchObject({
      data: [{
        id: "account-1",
        trader_id: "customer-1",
        balance: 250000,
        available_margin: 250000,
        used_margin: 0,
      }],
      active_account_id: "account-1",
    });
    expect(from).toHaveBeenNthCalledWith(1, "trading_accounts");
    expect(accountsQuery.select).toHaveBeenCalledWith(
      "id, account_code, broker_provider, current_balance, status, available_margin, used_margin, owner_user_id",
    );
    expect(accountsQuery.eq).toHaveBeenCalledWith("owner_user_id", "customer-1");
    expect(from).toHaveBeenNthCalledWith(2, "terminal_settings");
    expect(settingsQuery.eq).toHaveBeenCalledWith("owner_user_id", "customer-1");
  });
});
