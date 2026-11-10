import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAccountContext } from "@/hooks/useAccountContext";
import { useInstrumentLookup } from "@/hooks/useLocalDatabase";
import { InstrumentExplorer } from "@/components/InstrumentExplorer";
import { classifyInstrument, isProductionInstrument } from "@/lib/instrumentClassification";
import { isApprovedStock, APPROVED_200_STOCKS } from "@/lib/approvedInstruments";
import { getSavedWatchlist, saveWatchlist } from "@/lib/watchlist";

export default function Stocks() {
  const [searchParams] = useSearchParams();
  const [watchedSymbols, setWatchedSymbols] = useState<string[]>(() => getSavedWatchlist());
  const { instruments, isLoaded, loadError } = useInstrumentLookup();
  const { activeAccountId, accounts, hasNoAccount, isLoading: isAccountLoading } = useAccountContext();
  const activeAccountProvider = accounts.find((account) => account.id === activeAccountId)?.broker_provider;
  const initialChartSymbol = searchParams.get("symbol") ?? searchParams.get("contract") ?? undefined;
  const initialUnderlying = searchParams.get("underlying") ?? undefined;
  const initialExpiry = searchParams.get("expiry") ?? undefined;
  const initialInstrumentToken = searchParams.get("instrumentToken") ?? undefined;

  const rows = useMemo(() => {
    const bySymbol = new Map<string, typeof instruments[number]>();
    for (const inst of instruments) {
      if (!isProductionInstrument(inst)) continue;
      if (classifyInstrument(inst) !== "stocks") continue;
      if (!isApprovedStock(inst.symbol)) continue;
      const existing = bySymbol.get(inst.symbol);
      if (!existing || inst.exchangeSegment === "NSE_EQ") {
        bySymbol.set(inst.symbol, inst);
      }
    }
    return APPROVED_200_STOCKS.flatMap((stock) => {
      const inst = bySymbol.get(stock.symbol);
      if (!inst) return [];
      return [{
        symbol: stock.symbol,
        chartSymbol: inst.tradingSymbol,
        label: stock.name,
        ltp: null,
        change: null,
        changePercent: null,
        open: null,
        high: null,
        low: null,
        volume: null,
        instrument: inst,
        searchText: `${stock.symbol} ${inst.tradingSymbol} ${stock.name}`,
      }];
    });
  }, [instruments]);

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
        subtitle="200 approved NSE equities."
        asset="stocks"
        rows={rows}
        isLoading={!isLoaded}
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
