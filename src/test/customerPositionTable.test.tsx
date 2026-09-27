import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CustomerPositionTable, uniqueCanonicalPositions } from "@/components/CustomerPositionTable";
import type { TerminalPosition } from "@/lib/terminalApi";

function position(overrides: Partial<TerminalPosition> = {}): TerminalPosition {
  return {
    id: "position-1",
    trading_account_id: "account-1",
    symbol: "NIFTY",
    exchange: "NSE",
    side: "LONG",
    qty: 10,
    quantity: 10,
    avg_price: 100,
    average_price: 100,
    current_price: 110,
    last_price: 110,
    realized_pnl: 0,
    unrealized_pnl: 100,
    is_open: true,
    position_status: "open",
    opened_at: "2026-09-24T09:00:00.000Z",
    updated_at: "2026-09-24T09:05:00.000Z",
    ...overrides,
  } as TerminalPosition;
}

describe("CustomerPositionTable", () => {
  it("renders canonical LONG positions with authoritative realized and unrealized P&L values", () => {
    render(<CustomerPositionTable positions={[position({ realized_pnl: 250, unrealized_pnl: 100 })]} />);

    expect(screen.getByText("NIFTY")).toBeInTheDocument();
    expect(screen.getByText("LONG")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("₹100.00")).toBeInTheDocument();
    expect(screen.getByText("+₹250.00")).toBeInTheDocument();
    expect(screen.getByText("+₹100.00")).toBeInTheDocument();
  });

  it("renders canonical SHORT positions with negative authoritative P&L values without recalculating them", () => {
    render(<CustomerPositionTable positions={[position({ symbol: "BANKNIFTY", side: "SHORT", qty: 5, quantity: 5, avg_price: 210, average_price: 210, current_price: 205, last_price: 205, realized_pnl: -125, unrealized_pnl: -25, is_open: true, position_status: "open" })]} />);

    expect(screen.getByText("BANKNIFTY")).toBeInTheDocument();
    expect(screen.getByText("SHORT")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("₹210.00")).toBeInTheDocument();
    expect(screen.getByText("-₹125.00")).toBeInTheDocument();
    expect(screen.getByText("-₹25.00")).toBeInTheDocument();
  });

  it("deduplicates stale or retried canonical responses and keeps the newest authoritative P&L state", () => {
    const first = position({ id: "same-position", updated_at: "2026-09-24T09:00:00.000Z", qty: 3, quantity: 3, avg_price: 100, average_price: 100, realized_pnl: 0, unrealized_pnl: 0 });
    const second = position({ id: "same-position", updated_at: "2026-09-24T09:10:00.000Z", qty: 7, quantity: 7, avg_price: 102, average_price: 102, current_price: 112, last_price: 112, realized_pnl: 150, unrealized_pnl: 70 });

    expect(uniqueCanonicalPositions([second, first])).toEqual([second]);
    render(<CustomerPositionTable positions={[second, first]} />);

    expect(screen.getAllByText("NIFTY")).toHaveLength(1);
    expect(screen.getAllByText("7")).toHaveLength(1);
    expect(screen.getByText("₹102.00")).toBeInTheDocument();
    expect(screen.getByText("+₹150.00")).toBeInTheDocument();
    expect(screen.getByText("+₹70.00")).toBeInTheDocument();
  });

  it("handles loading, empty, error, and reconnect states", () => {
    const onRetry = vi.fn();
    const { rerender } = render(<CustomerPositionTable positions={[]} isLoading />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading canonical positions");

    rerender(<CustomerPositionTable positions={[]} isError errorMessage="Authenticated user is required" onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Authenticated user is required");

    rerender(<CustomerPositionTable positions={[]} />);
    expect(screen.getByText("No canonical positions recorded")).toBeInTheDocument();

    rerender(<CustomerPositionTable positions={[position({ realized_pnl: 0, unrealized_pnl: 0 })]} isFetching />);
    expect(screen.getByText("Refreshing canonical position state...")).toBeInTheDocument();
  });

  it("shows zero and authoritative refreshed P&L values while filtering closed positions", () => {
    const { rerender } = render(<CustomerPositionTable positions={[position({ id: "open-pos", realized_pnl: 0, unrealized_pnl: 0, position_status: "open" }), position({ id: "closed-pos", symbol: "TCS", side: "SHORT", qty: 2, quantity: 2, avg_price: 340, average_price: 340, current_price: 330, last_price: 330, realized_pnl: 50, unrealized_pnl: -10, is_open: false, position_status: "closed" })]} />);

    expect(screen.getByText("NIFTY")).toBeInTheDocument();
    expect(screen.queryByText("TCS")).not.toBeInTheDocument();
    expect(screen.getAllByText("₹0.00")).toHaveLength(2);

    rerender(<CustomerPositionTable positions={[position({ id: "open-pos", realized_pnl: 120, unrealized_pnl: -15, position_status: "open" })]} />);
    expect(screen.getByText("+₹120.00")).toBeInTheDocument();
    expect(screen.getByText("-₹15.00")).toBeInTheDocument();
  });
});
