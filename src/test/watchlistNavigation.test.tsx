import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useMarketData", () => ({
  useMarketStatus: () => ({ data: { isOpen: true } }),
}));
vi.mock("@/hooks/useLocalDatabase", () => ({
  useInstrumentLookup: () => ({ instruments: [], isLoaded: true, loadError: null }),
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
});
