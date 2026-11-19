import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAccountContext } from "@/hooks/useAccountContext";
import { useInstrumentLookup } from "@/hooks/useLocalDatabase";
import { InstrumentExplorer } from "@/components/InstrumentExplorer";
import { getSavedWatchlist, saveWatchlist } from "@/lib/watchlist";
import { resolveIndianIndexUniverse } from "@/lib/marketInstrumentResolver";

export default function Indices() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { activeAccountId, accounts, hasNoAccount, isLoading: isAccountLoading } = useAccountContext();
  const activeAccountProvider = accounts.find((account) => account.id === activeAccountId)?.broker_provider;
  const [watchedSymbols, setWatchedSymbols] = useState<string[]>(() => getSavedWatchlist());
  const { instruments, isLoaded, isCatalogLoading, loadError } = useInstrumentLookup();
  const initialChartSymbol = searchParams.get("symbol") ?? undefined;

  const [exchange, setExchange] = useState<"ALL" | "NSE" | "BSE">("ALL");

  const rows = useMemo(() => {
    return resolveIndianIndexUniverse(instruments)
      .filter((instrument) => exchange === "ALL" || instrument.exchange === exchange)
      .map((instrument) => {
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
          searchText: `${symbol} ${instrument.symbol} ${instrument.exchange} ${instrument.exchangeSegment} ${instrument.displayName ?? ""}`,
        };
      });
  }, [instruments, exchange]);

  const handleWatchlistToggle = (symbol: string) => {
    const next = watchedSymbols.includes(symbol)
      ? watchedSymbols.filter((entry) => entry !== symbol)
      : [...watchedSymbols, symbol];
    setWatchedSymbols(next);
    saveWatchlist(next);
  };

  return (
    <main className="flex h-full min-h-0 w-full flex-col">
      <InstrumentExplorer
        title="Indices"
        subtitle="Available NSE and BSE indices from the configured instrument master."
        asset="indices"
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
        onTradeOpen={(symbol) => navigate(`/option-chain?symbol=${symbol}`)}
        footerLabel="indices"
        searchPlaceholder="Search indices..."
        listHeader={
          <div className="flex gap-2">
            {(["ALL", "NSE", "BSE"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setExchange(tab)}
                className={[
                  "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
                  exchange === tab
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80",
                ].join(" ")}
              >
                {tab === "ALL" ? "All" : tab}
              </button>
            ))}
          </div>
        }
      />
    </main>
  );
}
