import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useAccountContext } from "@/hooks/useAccountContext";
import { useInstrumentLookup } from "@/hooks/useLocalDatabase";
import { InstrumentExplorer } from "@/components/InstrumentExplorer";
import { rankCashEquitiesByActivity, resolveCashEquityUniverse } from "@/lib/marketInstrumentResolver";
import { getSavedWatchlist, saveWatchlist } from "@/lib/watchlist";
import { fetchCentralMarketQuotes } from "@/lib/centralMarketQuotes";
import { isWithinNseSessionAt } from "@/lib/marketApi";

export default function Stocks() {
  const [searchParams] = useSearchParams();
  const [watchedSymbols, setWatchedSymbols] = useState<string[]>(() => getSavedWatchlist());
  const { instruments, isLoaded, isCatalogLoading, loadError } = useInstrumentLookup();
  const { activeAccountId, accounts, hasNoAccount, isLoading: isAccountLoading } = useAccountContext();
  const activeAccountProvider = accounts.find((a) => a.id === activeAccountId)?.broker_provider;
  const initialChartSymbol = searchParams.get("symbol") ?? searchParams.get("contract") ?? undefined;
  const initialUnderlying = searchParams.get("underlying") ?? undefined;
  const initialExpiry = searchParams.get("expiry") ?? undefined;
  const initialInstrumentToken = searchParams.get("instrumentToken") ?? undefined;

  const cashEquities = useMemo(() => resolveCashEquityUniverse(instruments), [instruments]);
  const activityQuery = useQuery({
    queryKey: [
      "top-active-indian-cash-equities",
      cashEquities.map((instrument) => `${instrument.exchangeSegment}:${instrument.providerInstrumentId ?? instrument.securityId}`),
    ],
    enabled: isLoaded && cashEquities.length > 0,
    queryFn: async ({ signal }) => fetchCentralMarketQuotes(
      cashEquities.map((instrument) => ({
        key: `${instrument.exchangeSegment}:${instrument.tradingSymbol}`,
        instrument,
      })),
      signal,
    ),
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    retry: false,
  });

  const activityQuotes = useMemo(() => activityQuery.data?.quotes ?? {}, [activityQuery.data?.quotes]);
  const rankedEquities = useMemo(() => {
    const quotes = new Map(Object.entries(activityQuotes).map(([key, quote]) => [key, {
      ltp: quote.ltp,
      volume: quote.volume,
      tradedValue: quote.tradedValue,
      timestamp: quote.timestamp,
    }]));
    return rankCashEquitiesByActivity(cashEquities, quotes, 100);
  }, [activityQuotes, cashEquities]);

  const rows = useMemo(() => {
    return rankedEquities.map((instrument) => {
      const symbol = instrument.tradingSymbol || instrument.symbol;
      const quote = activityQuotes[`${instrument.exchangeSegment}:${symbol}`];
      return {
        symbol,
        chartSymbol: `${instrument.exchangeSegment}:${symbol}`,
        label: instrument.displayName ?? instrument.symbol,
        ltp: quote?.ltp ?? null,
        change: quote?.change ?? null,
        changePercent: quote?.changePercent ?? null,
        open: quote?.open ?? null,
        high: quote?.high ?? null,
        low: quote?.low ?? null,
        volume: quote?.volume ?? null,
        quoteTimestamp: quote?.timestamp,
        instrument,
        searchText: `${symbol} ${instrument.symbol} ${instrument.exchange} ${instrument.exchangeSegment} ${instrument.series ?? ""} ${instrument.displayName ?? ""}`,
      };
    });
  }, [activityQuotes, rankedEquities]);

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
        subtitle="Top 100 active NSE and BSE cash equities, ranked by Dhan traded value when available and volume otherwise. NSE listings are preferred."
        asset="stocks"
        rows={rows}
        isLoading={!isLoaded}
        isCatalogLoading={isCatalogLoading}
        watchedSymbols={watchedSymbols}
        onToggleWatchlist={handleWatchlistToggle}
        activeAccountId={activeAccountId}
        activeAccountProvider={activeAccountProvider}
        hasNoAccount={hasNoAccount}
        isAccountLoading={isAccountLoading}
        loadError={
          loadError ??
          (activityQuery.data?.errors[0] ?? null) ??
          (activityQuery.isError && activityQuery.error instanceof Error ? activityQuery.error.message : null)
        }
        initialChartSymbol={initialChartSymbol}
        initialUnderlying={initialUnderlying}
        initialExpiry={initialExpiry}
        initialInstrumentToken={initialInstrumentToken}
        footerLabel="stocks"
        searchPlaceholder="Search stocks..."
      />
      {activityQuery.data?.errors.length ? (
        <p className="mt-2 text-xs text-amber-500" role="status">
          Dhan activity ranking is incomplete: {Object.keys(activityQuery.data.quotes).length} of {cashEquities.length} cash-equity listings returned quotes. {activityQuery.data.errors[0]}
        </p>
      ) : null}
    </main>
  );
}
