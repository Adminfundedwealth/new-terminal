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
  it("passes the exact selected option contract to the chart and displays its identity", () => {
    const onBuy = vi.fn();
    const onSell = vi.fn();
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
          instrument: {
            provider: "dhan",
            providerInstrumentId: "987654",
            symbol: "RELIANCE",
            tradingSymbol: "RELIANCE26NOV1340CE",
            exchange: "NSE",
            exchangeSegment: "NSE_FNO",
            instrumentType: "OPTSTK",
            expiryDate: "2026-11-26",
            strikePrice: 1340,
            optionType: "CE",
          },
        }}
        onBuy={onBuy}
        onSell={onSell}
      />,
    );

    expect(screen.getByText("ID 987654 · Lot 250")).toBeInTheDocument();
    expect(stockChart).toHaveBeenCalledWith(expect.objectContaining({
      symbol: "RELIANCE26NOV1340CE",
      onBuy,
      onSell,
      selectedInstrument: expect.objectContaining({
        providerInstrumentId: "987654",
        exchange: "NSE",
        exchangeSegment: "NSE_FNO",
        expiryDate: "2026-11-26",
        strikePrice: 1340,
        optionType: "CE",
      }),
    }));
  });
});
