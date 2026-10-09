import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useAccountContext", () => ({ useAccountContext: vi.fn() }));
vi.mock("@/lib/terminalApi", () => ({
  fetchTerminalExecutions: vi.fn(),
  fetchTerminalOrders: vi.fn(),
  fetchTerminalPerformance: vi.fn(),
  fetchTerminalPositions: vi.fn(),
  fetchTerminalRisk: vi.fn(),
}));

import { useAccountContext } from "@/hooks/useAccountContext";
import {
  fetchTerminalExecutions,
  fetchTerminalOrders,
  fetchTerminalPerformance,
  fetchTerminalPositions,
  fetchTerminalRisk,
} from "@/lib/terminalApi";
import MyStats from "@/pages/MyStats";

const account = {
  id: "account-1",
  account_code: "FW-001",
  trader_id: "user-1",
  broker_provider: null,
  balance: 100_000,
  status: "active" as const,
};

const accountContext = {
  identity: { trader_id: "user-1" },
  account: { id: account.id, owner_user_id: "user-1", status: "active", equity: 100_200, current_balance: 100_200 },
  product: { name: "Evaluation" },
  phase: { name: "Phase 1" },
  rules: { daily_loss_limit: 1_000, maximum_drawdown: 5_000 },
  permissions: {},
  risk_state: {
    status: "ACTIVE" as const,
    daily_loss: 100,
    drawdown_amount: 250,
    profit_target: 5_000,
    profit_current: 200,
    latest_snapshot: null,
    open_events: 0,
  },
};

const emptyPage = { data: [], meta: { total: 0, page: 1, page_size: 0, has_more: false } };

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MyStats /></QueryClientProvider>);
}

function setAccountState(overrides: Record<string, unknown> = {}) {
  vi.mocked(useAccountContext).mockReturnValue({
    accounts: [account],
    accountContext,
    activeAccountId: account.id,
    isLoading: false,
    isError: false,
    error: null,
    hasNoAccount: false,
    selectAccount: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as ReturnType<typeof useAccountContext>);
}

describe("My Stats analytics dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    vi.mocked(fetchTerminalExecutions).mockResolvedValue(emptyPage as never);
    vi.mocked(fetchTerminalOrders).mockResolvedValue(emptyPage as never);
    vi.mocked(fetchTerminalPerformance).mockResolvedValue(emptyPage as never);
    vi.mocked(fetchTerminalPositions).mockResolvedValue(emptyPage as never);
    vi.mocked(fetchTerminalRisk).mockResolvedValue({ data: { accounts_at_risk: 0, breached: 0, critical: 0, warning: 0, recent_events: [] } } as never);
  });

  it("keeps the complete analytics workspace visible without an account and does not request account data", () => {
    setAccountState({
      accounts: [],
      accountContext: undefined,
      activeAccountId: null,
      hasNoAccount: true,
    });

    renderPage();

    expect(screen.getByRole("heading", { name: "My Stats" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Performance charts" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Advanced statistics" })).toBeInTheDocument();
    expect(screen.getByText(/No FundedWealth trading account is currently available/)).toBeInTheDocument();
    expect(screen.getAllByText("00").length).toBeGreaterThan(10);
    expect(fetchTerminalPerformance).not.toHaveBeenCalled();
    expect(fetchTerminalExecutions).not.toHaveBeenCalled();
    expect(fetchTerminalOrders).not.toHaveBeenCalled();
    expect(fetchTerminalPositions).not.toHaveBeenCalled();
  });

  it("loads every analytics source for only the currently selected account and derives daily metrics", async () => {
    const selectedAccount = { ...account, id: "account-2", account_code: "FW-002" };
    setAccountState({
      activeAccountId: selectedAccount.id,
      accounts: [selectedAccount],
      accountContext: { ...accountContext, account: { ...accountContext.account, id: selectedAccount.id } },
    });
    vi.mocked(fetchTerminalPerformance).mockResolvedValue({
      data: [
        { id: "day-1", trading_account_id: "account-2", date: "2026-10-08", opening_balance: 100_000, closing_balance: 100_250, daily_pnl: 250, total_trades: 2, winning_trades: 1, losing_trades: 1 },
        { id: "day-2", trading_account_id: "account-2", date: "2026-10-09", opening_balance: 100_250, closing_balance: 100_200, daily_pnl: -50, total_trades: 1, winning_trades: 0, losing_trades: 1 },
      ],
      meta: { total: 2, page: 1, page_size: 100, has_more: false },
    } as never);
    vi.mocked(fetchTerminalExecutions).mockResolvedValue({
      data: [{ id: "fill-1", trading_account_id: "account-2", order_id: "order-1", position_id: null, symbol: "NIFTY", qty: 1, price: 100, executed_at: "2026-10-08T05:00:00.000Z" }],
      meta: { total: 1, page: 1, page_size: 100, has_more: false },
    } as never);

    renderPage();

    await waitFor(() => expect(screen.getAllByText("₹200.00").length).toBeGreaterThan(0));
    expect(screen.getByText("33.33%")).toBeInTheDocument();
    expect(screen.getAllByText("₹66.67").length).toBeGreaterThan(0);
    expect(screen.getByText("FW-002")).toBeInTheDocument();
    expect(fetchTerminalPerformance).toHaveBeenCalledWith("account-2");
    expect(fetchTerminalRisk).toHaveBeenCalledWith("account-2");
    expect(fetchTerminalExecutions).toHaveBeenCalledWith("account-2");
    expect(fetchTerminalOrders).toHaveBeenCalledWith("account-2");
    expect(fetchTerminalPositions).toHaveBeenCalledWith("account-2");
  });

  it("does not show the prior account context while the newly selected context is loading", () => {
    setAccountState({
      activeAccountId: "account-2",
      accounts: [{ ...account, id: "account-2", account_code: "FW-002" }],
    });

    renderPage();

    expect(screen.getByText("FW-002")).toBeInTheDocument();
    expect(screen.getAllByText("Limit unavailable")).toHaveLength(2);
    expect(screen.queryByText("Evaluation / Phase 1")).not.toBeInTheDocument();
    expect(screen.getByText("Selected account · selected period")).toBeInTheDocument();
  });

  it("shows unavailable rather than fabricated trade-level win/loss statistics", () => {
    setAccountState();
    renderPage();

    expect(screen.getAllByText("—").length).toBeGreaterThan(5);
    expect(screen.getAllByText("Trade-level gross wins/losses unavailable").length).toBeGreaterThan(0);
    expect(screen.getByText("Individual winning and losing trade P&L is not present in the available account records.")).toBeInTheDocument();
  });
});
