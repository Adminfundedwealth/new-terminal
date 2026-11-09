import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import InstrumentDirectory from "@/pages/InstrumentDirectory";
import { fetchCashQuotes } from "@/lib/marketApi";

const { fetchCashQuotesMock } = vi.hoisted(() => ({
  fetchCashQuotesMock: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/hooks/useLocalDatabase", () => ({
  useInstrumentLookup: () => ({
    instruments: [
      {
        securityId: "13",
        providerInstrumentId: "13",
        symbol: "NIFTY",
        tradingSymbol: "NIFTY",
        exchange: "NSE",
        exchangeSegment: "IDX_I",
        instrumentType: "INDEX",
        lotSize: 1,
        tickSize: 0.05,
        provider: "dhan",
      },
      {
        securityId: "2885",
        providerInstrumentId: "2885",
        symbol: "RELIANCE INDUSTRIES LTD",
        tradingSymbol: "RELIANCE",
        exchange: "NSE",
        exchangeSegment: "NSE_EQ",
        instrumentType: "EQUITY",
        series: "EQ",
        lotSize: 1,
        tickSize: 0.05,
        provider: "dhan",
      },
    ],
    isLoaded: true,
  }),
}));

vi.mock("@/lib/marketApi", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/marketApi")>(),
  fetchCashQuotes: fetchCashQuotesMock,
}));

function renderDirectory(category: "stocks" | "indices") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <InstrumentDirectory category={category} />
    </QueryClientProvider>,
  );
}

describe("InstrumentDirectory", () => {
  it("hides segment and security ID for indices while retaining them for quotes", async () => {
    renderDirectory("indices");

    expect(screen.getAllByRole("columnheader").map((header) => header.textContent?.trim())).toEqual([
      "Instrument",
      "Trading Symbol",
      "Last Price",
    ]);
    expect(screen.queryByText("IDX_I")).not.toBeInTheDocument();
    expect(screen.queryByText("13")).not.toBeInTheDocument();
    await waitFor(() => expect(fetchCashQuotes).toHaveBeenCalledWith("IDX_I", ["13"]));
  });

  it("keeps segment and security ID visible for stocks", () => {
    renderDirectory("stocks");

    expect(screen.getAllByRole("columnheader").map((header) => header.textContent?.trim())).toEqual([
      "Instrument",
      "Trading Symbol",
      "Last Price",
      "Segment",
      "Security ID",
    ]);
  });
});
