import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useAccountContext", () => ({
  useAccountContext: vi.fn(),
}));

import { TradingAccountBar } from "@/components/TradingAccountBar";
import { useAccountContext } from "@/hooks/useAccountContext";

const account = {
  id: "account-1",
  account_code: "FW-10L-XXXX",
  trader_id: "user-1",
  broker_provider: null,
  balance: 100_000,
  status: "active" as const,
};

const accountContext = {
  identity: { trader_id: "user-1" },
  account: {
    id: account.id,
    owner_user_id: "user-1",
    status: "active",
    account_type: "challenge",
    current_balance: 95_000,
    equity: 94_000,
    available_margin: 90_000,
  },
  product: { name: "Funded" },
  phase: {},
  rules: { daily_loss_limit: 5_000, maximum_drawdown: 10_000 },
  permissions: {},
  risk_state: {
    status: "ACTIVE" as const,
    daily_loss: 1_000,
    drawdown_amount: 2_000,
    profit_target: 10_000,
    profit_current: 500,
    latest_snapshot: null,
    open_events: 2,
  },
};

function mockAccountContext(overrides: Record<string, unknown> = {}) {
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

describe("TradingAccountBar", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders canonical account metrics and a green ACTIVE status", () => {
    mockAccountContext();

    render(<TradingAccountBar />);

    expect(screen.getByText("FW-10L-XXXX")).toBeInTheDocument();
    expect(screen.getByText("₹95,000.00")).toBeInTheDocument();
    expect(screen.getByText("₹94,000.00")).toBeInTheDocument();
    expect(screen.getByText("+₹500.00")).toBeInTheDocument();
    expect(screen.getByText("₹1,000.00 / ₹5,000.00")).toBeInTheDocument();
    expect(screen.getByText("ACTIVE")).toHaveClass("text-bullish");
  }, 30_000);

  it("renders zero values and a neutral NO ACCOUNT status for an empty account list", () => {
    mockAccountContext({
      accounts: [],
      accountContext: undefined,
      activeAccountId: null,
      hasNoAccount: true,
    });

    render(<TradingAccountBar />);

    expect(screen.getByText("NO ACCOUNT")).toHaveClass("text-muted-foreground");
    expect(screen.queryByText(/Dhan|broker|connect/i)).not.toBeInTheDocument();
    expect(screen.getByText("Account Type").parentElement).toHaveTextContent("Account Type00");
    expect(screen.getByText("Balance").parentElement).toHaveTextContent("Balance00");
    expect(screen.getByText("Equity").parentElement).toHaveTextContent("Equity00");
    expect(screen.getByText("Available Funds").parentElement).toHaveTextContent("Available Funds00");
    expect(screen.getByText("Total P&L").parentElement).toHaveTextContent("Total P&L00");
    expect(screen.getByText("Daily Loss").parentElement).toHaveTextContent("Daily Loss00");
    expect(screen.getByText("Max Drawdown").parentElement).toHaveTextContent("Max Drawdown00");
    expect(screen.getByText("Profit Target").parentElement).toHaveTextContent("Profit Target00");
    expect(screen.getByText("Open Risk Events").parentElement).toHaveTextContent("Open Risk Events00");
  }, 30_000);

  it("uses a danger status color for a breached account", () => {
    mockAccountContext({
      accountContext: {
        ...accountContext,
        account: { ...accountContext.account, status: "breached" },
        risk_state: { ...accountContext.risk_state, status: "BREACHED" },
      },
    });

    render(<TradingAccountBar />);

    expect(screen.getByText("BREACHED")).toHaveClass("text-bearish");
  });

  it("offers the account selector when multiple FundedWealth accounts are available", () => {
    mockAccountContext({
      accounts: [account, { ...account, id: "account-2", account_code: "FW-25L-XXXX", status: "breached" }],
    });

    render(<TradingAccountBar />);
    expect(screen.getByRole("button", { name: /FW-10L-XXXX/i })).toHaveAttribute("aria-haspopup", "menu");
  }, 30_000);
});
