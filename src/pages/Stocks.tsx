import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useFnOStocks } from "@/hooks/useMarketData";
import { useAccountContext } from "@/hooks/useAccountContext";
import { InstrumentExplorer } from "@/components/InstrumentExplorer";
import { getSavedWatchlist, saveWatchlist } from "@/lib/watchlist";
import { isProductionInstrument } from "@/lib/instrumentClassification";

export default function Stocks() {
  const [searchParams] = useSearchParams();
  const [watchedSymbols, setWatchedSymbols] = useState<string[]>(() => getSavedWatchlist());
  const { data, isLoading } = useFnOStocks();
  const { activeAccountId } = useAccountContext();
  const initialWorkspaceContext = searchParams.get("workspace") === "options" ? "options" : undefined;
  const initialChartSymbol = searchParams.get("contract") ?? undefined;
  const initialUnderlying = searchParams.get("underlying") ?? undefined;
  const initialExpiry = searchParams.get("expiry") ?? undefined;
  const initialInstrumentToken = searchParams.get("instrumentToken") ?? undefined;

  const rows = useMemo(() => {
    return (data?.allStocks || [])
      .filter((stock) => isProductionInstrument({ symbol: stock.symbol, tradingSymbol: stock.symbol, exchangeSegment: "NSE_EQ", instrumentType: "EQUITY" }))
      .sort((a, b) => a.symbol.localeCompare(b.symbol))
      .map((stock) => ({
        symbol: stock.symbol,
        chartSymbol: stock.symbol,
        label: stock.symbol,
        ltp: stock.ltp,
        change: stock.change,
        changePercent: stock.changePercent,
        open: stock.open,
        high: stock.high,
        low: stock.low,
        volume: stock.volume,
        searchText: stock.symbol,
      }));
  }, [data]);

  const handleWatchlistToggle = (symbol: string) => {
    const next = watchedSymbols.includes(symbol) ? watchedSymbols.filter((entry) => entry !== symbol) : [...watchedSymbols, symbol];
    setWatchedSymbols(next);
    saveWatchlist(next);
  };

  return (
    <main className="mx-auto flex h-full min-h-0 w-full max-w-[1500px] flex-col p-3 sm:p-5">
      <InstrumentExplorer
        title="Stocks"
        subtitle="NSE-listed equity quotes. Options are available separately in Option Chain."
        asset="stocks"
        rows={rows}
        isLoading={isLoading}
        watchedSymbols={watchedSymbols}
        onToggleWatchlist={handleWatchlistToggle}
        activeAccountId={activeAccountId}
        initialWorkspaceContext={initialWorkspaceContext}
        initialChartSymbol={initialChartSymbol}
        initialUnderlying={initialUnderlying}
        initialExpiry={initialExpiry}
        initialInstrumentToken={initialInstrumentToken}
        footerLabel="stocks"
        searchPlaceholder="Search stocks..."
      />
    </main>
  );
}
