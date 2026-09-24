import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLiveIndices } from "@/hooks/useMarketData";
import { InstrumentExplorer } from "@/components/InstrumentExplorer";
import { getSavedWatchlist, saveWatchlist } from "@/lib/watchlist";

export default function Indices() {
  const navigate = useNavigate();
  const [watchedSymbols, setWatchedSymbols] = useState<string[]>(() => getSavedWatchlist());
  const { data, isLoading } = useLiveIndices();

  const rows = useMemo(() => {
    return (data?.data || []).map((index) => ({
      symbol: index.symbol,
      label: index.name || index.symbol,
      ltp: index.ltp,
      change: index.change,
      changePercent: index.changePercent,
      open: index.open,
      high: index.high,
      low: index.low,
      volume: null,
      searchText: `${index.symbol} ${index.name || ""}`,
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
        title="Indices"
        subtitle="NIFTY, BANKNIFTY, FINNIFTY and other cash index quotes."
        asset="indices"
        rows={rows}
        isLoading={isLoading}
        watchedSymbols={watchedSymbols}
        onToggleWatchlist={handleWatchlistToggle}
        onTradeOpen={(symbol) => navigate(`/option-chain?symbol=${symbol}`)}
        footerLabel="indices"
        searchPlaceholder="Search indices..."
      />
    </main>
  );
}
