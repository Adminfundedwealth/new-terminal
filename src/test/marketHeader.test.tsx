import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarketHeader } from "@/components/dashboard/MarketHeader";

describe("market dashboard data status", () => {
  it("does not label available data as live while the market is closed", () => {
    render(<MarketHeader hasMarketData isLive={false} isOpen={false} marketStatus="Closed" />);

    expect(screen.getByText("CLOSED")).toBeTruthy();
    expect(screen.queryByText("LIVE")).toBeNull();
  });

  it("labels confirmed quotes as live and otherwise reports polling", () => {
    const { rerender } = render(<MarketHeader hasMarketData isLive={true} isOpen={true} marketStatus="Open" />);

    expect(screen.getByText("LIVE")).toBeTruthy();

    rerender(<MarketHeader hasMarketData isLive={false} isOpen={true} marketStatus="Open" />);
    expect(screen.getByText("POLLING")).toBeTruthy();
  });

  it("reports offline when market data is unavailable", () => {
    render(<MarketHeader hasMarketData={false} isLive={false} isOpen={true} marketStatus="Open" />);

    expect(screen.getByText("OFFLINE")).toBeTruthy();
  });
});
