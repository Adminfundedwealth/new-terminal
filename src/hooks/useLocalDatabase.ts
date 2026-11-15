/**
 * useLocalDatabase ΓÇö React hooks for reading locally-cached market data
 * 
 * Provides:
 *   1. useCachedPrices()     ΓÇö All stored price snapshots from IndexedDB
 *   2. useCandleHistory()    ΓÇö Stored OHLCV candle data for a specific instrument
 *   3. useDatabaseReady()    ΓÇö Whether the local DB has been populated
 *   4. useInstrumentLookup() ΓÇö Search instruments from the local DB
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
import { classifyInstrument, hasActiveInstrumentExpiry, isCashEquityListing, type InstrumentCategory } from "@/lib/instrumentClassification";
import { fetchDhanInstrumentMaster } from "@/lib/marketApi";
import { normalizeProviderInstrument } from "@/lib/instrumentMaster";

function filterCachedDhanInstruments(instruments: readonly Instrument[]): Instrument[] {
  return instruments.filter((instrument) =>
    instrument.provider === "dhan" &&
    (classifyInstrument(instrument) !== "stocks" || isCashEquityListing(instrument))
  );
}

// ΓöÇΓöÇ Hook: Database readiness check ΓöÇΓöÇ

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

// ΓöÇΓöÇ Hook: Cached price snapshots ΓöÇΓöÇ

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

// ΓöÇΓöÇ Hook: Candle history for a specific instrument ΓöÇΓöÇ

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

// ΓöÇΓöÇ Hook: All available candle histories ΓöÇΓöÇ

export function useAllCandleHistories() {
  const [histories, setHistories] = useState<CandleHistory[]>([]);

  useEffect(() => {
    getAllCandleHistories().then(setHistories).catch(() => setHistories([]));
  }, []);

  return histories;
}

// ΓöÇΓöÇ Hook: F&O Stock instrument list from local DB ΓöÇΓöÇ

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

// ΓöÇΓöÇ Hook: Instrument search/lookup ΓöÇΓöÇ

export function useInstrumentLookup() {
  const localQuery = useQuery({
    queryKey: ["local-instruments"],
    queryFn: async () => {
      try {
        return await getAllInstruments();
      } catch (error) {
        console.error("Local instrument cache could not be read:", error);
        throw error;
      }
    },
    staleTime: Infinity,
    gcTime: 6 * 60 * 60 * 1000,
    retry: false,
  });
  const localInstruments = useMemo(() => localQuery.data ?? [], [localQuery.data]);
  const localLoaded = localQuery.isFetched;

  const gatewayQuery = useQuery({
    queryKey: ["terminal-instrument-catalog", "founder-dhan"],
    queryFn: async ({ signal }) => {
      const normalizeMasterRows = async (rows: unknown[]): Promise<Instrument[]> => {
        const instruments: Instrument[] = [];
        const seenKeys = new Set<string>();
        for (let index = 0; index < rows.length; index += 1) {
          if (index > 0 && index % 2_000 === 0) {
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            if (signal.aborted) throw signal.reason ?? new DOMException("Request aborted.", "AbortError");
          }
          const row = rows[index];
          if (!row || typeof row !== "object") continue;
          const source = row as Record<string, unknown>;
          const instrumentName = String(source.SEM_INSTRUMENT_NAME ?? source.instrumentType ?? "").toUpperCase();
          if (!["EQUITY", "ES", "INDEX", "FUTSTK", "FUTIDX", "OPTSTK", "OPTIDX"].includes(instrumentName)) continue;
          const normalized = normalizeProviderInstrument(source, "dhan", index).instrument;
          if (!normalized) continue;
          const category = classifyInstrument(normalized);
          if (!category || !["stocks", "indices", "futures", "options"].includes(category)) continue;
          if (category === "stocks" && !isCashEquityListing(normalized)) continue;
          if ((category === "futures" || category === "options") && !hasActiveInstrumentExpiry(normalized.expiryDate)) continue;
          const key = `${normalized.exchangeSegment}:${normalized.providerInstrumentId || normalized.securityId}`;
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);
          instruments.push(normalized);
        }
        return instruments;
      };

      let officialMasterInstruments: Instrument[] = [];
      let instrumentMasterError: string | null = null;
      try {
        officialMasterInstruments = await normalizeMasterRows(await fetchDhanInstrumentMaster(signal));
      } catch (error) {
        if (signal.aborted) throw error;
        instrumentMasterError = error instanceof Error
          ? `Official Dhan instrument master failed: ${error.message}`
          : "Official Dhan instrument master failed.";
        console.error("Official Dhan instrument master failed:", error);
      }

      const localFallbackInstruments = filterCachedDhanInstruments(localQuery.data ?? []);
      const finalInstruments = officialMasterInstruments.length > 0
        ? officialMasterInstruments
        : localFallbackInstruments;
      const loadError = instrumentMasterError ?? (
        officialMasterInstruments.length === 0 ? "Official Dhan instrument master returned no instruments." : null
      );

      const BATCH_SIZE = 2000;
      void (async () => {
        for (let i = 0; i < officialMasterInstruments.length; i += BATCH_SIZE) {
          await saveInstruments(officialMasterInstruments.slice(i, i + BATCH_SIZE));
        }
      })().catch((error) => {
        console.error("Founder Dhan instruments could not be cached locally:", error);
      });
      return { instruments: finalInstruments, loadError };
    },
    retry: false,
    staleTime: 6 * 60 * 60 * 1000,
    gcTime: 6 * 60 * 60 * 1000,
  });

  const cachedDhanInstruments = useMemo(
    () => filterCachedDhanInstruments(localInstruments),
    [localInstruments],
  );
  const allInstruments = useMemo(() => (
    gatewayQuery.data && gatewayQuery.data.instruments.length > 0
      ? gatewayQuery.data.instruments
      : cachedDhanInstruments.length > 0
        ? cachedDhanInstruments
        : gatewayQuery.data?.instruments ?? []
  ), [cachedDhanInstruments, gatewayQuery.data]);
  const isLoaded = localLoaded;
  const isCatalogLoading = gatewayQuery.isFetching && allInstruments.length === 0;
  const loadError = gatewayQuery.data?.loadError ?? (
    gatewayQuery.error instanceof Error
      ? gatewayQuery.error.message
      : localQuery.error instanceof Error ? localQuery.error.message : null
  );

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

  return { search, findBySymbol, symbols, instruments: allInstruments, isLoaded, isCatalogLoading, count: allInstruments.length, loadError };
}

// ΓöÇΓöÇ Symbol ΓåÆ SecurityId mapping from local DB ΓöÇΓöÇ

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
