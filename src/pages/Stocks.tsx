import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAccountContext } from "@/hooks/useAccountContext";
import { useInstrumentLookup } from "@/hooks/useLocalDatabase";
import { InstrumentExplorer } from "@/components/InstrumentExplorer";
import { isNseCashEquityListing, isProductionInstrument } from "@/lib/instrumentClassification";
import { canonicalCuratedStockSymbol, curatedStockForInstrument, CURATED_STOCKS } from "@/lib/curatedMarketLists";
import { getSavedWatchlist, saveWatchlist } from "@/lib/watchlist";

export default function Stocks() {
  const [searchParams] = useSearchParams();
  const [watchedSymbols, setWatchedSymbols] = useState<string[]>(() => getSavedWatchlist());
  const { instruments, isLoaded, loadError } = useInstrumentLookup();
  const { activeAccountId, accounts, hasNoAccount, isLoading: isAccountLoading } = useAccountContext();
  const activeAccountProvider = accounts.find((account) => account.id === activeAccountId)?.broker_provider;
  const initialWorkspaceContext = searchParams.get("workspace") === "options" ? "options" : undefined;
  const requestedChartSymbol = searchParams.get("symbol") ?? searchParams.get("contract") ?? undefined;
  const initialUnderlying = searchParams.get("underlying") ?? undefined;
  const initialExpiry = searchParams.get("expiry") ?? undefined;
  const initialInstrumentToken = searchParams.get("instrumentToken") ?? undefined;

  const rows = useMemo(() => {
    const instrumentsByCuratedSymbol = new Map<string, typeof instruments[number]>();
    for (const instrument of instruments) {
      if (
        !isProductionInstrument(instrument) ||
        !isNseCashEquityListing(instrument)
      ) continue;
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
        label: stock.name,
        ltp: null,
        change: null,
        changePercent: null,
        open: null,
        high: null,
        low: null,
        volume: null,
        instrument,
        searchText: `${stock.symbol} ${symbol} ${stock.name} ${instrument.symbol}`,
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
    const next = watchedSymbols.includes(symbol) ? watchedSymbols.filter((entry) => entry !== symbol) : [...watchedSymbols, symbol];
    setWatchedSymbols(next);
    saveWatchlist(next);
  };

  return (
    <main className="mx-auto flex h-full min-h-0 w-full max-w-[1500px] flex-col p-3 sm:p-5">
      <InstrumentExplorer
        title="Stocks"
        subtitle="NSE cash-equity instruments with central Dhan quotes."
        asset="stocks"
        rows={rows}
        isLoading={!isLoaded}
        watchedSymbols={watchedSymbols}
        onToggleWatchlist={handleWatchlistToggle}
        activeAccountId={activeAccountId}
        activeAccountProvider={activeAccountProvider}
        hasNoAccount={hasNoAccount}
        isAccountLoading={isAccountLoading}
        loadError={loadError ?? instrumentMasterWarning}
        initialWorkspaceContext={initialWorkspaceContext}
        initialChartSymbol={resolvedInitialChartSymbol}
        initialUnderlying={initialUnderlying}
        initialExpiry={initialExpiry}
        initialInstrumentToken={initialInstrumentToken}
        footerLabel="stocks"
        searchPlaceholder="Search stocks..."
      />
    </main>
  );
}
