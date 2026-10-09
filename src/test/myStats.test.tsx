import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useAccountContext", () => ({
  useAccountContext: vi.fn(),
}));

import { useAccountContext } from "@/hooks/useAccountContext";
import MyStats from "@/pages/MyStats";

describe("MyStats empty account state", () => {
  it("shows neutral 00 placeholders instead of asking customers to connect a broker", () => {
    vi.mocked(useAccountContext).mockReturnValue({
      accounts: [],
      accountContext: undefined,
      activeAccountId: null,
      isLoading: false,
      isError: false,
      error: null,
      hasNoAccount: true,
      selectAccount: vi.fn().mockResolvedValue(undefined),
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <MyStats />
      </QueryClientProvider>,
    );

    expect(screen.getByRole("heading", { name: "MY STATS" })).toBeInTheDocument();
    expect(screen.getByText("NO ACCOUNT")).toHaveClass("text-muted-foreground");
    for (const label of ["Net P&L", "Trades", "Win Rate", "Avg. P&L / Trade", "Daily Drawdown", "Maximum Drawdown", "Current Equity", "Profit Target"]) {
      const metric = screen.getByText(label).parentElement;
      expect(metric).toHaveTextContent("00");
    }
    expect(screen.queryByText(/Dhan|broker|connect/i)).not.toBeInTheDocument();
  });
});
