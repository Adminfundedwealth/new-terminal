import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAccountContext, accountContextQueryKeys } from "@/hooks/useAccountContext";
import { useAuth } from "@/hooks/useAuth";
import { fetchAccountContext, fetchTerminalAccounts, setActiveAccount, subscribeToAccountContext } from "@/lib/terminalApi";

vi.mock("@/hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("@/lib/terminalApi", () => ({
  fetchAccountContext: vi.fn(),
  fetchTerminalAccounts: vi.fn(),
  setActiveAccount: vi.fn(),
  subscribeToAccountContext: vi.fn(() => () => undefined),
}));

const user = { id: "user-1" };
const account = { id: "account-1", account_code: "FW-001", trader_id: user.id, broker_provider: "dhan", balance: 10_000, status: "active" as const };
const context = {
  identity: { trader_id: user.id },
  account: { id: account.id, owner_user_id: user.id, status: "breached", current_balance: 9_500, equity: 9_400, starting_balance: 10_000 },
  product: { code: "FUNDED" },
  phase: { code: "CHALLENGE" },
  rules: { daily_loss_limit: 250 },
  permissions: { trade: false },
  risk_state: { status: "BREACHED" as const, daily_loss: 600, drawdown_amount: 600, profit_target: 1_000, profit_current: -600, latest_snapshot: { balance: 9_500, equity: 9_400, pnl: -600 }, open_events: 1 },
};

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

describe("customer account context", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves and propagates the canonical account, status, metrics, and rules", async () => {
    vi.mocked(useAuth).mockReturnValue({ user } as never);
    vi.mocked(fetchTerminalAccounts).mockResolvedValue({ data: [account], meta: { total: 1, page: 1, page_size: 1 } });
    vi.mocked(fetchAccountContext).mockResolvedValue(context as never);

    const { result } = renderHook(() => useAccountContext(), { wrapper });
    await waitFor(() => expect(result.current.accountContext).toEqual(context));

    expect(result.current.activeAccountId).toBe(account.id);
    expect(result.current.accountContext?.account.current_balance).toBe(9_500);
    expect(result.current.accountContext?.risk_state.latest_snapshot?.equity).toBe(9_400);
    expect(result.current.accountContext?.rules.daily_loss_limit).toBe(250);
    expect(result.current.accountContext?.risk_state.status).toBe("BREACHED");
  });

  it("shares account selection across all mounted account-context consumers", async () => {
    const secondAccount = { ...account, id: "account-2", account_code: "FW-002" };
    vi.mocked(useAuth).mockReturnValue({ user } as never);
    vi.mocked(fetchTerminalAccounts).mockResolvedValue({ data: [account, secondAccount], meta: { total: 2, page: 1, page_size: 2 } });
    vi.mocked(fetchAccountContext).mockResolvedValue(context as never);
    vi.mocked(setActiveAccount).mockResolvedValue(undefined);

    const { result } = renderHook(() => [useAccountContext(), useAccountContext()] as const, { wrapper });
    await waitFor(() => expect(result.current[0].activeAccountId).toBe(account.id));
    expect(result.current[1].activeAccountId).toBe(account.id);

    await result.current[0].selectAccount(secondAccount.id);

    await waitFor(() => {
      expect(result.current[0].activeAccountId).toBe(secondAccount.id);
      expect(result.current[1].activeAccountId).toBe(secondAccount.id);
    });
  });

  it("restores the canonical selected account from FundedWealth settings", async () => {
    const secondAccount = { ...account, id: "account-2", account_code: "FW-002" };
    const secondContext = { ...context, account: { ...context.account, id: secondAccount.id } };
    vi.mocked(useAuth).mockReturnValue({ user } as never);
    vi.mocked(fetchTerminalAccounts).mockResolvedValue({
      data: [account, secondAccount],
      active_account_id: secondAccount.id,
      meta: { total: 2, page: 1, page_size: 2 },
    });
    vi.mocked(fetchAccountContext).mockResolvedValue(secondContext as never);

    const { result } = renderHook(() => useAccountContext(), { wrapper });
    await waitFor(() => expect(result.current.accountContext).toEqual(secondContext));

    expect(result.current.activeAccountId).toBe(secondAccount.id);
    expect(fetchAccountContext).toHaveBeenCalledWith(secondAccount.id);
  });

  it("reports an authenticated no-account state without fetching account context", async () => {
    vi.mocked(useAuth).mockReturnValue({ user } as never);
    vi.mocked(fetchTerminalAccounts).mockResolvedValue({ data: [], meta: { total: 0, page: 1, page_size: 0 } });

    const { result } = renderHook(() => useAccountContext(), { wrapper });
    await waitFor(() => expect(result.current.hasNoAccount).toBe(true));

    expect(result.current.activeAccountId).toBeNull();
    expect(result.current.accountContext).toBeUndefined();
    expect(fetchAccountContext).not.toHaveBeenCalled();
  });

  it("surfaces account loading errors and rejects forged account selection", async () => {
    vi.mocked(useAuth).mockReturnValue({ user } as never);
    vi.mocked(fetchTerminalAccounts).mockResolvedValue({ data: [account], meta: { total: 1, page: 1, page_size: 1 } });
    vi.mocked(fetchAccountContext).mockRejectedValue(new Error("account not found or not owned"));

    const { result } = renderHook(() => useAccountContext(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    await expect(result.current.selectAccount("other-user-account")).rejects.toThrow("not available");
    expect(setActiveAccount).not.toHaveBeenCalled();
  });

  it("isolates account context cache keys by user and account", () => {
    expect(accountContextQueryKeys.context("user-1", "account-1")).not.toEqual(accountContextQueryKeys.context("user-2", "account-1"));
    expect(accountContextQueryKeys.context("user-1", "account-1")).not.toEqual(accountContextQueryKeys.context("user-1", "account-2"));
    expect(accountContextQueryKeys.accounts("user-1")).not.toEqual(accountContextQueryKeys.accounts("user-2"));
  });
});