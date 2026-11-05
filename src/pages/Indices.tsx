import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAccountContext } from "@/hooks/useAccountContext";
import { useInstrumentLookup } from "@/hooks/useLocalDatabase";
import { InstrumentExplorer } from "@/components/InstrumentExplorer";
import { getSavedWatchlist, saveWatchlist } from "@/lib/watchlist";
import { classifyInstrument, isProductionInstrument } from "@/lib/instrumentClassification";
import { curatedIndexForInstrument, CURATED_INDICES } from "@/lib/curatedMarketLists";

export default function Indices() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { activeAccountId, accounts, hasNoAccount, isLoading: isAccountLoading } = useAccountContext();
  const activeAccountProvider = accounts.find((account) => account.id === activeAccountId)?.broker_provider;
  const [watchedSymbols, setWatchedSymbols] = useState<string[]>(() => getSavedWatchlist());
  const { instruments, isLoaded, loadError } = useInstrumentLookup();
  const requestedChartSymbol = searchParams.get("symbol") ?? undefined;

  const rows = useMemo(() => {
    const instrumentsByCuratedSymbol = new Map<string, typeof instruments[number]>();
    for (const instrument of instruments) {
      if (
        !isProductionInstrument(instrument) ||
        classifyInstrument(instrument) !== "indices" ||
        instrument.instrumentType.toUpperCase() !== "INDEX"
      ) continue;
      const curatedIndex = curatedIndexForInstrument(instrument.tradingSymbol, instrument.symbol, instrument.displayName);
      if (curatedIndex && !instrumentsByCuratedSymbol.has(curatedIndex.symbol)) {
        instrumentsByCuratedSymbol.set(curatedIndex.symbol, instrument);
      }
    }

    return CURATED_INDICES.flatMap((index) => {
      const instrument = instrumentsByCuratedSymbol.get(index.symbol);
      if (!instrument) return [];
      return [{
        symbol: index.symbol,
        chartSymbol: instrument.tradingSymbol,
        label: index.name,
        ltp: null,
        change: null,
        changePercent: null,
        open: null,
        high: null,
        low: null,
        volume: null,
        instrument,
        searchText: `${index.symbol} ${index.name} ${instrument.symbol} ${instrument.tradingSymbol}`,
      }];
    });
  }, [instruments]);

  const missingIndices = CURATED_INDICES.filter((index) => !rows.some((row) => row.symbol === index.symbol));
  const instrumentMasterWarning = missingIndices.length
    ? `Instrument master did not resolve: ${missingIndices.map((index) => index.symbol).join(", ")}`
    : null;
  const requestedIndex = requestedChartSymbol ? curatedIndexForInstrument(requestedChartSymbol) : undefined;
  const initialChartSymbol = requestedIndex
    ? rows.find((row) => row.symbol === requestedIndex.symbol)?.chartSymbol ?? requestedChartSymbol
    : requestedChartSymbol;

  const handleWatchlistToggle = (symbol: string) => {
    const next = watchedSymbols.includes(symbol) ? watchedSymbols.filter((entry) => entry !== symbol) : [...watchedSymbols, symbol];
    setWatchedSymbols(next);
    saveWatchlist(next);
  };

  return (
    <main className="mx-auto flex h-full min-h-0 w-full max-w-[1500px] flex-col p-3 sm:p-5">
      <InstrumentExplorer
        title="Indices"
        subtitle="Cash indices with central Dhan quotes and account-scoped trading."
        asset="indices"
        rows={rows}
        isLoading={!isLoaded}
        watchedSymbols={watchedSymbols}
        onToggleWatchlist={handleWatchlistToggle}
        activeAccountId={activeAccountId}
        activeAccountProvider={activeAccountProvider}
        hasNoAccount={hasNoAccount}
        isAccountLoading={isAccountLoading}
        loadError={loadError ?? instrumentMasterWarning}
        initialChartSymbol={initialChartSymbol}
        onTradeOpen={(symbol) => navigate(`/option-chain?symbol=${symbol}`)}
        footerLabel="indices"
        searchPlaceholder="Search indices..."
      />
    </main>
  );
}
