import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarketHeader } from "@/components/dashboard/MarketHeader";

describe("market dashboard data status", () => {
  it("does not label available data as live while the market is closed", () => {
    render(<MarketHeader hasMarketData isConnected={false} isOpen={false} marketStatus="Closed" />);

    expect(screen.getByText("CLOSED")).toBeTruthy();
    expect(screen.queryByText("LIVE")).toBeNull();
  });

  it("distinguishes a connected realtime stream from REST polling", () => {
    const { rerender } = render(<MarketHeader hasMarketData isConnected={true} isOpen={true} marketStatus="Open" />);

    expect(screen.getByText("CONNECTED")).toBeTruthy();

    rerender(<MarketHeader hasMarketData isConnected={false} isOpen={true} marketStatus="Open" />);
    expect(screen.getByText("POLLING")).toBeTruthy();
  });

  it("reports offline when neither the stream nor market data is available", () => {
    render(<MarketHeader hasMarketData={false} isConnected={false} isOpen={true} marketStatus="Open" />);

    expect(screen.getByText("OFFLINE")).toBeTruthy();
  });
});
