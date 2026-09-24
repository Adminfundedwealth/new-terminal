import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useFnOStocks } from "@/hooks/useMarketData";
import { InstrumentExplorer } from "@/components/InstrumentExplorer";
import { getSavedWatchlist, saveWatchlist } from "@/lib/watchlist";
import { isProductionInstrument } from "@/lib/instrumentClassification";

export default function Stocks() {
  const navigate = useNavigate();
  const [watchedSymbols, setWatchedSymbols] = useState<string[]>(() => getSavedWatchlist());
  const { data, isLoading } = useFnOStocks();

  const rows = useMemo(() => {
    return (data?.allStocks || [])
      .filter((stock) => isProductionInstrument({ symbol: stock.symbol, tradingSymbol: stock.symbol, exchangeSegment: "NSE_EQ", instrumentType: "EQUITY" }))
      .sort((a, b) => a.symbol.localeCompare(b.symbol))
      .map((stock) => ({
        symbol: stock.symbol,
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
    <main className="mx-auto w-full max-w-[1500px] p-3 sm:p-5">
      <InstrumentExplorer
        title="Stocks"
        subtitle="NSE-listed equity quotes. Options are available separately in Option Chain."
        asset="stocks"
        rows={rows}
        isLoading={isLoading}
        watchedSymbols={watchedSymbols}
        onToggleWatchlist={handleWatchlistToggle}
        onTradeOpen={(symbol) => navigate(`/option-chain?symbol=${symbol}`)}
        footerLabel="stocks"
        searchPlaceholder="Search stocks..."
      />
    </main>
  );
}
