import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useInstrumentLookup } from "@/hooks/useLocalDatabase";
import { useAccountContext } from "@/hooks/useAccountContext";
import { InstrumentExplorer } from "@/components/InstrumentExplorer";
import { getPreferredMarketAdapter } from "@/lib/brokerRouter";
import { classifyInstrument, isProductionInstrument } from "@/lib/instrumentClassification";
import { getSavedWatchlist, saveWatchlist } from "@/lib/watchlist";
import { isMeaningfulMarketValue } from "@/lib/marketDataState";
import { fetchInstrumentMaster } from "@/lib/marketApi";
import type { Instrument } from "@/lib/localDatabase";

export default function Futures() {
  const navigate = useNavigate();
  const [watchedSymbols, setWatchedSymbols] = useState<string[]>(() => getSavedWatchlist());
  const { instruments, isLoaded } = useInstrumentLookup();
  const { activeAccountId, accounts } = useAccountContext();
  const activeAccountProvider = accounts.find((account) => account.id === activeAccountId)?.broker_provider;
  const activeProvider = resolveTerminalMarketDataProvider(activeAccountProvider);
  const kiteMarketQuery = useQuery({
    queryKey: ["futures-market-data", activeAccountId, activeProvider],
    queryFn: async () => {
      if (!activeAccountId || !activeProvider) return null;
      const futures = instruments.filter((instrument) => isProductionInstrument(instrument) && classifyInstrument(instrument) === "futures" && (instrument.provider === activeProvider || (activeProvider === "kite" && instrument.provider === "zerodha")));
      const quotes = [];
      for (let offset = 0; offset < futures.length; offset += 10) {
        const batch = futures.slice(offset, offset + 10);
        const results = await Promise.allSettled(batch.map(async (instrument) => {
          const terminalInstrument = toTerminalMarketDataInstrument(instrument, activeProvider);
          const quote = await requestTerminalMarketData(activeAccountId, activeProvider, { operation: "getQuote", instrument: terminalInstrument });
          return normalizeTerminalMarketQuote(quote, terminalInstrument, instrument.securityId);
        }));
        for (const result of results) if (result.status === "fulfilled") quotes.push(result.value);
      }
      return { instruments: futures, quotes };
    },
    staleTime: 10_000,
    refetchInterval: 15_000,
    retry: false,
  });
  const availableInstruments = kiteMarketQuery.data?.instruments ?? [];
  const quotesByInstrumentId = useMemo(
    () => new Map((kiteMarketQuery.data?.quotes ?? []).map((quote) => [quote.instrumentId ?? quote.providerInstrumentId ?? "", quote])),
    [kiteMarketQuery.data?.quotes],
  );

  useEffect(() => {
    if (instruments.length > 0) return;
    fetchInstrumentMaster()
      .then((result) => setProviderInstruments(result.instruments as Instrument[]))
      .catch(() => setProviderInstruments([]));
  }, [instruments.length]);

  const rows = useMemo(() => {
    return availableInstruments
      .filter((instrument) => isProductionInstrument(instrument) && classifyInstrument(instrument) === "futures")
      .sort((a, b) => a.symbol.localeCompare(b.symbol) || (a.expiryDate || "").localeCompare(b.expiryDate || ""))
      .map((instrument) => {
        const quote = quotesByInstrumentId.get(instrument.securityId);
        const quoteAge = quote?.timestamp ? Date.now() - new Date(quote.timestamp).getTime() : Number.POSITIVE_INFINITY;
        return {
          symbol: instrument.symbol,
          chartSymbol: instrument.tradingSymbol,
          label: instrument.tradingSymbol,
          contract: instrument.tradingSymbol,
          underlying: instrument.symbol,
          expiry: instrument.expiryDate || "—",
          ltp: quote?.ltp ?? null,
          change: quote?.change ?? null,
          changePercent: quote?.changePercent ?? null,
          open: quote?.open ?? null,
          high: quote?.high ?? null,
          low: quote?.low ?? null,
          volume: quote?.volume ?? null,
          oi: quote?.openInterest ?? null,
          oiChange: null,
          isLive: quoteAge >= 0 && quoteAge <= 60_000,
          instrument,
          searchText: `${instrument.symbol} ${instrument.tradingSymbol}`,
        };
      });
  }, [availableInstruments, quotesByInstrumentId]);

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
        activeAccountId={activeAccountId}
        activeAccountProvider={activeAccountProvider}
        onTradeOpen={(symbol) => navigate(`/option-chain?symbol=${symbol}`)}
        footerLabel="contracts"
        searchPlaceholder="Search futures..."
      />
    </main>
  );
}
