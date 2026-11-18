import { useQuery } from "@tanstack/react-query";
import { fetchLiveFnOStocks, fetchProxyHealth } from "@/lib/marketApi";
import type { FnOStockData, MarketIndicesSnapshot, OptionUnderlying } from "@/lib/marketApi";
import { getMaxPain } from "@/lib/oiUtils";
import type { OptionData, IndexData, ExpiryDate } from "@/lib/mockData";
import { useAccountContext } from "@/hooks/useAccountContext";
import {
  requestTerminalMarketData,
  resolveTerminalMarketDataProvider,
  fetchTerminalMarketDataStatus,
  type TerminalMarketDataInstrument,
  type TerminalMarketDataOptionChain,
} from "@/lib/terminalApi";
import { useWebSocketIndices, useWebSocketVix, useWebSocketStatus } from "@/hooks/useWebSocket";
import { useMemo, useEffect, useState, useRef } from "react";
import {
  getAllPriceSnapshots,
  getCandleHistory,
  getDatabaseStats,
  type PriceSnapshot,
} from "@/lib/localDatabase";

// ── Shared state: tracks whether proxy is reachable ──
let proxyStatus: "unknown" | "online" | "offline" = "unknown";
let proxyCheckTime = 0;

const CENTRAL_INDEX_OPTION_UNDERLYINGS: Record<string, OptionUnderlying> = {
  NIFTY: { securityId: "13", exchangeSegment: "IDX_I" },
  BANKNIFTY: { securityId: "25", exchangeSegment: "IDX_I" },
  FINNIFTY: { securityId: "27", exchangeSegment: "IDX_I" },
  MIDCPNIFTY: { securityId: "442", exchangeSegment: "IDX_I" },
};

function resolveCentralOptionUnderlying(symbol: string, underlying?: OptionUnderlying): OptionUnderlying | null {
  return underlying ?? CENTRAL_INDEX_OPTION_UNDERLYINGS[symbol.trim().toUpperCase()] ?? null;
}

function markProxyOnline() { proxyStatus = "online"; proxyCheckTime = Date.now(); }
function markProxyOffline() { proxyStatus = "offline"; proxyCheckTime = Date.now(); }
function shouldTryProxy(): boolean {
  if (proxyStatus === "unknown") return true;
  if (proxyStatus === "online") return true;
  return Date.now() - proxyCheckTime > 30000;
}

// ── Local database cache singleton ──
let cachedPrices: PriceSnapshot[] | null = null;
let cachedPricesLoaded = false;
let cachedPricesPromise: Promise<PriceSnapshot[]> | null = null;

async function getCachedPricesOnce(): Promise<PriceSnapshot[]> {
  if (cachedPrices !== null) return cachedPrices;
  if (cachedPricesPromise) return cachedPricesPromise;
  cachedPricesPromise = getAllPriceSnapshots().then((p) => {
    cachedPrices = p;
    cachedPricesLoaded = true;
    return p;
  }).catch((error) => {
    console.warn("Local market price cache could not be read:", error);
    cachedPrices = [];
    cachedPricesLoaded = true;
    return [];
  });
  return cachedPricesPromise;
}

// Build indices from cached price snapshots
function buildCachedIndices(prices: PriceSnapshot[]): IndexData[] {
  const indexSymbols = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"];
  const nameMap: Record<string, string> = {
    NIFTY: "NIFTY 50",
    BANKNIFTY: "BANK NIFTY",
    FINNIFTY: "FIN NIFTY",
    MIDCPNIFTY: "MIDCAP NIFTY",
  };
  return indexSymbols
    .map((sym) => {
      const p = prices.find((pr) => pr.symbol === sym);
      if (!p) return null;
      return {
        name: nameMap[sym] || sym,
        symbol: sym,
        ltp: p.ltp,
        change: p.change,
        changePercent: p.changePercent,
        high: p.high,
        low: p.low,
        open: p.open,
        prevClose: p.close,
      };
    })
    .filter(Boolean) as IndexData[];
}

type MarketIndexQueryData = MarketIndicesSnapshot & { isLive: boolean };

