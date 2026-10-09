import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { InstrumentExplorer, type ExplorerRow } from "@/components/InstrumentExplorer";
import { useAccountContext } from "@/hooks/useAccountContext";
import { useInstrumentLookup } from "@/hooks/useLocalDatabase";
import { classifyInstrument, isProductionInstrument, isTradableContract } from "@/lib/instrumentClassification";
import { getSavedWatchlist, saveWatchlist } from "@/lib/watchlist";
import type { Instrument } from "@/lib/localDatabase";

export default function Futures() {
  const navigate = useNavigate();
  const { instruments, isLoaded, loadError } = useInstrumentLookup();
  const { activeAccountId, accounts, hasNoAccount, isLoading: isAccountLoading } = useAccountContext();
  const activeAccountProvider = accounts.find((account) => account.id === activeAccountId)?.broker_provider;
  const [watchedSymbols, setWatchedSymbols] = useState<string[]>(() => getSavedWatchlist());

  const futures = useMemo(() => instruments
    .filter((instrument) =>
      isProductionInstrument(instrument) &&
      classifyInstrument(instrument) === "futures" &&
      isTradableContract(instrument, "futures") &&
      Date.parse(instrument.expiryDate || "") >= Date.now()
    )
    .sort((a, b) => a.symbol.localeCompare(b.symbol) || (a.expiryDate || "").localeCompare(b.expiryDate || "")),
  [instruments]);

  const rows = useMemo<ExplorerRow[]>(() => futures.map((instrument) => ({
      symbol: instrument.symbol,
      chartSymbol: instrument.tradingSymbol,
      label: instrument.tradingSymbol,
      contract: instrument.tradingSymbol,
      underlying: instrument.symbol,
      expiry: instrument.expiryDate,
      ltp: null,
      change: null,
      changePercent: null,
      open: null,
      high: null,
      low: null,
      volume: null,
      oi: null,
      oiChange: null,
      isLive: false,
      instrument: instrument as Instrument,
      searchText: `${instrument.symbol} ${instrument.tradingSymbol}`,
  })), [futures]);

  const handleWatchlistToggle = (symbol: string) => {
    const next = watchedSymbols.includes(symbol)
      ? watchedSymbols.filter((entry) => entry !== symbol)
      : [...watchedSymbols, symbol];
    setWatchedSymbols(next);
    saveWatchlist(next);
  };

  const quoteStatus = isLoaded && futures.length === 0
    ? loadError ?? "No valid, unexpired futures contracts are available."
    : null;

  return (
    <main className="mx-auto w-full max-w-[1500px] p-3 sm:p-5">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm text-muted-foreground">Only valid, unexpired FUTSTK and FUTIDX contracts are listed.</span>
        <Badge variant="outline">{futures.length} contracts</Badge>
      </div>
      {quoteStatus && <p className="mb-3 text-sm text-amber-500" role="status">{quoteStatus}</p>}
      <InstrumentExplorer
        title="Futures"
        subtitle="Stock and index futures with central Dhan quotes and account-scoped trading."
        asset="futures"
        rows={rows}
        isLoading={!isLoaded}
        watchedSymbols={watchedSymbols}
        onToggleWatchlist={handleWatchlistToggle}
        activeAccountId={activeAccountId}
        activeAccountProvider={activeAccountProvider}
        hasNoAccount={hasNoAccount}
        isAccountLoading={isAccountLoading}
        loadError={loadError}
        onTradeOpen={(symbol) => navigate(`/option-chain?symbol=${encodeURIComponent(symbol)}`)}
        footerLabel="contracts"
        searchPlaceholder="Search futures..."
      />
    </main>
  );
}
