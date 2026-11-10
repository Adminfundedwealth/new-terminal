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
import { classifyInstrument, isCashEquityListing, type InstrumentCategory } from "@/lib/instrumentClassification";
import { fetchDhanInstrumentMaster } from "@/lib/marketApi";
import { normalizeProviderInstrument } from "@/lib/instrumentMaster";
import {
  requestTerminalMarketData,
  type TerminalMarketDataInstrument,
  toLocalMarketDataInstrument,
} from "@/lib/terminalApi";
import { isApprovedStock, getDhanSymbol, APPROVED_200_STOCKS, getUnderlyingFromTradingSymbol } from "@/lib/approvedInstruments";
import { isApprovedIndex } from "@/lib/approvedIndices";

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
  const [localInstruments, setLocalInstruments] = useState<Instrument[]>([]);
  const [localLoaded, setLocalLoaded] = useState(false);

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
    queryKey: ["terminal-instrument-catalog", "founder-dhan"],
    queryFn: async () => {
      const remote = await requestTerminalMarketData<TerminalMarketDataInstrument[]>(
        null,
        "dhan",
        { operation: "listInstruments" },
      );
      const allRemote = remote
        .filter((instrument) => instrument.providerInstrumentId && instrument.symbol && instrument.tradingSymbol)
        .map(toLocalMarketDataInstrument);

      // Filter to approved 200 stocks + all derivatives + indices
      const instruments = allRemote.filter((instrument) => {
        const cat = classifyInstrument(instrument);
        if (!cat) return false;
        if (cat === "indices") {
          return isApprovedIndex(instrument.symbol) || isApprovedIndex(instrument.tradingSymbol);
        }
        if (cat === "futures" || cat === "options") return true; // further filtered below/in page
        if (cat === "stocks") {
          return APPROVED_200_STOCKS.some(stock =>
            stock.symbol === instrument.symbol.toUpperCase() ||
            stock.dhanSymbol === instrument.symbol.toUpperCase() ||
            stock.symbol === instrument.tradingSymbol.toUpperCase()
          );
        }
        return false;
      });
      if (!instruments.some((instrument) =>
        instrument.exchangeSegment === "NSE_EQ" && instrument.instrumentType === "EQUITY")) {
        const master = await fetchDhanInstrumentMaster();
        const existingIds = new Set(instruments.map((instrument) =>
          `${instrument.exchangeSegment}:${instrument.providerInstrumentId}`));
        const officialInstruments = master.flatMap((row, index) => {
          if (!row || typeof row !== "object") return [];
          const source = row as Record<string, unknown>;
          const instrumentName = String(source.SEM_INSTRUMENT_NAME ?? source.instrumentType ?? "").toUpperCase();
          if (!["EQUITY", "INDEX", "FUTSTK", "FUTIDX", "OPTSTK", "OPTIDX"].includes(instrumentName)) return [];
          const normalized = normalizeProviderInstrument(source, "dhan", index).instrument;
          if (!normalized) return [];
          const category = classifyInstrument(normalized);
          if (!category || !["stocks", "indices", "futures", "options"].includes(category)) return [];
          
          // FILTER: Only approved indices
          if (category === "indices") {
            if (!isApprovedIndex(normalized.symbol) && !isApprovedIndex(normalized.tradingSymbol)) return [];
          }

          // FILTER: Only approved 200 stocks for cash equity
          if (category === "stocks") {
            if (!isCashEquityListing(normalized)) return [];
            // Check if this stock's symbol OR dhanSymbol matches approved list
            const nseSymbol = normalized.symbol.toUpperCase();
            const dhanSymbol = normalized.tradingSymbol.toUpperCase();
            const isApproved = APPROVED_200_STOCKS.some(stock => 
              stock.symbol === nseSymbol || 
              stock.dhanSymbol === dhanSymbol ||
              stock.symbol === dhanSymbol // Handle reverse mapping
            );
            if (!isApproved) return []; // SKIP non-approved stocks
          }
          
          // FILTER: Only futures/options for approved underlying stocks
          if (category === "futures" || category === "options") {
            const underlying = normalized.symbol.toUpperCase();
            // Allow index derivatives (NIFTY, BANKNIFTY, etc.)
            const isIndex = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "INDIAVIX", "SENSEX"].includes(underlying);
            if (!isIndex) {
              // For stock futures/options, check the trading symbol prefix since
              // normalized.symbol may be the company name, not the NSE ticker.
              const resolvedUnderlying = getUnderlyingFromTradingSymbol(normalized.tradingSymbol);
              if (!resolvedUnderlying && !isApprovedStock(underlying)) {
                return []; // SKIP futures/options for non-approved stocks
              }
            }
            // Check expiry for derivatives
            if (category === "futures") {
              const expiry = Date.parse(normalized.expiryDate ?? "");
              if (!Number.isFinite(expiry) || expiry < Date.now()) return [];
            }
          }
          
          const key = `${normalized.exchangeSegment}:${normalized.providerInstrumentId}`;
          if (existingIds.has(key)) return [];
          existingIds.add(key);
          return [normalized];
        });
        if (officialInstruments.length === 0) {
          throw new Error("Dhan's official instrument master contains no valid approved instruments.");
        }
        instruments.push(...officialInstruments);
      }
      if (instruments.length === 0) throw new Error("Terminal OS returned an empty Dhan instrument catalog.");
      const BATCH_SIZE = 2000;
      try {
        for (let i = 0; i < instruments.length; i += BATCH_SIZE) {
          await saveInstruments(instruments.slice(i, i + BATCH_SIZE));
        }
      } catch (error) {
        console.error("Founder Dhan instruments could not be cached locally:", error);
      }
      return instruments;
    },
    retry: false,
    staleTime: 6 * 60 * 60 * 1000,
  });

  const cachedDhanInstruments = localInstruments.filter((instrument) => instrument.provider === "dhan");
  const allInstruments = gatewayQuery.data ?? cachedDhanInstruments;
  const isLoaded = localLoaded && gatewayQuery.isFetched;
  const loadError = gatewayQuery.error instanceof Error
    ? gatewayQuery.error.message
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