function useMarketIndexSnapshot() {
  const wsConnected = useWebSocketStatus();

  return useQuery({
    queryKey: ["nse-market-index-snapshot"],
    queryFn: async ({ signal }): Promise<MarketIndexQueryData> => {
      try {
        const instruments: TerminalMarketDataInstrument[] = [
          { provider: "dhan", providerInstrumentId: "13", symbol: "NIFTY 50", tradingSymbol: "NIFTY", exchange: "NSE", exchangeSegment: "IDX_I", instrumentType: "INDEX" },
          { provider: "dhan", providerInstrumentId: "25", symbol: "NIFTY BANK", tradingSymbol: "BANKNIFTY", exchange: "NSE", exchangeSegment: "IDX_I", instrumentType: "INDEX" },
          { provider: "dhan", providerInstrumentId: "27", symbol: "NIFTY FINANCIAL SERVICES", tradingSymbol: "FINNIFTY", exchange: "NSE", exchangeSegment: "IDX_I", instrumentType: "INDEX" },
          { provider: "dhan", providerInstrumentId: "442", symbol: "NIFTY MID SELECT", tradingSymbol: "MIDCPNIFTY", exchange: "NSE", exchangeSegment: "IDX_I", instrumentType: "INDEX" },
        ];
        const quotes = await requestTerminalMarketData(
          null,
          "dhan",
          "production",
          { operation: "getQuotes", instruments },
          signal,
        ) as Array<{ symbol: string; tradingSymbol: string; ltp: number; change: number | null; changePercent: number | null; open: number | null; high: number | null; low: number | null; previousClose: number | null }>;
        const indices: IndexData[] = quotes.map((quote) => ({
          name: quote.symbol,
          symbol: quote.tradingSymbol,
          ltp: quote.ltp,
          change: quote.change ?? 0,
          changePercent: quote.changePercent ?? 0,
          high: quote.high ?? quote.ltp,
          low: quote.low ?? quote.ltp,
          open: quote.open ?? quote.previousClose ?? quote.ltp,
          prevClose: quote.previousClose ?? quote.ltp,
        }));
        if (indices.length > 0) {
          return {
            indices,
            allIndices: { vix: null, sectors: [], advances: 0, declines: 0, unchanged: 0 },
            isLive: true,
          };
        }
      } catch (error) {
        if (signal.aborted) throw error;
        console.warn("Central market indices fetch failed:", error);
      }

      const dbIndices = buildCachedIndices(await getCachedPricesOnce());
      return {
        indices: dbIndices,
        allIndices: {
          vix: null,
          sectors: [],
          advances: 0,
          declines: 0,
          unchanged: 0,
        },
        isLive: false,
      };
    },
    refetchInterval: wsConnected ? 120000 : ((query) => query.state.data?.isLive ? 30000 : 60000),
    staleTime: 10000,
    retry: false,
  });
}

// ── Hook: Live Indices (WebSocket primary, polling fallback, DB cache tertiary) ──
// NO MOCK FALLBACK — returns empty array when offline
export function useLiveIndices() {
  const { indices: wsIndices } = useWebSocketIndices();
  const pollingQuery = useMarketIndexSnapshot();

  // Merge WebSocket data over polling data
  const mergedData = useMemo(() => {
    if (wsIndices.length > 0) {
      const polledData = pollingQuery.data?.indices || [];
      const merged = wsIndices.map((wsIdx) => {
        const polled = polledData.find((p) => p.symbol === wsIdx.symbol);
        return {
          name: wsIdx.name,
          symbol: wsIdx.symbol,
          ltp: wsIdx.ltp,
          change: wsIdx.change,
          changePercent: wsIdx.changePercent,
          open: wsIdx.open || polled?.open || wsIdx.ltp,
          high: wsIdx.high || polled?.high || wsIdx.ltp,
          low: wsIdx.low || polled?.low || wsIdx.ltp,
          prevClose: wsIdx.prevClose || polled?.prevClose || wsIdx.ltp,
        };
      });

      for (const p of polledData) {
        if (!merged.find((m) => m.symbol === p.symbol)) {
          merged.push(p);
        }
      }

      return { data: merged, isLive: true };
    }

    return {
      data: pollingQuery.data?.indices ?? [],
      isLive: pollingQuery.data?.isLive ?? false,
    };
  }, [wsIndices, pollingQuery.data]);

  return {
    data: mergedData,
    isLoading: pollingQuery.isLoading && wsIndices.length === 0,
  };
}

// ── Hook: Market Status + GIFT Nifty ──
export function useMarketStatus() {
  return useQuery({
    queryKey: ["nse-market-status"],
    queryFn: async ({ signal }) => {
      try {
        const status = await fetchTerminalMarketDataStatus(null, "dhan", "production", signal);
        const session = status.market_session;
        if (session) {
          return {
            isOpen: session.is_live,
            status: session.state === "LIVE" ? "Open" : "Closed",
            isLive: session.is_live,
            giftNifty: null,
            indicativeNifty: null,
            timestamp: session.timestamp,
          };
        }
      } catch (error) {
        if (signal.aborted) throw error;
        console.warn("Central market status fetch failed:", error);
      }
      return {
        isOpen: false,
        status: "Closed",
        isLive: false,
        giftNifty: null,
        indicativeNifty: null,
        timestamp: null,
      };
    },
    refetchInterval: (query) => query.state.data?.isLive ? 15000 : 60000,
    staleTime: 10000,
    retry: 0,
  });
}

