/**
 * useLocalDatabase — React hooks for reading locally-cached market data
 * 
 * Provides:
 *   1. useCachedPrices()     — All stored price snapshots from IndexedDB
 *   2. useCandleHistory()    — Stored OHLCV candle data for a specific instrument
 *   3. useDatabaseReady()    — Whether the local DB has been populated
 *   4. useInstrumentLookup() — Search instruments from the local DB
 * 
 * These hooks serve as the "offline-first" layer: components load from
 * IndexedDB immediately, then overlay live WebSocket / polling data on top.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getAllPriceSnapshots,
  getCandleHistory,
  getAllCandleHistories,
  getDatabaseStats,
  getFnOStockList,
  getAllInstruments,
  saveInstruments,
  type PriceSnapshot,
  type CandleHistory,
  type CandleData,
  type DatabaseStats,
  type Instrument,
} from "@/lib/localDatabase";
import { classifyInstrument, type InstrumentCategory } from "@/lib/instrumentClassification";
import { useAccountContext } from "@/hooks/useAccountContext";
import { fetchInstrumentMaster, normalizeInstrumentMasterResponse } from "@/lib/marketApi";
import { normalizeInstrumentMaster } from "@/lib/instrumentMaster";
import {
  requestTerminalMarketData,
  resolveTerminalMarketDataProvider,
  type TerminalMarketDataInstrument,
  toLocalMarketDataInstrument,
} from "@/lib/terminalApi";

// ── Hook: Database readiness check ──

export function useDatabaseReady() {
  const [stats, setStats] = useState<DatabaseStats | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    getDatabaseStats().then((s) => {
      setStats(s);
      setIsReady(s.instruments > 0);
    }).catch(() => {
      setIsReady(false);
    });
  }, []);

  return { isReady, stats };
}

// ── Hook: Cached price snapshots ──

export function useCachedPrices() {
  const [prices, setPrices] = useState<PriceSnapshot[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    getAllPriceSnapshots().then((data) => {
      setPrices(data);
      setIsLoaded(true);
    }).catch(() => {
      setIsLoaded(true); // Still mark as loaded even if empty
    });
  }, []);

  // Build a lookup map for O(1) access
  const priceMap = useMemo(() => {
    const map = new Map<string, PriceSnapshot>();
    for (const p of prices) {
      map.set(p.symbol, p);
      map.set(p.securityId, p);
    }
    return map;
  }, [prices]);

  const getPrice = useCallback((symbolOrId: string) => {
    return priceMap.get(symbolOrId) || null;
  }, [priceMap]);

  return { prices, priceMap, getPrice, isLoaded };
}

// ── Hook: Candle history for a specific instrument ──

export function useCandleHistory(
  securityId: string | undefined,
  interval: string = "5",
) {
  const [history, setHistory] = useState<CandleHistory | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!securityId) {
      setHistory(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    getCandleHistory(securityId, interval)
      .then((data) => {
        setHistory(data || null);
      })
      .catch(() => {
        setHistory(null);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [securityId, interval]);

  // Convert to chart-friendly format
  const chartData = useMemo(() => {
    if (!history?.candles?.length) return [];
    return history.candles.map((c) => ({
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
    }));
  }, [history]);

  return { history, chartData, isLoading, hasData: !!history?.candles?.length };
}

// ── Hook: All available candle histories ──

export function useAllCandleHistories() {
  const [histories, setHistories] = useState<CandleHistory[]>([]);

  useEffect(() => {
    getAllCandleHistories().then(setHistories).catch(() => setHistories([]));
  }, []);

  return histories;
}

// ── Hook: F&O Stock instrument list from local DB ──

export function useLocalFnOStocks() {
  const [stocks, setStocks] = useState<Instrument[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    getFnOStockList().then((data) => {
      setStocks(data);
      setIsLoaded(true);
    }).catch(() => {
      setIsLoaded(true);
    });
  }, []);

  return { stocks, isLoaded };
}

// ── Hook: Instrument search/lookup ──

export function useInstrumentLookup() {
  const [localInstruments, setLocalInstruments] = useState<Instrument[]>([]);
  const [localLoaded, setLocalLoaded] = useState(false);
  const { activeAccountId, accounts, isLoading: isAccountLoading } = useAccountContext();
  const provider = resolveTerminalMarketDataProvider(
    accounts.find((account) => account.id === activeAccountId)?.broker_provider,
  );

  useEffect(() => {
    let cancelled = false;
    getAllInstruments().then((local) => {
      if (!cancelled) {
        setLocalInstruments(local);
        setLocalLoaded(true);
      }
    }).catch((error) => {
      console.error("Local instrument cache could not be read:", error);
      if (!cancelled) setLocalLoaded(true);
    });
    return () => { cancelled = true; };
  }, []);

  const gatewayQuery = useQuery({
    queryKey: ["terminal-instrument-master", activeAccountId, provider],
    enabled: Boolean(activeAccountId && provider),
    queryFn: async () => {
      if (!activeAccountId || !provider) throw new Error("Select an active Dhan or Kite account to load instruments from Terminal OS.");
      const remote = await requestTerminalMarketData<TerminalMarketDataInstrument[]>(
        activeAccountId,
        provider,
        { operation: "searchInstruments", query: "" },
      );
      const instruments = remote
        .filter((instrument) => instrument.providerInstrumentId && instrument.symbol && instrument.tradingSymbol)
        .map(toLocalMarketDataInstrument);
      if (instruments.length === 0) throw new Error("Terminal OS returned an empty instrument master.");
      const BATCH_SIZE = 2000;
      for (let i = 0; i < instruments.length; i += BATCH_SIZE) {
        await saveInstruments(instruments.slice(i, i + BATCH_SIZE));
      }
      return instruments;
    },
    retry: false,
    staleTime: 6 * 60 * 60 * 1000,
  });

  const localDhanInstruments = useMemo(
    () => localInstruments.filter((instrument) => instrument.provider === "dhan"),
    [localInstruments],
  );
  const centralMasterQuery = useQuery({
    queryKey: ["central-dhan-instrument-master"],
    enabled: localLoaded && !isAccountLoading && !activeAccountId && localDhanInstruments.length === 0,
    queryFn: async () => {
      const response = await fetchInstrumentMaster();
      const report = normalizeInstrumentMaster(normalizeInstrumentMasterResponse(response), "dhan");
      if (report.instruments.length === 0) throw new Error("The central Dhan instrument master contained no valid instruments.");
      const BATCH_SIZE = 2000;
      for (let i = 0; i < report.instruments.length; i += BATCH_SIZE) {
        await saveInstruments(report.instruments.slice(i, i + BATCH_SIZE));
      }
      return report.instruments;
    },
    retry: false,
    staleTime: 6 * 60 * 60 * 1000,
  });

  const accountMasterRequired = Boolean(activeAccountId && provider);
  const allInstruments = accountMasterRequired
    ? gatewayQuery.data ?? localInstruments
    : !activeAccountId
      ? centralMasterQuery.data ?? localDhanInstruments
      : localInstruments;
  const isLoaded = localLoaded && (
    accountMasterRequired
      ? gatewayQuery.isFetched
      : !isAccountLoading && (
        Boolean(activeAccountId) ||
        localDhanInstruments.length > 0 ||
        centralMasterQuery.isFetched
      )
  );
  const loadError = gatewayQuery.error instanceof Error
    ? gatewayQuery.error.message
    : centralMasterQuery.error instanceof Error
      ? centralMasterQuery.error.message
      : null;

  const search = useCallback((query: string, category?: InstrumentCategory, limit = 20) => {
    if (!query || query.length < 1) return [];
    const q = query.toUpperCase();
    return allInstruments
      .filter((i) => (!category || classifyInstrument(i) === category) &&
        (i.symbol.toUpperCase().includes(q) || i.tradingSymbol.toUpperCase().includes(q)))
      .slice(0, limit);
  }, [allInstruments]);

  const findBySymbol = useCallback(async (symbol: string, category?: InstrumentCategory) => {
    const normalized = symbol.trim().toUpperCase();
    return allInstruments.find((instrument) =>
      (instrument.symbol.toUpperCase() === normalized || instrument.tradingSymbol.toUpperCase() === normalized) &&
      (!category || classifyInstrument(instrument) === category)
    );
  }, [allInstruments]);

  const symbols = useCallback((category: InstrumentCategory) => {
    const seen = new Set<string>();
    return allInstruments.filter((instrument) => classifyInstrument(instrument) === category && !seen.has(instrument.symbol) && seen.add(instrument.symbol));
  }, [allInstruments]);

  return { search, findBySymbol, symbols, instruments: allInstruments, isLoaded, count: allInstruments.length, loadError };
}

// ── Symbol → SecurityId mapping from local DB ──

const KNOWN_INDEX_MAP: Record<string, string> = {
  NIFTY: "13",
  BANKNIFTY: "25",
  FINNIFTY: "27",
  MIDCPNIFTY: "442",
  INDIAVIX: "26",
};

export function getSecurityIdForSymbol(symbol: string): string | undefined {
  return KNOWN_INDEX_MAP[symbol.toUpperCase()];
}
