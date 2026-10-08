import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAccountContext } from "@/hooks/useAccountContext";
import { useInstrumentLookup } from "@/hooks/useLocalDatabase";
import { InstrumentExplorer } from "@/components/InstrumentExplorer";
import { getSavedWatchlist, saveWatchlist } from "@/lib/watchlist";
import { classifyInstrument, isCashEquityListing, isProductionInstrument } from "@/lib/instrumentClassification";

export default function Stocks() {
  const [searchParams] = useSearchParams();
  const [watchedSymbols, setWatchedSymbols] = useState<string[]>(() => getSavedWatchlist());
  const { instruments, isLoaded, loadError } = useInstrumentLookup();
  const { activeAccountId, accounts } = useAccountContext();
  const activeAccountProvider = accounts.find((account) => account.id === activeAccountId)?.broker_provider;
  const initialWorkspaceContext = searchParams.get("workspace") === "options" ? "options" : undefined;
  const initialChartSymbol = searchParams.get("symbol") ?? searchParams.get("contract") ?? undefined;
  const initialUnderlying = searchParams.get("underlying") ?? undefined;
  const initialExpiry = searchParams.get("expiry") ?? undefined;
  const initialInstrumentToken = searchParams.get("instrumentToken") ?? undefined;

  const rows = useMemo(() => {
    return instruments
      .filter((instrument) =>
        isProductionInstrument(instrument) &&
        classifyInstrument(instrument) === "stocks" &&
        isCashEquityListing(instrument)
      )
      .sort((a, b) => a.symbol.localeCompare(b.symbol) || a.tradingSymbol.localeCompare(b.tradingSymbol))
      .map((instrument) => ({
        symbol: instrument.symbol,
        chartSymbol: instrument.tradingSymbol,
        label: instrument.tradingSymbol,
        ltp: null,
        change: null,
        changePercent: null,
        open: null,
        high: null,
        low: null,
        volume: null,
        instrument,
        searchText: `${instrument.symbol} ${instrument.tradingSymbol}`,
      }));
  }, [instruments]);

  const handleWatchlistToggle = (symbol: string) => {
    const next = watchedSymbols.includes(symbol) ? watchedSymbols.filter((entry) => entry !== symbol) : [...watchedSymbols, symbol];
    setWatchedSymbols(next);
    saveWatchlist(next);
  };

  return (
    <main className="mx-auto flex h-full min-h-0 w-full max-w-[1500px] flex-col p-3 sm:p-5">
      <InstrumentExplorer
        title="Stocks"
        subtitle="NSE cash-equity instruments with account-scoped Terminal OS quotes."
        asset="stocks"
        rows={rows}
        isLoading={!isLoaded}
        watchedSymbols={watchedSymbols}
        onToggleWatchlist={handleWatchlistToggle}
        activeAccountId={activeAccountId}
        activeAccountProvider={activeAccountProvider}
        loadError={loadError}
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