// ── Hook: Live Option Chain ──
// Returns live data during market hours, or cached "last close" data after hours
export function useLiveOptionChain(symbol: string, expiry?: string, enabled = true, underlying?: OptionUnderlying, lotSizeOverride?: number) {
  const provider = resolveTerminalMarketDataProvider(null);
  const centralUnderlying = resolveCentralOptionUnderlying(symbol, underlying);

  return useQuery({
    queryKey: ["live-option-chain", "founder-dhan", symbol, expiry, centralUnderlying?.securityId, centralUnderlying?.exchangeSegment],
    enabled: enabled && Boolean(symbol.trim()),
    queryFn: async ({ signal }) => {
      const chainRequest = requestTerminalMarketData<TerminalMarketDataOptionChain>(null, provider, {
        operation: "getOptionChain",
        underlying: symbol.toUpperCase(),
        ...(expiry ? { expiry } : {}),
      }, "production", signal);
      const instrumentRequest = lotSizeOverride && lotSizeOverride > 0
        ? Promise.resolve([] as TerminalMarketDataInstrument[])
        : requestTerminalMarketData<TerminalMarketDataInstrument[]>(null, provider, {
          operation: "searchInstruments",
          query: symbol.toUpperCase(),
        }, "production", signal);
      const [result, optionInstruments] = await Promise.all([chainRequest, instrumentRequest]);

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
        (!expiry || (instrument.expiryDate ?? "").slice(0, 10) === expiry.slice(0, 10))
      );
      const hasChainData = result.chain.length > 0;
      const isAfterHours = result.afterHours ?? false;
      const stepSize = result.chain.length > 1
        ? Math.abs(result.chain[1].strikePrice - result.chain[0].strikePrice)
        : 50;

      if (!hasChainData && !isAfterHours) return null;
      // Use the caller-supplied lot size (from local instrument master) if available,
      // otherwise fall back to searchInstruments result
      const instrumentLotSize = (lotSizeOverride && lotSizeOverride > 0)
        ? lotSizeOverride
        : (optionInstrument?.lotSize ?? 0);
      return {
        chain: result.chain,
        spotPrice: result.spotPrice,
        expiries,
        lotSize: instrumentLotSize > 0 ? instrumentLotSize : 0,
        stepSize,
        maxPain: hasChainData ? getMaxPain(result.chain) : 0,
        totalCEOI: result.totalCEOI,
        totalPEOI: result.totalPEOI,
        isLive: hasChainData && !isAfterHours,
        afterHours: isAfterHours,
        source: "source" in result ? result.source : result.provider,
        greeksAvailable: result.greeksAvailable,
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
    retry: false,
  });
}

// ── Hook: Expiry List ──
// NO MOCK FALLBACK — returns empty array
export function useExpiryList(symbol: string, underlying?: OptionUnderlying) {
  const provider = resolveTerminalMarketDataProvider(null);
  const centralUnderlying = resolveCentralOptionUnderlying(symbol, underlying);

  return useQuery({
    queryKey: ["expiry-list", "founder-dhan", symbol, centralUnderlying?.securityId, centralUnderlying?.exchangeSegment],
    enabled: Boolean(symbol.trim()),
    queryFn: async ({ signal }) => {
      const chain = await requestTerminalMarketData<TerminalMarketDataOptionChain>(null, provider, {
        operation: "getOptionChain",
        underlying: symbol.toUpperCase(),
      }, "production", signal);
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
    retry: false,
  });
}

// ── Hook: All Indices (VIX + Sectors + Advance/Decline) ──
// NO MOCK FALLBACK — returns null values when offline
export function useAllIndices() {
  const { vix: wsVix } = useWebSocketVix();
  const pollingQuery = useMarketIndexSnapshot();

  // Merge WebSocket VIX over polled VIX
  const mergedData = useMemo(() => {
    const base = pollingQuery.data?.allIndices || {
      vix: null, sectors: [], advances: 0, declines: 0, unchanged: 0, isLive: false,
    };

    if (wsVix) {
      return {
        ...base,
        vix: wsVix,
        isLive: true,
      };
    }

    return { ...base, isLive: pollingQuery.data?.isLive ?? false };
  }, [pollingQuery.data, wsVix]);

  return { data: mergedData, isLoading: pollingQuery.isLoading };
}

// ── Hook: F&O Stocks (Top Movers + Most Active) ──
// NO MOCK FALLBACK — returns empty arrays when offline
export function useFnOStocks() {
  return useQuery({
    queryKey: ["nse-fno-stocks"],
    queryFn: async ({ signal }) => {
      if (shouldTryProxy()) {
        try {
          const stocks = await fetchLiveFnOStocks(signal);
          if (stocks.length > 0) {
            markProxyOnline();
            const gainers = [...stocks].filter(s => s.changePercent > 0).sort((a, b) => b.changePercent - a.changePercent).slice(0, 5);
            const losers = [...stocks].filter(s => s.changePercent < 0).sort((a, b) => a.changePercent - b.changePercent).slice(0, 5);
            const mostActive = [...stocks].sort((a, b) => (b.volume || 0) - (a.volume || 0)).slice(0, 10).map(s => ({
              ...s, oi: s.openInterest || 0, oiChange: s.oiChange || 0,
              oiInterpretation: getOIInterpretation(s.changePercent, s.oiChange || 0),
            }));
            const hasOI = stocks.some(s => (s.openInterest || 0) > 0);
            const source = hasOI ? "nse" as const : "tradingview" as const;
            return { gainers, losers, mostActive, allStocks: stocks, isLive: true, source };
          }
        } catch (e) {
          if (signal.aborted) throw e;
          markProxyOffline();
          console.warn("F&O stocks fetch failed:", e);
        }
      }
      // Try local DB price snapshots
      const dbPrices = await getCachedPricesOnce();
      if (dbPrices.length > 0) {
        const dbStocks: FnOStockData[] = dbPrices
          .filter(p => p.ltp > 0 && p.symbol)
          .map(p => ({
            symbol: p.symbol,
            ltp: p.ltp,
            change: p.change,
            changePercent: p.changePercent,
            open: p.open,
            high: p.high,
            low: p.low,
            previousClose: p.close,
            volume: p.volume,
            totalTradedVolume: p.volume,
            openInterest: p.oi,
            oiChange: 0,
          }));
        if (dbStocks.length > 0) {
          const gainers = [...dbStocks].filter(s => s.changePercent > 0).sort((a, b) => b.changePercent - a.changePercent).slice(0, 5);
          const losers = [...dbStocks].filter(s => s.changePercent < 0).sort((a, b) => a.changePercent - b.changePercent).slice(0, 5);
          const mostActive = [...dbStocks].sort((a, b) => (b.volume || 0) - (a.volume || 0)).slice(0, 10).map(s => ({
            ...s, oi: s.openInterest || 0, oiChange: s.oiChange || 0,
            oiInterpretation: getOIInterpretation(s.changePercent, s.oiChange || 0),
          }));
          return { gainers, losers, mostActive, allStocks: dbStocks, isLive: false, source: "database" as const };
        }
      }
      // NO MOCK — return empty
      return { gainers: [], losers: [], mostActive: [], allStocks: [] as FnOStockData[], isLive: false, source: "none" as const };
    },
    refetchInterval: (query) => query.state.data?.isLive ? 30000 : 120000,
    staleTime: 15000,
    retry: false,
  });
}

// ── Hook: Candle history for charts ──
export function useStoredCandles(symbol: string, interval: string = "5") {
  const KNOWN_INDEX_MAP: Record<string, string> = {
    NIFTY: "13",
    BANKNIFTY: "25",
    FINNIFTY: "27",
    MIDCPNIFTY: "442",
    INDIAVIX: "26",
  };

  return useQuery({
    queryKey: ["stored-candles", symbol, interval],
    queryFn: async () => {
      const secId = KNOWN_INDEX_MAP[symbol.toUpperCase()] || symbol;
      const history = await getCandleHistory(secId, interval);
      if (!history?.candles?.length) return null;

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

/**
 * Invalidate the local price cache so next fetch
 * re-reads from IndexedDB (call after DB update).
 */
export function invalidateLocalPriceCache() {
  cachedPrices = null;
  cachedPricesLoaded = false;
  cachedPricesPromise = null;
}


// ── Hook: Proxy Health ──
export function useProxyHealth() {
  return useQuery({
    queryKey: ["proxy-health"],
    queryFn: async ({ signal }) => {
      try {
        const health = await fetchProxyHealth(signal);
        return { ...health, reachable: true };
      } catch (error) {
        if (signal.aborted) throw error;
        console.warn("Market-data proxy health check failed:", error);
        return {
          reachable: false,
          status: "offline",
          errorMessage: error instanceof Error ? error.message : "The market-data proxy is unavailable.",
        };
      }
    },
    refetchInterval: 30000,
    staleTime: 10000,
    retry: 0,
  });
}
