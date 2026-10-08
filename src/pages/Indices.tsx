import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAccountContext } from "@/hooks/useAccountContext";
import { useInstrumentLookup } from "@/hooks/useLocalDatabase";
import { InstrumentExplorer } from "@/components/InstrumentExplorer";
import { getSavedWatchlist, saveWatchlist } from "@/lib/watchlist";
import { canonicalIndexSymbol, classifyInstrument, isProductionInstrument } from "@/lib/instrumentClassification";

export default function Indices() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { activeAccountId, accounts } = useAccountContext();
  const activeAccountProvider = accounts.find((account) => account.id === activeAccountId)?.broker_provider;
  const [watchedSymbols, setWatchedSymbols] = useState<string[]>(() => getSavedWatchlist());
  const { instruments, isLoaded, loadError } = useInstrumentLookup();
  const initialChartSymbol = searchParams.get("symbol") ?? undefined;

  const rows = useMemo(() => {
    const seen = new Set<string>();
    return instruments.flatMap((instrument) => {
      if (!isProductionInstrument(instrument) || classifyInstrument(instrument) !== "indices") return [];
      const chartSymbol = canonicalIndexSymbol(instrument.symbol);
      if (seen.has(chartSymbol)) return [];
      seen.add(chartSymbol);
      return [{
        symbol: chartSymbol,
        chartSymbol,
        label: instrument.tradingSymbol,
        ltp: null,
        change: null,
        changePercent: null,
        open: null,
        high: null,
        low: null,
        volume: null,
        instrument,
        searchText: `${chartSymbol} ${instrument.symbol} ${instrument.tradingSymbol}`,
      }];
    }).sort((a, b) => a.symbol.localeCompare(b.symbol));
  }, [instruments]);

  const handleWatchlistToggle = (symbol: string) => {
    const next = watchedSymbols.includes(symbol) ? watchedSymbols.filter((entry) => entry !== symbol) : [...watchedSymbols, symbol];
    setWatchedSymbols(next);
    saveWatchlist(next);
  };

  return (
    <main className="mx-auto flex h-full min-h-0 w-full max-w-[1500px] flex-col p-3 sm:p-5">
      <InstrumentExplorer
        title="Indices"
        subtitle="Cash indices with account-scoped Terminal OS quotes and historical charts."
        asset="indices"
        rows={rows}
        isLoading={!isLoaded}
        watchedSymbols={watchedSymbols}
        onToggleWatchlist={handleWatchlistToggle}
        activeAccountId={activeAccountId}
        activeAccountProvider={activeAccountProvider}
        loadError={loadError}
        initialChartSymbol={initialChartSymbol}
        onTradeOpen={(symbol) => navigate(`/option-chain?symbol=${symbol}`)}
        footerLabel="indices"
        searchPlaceholder="Search indices..."
      />
    </main>
  );
}
