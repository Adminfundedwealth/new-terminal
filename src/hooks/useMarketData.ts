import { useQuery } from "@tanstack/react-query";
import { fetchMarketStatus, fetchAllIndices, fetchProxyHealth, isNseMarketOpenAt, isWithinNseSessionAt } from "@/lib/marketApi";
import type { FnOStockData, OptionUnderlying } from "@/lib/marketApi";
import { getMaxPain } from "@/lib/oiUtils";
import type { OptionData, ExpiryDate } from "@/lib/mockData";
import { useAccountContext } from "@/hooks/useAccountContext";
import {
  requestTerminalMarketData,
  resolveTerminalMarketDataProvider,
  type TerminalMarketDataInstrument,
  type TerminalMarketDataOptionChain,
  type TerminalMarketDataQuote,
} from "@/lib/terminalApi";
import {
  getCandleHistory,
} from "@/lib/localDatabase";

// ── Shared state: tracks whether proxy is reachable ──
let proxyStatus: "unknown" | "online" | "offline" = "unknown";
let proxyCheckTime = 0;

function markProxyOnline() { proxyStatus = "online"; proxyCheckTime = Date.now(); }
function markProxyOffline() { proxyStatus = "offline"; proxyCheckTime = Date.now(); }
function shouldTryProxy(): boolean {
  if (proxyStatus === "unknown") return true;
  if (proxyStatus === "online") return true;
  return Date.now() - proxyCheckTime > 30000;
}

// ── Hook: Live indices from the central Dhan market-data service ──
export function useLiveIndices() {
  const marketStatus = useMarketStatus();
  const aliases: Record<string, string[]> = {
    NIFTY: ["NIFTY", "NIFTY 50"],
    BANKNIFTY: ["BANKNIFTY", "NIFTY BANK"],
    FINNIFTY: ["FINNIFTY", "NIFTY FIN SERVICE"],
    MIDCPNIFTY: ["MIDCPNIFTY", "NIFTY MID SELECT"],
  };

  const pollingQuery = useQuery({
    queryKey: ["global-dhan-indices"],
    queryFn: async () => {
      const catalog = await requestTerminalMarketData<TerminalMarketDataInstrument[]>(
        null,
        "dhan",
        { operation: "listInstruments" },
      );
      const instruments = Object.entries(aliases).flatMap(([symbol, names]) => {
        const acceptedNames = new Set(names.map((name) => name.toUpperCase()));
        const instrument = catalog.find((candidate) =>
          candidate.exchangeSegment === "IDX_I" &&
          candidate.instrumentType.toUpperCase() === "INDEX" &&
          (acceptedNames.has(candidate.symbol.trim().toUpperCase()) ||
            acceptedNames.has(candidate.tradingSymbol.trim().toUpperCase()))
        );
        return instrument ? [{ symbol, instrument }] : [];
      });
      if (instruments.length === 0) throw new Error("The official Dhan instrument catalog contains no supported NSE indices.");
      const quotes = await requestTerminalMarketData<TerminalMarketDataQuote[]>(
        null,
        "dhan",
        { operation: "getQuotes", instruments: instruments.map(({ instrument }) => instrument) },
      );
      const quotesBySymbol = new Map(quotes.map((quote) => [quote.symbol, quote]));
      return {
        data: instruments.flatMap(({ symbol, instrument }) => {
          const quote = quotesBySymbol.get(instrument.symbol) ??
            quotesBySymbol.get(instrument.tradingSymbol);
          if (!quote || quote.change === null || quote.changePercent === null ||
              quote.open === null || quote.high === null || quote.low === null ||
              quote.previousClose === null || quote.ltp <= 0) return [];
          const names: Record<string, string> = {
            NIFTY: "NIFTY 50",
            BANKNIFTY: "BANK NIFTY",
            FINNIFTY: "FIN NIFTY",
            MIDCPNIFTY: "MIDCAP NIFTY",
          };
          return [{
            name: names[symbol],
            symbol,
            ltp: quote.ltp,
            change: quote.change,
            changePercent: quote.changePercent,
            high: quote.high,
            low: quote.low,
            open: quote.open,
            prevClose: quote.previousClose,
            timestamp: quote.timestamp,
          }];
        }),
      };
    },
    refetchInterval: marketStatus.data?.isOpen ? 5_000 : 60_000,
    staleTime: 3_000,
    retry: 2,
  });

  const indices = pollingQuery.data?.data ?? [];
  const isLive = Boolean(marketStatus.data?.isLive && marketStatus.data.isOpen && indices.length > 0);

  return {
    data: { data: indices, isLive },
    isLoading: pollingQuery.isLoading,
    error: pollingQuery.error,
  };
}

