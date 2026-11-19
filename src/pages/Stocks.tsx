import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAccountContext } from "@/hooks/useAccountContext";
import { useInstrumentLookup } from "@/hooks/useLocalDatabase";
import { InstrumentExplorer } from "@/components/InstrumentExplorer";
import { resolveCashEquityUniverse } from "@/lib/marketInstrumentResolver";
import { getSavedWatchlist, saveWatchlist } from "@/lib/watchlist";

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
  const rows = useMemo(() => cashEquities.map((instrument) => {
    const symbol = instrument.tradingSymbol || instrument.symbol;
    return {
      symbol,
      chartSymbol: `${instrument.exchangeSegment}:${symbol}`,
      label: instrument.displayName ?? instrument.symbol,
      ltp: null,
      change: null,
      changePercent: null,
      open: null,
      high: null,
      low: null,
      volume: null,
      instrument,
      searchText: `${symbol} ${instrument.symbol} ${instrument.exchange} ${instrument.exchangeSegment} ${instrument.series ?? ""} ${instrument.displayName ?? ""}`,
    };
  }), [cashEquities]);

  const handleWatchlistToggle = (symbol: string) => {
    const next = watchedSymbols.includes(symbol)
      ? watchedSymbols.filter((e) => e !== symbol)
      : [...watchedSymbols, symbol];
    setWatchedSymbols(next);
    saveWatchlist(next);
  };

  return (
    <main className="flex h-full min-h-0 w-full flex-col">
      <InstrumentExplorer
        title="Stocks"
        subtitle="NSE and BSE cash equities from the Dhan instrument master. Quotes load for the visible page and refresh during the session."
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
        loadError={loadError}
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
