import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAccountContext } from "@/hooks/useAccountContext";
import { useInstrumentLookup } from "@/hooks/useLocalDatabase";
import { InstrumentExplorer } from "@/components/InstrumentExplorer";
import { isNseCashEquityListing, isProductionInstrument } from "@/lib/instrumentClassification";
import { canonicalCuratedStockSymbol, curatedStockForInstrument, CURATED_STOCKS } from "@/lib/curatedMarketLists";
import { getSavedWatchlist, saveWatchlist } from "@/lib/watchlist";
<<<<<<< Updated upstream
=======
import { classifyInstrument, isProductionInstrument } from "@/lib/instrumentClassification";
import { isApprovedStock, APPROVED_200_STOCKS } from "@/lib/approvedInstruments";
>>>>>>> Stashed changes

export default function Stocks() {
  const [searchParams] = useSearchParams();
  const [watchedSymbols, setWatchedSymbols] = useState<string[]>(() => getSavedWatchlist());
  const { instruments, isLoaded, loadError } = useInstrumentLookup();
  const { activeAccountId, accounts, hasNoAccount, isLoading: isAccountLoading } = useAccountContext();
  const activeAccountProvider = accounts.find((account) => account.id === activeAccountId)?.broker_provider;
<<<<<<< Updated upstream
  const initialWorkspaceContext = searchParams.get("workspace") === "options" ? "options" : undefined;
  const requestedChartSymbol = searchParams.get("symbol") ?? searchParams.get("contract") ?? undefined;
=======
  const initialChartSymbol = searchParams.get("symbol") ?? searchParams.get("contract") ?? undefined;
>>>>>>> Stashed changes
  const initialUnderlying = searchParams.get("underlying") ?? undefined;
  const initialExpiry = searchParams.get("expiry") ?? undefined;
  const initialInstrumentToken = searchParams.get("instrumentToken") ?? undefined;

  const rows = useMemo(() => {
<<<<<<< Updated upstream
    const instrumentsByCuratedSymbol = new Map<string, typeof instruments[number]>();
    for (const instrument of instruments) {
      if (!isProductionInstrument(instrument)) continue;
      const curatedStock = curatedStockForInstrument(instrument.tradingSymbol, instrument.symbol);
      if (curatedStock && !instrumentsByCuratedSymbol.has(curatedStock.symbol)) {
        instrumentsByCuratedSymbol.set(curatedStock.symbol, instrument);
      }
    }

    return CURATED_STOCKS.flatMap((stock) => {
      const instrument = instrumentsByCuratedSymbol.get(stock.symbol);
      if (!instrument) return [];
      const symbol = instrument.tradingSymbol;
      return [{
        symbol,
        chartSymbol: symbol,
=======
    // Build a map from symbol -> best instrument match
    const bySymbol = new Map<string, typeof instruments[number]>();
    for (const inst of instruments) {
      if (!isProductionInstrument(inst)) continue;
      const cat = classifyInstrument(inst);
      if (cat !== "stocks") continue;
      if (!isApprovedStock(inst.symbol)) continue;
      // Prefer NSE_EQ over BSE
      const existing = bySymbol.get(inst.symbol);
      if (!existing || inst.exchangeSegment === "NSE_EQ") {
        bySymbol.set(inst.symbol, inst);
      }
    }

    // Return rows in approved-list order, fall back to symbol-only row if no instrument found yet
    return APPROVED_200_STOCKS.flatMap((stock) => {
      const inst = bySymbol.get(stock.symbol);
      if (!inst) return [];   // instrument master not loaded yet — skip, table will fill as data arrives
      return [{
        symbol: stock.symbol,
        chartSymbol: inst.tradingSymbol,
>>>>>>> Stashed changes
        label: stock.name,
        ltp: null,
        change: null,
        changePercent: null,
        open: null,
        high: null,
        low: null,
        volume: null,
<<<<<<< Updated upstream
        instrument,
        searchText: `${stock.symbol} ${symbol} ${stock.name} ${instrument.symbol}`,
=======
        instrument: inst,
        searchText: `${stock.symbol} ${inst.tradingSymbol} ${stock.name}`,
>>>>>>> Stashed changes
      }];
    });
  }, [instruments]);

  const isOptionContract = requestedChartSymbol
    ? /\d+(CE|PE)$/i.test(requestedChartSymbol)
    : false;
  const resolvedInitialChartSymbol = requestedChartSymbol
    ? (isOptionContract ? requestedChartSymbol : canonicalCuratedStockSymbol(requestedChartSymbol))
    : undefined;
  const missingStocks = CURATED_STOCKS.filter((stock) =>
    !rows.some((row) => curatedStockForInstrument(row.chartSymbol)?.symbol === stock.symbol)
  );
  const instrumentMasterWarning = missingStocks.length
    ? `Instrument master did not resolve: ${missingStocks.map((stock) => stock.symbol).join(", ")}`
    : null;

  const handleWatchlistToggle = (symbol: string) => {
    const next = watchedSymbols.includes(symbol)
      ? watchedSymbols.filter((e) => e !== symbol)
      : [...watchedSymbols, symbol];
    setWatchedSymbols(next);
    saveWatchlist(next);
  };

  return (
    <main className="mx-auto flex h-full min-h-0 w-full max-w-[1500px] flex-col p-3 sm:p-5">
      <InstrumentExplorer
        title="Stocks"
        subtitle="200 approved NSE equities with central Dhan quotes."
        asset="stocks"
        rows={rows}
        isLoading={!isLoaded}
        watchedSymbols={watchedSymbols}
        onToggleWatchlist={handleWatchlistToggle}
        activeAccountId={activeAccountId}
        activeAccountProvider={activeAccountProvider}
        hasNoAccount={hasNoAccount}
        isAccountLoading={isAccountLoading}
<<<<<<< Updated upstream
        loadError={loadError ?? instrumentMasterWarning}
        initialWorkspaceContext={initialWorkspaceContext}
        initialChartSymbol={resolvedInitialChartSymbol}
=======
        loadError={loadError}
        initialChartSymbol={initialChartSymbol}
>>>>>>> Stashed changes
        initialUnderlying={initialUnderlying}
        initialExpiry={initialExpiry}
        initialInstrumentToken={initialInstrumentToken}
        footerLabel="stocks"
        searchPlaceholder="Search stocks..."
      />
    </main>
  );
}