// ── Hook: Market Status + GIFT Nifty ──
export function useMarketStatus() {
  return useQuery({
    queryKey: ["nse-market-status"],
    queryFn: async () => {
      if (shouldTryProxy()) {
        try {
          const data = await fetchMarketStatus();
          if (data?.marketState) {
            markProxyOnline();
            const nseStatus = data.marketState.find((m: any) => m.market === "Capital Market" || m.market === "CM");
            const giftNifty = data.giftnifty ? {
              lastPrice: data.giftnifty.LASTPRICE || 0, change: data.giftnifty.DAYCHANGE || 0,
              changePercent: data.giftnifty.PERCHANGE || 0, expiry: data.giftnifty.EXPIRYDATE || "",
              timestamp: data.giftnifty.TIMESTMP || "", contractsTraded: data.giftnifty.CONTRACTSTRADED || 0,
            } : null;
            const indicativeNifty = data.indicativenifty50 ? {
              value: data.indicativenifty50.finalClosingValue || data.indicativenifty50.closingValue || 0,
              change: data.indicativenifty50.change || 0, changePercent: data.indicativenifty50.perChange || 0,
              status: data.indicativenifty50.status || "",
            } : null;
            const isOpen = isNseMarketOpenAt(nseStatus?.marketStatus, nseStatus?.tradeDate);
            return { isOpen, status: isOpen ? "Open" : "Closed", isLive: true, giftNifty, indicativeNifty };
          }
        } catch (e) { markProxyOffline(); console.warn("Market status fetch failed:", e); }
      }
      const now = new Date();
      const isOpen = isWithinNseSessionAt(now);
      return { isOpen, status: isOpen ? "Open" : "Closed", isLive: false, giftNifty: null, indicativeNifty: null };
    },
    refetchInterval: (query) => query.state.data?.isLive ? 15000 : 60000,
    staleTime: 10000,
    retry: 0,
  });
}

