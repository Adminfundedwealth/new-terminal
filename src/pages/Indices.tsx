import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAccountContext } from "@/hooks/useAccountContext";
import { useInstrumentLookup } from "@/hooks/useLocalDatabase";
import { InstrumentExplorer } from "@/components/InstrumentExplorer";
import { getSavedWatchlist, saveWatchlist } from "@/lib/watchlist";
import { APPROVED_INDICES } from "@/lib/approvedIndices";
import { findApprovedIndexInstrument } from "@/lib/marketInstrumentResolver";

export default function Indices() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { activeAccountId, accounts, hasNoAccount, isLoading: isAccountLoading } = useAccountContext();
  const activeAccountProvider = accounts.find((account) => account.id === activeAccountId)?.broker_provider;
  const [watchedSymbols, setWatchedSymbols] = useState<string[]>(() => getSavedWatchlist());
  const { instruments, isLoaded, loadError } = useInstrumentLookup();
  const initialChartSymbol = searchParams.get("symbol") ?? undefined;

  const [exchange, setExchange] = useState<"ALL" | "NSE" | "BSE">("ALL");

  const rows = useMemo(() => {
    return APPROVED_INDICES
      .filter((entry) => exchange === "ALL" || entry.exchange === exchange)
      .map((entry) => {
        const matchedInstrument = findApprovedIndexInstrument(instruments, entry);
        return {
          symbol: entry.symbol,
          chartSymbol: matchedInstrument?.tradingSymbol ?? entry.symbol,
          label: entry.displayName,
          ltp: null,
          change: null,
          changePercent: null,
          open: null,
          high: null,
          low: null,
          volume: null,
          instrument: matchedInstrument ?? null,
          searchText: `${entry.symbol} ${entry.displayName} ${entry.exchange}`,
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
    <main className="mx-auto flex h-full min-h-0 w-full max-w-[1500px] flex-col p-3 sm:p-5">
      {/* Exchange filter tabs */}
      <div className="mb-3 flex gap-2">
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
        loadError={loadError}
        initialChartSymbol={initialChartSymbol}
        onTradeOpen={(symbol) => navigate(`/option-chain?symbol=${symbol}`)}
        footerLabel="indices"
        searchPlaceholder="Search indices..."
      />
    </main>
  );
}
