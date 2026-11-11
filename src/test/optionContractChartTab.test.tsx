import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OptionContractChartTab } from "@/components/OptionContractChartTab";

const stockChart = vi.hoisted(() => vi.fn());
vi.mock("@/components/StockChart", () => ({
  StockChart: (props: Record<string, unknown>) => {
    stockChart(props);
    return <div data-testid="stock-chart" />;
  },
}));

describe("OptionContractChartTab", () => {
  it("opens the selected option symbol using its exact provider ID and displays contract identity", () => {
    render(
      <OptionContractChartTab
        tab={{
          id: "RELIANCE26NOV1340CE",
          label: "RELIANCE 26 Nov 2026 1340 CE",
          tradingSymbol: "RELIANCE26NOV1340CE",
          underlying: "RELIANCE",
          strike: 1340,
          optionType: "CE",
          expiry: "2026-11-26",
          securityId: "987654",
          exchangeSegment: "NSE_FNO",
          lotSize: 250,
        }}
        onBuy={vi.fn()}
        onSell={vi.fn()}
      />,
    );

    expect(screen.getByText("ID 987654 · Lot 250")).toBeInTheDocument();
    expect(stockChart).toHaveBeenCalledWith(expect.objectContaining({
      symbol: "RELIANCE26NOV1340CE",
      instrumentToken: "987654",
    }));
  });
});