// ── Hook: Live Option Chain ──
// Returns live data during market hours, or cached "last close" data after hours
export function useLiveOptionChain(symbol: string, expiry?: string, enabled = true, underlying?: OptionUnderlying) {
  const provider = resolveTerminalMarketDataProvider(null);
  const centralUnderlying = underlying ?? null;

  return useQuery({
    queryKey: ["live-option-chain", "founder-dhan", symbol, expiry, centralUnderlying?.securityId, centralUnderlying?.exchangeSegment],
    enabled: enabled && Boolean(symbol.trim()),
    queryFn: async () => {
      const result = await requestTerminalMarketData<TerminalMarketDataOptionChain>(null, provider, {
        operation: "getOptionChain",
        underlying: symbol.toUpperCase(),
        ...(expiry ? { expiry } : {}),
      });
      const optionInstruments = await requestTerminalMarketData<TerminalMarketDataInstrument[]>(null, provider, {
        operation: "searchInstruments",
        query: symbol.toUpperCase(),
      });

      const expiries: ExpiryDate[] = result.expiries.map((value) => {
        if (typeof value !== "string") return value;
        const date = new Date(value);
        return {
          label: date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
          value,
          daysToExpiry: Math.max(0, Math.ceil((date.getTime() - Date.now()) / (1000 * 60 * 60 * 24))),
        };
      });
      const optionInstrument = optionInstruments.find((instrument) =>
        ["OPTIDX", "OPTSTK"].includes(instrument.instrumentType.toUpperCase()) &&
        (!expiry || instrument.expiryDate === expiry)
      );
      const hasChainData = result.chain.length > 0;
      const isAfterHours = result.afterHours ?? false;
      const stepSize = result.chain.length > 1
        ? Math.abs(result.chain[1].strikePrice - result.chain[0].strikePrice)
        : 50;

      if (!hasChainData && !isAfterHours) return null;
      return {
        chain: result.chain,
        spotPrice: result.spotPrice,
        expiries,
        lotSize: optionInstrument?.lotSize ?? 0,
        stepSize,
        maxPain: hasChainData ? getMaxPain(result.chain) : 0,
        totalCEOI: result.totalCEOI,
        totalPEOI: result.totalPEOI,
        greeksAvailable: result.greeksAvailable,
        ivAvailable: result.ivAvailable ?? result.chain.some((row) =>
          row.call?.iv != null || row.put?.iv != null
        ),
        isLive: hasChainData && !isAfterHours,
        afterHours: isAfterHours,
        source: "source" in result ? result.source : result.provider,
        cachedAt: result.cachedAt ?? null,
        oiChangeAvailable: "oiChangeAvailable" in result && typeof result.oiChangeAvailable === "boolean"
          ? result.oiChangeAvailable
          : undefined,
        errorMessage: "errorMessage" in result && typeof result.errorMessage === "string"
          ? result.errorMessage
          : undefined,
        unsupported: "unsupported" in result && typeof result.unsupported === "boolean"
          ? result.unsupported
          : undefined,
      };
    },
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.isLive) return 3000;         // Live: 3s refresh
      if (data?.afterHours) return 120000;   // After hours: 2min (data won't change)
      return 15000;                           // Offline/retrying: 15s
    },
    staleTime: 2000,
    retry: 1,
  });
}

// ── Hook: Expiry List ──
// NO MOCK FALLBACK — returns empty array
export function useExpiryList(symbol: string, underlying?: OptionUnderlying) {
  const provider = resolveTerminalMarketDataProvider(null);
  const centralUnderlying = underlying ?? null;

  return useQuery({
    queryKey: ["expiry-list", "founder-dhan", symbol, centralUnderlying?.securityId, centralUnderlying?.exchangeSegment],
    enabled: Boolean(symbol.trim()),
    queryFn: async () => {
      const chain = await requestTerminalMarketData<TerminalMarketDataOptionChain>(null, provider, {
        operation: "getOptionChain",
        underlying: symbol.toUpperCase(),
      });
      const expiries: ExpiryDate[] = chain.expiries.map((value) => {
        const date = new Date(value);
        return {
          label: date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
          value,
          daysToExpiry: Math.max(0, Math.ceil((date.getTime() - Date.now()) / (1000 * 60 * 60 * 24))),
        };
      });
      return { expiries, isLive: true };
    },
    staleTime: 60000,
    refetchInterval: 120000,
    retry: 1,
  });
}

