import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useMarketData", () => ({
  useMarketStatus: () => ({ data: { isOpen: true } }),
}));
vi.mock("@/hooks/useLocalDatabase", () => ({
  useInstrumentLookup: () => ({
    instruments: [
      { securityId: "13", providerInstrumentId: "13", provider: "dhan", symbol: "NIFTY", tradingSymbol: "NIFTY", exchange: "NSE", exchangeSegment: "IDX_I", instrumentType: "INDEX", lotSize: 1, tickSize: 0.05 },
      { securityId: "2885", providerInstrumentId: "2885", provider: "dhan", symbol: "RELIANCE INDUSTRIES LTD", tradingSymbol: "RELIANCE", exchange: "NSE", exchangeSegment: "NSE_EQ", instrumentType: "EQUITY", series: "EQ", lotSize: 1, tickSize: 0.05 },
      { securityId: "23669", providerInstrumentId: "23669", provider: "dhan", symbol: "AAFS MARKET LINKED 2027", tradingSymbol: "AAFS27C", exchange: "NSE", exchangeSegment: "NSE_EQ", instrumentType: "EQUITY", series: "N4", lotSize: 1, tickSize: 0.05 },
    ],
    isLoaded: true,
    loadError: null,
  }),
}));
vi.mock("@/hooks/useAccountContext", () => ({
  useAccountContext: () => ({ activeAccountId: null, accounts: [] }),
}));
vi.mock("@/components/MiniChart", () => ({ MiniChart: () => <span data-testid="mini-chart" /> }));

import Watchlist from "@/pages/Watchlist";

function CurrentLocation() {
  const location = useLocation();
  return <output data-testid="current-location">{location.pathname}{location.search}</output>;
}

function renderWatchlist() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/watchlist"]}>
        <Routes>
          <Route path="/watchlist" element={<Watchlist />} />
          <Route path="*" element={<CurrentLocation />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Watchlist instrument chart navigation", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("optionsdesk_watchlist", JSON.stringify(["NIFTY", "RELIANCE"]));
  });

  it("opens an index in the index chart workspace", async () => {
    renderWatchlist();
    fireEvent.click(screen.getByRole("button", { name: "View chart for NIFTY" }));

    await waitFor(() => expect(screen.getByTestId("current-location")).toHaveTextContent("/indices?symbol=NIFTY"));
  });

  it("opens a stock in the stock chart workspace", async () => {
    renderWatchlist();
    fireEvent.click(screen.getByRole("button", { name: "View chart for RELIANCE" }));

    await waitFor(() => expect(screen.getByTestId("current-location")).toHaveTextContent("/stocks?symbol=RELIANCE"));
  });

  it("excludes legacy debt-series instruments from watchlist rows", () => {
    localStorage.setItem("optionsdesk_watchlist", JSON.stringify(["NIFTY", "RELIANCE", "AAFS27C"]));
    renderWatchlist();

    expect(screen.getByRole("button", { name: "View chart for NIFTY" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View chart for RELIANCE" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "View chart for AAFS27C" })).not.toBeInTheDocument();
    expect(screen.getByText(/2 supported symbols/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("No supported cash-equity or index instrument found for 1 watchlist symbol: AAFS27C");
  });

  it("rejects adding a debt-series instrument", () => {
    renderWatchlist();
    fireEvent.change(screen.getByPlaceholderText("Add symbol..."), { target: { value: "AAFS27C" } });
    fireEvent.click(screen.getByRole("button", { name: /add/i }));
    expect(screen.getByRole("alert")).toHaveTextContent("Only supported cash-equity stocks and indices can be added.");
  });
});
