import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CustomerOrderTable, uniqueCanonicalOrders } from "@/components/CustomerOrderTable";
import type { TerminalOrder } from "@/lib/terminalApi";

function order(status: TerminalOrder["status"], overrides: Partial<TerminalOrder> = {}): TerminalOrder {
  return {
    id: `order-${status}`,
    accountId: "account-1",
    ownerUserId: "user-1",
    clientOrderId: null,
    brokerOrderId: null,
    instrumentId: null,
    symbol: "NIFTY",
    exchange: "NSE",
    segment: "F&O",
    instrumentType: "INDEX",
    side: "BUY",
    orderType: "LIMIT",
    quantity: 10,
    filledQuantity: status === "filled" ? 10 : 0,
    price: 100,
    averageFillPrice: null,
    triggerPrice: null,
    stopLoss: null,
    takeProfit: null,
    timeInForce: "DAY",
    status,
    rejectionReason: null,
    cancellationReason: null,
    parentOrderId: null,
    replacesOrderId: null,
    createdAt: "2026-09-24T09:00:00.000Z",
    submittedAt: null,
    updatedAt: "2026-09-24T09:00:00.000Z",
    cancelRequestedAt: null,
    cancelledAt: null,
    completedAt: null,
    ...overrides,
  };
}

describe("CustomerOrderTable", () => {
  it("renders all canonical lifecycle states and backend reasons", () => {
    const statuses: TerminalOrder["status"][] = ["requested", "pending", "open", "partially_filled", "filled", "cancel_requested", "cancelled", "rejected", "failed"];
    const orders = statuses.map((status) => order(status, status === "rejected" ? { rejectionReason: "Risk policy rejected" } : status === "failed" ? { rejectionReason: "Broker timeout" } : undefined));

    render(<CustomerOrderTable orders={orders} />);

    for (const label of ["Requested", "Pending", "Open", "Partially filled", "Filled", "Cancel requested", "Cancelled", "Rejected", "Failed"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText("Risk policy rejected")).toBeInTheDocument();
    expect(screen.getByText("Broker timeout")).toBeInTheDocument();
  });

  it("shows controls only for cancellable and modifiable states", () => {
    const onCancel = vi.fn();
    const onModify = vi.fn();
    render(<CustomerOrderTable orders={[order("open"), order("cancel_requested"), order("filled")]} onCancel={onCancel} onModify={onModify} />);

    expect(screen.getByRole("button", { name: "Cancel order-open" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Modify order-open" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Cancel order-cancel_requested" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Modify order-cancel_requested" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel order-filled" })).not.toBeInTheDocument();
    expect(screen.getAllByText("Immutable terminal state")).toHaveLength(1);
  });

  it("deduplicates duplicate or retried canonical responses by order id", () => {
    const first = order("pending", { id: "same-order" });
    const second = order("open", { id: "same-order", updatedAt: "2026-09-24T09:01:00.000Z" });
    expect(uniqueCanonicalOrders([second, first])).toEqual([second]);
    render(<CustomerOrderTable orders={[second, first]} />);
    expect(screen.getAllByText("Open")).toHaveLength(1);
    expect(screen.queryByText("Pending")).not.toBeInTheDocument();
  });

  it("handles loading, unauthorized/error, empty, and reconnect states", () => {
    const onRetry = vi.fn();
    const { rerender } = render(<CustomerOrderTable orders={[]} isLoading />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading canonical orders");

    rerender(<CustomerOrderTable orders={[]} isError errorMessage="Authenticated user is required" onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Authenticated user is required");
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledOnce();

    rerender(<CustomerOrderTable orders={[]} />);
    expect(screen.getByText("No canonical orders recorded")).toBeInTheDocument();

    rerender(<CustomerOrderTable orders={[order("open")]} isFetching />);
    expect(screen.getByText("Refreshing canonical order state...")).toBeInTheDocument();
  });
});