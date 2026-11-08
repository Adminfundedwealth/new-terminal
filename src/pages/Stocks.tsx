import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAccountContext } from "@/hooks/useAccountContext";
import { useInstrumentLookup } from "@/hooks/useLocalDatabase";
import { InstrumentExplorer } from "@/components/InstrumentExplorer";
import { getSavedWatchlist, saveWatchlist } from "@/lib/watchlist";
import { classifyInstrument, isCashEquityListing, isProductionInstrument } from "@/lib/instrumentClassification";
import { resolveSelectedOptionFromParams } from "@/lib/selectedOptionContract";

export default function Stocks() {
  const [searchParams] = useSearchParams();
  const [watchedSymbols, setWatchedSymbols] = useState<string[]>(() => getSavedWatchlist());
  const { instruments, isLoaded, loadError } = useInstrumentLookup();
  const { activeAccountId, accounts, hasNoAccount, isLoading: isAccountLoading } = useAccountContext();
  const activeAccountProvider = accounts.find((account) => account.id === activeAccountId)?.broker_provider;
  const isOptionWorkspaceRequest = searchParams.get("workspace") === "options";
  const selectedOptionInstrument = useMemo(
    () => isOptionWorkspaceRequest ? resolveSelectedOptionFromParams(instruments, searchParams) : undefined,
    [instruments, isOptionWorkspaceRequest, searchParams],
  );
  const requestedOrderSide = searchParams.get("side")?.toUpperCase();
  const initialOrderSide = selectedOptionInstrument && (requestedOrderSide === "BUY" || requestedOrderSide === "SELL")
    ? requestedOrderSide
    : undefined;
  const initialWorkspaceContext = selectedOptionInstrument ? "options" : undefined;
  const initialChartSymbol = selectedOptionInstrument?.tradingSymbol
    ?? (isOptionWorkspaceRequest ? undefined : searchParams.get("symbol") ?? searchParams.get("contract") ?? undefined);
  const initialUnderlying = selectedOptionInstrument?.symbol ?? undefined;
  const initialExpiry = selectedOptionInstrument?.expiryDate ?? undefined;
  const initialInstrumentToken = selectedOptionInstrument?.providerInstrumentId ?? selectedOptionInstrument?.securityId;

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
        loadError={loadError}
        initialWorkspaceContext={initialWorkspaceContext}
        initialChartSymbol={initialChartSymbol}
        initialUnderlying={initialUnderlying}
        initialExpiry={initialExpiry}
        initialInstrumentToken={initialInstrumentToken}
        initialOptionSecurityId={selectedOptionInstrument?.securityId}
        initialOrderSide={initialOrderSide}
        footerLabel="stocks"
        searchPlaceholder="Search stocks..."
      />
      {isOptionWorkspaceRequest && !selectedOptionInstrument && (
        <p className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-600" role="status">
          The selected option contract is no longer available in the loaded instrument master. Return to Option Chain and select the contract again.
        </p>
      )}
    </main>
  );
}
