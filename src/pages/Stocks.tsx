import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAccountContext } from "@/hooks/useAccountContext";
import { useInstrumentLookup } from "@/hooks/useLocalDatabase";
import { InstrumentExplorer } from "@/components/InstrumentExplorer";
import { isProductionInstrument } from "@/lib/instrumentClassification";
import { isApprovedStock, APPROVED_200_STOCKS } from "@/lib/approvedInstruments";
import { getSavedWatchlist, saveWatchlist } from "@/lib/watchlist";

export default function Stocks() {
  const [searchParams] = useSearchParams();
  const [watchedSymbols, setWatchedSymbols] = useState<string[]>(() => getSavedWatchlist());
  const { instruments, isLoaded, loadError } = useInstrumentLookup();
  const { activeAccountId, accounts, hasNoAccount, isLoading: isAccountLoading } = useAccountContext();
  const activeAccountProvider = accounts.find((a) => a.id === activeAccountId)?.broker_provider;
  const initialChartSymbol = searchParams.get("symbol") ?? searchParams.get("contract") ?? undefined;
  const initialUnderlying = searchParams.get("underlying") ?? undefined;
  const initialExpiry = searchParams.get("expiry") ?? undefined;
  const initialInstrumentToken = searchParams.get("instrumentToken") ?? undefined;

  const rows = useMemo(() => {
    // Build instrument lookup map from whatever has loaded
    const bySymbol = new Map<string, typeof instruments[number]>();
    for (const inst of instruments) {
      if (!isProductionInstrument(inst)) continue;
      if (!isApprovedStock(inst.symbol)) continue;
      // Prefer NSE_EQ segment
      const existing = bySymbol.get(inst.symbol);
      if (!existing || inst.exchangeSegment === "NSE_EQ") {
        bySymbol.set(inst.symbol, inst);
      }
    }

    // Always show all 200 approved stocks — use instrument data when available
    return APPROVED_200_STOCKS.map((stock) => {
      const inst = bySymbol.get(stock.symbol);
      return {
        symbol: stock.symbol,
        chartSymbol: inst?.tradingSymbol ?? stock.symbol,
        label: stock.name,
        ltp: null,
        change: null,
        changePercent: null,
        open: null,
        high: null,
        low: null,
        volume: null,
        instrument: inst ?? null,
        searchText: `${stock.symbol} ${stock.name} ${stock.sector}`,
      };
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
        isLoading={false}
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
