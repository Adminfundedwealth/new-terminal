import { useQuery } from "@tanstack/react-query";
import { useAccountContext } from "@/hooks/useAccountContext";
import { fetchLiveOptionChain, fetchLiveIndices, fetchExpiryList, fetchAllIndices, fetchLiveFnOStocks, fetchProxyHealth } from "@/lib/marketApi";
import type { FnOStockData } from "@/lib/marketApi";
import { resolveTerminalMarketDataProvider } from "@/lib/terminalApi";
import { getMaxPain } from "@/lib/oiUtils";
import type { OptionData, IndexData, ExpiryDate } from "@/lib/mockData";
import { findInstrumentsBySymbol } from "@/lib/localDatabase";
import { classifyInstrument } from "@/lib/instrumentClassification";
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
  }).catch(() => {
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

// ── Hook: Live Indices (WebSocket primary, polling fallback, DB cache tertiary) ──
// NO MOCK FALLBACK — returns empty array when offline
export function useLiveIndices() {
  const { activeAccountId, accounts } = useAccountContext();
  const activeAccount = accounts.find((account) => account.id === activeAccountId);
  const provider = resolveTerminalMarketDataProvider(activeAccount?.broker_provider);
  const { indices: wsIndices, isConnected: wsConnected } = useWebSocketIndices();

  const pollingQuery = useQuery({
    queryKey: ["terminal-indices", activeAccountId, provider],
    queryFn: async () => {
      if (activeAccountId && provider) {
        try {
          const data = await fetchLiveIndices(activeAccountId, provider);
          if (data.length > 0) return { data, isLive: true, source: "terminal-os" as const };
        } catch (e) { console.warn("Terminal OS indices fetch failed:", e); }
      }
      // Try local DB prices
      const dbPrices = await getCachedPricesOnce();
      const dbIndices = buildCachedIndices(dbPrices);
      if (dbIndices.length > 0) {
        return { data: dbIndices, isLive: false, source: "database" as const };
      }
      // NO MOCK — return empty
      return { data: [] as IndexData[], isLive: false };
    },
    refetchInterval: wsConnected ? 120000 : ((query) => query.state.data?.isLive ? 15000 : 60000),
    staleTime: 10000,
    retry: 1,
  });

  // Merge WebSocket data over polling data
  const mergedData = useMemo(() => {
    if (wsIndices.length > 0) {
      const polledData = pollingQuery.data?.data || [];
      const merged = wsIndices.map((wsIdx) => {
        const polled = polledData.find((p: any) => p.symbol === wsIdx.symbol);
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
        if (!merged.find((m: any) => m.symbol === p.symbol)) {
          merged.push(p);
        }
      }

      return { data: merged, isLive: true };
    }

    return pollingQuery.data || { data: [] as IndexData[], isLive: false };
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
    queryFn: async () => {
      const now = new Date();
      const h = now.getHours(), m = now.getMinutes();
      const isOpen = (h > 9 || (h === 9 && m >= 15)) && (h < 15 || (h === 15 && m <= 30));
      return { isOpen, status: isOpen ? "Open" : "Closed", isLive: false, giftNifty: null, indicativeNifty: null };
    },
    refetchInterval: (query) => query.state.data?.isLive ? 15000 : 60000,
    staleTime: 10000,
    retry: 0,
  });
}

// ── Hook: Live Option Chain ──
// Returns live data during market hours, or cached "last close" data after hours
interface LiveOptionChainState {
  chain: OptionData[];
  spotPrice: number;
  expiries: ExpiryDate[];
  lotSize: number;
  stepSize: number;
  maxPain: number;
  totalCEOI: number;
  totalPEOI: number;
  isLive: boolean;
  afterHours: boolean;
  source: string;
  cachedAt: string | number | null;
  greeksAvailable?: boolean;
  oiChangeAvailable?: boolean;
  errorMessage?: string | null;
  unsupported?: boolean;
}

export function useLiveOptionChain(symbol: string, expiry?: string, enabled = true) {
  const { activeAccountId, accounts } = useAccountContext();
  const activeAccount = accounts.find((account) => account.id === activeAccountId);
  const provider = resolveTerminalMarketDataProvider(activeAccount?.broker_provider);
  return useQuery<LiveOptionChainState | null>({
    queryKey: ["live-option-chain", activeAccountId, provider, symbol, expiry],
    queryFn: async () => {
      if (activeAccountId && provider) {
        try {
          const result = await fetchLiveOptionChain(symbol, expiry, activeAccountId, provider);
          if (result) {
            const stepSize = result.chain.length > 1 ? Math.abs(result.chain[1].strikePrice - result.chain[0].strikePrice) : 50;
            const isAfterHours = !!(result as any).afterHours;
            const hasChainData = result.chain.length > 0;
            
            // Return data even if chain is empty during after-hours
            // so the UI can show "Market Closed" instead of a blank page
            if (hasChainData || isAfterHours) {
              return {
                chain: result.chain, spotPrice: result.spotPrice, expiries: result.expiries,
                lotSize: (await findInstrumentsBySymbol(symbol)).find((instrument) => classifyInstrument(instrument) === "options" && (!expiry || instrument.expiryDate === expiry))?.lotSize || 0,
                stepSize, maxPain: hasChainData ? getMaxPain(result.chain) : 0,
                totalCEOI: result.totalCEOI, totalPEOI: result.totalPEOI,
                isLive: hasChainData && !isAfterHours, afterHours: isAfterHours,
                source: result.source || "live",
                cachedAt: (result as any).cachedAt || null,
                greeksAvailable: result.greeksAvailable,
                oiChangeAvailable: result.oiChangeAvailable,
              };
            }
          }
        } catch (e) { console.warn("Terminal OS option-chain fetch failed:", e); }
      }
      return null;
    },
    enabled: enabled && !!symbol && !!activeAccountId && !!provider,
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
export function useExpiryList(symbol: string) {
  const { activeAccountId, accounts } = useAccountContext();
  const activeAccount = accounts.find((account) => account.id === activeAccountId);
  const provider = resolveTerminalMarketDataProvider(activeAccount?.broker_provider);
  return useQuery({
    queryKey: ["expiry-list", activeAccountId, provider, symbol],
    queryFn: async () => {
      if (activeAccountId && provider) {
        try {
          const expiries = await fetchExpiryList(symbol, activeAccountId, provider);
          if (expiries.length > 0) return { expiries, isLive: true };
        } catch (e) { console.warn("Terminal OS expiry-list fetch failed:", e); }
      }
      return { expiries: [] as ExpiryDate[], isLive: false };
    },
    enabled: Boolean(symbol && activeAccountId && provider),
    staleTime: 60000,
    refetchInterval: 120000,
    retry: 1,
  });
}

// ── Hook: All Indices (VIX + Sectors + Advance/Decline) ──
// NO MOCK FALLBACK — returns null values when offline
export function useAllIndices() {
  const { vix: wsVix } = useWebSocketVix();
  const wsConnected = useWebSocketStatus();

  const pollingQuery = useQuery({
    queryKey: ["nse-all-indices"],
    queryFn: async () => {
      if (shouldTryProxy()) {
        try {
          const data = await fetchAllIndices();
          if (data) { markProxyOnline(); return { ...data, isLive: true }; }
        } catch (e) { markProxyOffline(); console.warn("All indices fetch failed:", e); }
      }
      // NO MOCK — return empty/null values
      return {
        vix: null,
        sectors: [],
        advances: 0,
        declines: 0,
        unchanged: 0,
        isLive: false,
      };
    },
    refetchInterval: wsConnected ? 120000 : ((query) => query.state.data?.isLive ? 30000 : 120000),
    staleTime: 15000,
    retry: 1,
  });

  // Merge WebSocket VIX over polled VIX
  const mergedData = useMemo(() => {
    const base = pollingQuery.data || {
      vix: null, sectors: [], advances: 0, declines: 0, unchanged: 0, isLive: false,
    };

    if (wsVix) {
      return {
        ...base,
        vix: wsVix,
        isLive: true,
      };
    }

    return base;
  }, [pollingQuery.data, wsVix]);

  return { data: mergedData, isLoading: pollingQuery.isLoading };
}

// ── Hook: F&O Stocks (Top Movers + Most Active) ──
// NO MOCK FALLBACK — returns empty arrays when offline
export function useFnOStocks() {
  const { activeAccountId, accounts } = useAccountContext();
  const provider = resolveTerminalMarketDataProvider(accounts.find((account) => account.id === activeAccountId)?.broker_provider);
  return useQuery({
    queryKey: ["terminal-fno-stocks", activeAccountId, provider],
    queryFn: async () => {
      if (activeAccountId && provider) {
        try {
          const stocks = await fetchLiveFnOStocks(activeAccountId, provider);
          if (stocks.length > 0) {
            const gainers = [...stocks].filter(s => s.changePercent > 0).sort((a, b) => b.changePercent - a.changePercent).slice(0, 5);
            const losers = [...stocks].filter(s => s.changePercent < 0).sort((a, b) => a.changePercent - b.changePercent).slice(0, 5);
            const mostActive = [...stocks].sort((a, b) => (b.volume || 0) - (a.volume || 0)).slice(0, 10).map(s => ({
              ...s, oi: s.openInterest || 0, oiChange: s.oiChange || 0,
              oiInterpretation: getOIInterpretation(s.changePercent, s.oiChange || 0),
            }));
            const hasOI = stocks.some(s => (s.openInterest || 0) > 0);
            return { gainers, losers, mostActive, allStocks: stocks, isLive: true, source: "terminal-os" as const };
          }
        } catch (e) { console.warn("Terminal OS F&O stock quotes failed:", e); }
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
    retry: 1,
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
