import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { InstrumentExplorer } from "@/components/InstrumentExplorer";
import { useLiveOptionChain } from "@/hooks/useMarketData";
import { createTerminalOrder, fetchTerminalExecutions, fetchTerminalOrders, fetchTerminalPositions, modifyTerminalPositionProtection } from "@/lib/terminalApi";

vi.mock("@/hooks/useLocalDatabase", () => ({
  useInstrumentLookup: () => ({
    instruments: [
      { securityId: "500002", symbol: "ABB", tradingSymbol: "ABB", displayName: "ABB Ltd", exchange: "BSE", exchangeSegment: "BSE_EQ", instrumentType: "EQUITY", lotSize: 1, tickSize: 0.05, provider: "test", providerInstrumentId: "500002" },
      { securityId: "500490", symbol: "ABB", tradingSymbol: "ABB", displayName: "ABB Ltd", exchange: "NSE", exchangeSegment: "NSE_EQ", instrumentType: "EQUITY", lotSize: 1, tickSize: 0.05, provider: "test", providerInstrumentId: "500490" },
      { securityId: "18920450", symbol: "NIFTY", tradingSymbol: "NIFTY26SEP23150CE", displayName: "NIFTY 23150 CE", exchange: "NSE", exchangeSegment: "NSE_FNO", instrumentType: "OPTIDX", lotSize: 65, tickSize: 0.05, expiryDate: "2026-09-29", strikePrice: 23150, optionType: "CE", provider: "zerodha", providerInstrumentId: "18920450" },
    ],
    isLoaded: true,
  }),
}));

vi.mock("@/hooks/useMarketData", () => ({
  useLiveOptionChain: vi.fn().mockReturnValue({ data: null, isLoading: false }),
}));

vi.mock("@/lib/marketApi", () => ({
  fetchInstrumentMaster: vi.fn().mockResolvedValue({ instruments: [] }),
}));

vi.mock("@/lib/terminalApi", () => ({
  createClientOrderId: vi.fn(() => "mock-client-order-id"),
  resolveTerminalMarketDataProvider: vi.fn((provider?: string) =>
    provider === "dhan" ? "dhan" : provider === "kite" || provider === "zerodha" ? "kite" : null
  ),
  createTerminalOrder: vi.fn().mockResolvedValue({ ok: true, order: { id: "mock-order" } }),
  modifyTerminalPositionProtection: vi.fn().mockResolvedValue({}),
  fetchTerminalPositions: vi.fn().mockResolvedValue({
    data: [{
      id: "pos-001",
      trading_account_id: "account-1",
      account_id: "account-1",
      symbol: "BANKNIFTY",
      side: "LONG",
      qty: 1,
      quantity: 1,
      avg_price: 51000,
      average_price: 51000,
      current_price: 51250,
      last_price: 51250,
      stop_loss: 50750,
      take_profit: 51600,
      is_open: true,
      position_status: "open",
      updated_at: "2026-09-26T04:00:00.000Z",
    }],
    meta: { total: 1, page: 1, page_size: 1, has_more: false },
  }),
  fetchTerminalOrders: vi.fn().mockResolvedValue({
    data: [{
      id: "ord-001",
      account_id: "account-1",
      user_id: "user-1",
      symbol: "BANKNIFTY",
      side: "BUY",
      quantity: 1,
      filled_quantity: 1,
      status: "filled",
      order_type: "MARKET",
      price: 51000,
      stop_loss: 50750,
      take_profit: 51600,
      created_at: "2026-09-26T03:55:00.000Z",
      updated_at: "2026-09-26T03:55:00.000Z",
      order_id: "ord-001",
      client_order_id: "client-ord-001",
      exchange: "NSE",
      segment: "NSE_EQ",
      is_overnight: false,
      product: "CNC",
      time_in_force: "DAY",
      broker_order_id: null,
      rejection_reason: null,
      cancellation_reason: null,
    }],
    meta: { total: 1, page: 1, page_size: 1, has_more: false },
  }),
  fetchTerminalExecutions: vi.fn().mockResolvedValue({
    data: [{
      id: "exec-001",
      trading_account_id: "account-1",
      order_id: "ord-001",
      position_id: "pos-001",
      symbol: "BANKNIFTY",
      qty: 1,
      price: 51000,
      executed_at: "2026-09-26T03:55:30.000Z",
    }],
    meta: { total: 1, page: 1, page_size: 1, has_more: false },
  }),
  fetchTerminalRisk: vi.fn().mockResolvedValue({ data: { accounts_at_risk: 0, breached: 0, critical: 0, warning: 0, recent_events: [] } }),
}));