// ── Hook: All Indices (VIX + Sectors + Advance/Decline) ──
// NO MOCK FALLBACK — returns null values when offline
export function useAllIndices() {
  const marketStatus = useMarketStatus();
  return useQuery({
    queryKey: ["nse-all-indices"],
    queryFn: async () => {
      let marketSummary = {
        sectors: [] as Array<{ name: string; change: number; stocks: Array<{ symbol: string; change: number }> }>,
        advances: 0,
        declines: 0,
        unchanged: 0,
      };
      if (shouldTryProxy()) {
        try {
          const data = await fetchAllIndices();
          if (data) {
            markProxyOnline();
            marketSummary = {
              sectors: data.sectors ?? [],
              advances: data.advances ?? 0,
              declines: data.declines ?? 0,
              unchanged: data.unchanged ?? 0,
            };
          }
        } catch (error) {
          markProxyOffline();
          console.warn("NSE market summary fetch failed:", error);
        }
      }

      let vix: { value: number; change: number; changePercent: number; high: number | null; low: number | null; timestamp: string } | null = null;
      try {
        const catalog = await requestTerminalMarketData<TerminalMarketDataInstrument[]>(
          null,
          "dhan",
          { operation: "listInstruments" },
        );
        const vixInstrument = catalog.find((instrument) =>
          instrument.exchangeSegment === "IDX_I" &&
          instrument.instrumentType.toUpperCase() === "INDEX" &&
          ["INDIAVIX", "INDIA VIX"].includes(instrument.symbol.trim().toUpperCase())
        );
        if (vixInstrument) {
          const quote = await requestTerminalMarketData<TerminalMarketDataQuote>(
            null,
            "dhan",
            { operation: "getQuote", instrument: vixInstrument },
          );
          if (quote.change !== null && quote.changePercent !== null && quote.ltp > 0) {
            vix = {
              value: quote.ltp,
              change: quote.change,
              changePercent: quote.changePercent,
              high: quote.high,
              low: quote.low,
              timestamp: quote.timestamp,
            };
          }
        }
      } catch (error) {
        console.warn("Central Dhan India VIX quote unavailable:", error);
      }

      return {
        ...marketSummary,
        vix,
        isLive: Boolean(vix && marketStatus.data?.isLive && marketStatus.data.isOpen),
      };
    },
    refetchInterval: marketStatus.data?.isOpen ? 30_000 : 120_000,
    staleTime: 15000,
    retry: 1,
  });
}

// ── Hook: F&O Stocks (Top Movers + Most Active) ──
// NO MOCK FALLBACK — returns empty arrays when offline
export function useFnOStocks() {
  const marketStatus = useMarketStatus();
  return useQuery({
    queryKey: ["global-dhan-fno-stocks"],
    queryFn: async () => {
      const catalog = await requestTerminalMarketData<TerminalMarketDataInstrument[]>(
        null,
        "dhan",
        { operation: "listInstruments" },
      );
      const activeFutures = catalog
        .filter((instrument) =>
          instrument.exchangeSegment === "NSE_FNO" &&
          instrument.instrumentType.toUpperCase() === "FUTSTK" &&
          Boolean(instrument.expiryDate) &&
          Date.parse(instrument.expiryDate ?? "") >= Date.now()
        )
        .sort((left, right) => (left.expiryDate ?? "").localeCompare(right.expiryDate ?? ""));
      const futuresBySymbol = new Map<string, TerminalMarketDataInstrument>();
      for (const future of activeFutures) {
        if (!futuresBySymbol.has(future.symbol)) futuresBySymbol.set(future.symbol, future);
      }
      const cashInstruments = catalog.filter((instrument) =>
        instrument.exchangeSegment === "NSE_EQ" &&
        instrument.instrumentType.toUpperCase() === "EQUITY" &&
        futuresBySymbol.has(instrument.symbol)
      );
      const futures = [...futuresBySymbol.values()];
      const instruments = [...cashInstruments, ...futures];
      const quotes: TerminalMarketDataQuote[] = [];
      for (let offset = 0; offset < instruments.length; offset += 50) {
        const batch = await requestTerminalMarketData<TerminalMarketDataQuote[]>(
          null,
          "dhan",
          { operation: "getQuotes", instruments: instruments.slice(offset, offset + 50) },
        );
        quotes.push(...batch);
      }
      const quoteBySymbol = new Map(quotes.map((quote) => [`${quote.exchange}:${quote.tradingSymbol}`, quote]));
      const stocks: FnOStockData[] = cashInstruments.flatMap((instrument) => {
        const quote = quoteBySymbol.get(`${instrument.exchange}:${instrument.tradingSymbol}`);
        const future = futuresBySymbol.get(instrument.symbol);
        const futureQuote = future ? quoteBySymbol.get(`${future.exchange}:${future.tradingSymbol}`) : undefined;
        if (!quote || quote.change === null || quote.changePercent === null ||
            quote.open === null || quote.high === null || quote.low === null ||
            quote.previousClose === null || quote.volume === null) return [];
        return [{
          symbol: instrument.symbol,
          ltp: quote.ltp,
          change: quote.change,
          changePercent: quote.changePercent,
          open: quote.open,
          high: quote.high,
          low: quote.low,
          previousClose: quote.previousClose,
          volume: quote.volume,
          totalTradedVolume: quote.volume,
          ...(futureQuote?.openInterest == null ? {} : { openInterest: futureQuote.openInterest }),
        }];
      });
      const gainers = [...stocks].filter((stock) => stock.changePercent > 0).sort((a, b) => b.changePercent - a.changePercent).slice(0, 5);
      const losers = [...stocks].filter((stock) => stock.changePercent < 0).sort((a, b) => a.changePercent - b.changePercent).slice(0, 5);
      const mostActive = [...stocks].sort((a, b) => b.volume - a.volume).slice(0, 10).map((stock) => ({
        ...stock,
        oi: stock.openInterest ?? 0,
        oiChange: stock.oiChange ?? 0,
        oiInterpretation: getOIInterpretation(stock.changePercent, stock.oiChange ?? 0),
      }));
      return {
        gainers,
        losers,
        mostActive,
        allStocks: stocks,
        isLive: Boolean(marketStatus.data?.isLive && marketStatus.data.isOpen && stocks.length > 0),
        source: "dhan" as const,
      };
    },
    refetchInterval: marketStatus.data?.isOpen ? 30_000 : 120_000,
    staleTime: 15000,
    retry: 2,
  });
}

