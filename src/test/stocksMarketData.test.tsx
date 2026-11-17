import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import Stocks from "@/pages/Stocks";

vi.mock("@/hooks/useAccountContext", () => ({
  useAccountContext: () => ({
    activeAccountId: null,
    accounts: [],
    hasNoAccount: true,
    isLoading: false,
  }),
}));

vi.mock("@/hooks/useLocalDatabase", () => ({
  useInstrumentLookup: () => ({
    instruments: [
      {
        securityId: "2885",
        providerInstrumentId: "2885",
        provider: "dhan",
        symbol: "RELIANCE INDUSTRIES LTD",
        tradingSymbol: "RELIANCE",
        displayName: "Reliance Industries",
        exchange: "NSE",
        exchangeSegment: "NSE_EQ",
        instrumentType: "EQUITY",
        series: "EQ",
        lotSize: 1,
      },
      {
        securityId: "1333",
        providerInstrumentId: "1333",
        provider: "dhan",
        symbol: "STATE BANK OF INDIA",
        tradingSymbol: "SBIN",
        displayName: "State Bank of India",
        exchange: "NSE",
        exchangeSegment: "NSE_EQ",
        instrumentType: "EQUITY",
        series: "EQ",
        lotSize: 1,
      },
    ],
    isLoaded: true,
    isCatalogLoading: false,
    loadError: null,
  }),
}));

vi.mock("@/components/InstrumentExplorer", () => ({
  InstrumentExplorer: ({ rows }: { rows: Array<{ symbol: string }> }) => (
    <div>
      {rows.map((row) => <span key={row.symbol}>{row.symbol}</span>)}
    </div>
  ),
}));

describe("Stocks market data loading", () => {
  it("renders valid Dhan stocks before quote requests complete", () => {
    render(
      <MemoryRouter>
        <Stocks />
      </MemoryRouter>,
    );

    expect(screen.getByText("RELIANCE")).toBeInTheDocument();
    expect(screen.getByText("SBIN")).toBeInTheDocument();
  });
});
