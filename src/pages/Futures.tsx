import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useInstrumentLookup } from "@/hooks/useLocalDatabase";
import { InstrumentExplorer } from "@/components/InstrumentExplorer";
import { classifyInstrument, isProductionInstrument } from "@/lib/instrumentClassification";
import { getSavedWatchlist, saveWatchlist } from "@/lib/watchlist";
import { isMeaningfulMarketValue } from "@/lib/marketDataState";
import { fetchInstrumentMaster } from "@/lib/marketApi";
import type { Instrument } from "@/lib/localDatabase";

export default function Futures() {
  const navigate = useNavigate();
  const [watchedSymbols, setWatchedSymbols] = useState<string[]>(() => getSavedWatchlist());
  const { instruments, isLoaded } = useInstrumentLookup();
  const [providerInstruments, setProviderInstruments] = useState<Instrument[]>([]);

  useEffect(() => {
    if (instruments.length > 0) return;
    fetchInstrumentMaster()
      .then((result) => setProviderInstruments(result.instruments as Instrument[]))
      .catch(() => setProviderInstruments([]));
  }, [instruments.length]);

  const availableInstruments = instruments.length > 0 ? instruments : providerInstruments;

  const rows = useMemo(() => {
    return availableInstruments
      .filter((instrument) => isProductionInstrument(instrument) && classifyInstrument(instrument) === "futures")
      .sort((a, b) => a.symbol.localeCompare(b.symbol) || (a.expiryDate || "").localeCompare(b.expiryDate || ""))
      .map((instrument) => ({
        symbol: instrument.symbol,
        label: instrument.symbol,
        contract: instrument.tradingSymbol,
        underlying: instrument.symbol,
        expiry: instrument.expiryDate || "—",
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
        searchText: `${instrument.symbol} ${instrument.tradingSymbol}`,
      }));
  }, [availableInstruments]);

  const hasAvailableMarketData = rows.some((row) => isMeaningfulMarketValue(row.ltp) || isMeaningfulMarketValue(row.open) || isMeaningfulMarketValue(row.high));

  const explorerSubtitle = hasAvailableMarketData
    ? "Available futures contracts from the instrument master. Live quote updates will appear when the market is active."
    : "Futures contracts are available from the instrument master and will display live or last-known values when data is available.";

  const handleWatchlistToggle = (symbol: string) => {
    const next = watchedSymbols.includes(symbol) ? watchedSymbols.filter((entry) => entry !== symbol) : [...watchedSymbols, symbol];
    setWatchedSymbols(next);
    saveWatchlist(next);
  };

  return (
    <main className="mx-auto w-full max-w-[1500px] p-3 sm:p-5">
      <InstrumentExplorer
        title="Futures"
        subtitle={explorerSubtitle}
        asset="futures"
        rows={rows}
        isLoading={!isLoaded}
        watchedSymbols={watchedSymbols}
        onToggleWatchlist={handleWatchlistToggle}
        onTradeOpen={(symbol) => navigate(`/option-chain?symbol=${symbol}`)}
        footerLabel="contracts"
        searchPlaceholder="Search futures..."
      />
    </main>
  );
}