// ── Hook: Candle history for charts ──
export function useStoredCandles(symbol: string, interval: string = "5m") {
  return useQuery({
    queryKey: ["stored-candles", symbol, interval],
    queryFn: async () => {
      const instruments = await requestTerminalMarketData<TerminalMarketDataInstrument[]>(
        null,
        "dhan",
        { operation: "searchInstruments", query: symbol.trim().replace(/_/g, " ") },
      );
      const normalizedSymbol = symbol.trim().toUpperCase();
      const acceptedNames = new Set([
        normalizedSymbol,
        ...(normalizedSymbol === "NIFTY" ? ["NIFTY 50"] : []),
        ...(normalizedSymbol === "BANKNIFTY" ? ["NIFTY BANK"] : []),
        ...(normalizedSymbol === "FINNIFTY" ? ["NIFTY FIN SERVICE"] : []),
        ...(normalizedSymbol === "MIDCPNIFTY" ? ["NIFTY MID SELECT"] : []),
      ]);
      const instrument = instruments.find((candidate) =>
        acceptedNames.has(candidate.symbol.trim().toUpperCase()) ||
        acceptedNames.has(candidate.tradingSymbol.trim().toUpperCase())
      );
      if (!instrument) return null;
      const history = await getCandleHistory(instrument.providerInstrumentId, interval);
      if (history?.provider !== "dhan" || !history.candles.length) return null;

      return {
        symbol: history.symbol,
        interval: history.interval,
        lastUpdated: history.lastUpdated,
        candles: history.candles.map(c => ({
          time: c.timestamp,
          date: new Date(c.timestamp).toLocaleString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
            day: "numeric",
            month: "short",
          }),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
          oi: c.oi,
        })),
      };
    },
    staleTime: 60000,
    retry: 0,
  });
}

function getOIInterpretation(changePercent: number, oiChange: number): string {
  if (changePercent > 0 && oiChange > 0) return "Long Buildup";
  if (changePercent < 0 && oiChange > 0) return "Short Buildup";
  if (changePercent > 0 && oiChange < 0) return "Short Covering";
  if (changePercent < 0 && oiChange < 0) return "Long Unwinding";
  return "Neutral";
}

export function resetProxyStatus() { proxyStatus = "unknown"; proxyCheckTime = 0; }


// ── Hook: Proxy Health ──
export function useProxyHealth() {
  return useQuery({
    queryKey: ["proxy-health"],
    queryFn: async () => {
      try {
        const health = await fetchProxyHealth();
        return { ...health, reachable: true };
      } catch {
        return { reachable: false, status: "offline" };
      }
    },
    refetchInterval: 30000,
    staleTime: 10000,
    retry: 0,
  });
}