vi.mock("@/components/StockChart", () => ({
  StockChart: ({ symbol, instrumentToken, unavailableMessage }: { symbol: string; instrumentToken?: string; unavailableMessage?: string }) => <div data-testid="stock-chart" data-instrument-token={instrumentToken} data-unavailable-message={unavailableMessage}>{symbol} chart mock</div>,
}));

describe("InstrumentExplorer stock workspace", () => {
  it("opens the existing chart workspace for a stock row using the same shared layout", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <InstrumentExplorer
          title="Stocks"
          subtitle="NSE-listed equity quotes."
          asset="stocks"
          rows={[
            {
              symbol: "ABB",
              chartSymbol: "ABB",
              label: "ABB LIMITED",
              ltp: 7051.5,
              change: -77.5,
              changePercent: -1.09,
              open: 7000,
              high: 7100,
              low: 6900,
              volume: 10000,
              instrument: { securityId: "500490", symbol: "ABB", tradingSymbol: "ABB", displayName: "ABB Limited", exchange: "NSE", exchangeSegment: "NSE_EQ", instrumentType: "EQUITY", lotSize: 1, tickSize: 0.05, provider: "dhan", providerInstrumentId: "500490" },
            },
          ]}
          isLoading={false}
          watchedSymbols={[]}
          onToggleWatchlist={() => {}}
          hasNoAccount
        />
      </QueryClientProvider>
    );

    expect(screen.getAllByRole("columnheader").map((header) => header.textContent?.trim())).toEqual([
      "SYMBOL", "LTP", "CHG", "CHG%", "OPEN", "HIGH", "LOW", "VOLUME", "CHART", "ACTIONS",
    ]);
    expect(screen.queryByText("NSE_EQ")).not.toBeInTheDocument();
    expect(screen.queryByText("500490")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open ABB stock chart" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open ABB stock chart" }));

    expect(screen.getByRole("button", { name: /back to stocks/i })).toBeInTheDocument();
    expect(screen.getAllByText("ABB").length).toBeGreaterThan(1);
    expect(screen.getAllByText("NSE").length).toBeGreaterThan(1);
    expect(screen.getByTestId("stock-chart")).toHaveTextContent("ABB chart mock");
    expect(screen.getByTestId("stock-chart")).toHaveAttribute("data-unavailable-message", "Historical market data is currently unavailable for this chart.");
    expect(screen.queryByText(/Dhan|broker|link .*account/i)).not.toBeInTheDocument();
    expect(screen.getByText("UNAVAILABLE")).toBeInTheDocument();
    expect(screen.queryByText("LIVE")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Option Chain" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Futures" })).not.toBeInTheDocument();
  });

  it("opens the full index chart workspace and only shows trading positions when active", async () => {
    vi.mocked(fetchTerminalPositions).mockResolvedValueOnce({ data: [], meta: { total: 0, page: 1, page_size: 100, has_more: false } });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <InstrumentExplorer
          title="Indices"
          subtitle="NSE index quotes."
          asset="indices"
          rows={[
            { symbol: "NIFTY", label: "NIFTY 50", ltp: 23140.5, change: 77.4, changePercent: 0.34, open: 23035, high: 23162.7, low: 23020.95, volume: null },
            { symbol: "MIDCPNIFTY", chartSymbol: "NIFTY_MIDCAP_50", label: "NIFTY MIDCAP 50", ltp: 17474.1, change: -43.95, changePercent: -0.25, open: 17501.5, high: 17557.55, low: 17378.85, volume: null },
          ]}
          isLoading={false}
          watchedSymbols={[]}
          onToggleWatchlist={() => {}}
          activeAccountId="account-1"
        />
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "View chart for NIFTY" }));
    await waitFor(() => expect(queryClient.getQueryState(["terminal-os", "positions", "account-1"])?.status).toBe("success"));

    expect(screen.getByRole("button", { name: /back to indices/i })).toBeInTheDocument();
    expect(screen.getByText("NIFTY 50")).toBeInTheDocument();
    expect(screen.getAllByText("NSE · IDX_I")).toHaveLength(3);
    expect(screen.getAllByText("₹23,140.50")).toHaveLength(2);
    expect(screen.getByTestId("stock-chart")).toHaveTextContent("NIFTY chart mock");
    expect(screen.queryByRole("button", { name: "Option Chain" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Futures" })).not.toBeInTheDocument();
    expect(screen.getByTestId("bottom-trading-workspace")).toBeInTheDocument();
    expect(screen.getByText("No active positions")).toBeInTheDocument();

    queryClient.setQueryData(["terminal-os", "positions", "account-1"], {
      data: [{ id: "index-position-1", account_id: "account-1", trading_account_id: "account-1", symbol: "NIFTY", side: "LONG", qty: 1, avg_price: 23140, is_open: true, position_status: "open" }],
      meta: { total: 1, page: 1, page_size: 1, has_more: false },
    });
    await waitFor(() => expect(screen.getByTestId("bottom-trading-workspace")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /back to indices/i }));
    fireEvent.click(screen.getByRole("button", { name: "View chart for MIDCPNIFTY" }));

    expect(screen.getByText("NIFTY MIDCAP 50")).toBeInTheDocument();
    expect(screen.getAllByText("₹17,474.10")).toHaveLength(2);
    expect(screen.getByTestId("stock-chart")).toHaveTextContent("NIFTY_MIDCAP_50 chart mock");
    fireEvent.click(screen.getByRole("button", { name: /MIDCPNIFTY NSE · IDX_I/i }));
    expect(screen.getByTestId("stock-chart")).toHaveTextContent("NIFTY_MIDCAP_50 chart mock");
  });

  it("routes one-lot Kite futures BUY and SELL through the simulated existing ticket", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.mocked(createTerminalOrder).mockClear();
    const futuresInstrument = { securityId: "12345", symbol: "NIFTY", tradingSymbol: "NIFTY26DEC26FUT", displayName: "NIFTY26DEC26FUT", exchange: "NSE", exchangeSegment: "NFO", instrumentType: "FUTIDX", lotSize: 65, tickSize: 0.05, expiryDate: "2026-12-31", provider: "zerodha", providerInstrumentId: "12345" };

    render(
      <QueryClientProvider client={queryClient}>
        <InstrumentExplorer
          title="Futures"
          subtitle="NSE futures contracts."
          asset="futures"
          rows={[{ symbol: "NIFTY", chartSymbol: futuresInstrument.tradingSymbol, instrument: futuresInstrument, label: futuresInstrument.tradingSymbol, contract: futuresInstrument.tradingSymbol, underlying: "NIFTY", expiry: "2026-12-31", ltp: 25000, change: 25, changePercent: 0.35, open: 24900, high: 25100, low: 24850, volume: 1200, oi: 8400, oiChange: null }]}
          isLoading={false}
          watchedSymbols={[]}
          onToggleWatchlist={() => {}}
          activeAccountId="account-1"
        />
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "View chart for NIFTY" }));

    expect(screen.getByRole("button", { name: /back to futures/i })).toBeInTheDocument();
    expect(screen.getByTestId("stock-chart")).toHaveTextContent("NIFTY26DEC26FUT chart mock");
    expect(screen.getByTestId("stock-chart")).toHaveAttribute("data-instrument-token", "12345");
    expect(screen.queryByTestId("bottom-trading-workspace")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "BUY" }));
    let ticket = screen.getByRole("dialog", { name: "SIMULATED BUY order ticket" });
    expect(within(ticket).getByRole("spinbutton", { name: "Units / Quantity" })).toHaveValue(65);
    fireEvent.click(within(ticket).getByRole("button", { name: "SIMULATED BUY Market" }));
    await waitFor(() => expect(createTerminalOrder).toHaveBeenCalledWith(expect.objectContaining({
      account_id: "account-1",
      symbol: "NIFTY26DEC26FUT",
      exchange: "NSE",
      segment: "NSE_FNO",
      side: "BUY",
      quantity: 65,
      price: 25000,
      product: "NRML",
      instrument: expect.objectContaining({ provider: "zerodha", instrumentType: "FUTIDX", exchangeSegment: "NSE_FNO" }),
    })));

    fireEvent.click(within(ticket).getByRole("button", { name: "SIMULATED SELL" }));
    ticket = screen.getByRole("dialog", { name: "SIMULATED SELL order ticket" });
    fireEvent.click(within(ticket).getByRole("button", { name: "SIMULATED SELL Market" }));
    await waitFor(() => expect(createTerminalOrder).toHaveBeenCalledWith(expect.objectContaining({
      symbol: "NIFTY26DEC26FUT",
      side: "SELL",
      quantity: 65,
      product: "NRML",
      instrument: expect.objectContaining({ provider: "zerodha", exchangeSegment: "NSE_FNO" }),
    })));
  });

  it("prices a deep-linked Kite option ticket from its real chain leg", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const chainData = {
      chain: [{ strikePrice: 23150, ce: { ltp: 119.25, oi: 1000, oiChange: 0, volume: 500, iv: 0, delta: 0, gamma: 0, theta: 0, vega: 0, bidPrice: 0, askPrice: 0 }, pe: { ltp: 76.75, oi: 1200, oiChange: 0, volume: 400, iv: 0, delta: 0, gamma: 0, theta: 0, vega: 0, bidPrice: 0, askPrice: 0 } }],
      spotPrice: 23140.5,
      expiries: [{ label: "2026-09-29", value: "2026-09-29", daysToExpiry: 2 }],
      lotSize: 65,
      stepSize: 50,
      maxPain: 0,
      totalCEOI: 1000,
      totalPEOI: 1200,
      isLive: false,
      afterHours: true,
      source: "zerodha",
      cachedAt: null,
    };
    vi.mocked(useLiveOptionChain).mockReturnValue({ data: chainData, isLoading: false } as ReturnType<typeof useLiveOptionChain>);
    vi.mocked(createTerminalOrder).mockClear();

    render(
      <QueryClientProvider client={queryClient}>
        <InstrumentExplorer
          title="Stocks"
          subtitle="NSE-listed equity quotes."
          asset="stocks"
          rows={[]}
          isLoading={false}
          watchedSymbols={[]}
          onToggleWatchlist={() => {}}
          activeAccountId="account-1"
          initialWorkspaceContext="options"
          initialChartSymbol="NIFTY26SEP23150CE"
          initialUnderlying="NIFTY"
          initialExpiry="2026-09-29"
          initialInstrumentToken="18920450"
        />
      </QueryClientProvider>
    );

    await waitFor(() => expect(screen.getAllByText("₹119.25").length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: "BUY" }));
    const ticket = screen.getByRole("dialog", { name: "SIMULATED BUY order ticket" });
    expect(within(ticket).getByText("₹119.25")).toBeInTheDocument();
    expect(within(ticket).getByRole("spinbutton", { name: "Units / Quantity" })).toHaveValue(65);
    fireEvent.click(within(ticket).getByRole("button", { name: "SIMULATED BUY Market" }));

    await waitFor(() => expect(createTerminalOrder).toHaveBeenCalledWith(expect.objectContaining({
      account_id: "account-1",
      symbol: "NIFTY26SEP23150CE",
      side: "BUY",
      quantity: 65,
      price: 119.25,
      product: "NRML",
      instrument: expect.objectContaining({ providerInstrumentId: "18920450", instrumentType: "OPTIDX" }),
    })));
    vi.mocked(useLiveOptionChain).mockReturnValue({ data: null, isLoading: false } as ReturnType<typeof useLiveOptionChain>);
  });

  it("opens the chart workspace and keeps order ticket controls and payload consistent", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <InstrumentExplorer
          title="Stocks"
          subtitle="NSE-listed equity quotes."
          asset="stocks"
          rows={[
            { symbol: "ABB", label: "ABB", ltp: 7051.5, change: -77.5, changePercent: -1.09, open: 7000, high: 7100, low: 6900, volume: 10000 },
            { symbol: "ASIANPAINT", label: "ASIANPAINT", ltp: 2000, change: 10, changePercent: 0.5, open: 1990, high: 2030, low: 1950, volume: 8000 },
          ]}
          isLoading={false}
          watchedSymbols={[]}
          onToggleWatchlist={() => {}}
          activeAccountId="account-1"
        />
      </QueryClientProvider>
    );

    fireEvent.click(screen.getAllByTitle("View Chart")[0]);

    expect(screen.getByRole("button", { name: /back to stocks/i })).toBeInTheDocument();
    expect(screen.getByText(/^stocks$/i)).toBeInTheDocument();
    expect(screen.getByTestId("stock-chart")).toHaveTextContent("ABB chart mock");

    fireEvent.click(screen.getByRole("button", { name: /^BUY$/ }));
    const ticket = screen.getByRole("dialog", { name: "SIMULATED BUY order ticket" });
    expect(ticket).toHaveTextContent("ABB");
    expect(ticket).toHaveTextContent("NSE_EQ · simulated order ticket");
    expect(ticket).toHaveTextContent("NSE");
    expect(ticket).toHaveTextContent("₹7,051.50");
    expect(ticket).toHaveTextContent("Risk, INR");
    expect(within(ticket).getByRole("button", { name: "SIMULATED BUY" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("tab", { name: "Limit" }));
    expect(screen.getByLabelText("Limit price")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Stop" }));
    expect(screen.getByLabelText("Trigger price")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Stop-Limit" }));
    expect(screen.getByLabelText("Limit price")).toBeInTheDocument();
    expect(screen.getByLabelText("Trigger price")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Market" }));
    fireEvent.click(screen.getByLabelText("Take profit"));
    fireEvent.click(screen.getByLabelText("Stop loss"));
    expect(screen.getByLabelText("Take profit price")).toHaveValue(7055.25);
    expect(screen.getByLabelText("Stop loss price")).toHaveValue(7050.25);
    expect(screen.getByText("₹1.25")).toBeInTheDocument();

    fireEvent.click(within(ticket).getByRole("button", { name: "SIMULATED SELL" }));
    const sellTicket = screen.getByRole("dialog", { name: "SIMULATED SELL order ticket" });
    expect(within(sellTicket).getByRole("button", { name: "SIMULATED SELL" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Take profit price")).toHaveValue(7047.75);
    expect(screen.getByLabelText("Stop loss price")).toHaveValue(7052.75);

    fireEvent.click(within(sellTicket).getByRole("button", { name: "SIMULATED BUY" }));
    const buyTicket = screen.getByRole("dialog", { name: "SIMULATED BUY order ticket" });
    expect(within(buyTicket).getByRole("button", { name: "SIMULATED BUY" })).toHaveAttribute("aria-pressed", "true");
    for (const orderType of ["Market", "Limit", "Stop", "Stop-Limit"]) {
      expect(screen.getByRole("tab", { name: orderType })).toBeInTheDocument();
    }
    expect(screen.getByLabelText("Units / Quantity")).toHaveValue(1);

    fireEvent.click(within(buyTicket).getByRole("button", { name: "SIMULATED SELL" }));
    const sellOrderTicket = screen.getByRole("dialog", { name: "SIMULATED SELL order ticket" });
    fireEvent.click(within(sellOrderTicket).getByRole("button", { name: "SIMULATED SELL Market" }));
    await waitFor(() => expect(createTerminalOrder).toHaveBeenCalledWith(expect.objectContaining({
      side: "SELL",
      order_type: "MARKET",
      segment: "NSE_EQ",
      stop_loss: 7052.75,
      take_profit: 7047.75,
    })));

    fireEvent.click(within(sellOrderTicket).getByRole("button", { name: "Close order ticket" }));
    fireEvent.click(screen.getByRole("button", { name: /^SELL$/ }));
    const headerSellTicket = screen.getByRole("dialog", { name: "SIMULATED SELL order ticket" });
    expect(within(headerSellTicket).getByRole("button", { name: "SIMULATED SELL" })).toHaveAttribute("aria-pressed", "true");
  }, 15_000);

  it("shows no positions when canonical position, order, and execution reads are empty", async () => {
    vi.mocked(fetchTerminalPositions).mockResolvedValueOnce({ data: [], meta: { total: 0, page: 1, page_size: 100, has_more: false } });
    vi.mocked(fetchTerminalOrders).mockResolvedValueOnce({ data: [], meta: { total: 0, page: 1, page_size: 100, has_more: false } });
    vi.mocked(fetchTerminalExecutions).mockResolvedValueOnce({ data: [], meta: { total: 0, page: 1, page_size: 100, has_more: false } });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <InstrumentExplorer
          title="Stocks"
          subtitle="NSE-listed equity quotes."
          asset="stocks"
          rows={[{ symbol: "BANKNIFTY", label: "BANKNIFTY", ltp: 51250, change: 250, changePercent: 0.49, open: 50880, high: 51320, low: 50740, volume: 370000 }]}
          isLoading={false}
          watchedSymbols={[]}
          onToggleWatchlist={() => {}}
          activeAccountId="account-1"
        />
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByTitle("View Chart"));

    await waitFor(() => expect(screen.getByText(/Positions \[0\]/i)).toBeInTheDocument(), { timeout: 3000 });
    expect(screen.getByText("No active positions")).toBeInTheDocument();
  });

  it("renders the compact bottom workspace for the canonical open position", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <InstrumentExplorer
          title="Stocks"
          subtitle="NSE-listed equity quotes."
          asset="stocks"
          rows={[{ symbol: "BANKNIFTY", label: "BANKNIFTY", ltp: 51250, change: 250, changePercent: 0.49, open: 50880, high: 51320, low: 50740, volume: 370000 }]}
          isLoading={false}
          watchedSymbols={[]}
          onToggleWatchlist={() => {}}
          activeAccountId="account-1"
        />
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByTitle("View Chart"));

    await waitFor(() => expect(screen.getByText(/Positions \[1\]/i)).toBeInTheDocument(), { timeout: 3000 });
    expect(screen.getByText("Enter the Market")).toBeInTheDocument();
    const workspaces = screen.getAllByTestId("bottom-trading-workspace");
    expect(workspaces).toHaveLength(1);
    const workspace = workspaces[0];
    const chart = screen.getByTestId("stock-chart");
    expect(chart.compareDocumentPosition(workspace) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(workspace).getByRole("button", { name: "Balance" })).toBeInTheDocument();
    expect(within(workspace).getByRole("button", { name: "Close All" })).toBeInTheDocument();
    expect(Array.from(workspace.querySelectorAll("th")).map((header) => header.textContent)).toEqual([
      "Instrument", "Entry Time (UTC)", "Type", "Side", "Amount", "Entry Price", "Stop Loss", "Take Profit", "Exit Time (UTC)", "Exit Price", "P&L", "Net P&L", "X",
    ]);
    expect(within(workspace).getByRole("spinbutton", { name: "Stop Loss for BANKNIFTY" })).toHaveValue(50750);
    expect(within(workspace).getByRole("spinbutton", { name: "Take Profit for BANKNIFTY" })).toHaveValue(51600);
    expect(within(workspace).getByRole("button", { name: "Close position BANKNIFTY" })).toBeInTheDocument();
    expect(within(workspace).queryByText("ord-001")).not.toBeInTheDocument();
    expect(within(workspace).queryByText("pos-001")).not.toBeInTheDocument();

    fireEvent.change(within(workspace).getByRole("spinbutton", { name: "Stop Loss for BANKNIFTY" }), { target: { value: "50800" } });
    fireEvent.blur(within(workspace).getByRole("spinbutton", { name: "Stop Loss for BANKNIFTY" }));
    await waitFor(() => expect(modifyTerminalPositionProtection).toHaveBeenCalledWith("pos-001", "stop_loss", 50800));

    fireEvent.click(within(workspace).getByRole("button", { name: "Close position BANKNIFTY" }));
    await waitFor(() => expect(createTerminalOrder).toHaveBeenCalledWith(expect.objectContaining({
      account_id: "account-1",
      symbol: "BANKNIFTY",
      side: "SELL",
      quantity: 1,
      order_type: "MARKET",
    })));
  }, 15_000);
});
