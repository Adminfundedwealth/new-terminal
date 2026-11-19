import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Star, TrendingUp, TrendingDown, Loader2, BarChart3, ExternalLink, X, ArrowLeft, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { loadStockChart } from "@/components/stockChartLoader";
import type { OrderRequest } from "openalgo-charts/widget";
import { normalizeCanonicalPosition, uniqueCanonicalPositions } from "@/components/CustomerPositionTable";
import { isWatchlisted } from "@/lib/watchlist";
import { useLiveOptionChain } from "@/hooks/useMarketData";
import { useInstrumentLookup } from "@/hooks/useLocalDatabase";
import { classifyInstrument, isProductionInstrument } from "@/lib/instrumentClassification";
import { findDhanOptionInstrument } from "@/lib/marketInstrumentResolver";
import { getPreferredMarketAdapter } from "@/lib/brokerRouter";
import {
  createClientOrderId,
  createTerminalOrder,
  fetchTerminalPositions,
  modifyTerminalPositionProtection,
  requestTerminalMarketData,
  resolveTerminalMarketDataProvider,
  toTerminalMarketDataInstrument,
  type TerminalMarketDataQuote,
} from "@/lib/terminalApi";
import { canonicalOrderSegment, resolveStockOrderInstrument } from "@/lib/orderInstrument";
import { fetchCentralMarketQuotes } from "@/lib/centralMarketQuotes";
import { subscribeToTerminalMarketDataStream, type TerminalRealtimeStatus } from "@/lib/terminalApi";
import { isWithinNseSessionAt } from "@/lib/marketApi";
import type { Instrument } from "@/lib/localDatabase";

export type ExplorerAsset = "stocks" | "indices" | "futures";
const ORDER_TICK_SIZE = 0.05;
const EXPLORER_PAGE_SIZE = 50;
const StockChart = lazy(() => loadStockChart().then((module) => ({ default: module.StockChart })));

export interface ExplorerRow {
  symbol: string;
  chartSymbol?: string;
  instrument?: Instrument;
  label: string;
  contract?: string;
  underlying?: string;
  expiry?: string;
  ltp: number | null;
  change: number | null;
  changePercent: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  oi?: number | null;
  oiChange?: number | null;
  isFresh?: boolean;
  isLive?: boolean;
  quoteTimestamp?: string;
  searchText?: string;
}

interface ExplorerProps {
  title: string;
  subtitle: string;
  rows: ExplorerRow[];
  asset: ExplorerAsset;
  footerLabel?: string;
  listHeader?: ReactNode;
  isLoading?: boolean;
  isCatalogLoading?: boolean;
  loadError?: string | null;
  watchedSymbols: string[];
  onToggleWatchlist: (symbol: string) => void;
  onTradeOpen?: (symbol: string) => void;
  activeAccountId?: string | null;
  activeAccountProvider?: string | null;
  hasNoAccount?: boolean;
  isAccountLoading?: boolean;
  searchPlaceholder?: string;
  initialWorkspaceContext?: "stocks" | "options" | "futures";
  initialChartSymbol?: string;
  initialUnderlying?: string;
  initialExpiry?: string;
  initialInstrumentToken?: string;
}

function formatNumber(value: number | null | undefined, digits = 2) {
  if (value == null || Number.isNaN(value) || !Number.isFinite(value) || value === 0) return "—";
  return value.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatCompact(value: number | null | undefined) {
  if (value == null || Number.isNaN(value) || !Number.isFinite(value) || value <= 0) return "—";
  if (value >= 100000) return `${(value / 100000).toFixed(1)}L`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return value.toLocaleString("en-IN");
}

export function InstrumentExplorer({
  title,
  subtitle,
  rows,
  asset,
  footerLabel,
  listHeader,
  isLoading,
  isCatalogLoading,
  watchedSymbols,
  onToggleWatchlist,
  onTradeOpen,
  activeAccountId,
  activeAccountProvider,
  isAccountLoading,
  loadError,
  searchPlaceholder,
  initialWorkspaceContext,
  initialChartSymbol,
  initialUnderlying,
  initialExpiry,
  initialInstrumentToken,
}: ExplorerProps) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"activity" | "symbol" | "price" | "change">("activity");
  const [currentPage, setCurrentPage] = useState(0);
  const [streamQuotes, setStreamQuotes] = useState<Record<string, TerminalMarketDataQuote>>({});
  const [streamStatus, setStreamStatus] = useState<TerminalRealtimeStatus>("disconnected");
  const [chartSymbol, setChartSymbol] = useState<string | null>(initialChartSymbol ?? null);
  const [isInstrumentDrawerOpen, setIsInstrumentDrawerOpen] = useState(
    () => typeof window === "undefined" || window.innerWidth >= 768,
  );
  const [activeTab, setActiveTab] = useState("Charts");
  const [workspaceContext, setWorkspaceContext] = useState<"stocks" | "options" | "futures">(initialWorkspaceContext ?? (asset === "futures" ? "futures" : "stocks"));
  const [ticketSide, setTicketSide] = useState<"BUY" | "SELL" | null>(null);
  const [orderType, setOrderType] = useState<"MARKET" | "LIMIT" | "STOP" | "STOP-LIMIT">("MARKET");
  const [quantity, setQuantity] = useState("1");
  const [stockProduct, setStockProduct] = useState<"CNC" | "MIS">("CNC");
  const [limitPrice, setLimitPrice] = useState("");
  const [triggerPrice, setTriggerPrice] = useState("");
  const [takeProfitEnabled, setTakeProfitEnabled] = useState(false);
  const [takeProfitPrice, setTakeProfitPrice] = useState("");
  const [takeProfitTicks, setTakeProfitTicks] = useState("75");
  const [stopLossEnabled, setStopLossEnabled] = useState(false);
  const [stopLossPrice, setStopLossPrice] = useState("");
  const [stopLossTicks, setStopLossTicks] = useState("25");
  const [ticketState, setTicketState] = useState<"idle" | "submitting" | "submitted" | "error">("idle");
  const [ticketMessage, setTicketMessage] = useState("");
  const [contextUnderlying, setContextUnderlying] = useState(initialUnderlying ?? "NIFTY");
  const [contextExpiry, setContextExpiry] = useState<string | undefined>(initialExpiry);
  const { instruments } = useInstrumentLookup();
  const rowInstruments = rows.flatMap((row) => row.instrument ? [row.instrument] : []);
  const workspaceInstruments = rowInstruments.length > 0 ? rowInstruments : instruments;
  const marketDataProvider = asset === "indices"
    ? "dhan"
    : resolveTerminalMarketDataProvider(activeAccountProvider) ?? "dhan";
  const marketDataAccountId = marketDataProvider === "dhan" ? null : activeAccountId;
  const canLoadMarketData = marketDataProvider === "dhan" || Boolean(activeAccountId);
  const normalizedChartSymbol = (chartSymbol ?? "").toUpperCase();
  const chartInstrument = rows.find((row) =>
    row.instrument &&
    [row.chartSymbol, row.symbol].some((candidate) =>
      candidate?.toUpperCase() === normalizedChartSymbol
    ),
  )?.instrument ?? workspaceInstruments.find((instrument) =>
    instrument.tradingSymbol.toUpperCase() === normalizedChartSymbol ||
    (chartSymbol === initialChartSymbol &&
      Boolean(initialInstrumentToken) &&
      (instrument.providerInstrumentId || instrument.securityId) === initialInstrumentToken),
  );
  const chartDataInstrument = chartInstrument &&
    (!chartInstrument.provider || chartInstrument.provider === "dhan")
    ? toTerminalMarketDataInstrument(chartInstrument, marketDataProvider)
    : undefined;

  const filteredRows = useMemo(() => {
    const q = search.trim().toUpperCase();
    const matched = !q ? rows : rows.filter((row) => {
      const haystack = `${row.symbol} ${row.label} ${row.contract ?? ""} ${row.underlying ?? ""} ${row.searchText ?? ""}`.toUpperCase();
      return haystack.includes(q);
    });
    if (sortBy === "activity") return matched;
    return [...matched].sort((left, right) => {
      if (sortBy === "symbol") return left.symbol.localeCompare(right.symbol);
      if (sortBy === "price") return (right.ltp ?? -Infinity) - (left.ltp ?? -Infinity);
      return (right.changePercent ?? -Infinity) - (left.changePercent ?? -Infinity);
    });
  }, [rows, search, sortBy]);
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / EXPLORER_PAGE_SIZE));
  const safePage = Math.min(currentPage, pageCount - 1);
  const visibleRows = useMemo(
    () => filteredRows.slice(safePage * EXPLORER_PAGE_SIZE, (safePage + 1) * EXPLORER_PAGE_SIZE),
    [filteredRows, safePage],
  );

  useEffect(() => setCurrentPage(0), [search]);

  useEffect(() => {
    if (
      !["stocks", "indices"].includes(asset) ||
      !canLoadMarketData ||
      visibleRows.length === 0 ||
      !visibleRows.some((row) => row.instrument)
    ) {
      setStreamStatus("disconnected");
      setStreamQuotes({});
      return;
    }

    setStreamQuotes({});
    const streamRows = visibleRows.filter((row) => row.instrument?.provider === "dhan");
    const symbols = [...new Set(streamRows.map((row) => row.instrument?.tradingSymbol ?? row.symbol))];
    if (symbols.length === 0) return;
    const rowKeyByExchangeSymbol = new Map<string, string>();
    const rowKeyBySymbol = new Map<string, string>();
    for (const row of streamRows) {
      if (!row.instrument) continue;
      const rowKey = row.chartSymbol ?? row.symbol;
      rowKeyByExchangeSymbol.set(
        `${row.instrument.exchange.toUpperCase()}:${row.instrument.tradingSymbol.toUpperCase()}`,
        rowKey,
      );
      rowKeyBySymbol.set(row.instrument.tradingSymbol.toUpperCase(), rowKey);
    }

    return subscribeToTerminalMarketDataStream(
      marketDataAccountId,
      marketDataProvider,
      symbols,
      (event) => {
        const quote = event.quote;
        const timestamp = Date.parse(quote.timestamp);
        if (
          event.provider !== marketDataProvider ||
          !Number.isFinite(quote.ltp) ||
          quote.ltp <= 0 ||
          !Number.isFinite(timestamp)
        ) return;
        const quoteSymbol = quote.tradingSymbol.toUpperCase();
        const key = rowKeyByExchangeSymbol.get(`${quote.exchange.toUpperCase()}:${quoteSymbol}`)
          ?? rowKeyBySymbol.get(event.symbol.toUpperCase())
          ?? rowKeyBySymbol.get(quoteSymbol);
        if (!key) return;
        setStreamQuotes((current) => {
          const previous = current[key];
          if (previous && Date.parse(previous.timestamp) > timestamp) return current;
          return { ...current, [key]: quote };
        });
      },
      setStreamStatus,
    );
  }, [asset, canLoadMarketData, marketDataAccountId, marketDataProvider, visibleRows]);

  const visibleQuotesQuery = useQuery({
    queryKey: [
      "terminal-explorer-quotes",
      asset,
      marketDataAccountId,
      marketDataProvider,
      visibleRows.map((row) => row.instrument?.providerInstrumentId ?? row.instrument?.securityId ?? row.chartSymbol ?? row.symbol),
    ],
    enabled: Boolean(visibleRows.length > 0 && canLoadMarketData && !isLoading && visibleRows.some((row) => row.instrument)),
    queryFn: async ({ signal }) => {
      const quotes: Record<string, TerminalMarketDataQuote> = {};
      const errors: string[] = [];
      if (!marketDataAccountId && marketDataProvider !== "dhan") throw new Error("Select a FundedWealth trading account to load account-specific quotes.");

      // Build instrument list from rows that have resolved instruments
      const resolvedRows = visibleRows.filter((row) => row.instrument);
      const unresolvedSymbols = visibleRows
        .filter((row) => !row.instrument)
        .map((row) => row.chartSymbol ?? row.symbol);

      if (marketDataProvider === "dhan" && resolvedRows.length > 0) {
        // Batched path: one /marketfeed/quote call for the whole page
        const targets = resolvedRows.map((row) => ({
          key: row.chartSymbol ?? row.symbol,
          instrument: row.instrument as Instrument,
        }));
        const { quotes: batchQuotes, errors: batchErrors } = await fetchCentralMarketQuotes(targets, signal);
        Object.assign(quotes, batchQuotes);
        errors.push(...batchErrors);
      } else {
        // Fallback: serial getQuote for non-Dhan providers
        for (let offset = 0; offset < visibleRows.length; offset += 10) {
          const batch = visibleRows.slice(offset, offset + 10);
          const results = await Promise.allSettled(batch.map(async (row) => {
            const chartSymbol = row.chartSymbol ?? row.symbol;
            const instrument = row.instrument ?? workspaceInstruments.find((candidate) =>
              candidate.tradingSymbol.toUpperCase() === chartSymbol.toUpperCase() ||
              candidate.symbol.toUpperCase() === chartSymbol.toUpperCase()
            );
            if (!instrument) throw new Error(`Terminal OS could not resolve ${chartSymbol}.`);
            const quote = await requestTerminalMarketData<TerminalMarketDataQuote>(
              marketDataAccountId,
              marketDataProvider,
              { operation: "getQuote", instrument: toTerminalMarketDataInstrument(instrument, marketDataProvider) },
            );
            return [chartSymbol, quote] as const;
          }));
          for (const result of results) {
            if (result.status === "fulfilled") quotes[result.value[0]] = result.value[1];
            else errors.push(result.reason instanceof Error ? result.reason.message : "A market quote request failed.");
          }
        }
      }

      if (unresolvedSymbols.length > 0) {
        errors.push(`Terminal OS could not resolve: ${unresolvedSymbols.slice(0, 3).join(", ")}${unresolvedSymbols.length > 3 ? ` +${unresolvedSymbols.length - 3} more` : ""}.`);
      }

      return { quotes, errors: [...new Set(errors)] };
    },
    staleTime: 5_000,
    refetchInterval: 30_000,
    retry: false,
  });
  const marketDataNotice = !activeAccountId && isAccountLoading && marketDataProvider !== "dhan"
    ? null
    : !activeAccountId && marketDataProvider !== "dhan"
      ? "Select a FundedWealth trading account to load account-specific market data."
      : visibleQuotesQuery.data?.errors[0] ?? (visibleQuotesQuery.error instanceof Error ? visibleQuotesQuery.error.message : null);

  const displayedRows = useMemo(() => visibleRows.map((row) => {
    const rowKey = row.chartSymbol ?? row.symbol;
    const quote = streamQuotes[rowKey] ?? visibleQuotesQuery.data?.quotes[rowKey];
    if (!quote || !Number.isFinite(quote.ltp) || quote.ltp <= 0) {
      const age = row.quoteTimestamp ? Date.now() - Date.parse(row.quoteTimestamp) : Infinity;
      const fresh = Number.isFinite(age) && age >= 0 && age <= 60_000;
      return { ...row, isFresh: fresh, isLive: fresh };
    }
    const quoteAge = Date.now() - Date.parse(quote.timestamp);
    const isFresh = Number.isFinite(quoteAge) && quoteAge >= 0 && quoteAge <= 60_000;
    return {
      ...row,
      ltp: quote.ltp,
      change: quote.change,
      changePercent: quote.changePercent,
      open: quote.open,
      high: quote.high,
      low: quote.low,
      volume: quote.volume,
      oi: quote.openInterest,
      quoteTimestamp: quote.timestamp,
      isFresh,
      isLive: isFresh,
    };
  }), [visibleRows, streamQuotes, visibleQuotesQuery.data]);
  const freshQuoteCount = displayedRows.filter((row) => row.isLive).length;
  const quoteTimestamp = displayedRows
    .map((row) => row.quoteTimestamp)
    .filter((timestamp): timestamp is string => Boolean(timestamp))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
  const marketDataLabel = freshQuoteCount > 0
    ? streamStatus === "connected" ? "LIVE" : "POLLING"
    : quoteTimestamp
      ? isWithinNseSessionAt() ? "STALE" : "PREVIOUS SESSION"
      : "UNAVAILABLE";
  const marketDataAsOf = quoteTimestamp
    ? new Date(quoteTimestamp).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })
    : null;

  const ticketInstrument = useMemo(() => {
    if (workspaceContext === "stocks") {
      const stockInstruments = workspaceInstruments.filter((instrument) =>
        isProductionInstrument(instrument) && classifyInstrument(instrument) === "stocks",
      );
      return resolveStockOrderInstrument(chartSymbol, rows, stockInstruments);
    }

    const matches = workspaceInstruments.filter((instrument) => {
      if (!isProductionInstrument(instrument)) return false;
      return instrument.tradingSymbol.toUpperCase() === (chartSymbol ?? "").toUpperCase();
    });

    if (matches.length === 0) return undefined;
    return matches.find((instrument) => instrument.exchange === "NSE" || instrument.exchangeSegment === "NSE_EQ") ?? matches[0];
  }, [workspaceInstruments, chartSymbol, rows, workspaceContext]);

  const { data: selectedTerminalQuote, error: selectedTerminalQuoteError } = useQuery({
    queryKey: ["terminal-selected-quote", marketDataAccountId, marketDataProvider, chartSymbol],
    queryFn: async () => {
      if ((!marketDataAccountId && marketDataProvider !== "dhan") || !chartSymbol) return null;
      const existingInstrument = rows.find((row) => (row.chartSymbol ?? row.symbol) === chartSymbol)?.instrument
        ?? workspaceInstruments.find((candidate) =>
        candidate.tradingSymbol.toUpperCase() === chartSymbol.toUpperCase() ||
        candidate.symbol.toUpperCase() === chartSymbol.toUpperCase()
      );
      const searchResults = existingInstrument ? [] : await requestTerminalMarketData<Instrument[]>(
        marketDataAccountId,
        marketDataProvider,
        { operation: "searchInstruments", query: chartSymbol },
      );
      const instrument = existingInstrument ?? (searchResults ?? []).find((candidate) =>
        candidate.tradingSymbol.toUpperCase() === chartSymbol.toUpperCase() ||
        candidate.symbol.toUpperCase() === chartSymbol.toUpperCase()
      ) ?? ((searchResults ?? []).length === 1 ? (searchResults ?? [])[0] : undefined);
      if (!instrument) return null;
      return await requestTerminalMarketData<TerminalMarketDataQuote>(
        marketDataAccountId,
        marketDataProvider,
        { operation: "getQuote", instrument: toTerminalMarketDataInstrument(instrument, marketDataProvider) },
      ) ?? null;
    },
    enabled: Boolean(canLoadMarketData && chartSymbol && workspaceContext !== "options"),
    staleTime: 5_000,
    refetchInterval: 15_000,
    retry: false,
  });

  const { data: optionChainData, isLoading: isOptionChainLoading } = useLiveOptionChain(
    contextUnderlying,
    contextExpiry,
    workspaceContext === "options"
  );

  const { data: derivativeQuote } = useQuery({
    queryKey: ["kite-derivative-quote", chartSymbol, ticketInstrument?.providerInstrumentId],
    queryFn: async () => {
      if (!ticketInstrument || !["futures", "options"].includes(classifyInstrument(ticketInstrument)) || ticketInstrument.provider !== "zerodha") return null;
      const adapter = await getPreferredMarketAdapter();
      if (adapter?.id !== "zerodha") return null;
      const result = await adapter.getQuotes([`NFO:${ticketInstrument.tradingSymbol}`]);
      return result.data?.[0] ?? null;
    },
    enabled: Boolean(ticketInstrument && workspaceContext !== "stocks"),
    retry: false,
    staleTime: 5_000,
  });

  const selectedRowQuote = displayedRows.find((row) => (row.chartSymbol ?? row.symbol) === chartSymbol);
  const selectedQuote = useMemo(() => {
    const rowQuote = selectedRowQuote
      ?? rows.find((row) => (row.chartSymbol ?? row.symbol) === chartSymbol)
      ?? filteredRows.find((row) => (row.chartSymbol ?? row.symbol) === chartSymbol);
    if (selectedTerminalQuote && Number.isFinite(selectedTerminalQuote.ltp) && selectedTerminalQuote.ltp > 0) {
      return {
        symbol: selectedTerminalQuote.symbol,
        chartSymbol: selectedTerminalQuote.tradingSymbol,
        label: selectedTerminalQuote.tradingSymbol,
        ltp: selectedTerminalQuote.ltp,
        change: selectedTerminalQuote.change,
        changePercent: selectedTerminalQuote.changePercent,
        open: selectedTerminalQuote.open,
        high: selectedTerminalQuote.high,
        low: selectedTerminalQuote.low,
        volume: selectedTerminalQuote.volume,
        instrument: ticketInstrument,
      };
    }
    if (rowQuote || workspaceContext !== "options" || !ticketInstrument?.strikePrice || !ticketInstrument.optionType) {
      return rowQuote ?? null;
    }

    const optionRow = optionChainData?.chain.find((row) => row.strikePrice === ticketInstrument.strikePrice);
    const leg = optionRow?.[ticketInstrument.optionType === "CE" ? "ce" : "pe"];
    if (!leg || !Number.isFinite(leg.ltp) || leg.ltp <= 0) {
      if (!derivativeQuote?.ltp || derivativeQuote.ltp <= 0) return null;
      return {
        symbol: ticketInstrument.symbol,
        chartSymbol: ticketInstrument.tradingSymbol,
        label: ticketInstrument.tradingSymbol,
        ltp: derivativeQuote.ltp,
        change: derivativeQuote.change ?? null,
        changePercent: derivativeQuote.changePercent ?? null,
        open: derivativeQuote.open ?? null,
        high: derivativeQuote.high ?? null,
        low: derivativeQuote.low ?? null,
        volume: derivativeQuote.volume ?? null,
        instrument: ticketInstrument,
      };
    }
    return {
      symbol: ticketInstrument.symbol,
      chartSymbol: ticketInstrument.tradingSymbol,
      label: ticketInstrument.tradingSymbol,
      ltp: leg.ltp,
      change: null,
      changePercent: null,
      open: null,
      high: null,
      low: null,
      volume: leg.volume,
      instrument: ticketInstrument,
    };
  }, [chartSymbol, derivativeQuote, filteredRows, optionChainData, rows, selectedRowQuote, selectedTerminalQuote, ticketInstrument, workspaceContext]);
  const selectedQuoteIsAvailable = Boolean(
    selectedQuote && Number.isFinite(selectedQuote.ltp) && selectedQuote.ltp > 0
  );
  const selectedQuoteIsFresh = Boolean(
    selectedQuoteIsAvailable && (
      selectedRowQuote?.isLive ||
      (selectedTerminalQuote != null &&
        Number.isFinite(Date.parse(selectedTerminalQuote.timestamp)) &&
        Date.now() - Date.parse(selectedTerminalQuote.timestamp) >= 0 &&
        Date.now() - Date.parse(selectedTerminalQuote.timestamp) <= 60_000)
    )
  );
  const chartQuoteStatus = workspaceContext === "options" && selectedQuote?.ltp
    ? "AVAILABLE"
    : selectedQuoteIsFresh
      ? "POLLING"
      : selectedQuoteIsAvailable
        ? "STALE"
        : "UNAVAILABLE";
  const chartUnavailableMessage = selectedTerminalQuoteError instanceof Error
    ? selectedTerminalQuoteError.message
    : selectedTerminalQuote === null
      ? "Central Dhan market data is currently unavailable for this chart."
      : undefined;

  const futuresContracts = useMemo(
    () => workspaceInstruments
      .filter((instrument) => isProductionInstrument(instrument) && classifyInstrument(instrument) === "futures")
      .sort((a, b) => a.symbol.localeCompare(b.symbol) || (a.expiryDate ?? "").localeCompare(b.expiryDate ?? "")),
    [workspaceInstruments]
  );

  const optionUnderlyings = useMemo(
    () => Array.from(new Set(workspaceInstruments
      .filter((instrument) => isProductionInstrument(instrument) && classifyInstrument(instrument) === "options")
      .map((instrument) => instrument.symbol)))
      .sort(),
    [workspaceInstruments]
  );

  const resolveContract = (underlying: string, expiry: string | undefined, strike: number, optionType: "CE" | "PE") =>
    expiry ? findDhanOptionInstrument(workspaceInstruments, {
      underlying,
      expiry,
      strike,
      optionType,
      exchange: chartInstrument?.exchange,
    }) : undefined;

  const selectWorkspaceContext = (context: "stocks" | "options" | "futures") => {
    setWorkspaceContext(context);
    setActiveTab(context === "stocks" ? "Charts" : context === "options" ? "Option Chain" : "Futures");
    if (context === "options") {
      setContextUnderlying((current) => optionUnderlyings.includes(current) ? current : optionUnderlyings[0] ?? "NIFTY");
      setContextExpiry(undefined);
      setChartSymbol(optionUnderlyings.includes(contextUnderlying) ? contextUnderlying : optionUnderlyings[0] ?? "NIFTY");
    }
    if (context === "futures") {
      setContextUnderlying((current) => futuresContracts.some((contract) => contract.symbol === current) ? current : futuresContracts[0]?.symbol ?? "NIFTY");
      setChartSymbol(futuresContracts[0]?.tradingSymbol ?? chartSymbol);
    }
  };

  const openChart = (symbol: string) => {
    preloadStockChart();
    setChartSymbol(symbol);
    setWorkspaceContext(asset === "futures" ? "futures" : "stocks");
    setActiveTab("Charts");
  };

  const preloadStockChart = () => {
    void loadStockChart().catch((error: unknown) => {
      console.error("Failed to preload chart workspace", error);
    });
  };

  const openTrade = (symbol: string) => {
    if (symbol !== chartSymbol) setChartSymbol(symbol);
    setTicketSide("BUY");
    setOrderType("MARKET");
    setQuantity("1");
    setLimitPrice("");
    setTriggerPrice("");
    setTakeProfitEnabled(false);
    setTakeProfitPrice("");
    setTakeProfitTicks("75");
    setStopLossEnabled(false);
    setStopLossPrice("");
    setStopLossTicks("25");
    setTicketState("idle");
    setTicketMessage("");
  };

  const openOrderTicket = (side: "BUY" | "SELL", chartOrder?: OrderRequest) => {
    setTicketSide(side);
    setStockProduct("CNC");
    const nextOrderType = chartOrder?.type === "LIMIT"
      ? "LIMIT"
      : chartOrder?.type === "SL"
        ? "STOP"
        : "MARKET";
    setOrderType(nextOrderType);
    const ticketCategory = ticketInstrument ? classifyInstrument(ticketInstrument) : null;
    setQuantity(ticketCategory === "futures" || ticketCategory === "options" ? String(ticketInstrument?.lotSize ?? 1) : "1");
    setLimitPrice(nextOrderType === "LIMIT" && chartOrder?.price != null ? String(chartOrder.price) : "");
    setTriggerPrice(nextOrderType === "STOP" && chartOrder?.price != null ? String(chartOrder.price) : "");
    setTakeProfitEnabled(false);
    setTakeProfitPrice("");
    setTakeProfitTicks("75");
    setStopLossEnabled(false);
    setStopLossPrice("");
    setStopLossTicks("25");
    setTicketState("idle");
    setTicketMessage("");
  };

  const submitOrder = async () => {
    if (!ticketSide || !chartSymbol || !activeAccountId) {
      setTicketState("error");
      setTicketMessage("Select an active trading account before placing an order.");
      return;
    }

    const ticketCategory = ticketInstrument ? classifyInstrument(ticketInstrument) : null;
    const isDerivative = ticketCategory === "futures" || ticketCategory === "options";
    const isCashStock = asset === "stocks" && workspaceContext === "stocks";
    if (asset === "indices" && workspaceContext === "stocks") {
      setTicketState("error");
      setTicketMessage("Index spot instruments are not tradable. Select a valid futures or options contract.");
      return;
    }
    if (isCashStock && (
      !ticketInstrument ||
      ticketCategory !== "stocks" ||
      !["NSE_EQ", "BSE_EQ"].includes(canonicalOrderSegment(ticketInstrument.exchangeSegment))
    )) {
      setTicketState("error");
      setTicketMessage("Select a valid NSE or BSE cash-equity instrument.");
      return;
    }
    if (workspaceContext !== "stocks" && (
      !ticketInstrument ||
      !isDerivative ||
      (ticketInstrument.provider !== "zerodha" && ticketInstrument.provider !== "dhan")
    )) {
      setTicketState("error");
      setTicketMessage("Select a valid Indian futures or options contract.");
      return;
    }
    if (!isCashStock && !isDerivative) {
      setTicketState("error");
      setTicketMessage("Select a valid cash-equity, futures, or options instrument.");
      return;
    }
    const currentPrice = selectedQuote?.ltp ?? 0;
    const parsedQuantity = Number(quantity);
    const requiresLimitPrice = orderType === "LIMIT" || orderType === "STOP-LIMIT";
    const requiresTriggerPrice = orderType === "STOP" || orderType === "STOP-LIMIT";
    const requestedPrice = requiresLimitPrice ? Number(limitPrice) : currentPrice;
    const referencePrice = orderType === "STOP" ? Number(triggerPrice) : requestedPrice;
    const parsedTakeProfit = takeProfitEnabled ? Number(takeProfitPrice || getExitPrice("TAKE_PROFIT")) : undefined;
    const parsedStopLoss = stopLossEnabled ? Number(stopLossPrice || getExitPrice("STOP_LOSS")) : undefined;

    if (!Number.isInteger(parsedQuantity) || parsedQuantity <= 0) {
      setTicketState("error");
      setTicketMessage("Quantity must be a positive whole number.");
      return;
    }
    if (isDerivative && ticketInstrument && parsedQuantity % ticketInstrument.lotSize !== 0) {
      setTicketState("error");
      setTicketMessage(`Quantity must be a multiple of ${ticketInstrument.lotSize}.`);
      return;
    }
    if ((orderType === "MARKET" || requiresLimitPrice) && (!Number.isFinite(requestedPrice) || requestedPrice <= 0)) {
      setTicketState("error");
      setTicketMessage("Enter a valid order price.");
      return;
    }
    if (requiresTriggerPrice && (!Number.isFinite(Number(triggerPrice)) || Number(triggerPrice) <= 0)) {
      setTicketState("error");
      setTicketMessage("Enter a valid trigger price.");
      return;
    }
    if (takeProfitEnabled && (!Number.isFinite(parsedTakeProfit) || (ticketSide === "BUY" ? parsedTakeProfit <= referencePrice : parsedTakeProfit >= referencePrice))) {
      setTicketState("error");
      setTicketMessage("Take profit must be above the entry price for BUY and below it for SELL.");
      return;
    }
    if (stopLossEnabled && (!Number.isFinite(parsedStopLoss) || (ticketSide === "BUY" ? parsedStopLoss >= referencePrice : parsedStopLoss <= referencePrice))) {
      setTicketState("error");
      setTicketMessage("Stop loss must be below the entry price for BUY and above it for SELL.");
      return;
    }

    setTicketState("submitting");
    setTicketMessage("");
    try {
      const orderInstrument = (isDerivative || isCashStock) && ticketInstrument
        ? {
            ...ticketInstrument,
            exchangeSegment: ticketInstrument.exchangeSegment.trim().toUpperCase() === "NFO"
              ? "NSE_FNO"
              : ticketInstrument.exchangeSegment.trim().toUpperCase() === "BFO"
                ? "BSE_FNO"
                : canonicalOrderSegment(ticketInstrument.exchangeSegment),
          }
        : undefined;
      const result = await createTerminalOrder({
        account_id: activeAccountId,
        client_order_id: `customer-${createClientOrderId()}`,
        symbol: orderInstrument?.tradingSymbol ?? chartSymbol,
        exchange: orderInstrument?.exchange ?? "",
        segment: orderInstrument?.exchangeSegment
          ?? "",
        side: ticketSide,
        quantity: parsedQuantity,
        order_type: orderType,
        ...(orderType === "MARKET" || requiresLimitPrice ? { price: requestedPrice } : {}),
        ...(requiresTriggerPrice ? { trigger_price: Number(triggerPrice) } : {}),
        ...(parsedStopLoss != null ? { stop_loss: parsedStopLoss } : {}),
        ...(parsedTakeProfit != null ? { take_profit: parsedTakeProfit } : {}),
        time_in_force: "DAY",
        product: isDerivative ? "NRML" : isCashStock ? stockProduct : "CNC",
        is_overnight: false,
        ...(orderInstrument ? { instrument: orderInstrument } : {}),
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["terminal-os"] }),
        queryClient.invalidateQueries({ queryKey: ["customer-account"] }),
      ]);
      setTicketState("submitted");
      setTicketMessage(`Simulated order ${result.order.status.replace(/_/g, " ")}: ${result.order.id}`);
    } catch (error) {
      setTicketState("error");
      setTicketMessage(error instanceof Error ? error.message : "Order creation failed.");
    }
  };

  const exitBasePrice = (orderType === "LIMIT" || orderType === "STOP-LIMIT") && Number(limitPrice) > 0
    ? Number(limitPrice)
    : orderType === "STOP" && Number(triggerPrice) > 0
      ? Number(triggerPrice)
      : selectedQuote?.ltp ?? 0;
  const getExitPrice = (kind: "TAKE_PROFIT" | "STOP_LOSS") => {
    const ticks = Number(kind === "TAKE_PROFIT" ? takeProfitTicks : stopLossTicks);
    if (!Number.isFinite(ticks) || ticks <= 0 || exitBasePrice <= 0) return 0;
    const sideDirection = ticketSide === "SELL" ? -1 : 1;
    const exitDirection = kind === "TAKE_PROFIT" ? sideDirection : -sideDirection;
    return Number((exitBasePrice + exitDirection * ticks * ORDER_TICK_SIZE).toFixed(2));
  };
  const resolvedStopLoss = Number(stopLossPrice || getExitPrice("STOP_LOSS"));
  const estimatedRisk = stopLossEnabled && exitBasePrice > 0 && resolvedStopLoss > 0
    ? Math.abs(exitBasePrice - resolvedStopLoss) * (Number(quantity) || 0)
    : null;

  const chartTabs = ["Markets", "Charts"];

  const hasChartWorkspace = asset === "stocks" || asset === "indices" || asset === "futures";

  const { data: terminalPositionsData } = useQuery({
    queryKey: ["terminal-os", "positions", activeAccountId],
    queryFn: async () => {
      if (!activeAccountId) {
        return { data: [], meta: { total: 0, page: 1, page_size: 100, has_more: false } };
      }
      return fetchTerminalPositions(activeAccountId);
    },
    enabled: Boolean(activeAccountId),
    retry: false,
    staleTime: 30_000,
  });

  const [protectionDrafts, setProtectionDrafts] = useState<Record<string, { stopLoss: string; takeProfit: string }>>({});

  const activeCanonicalPositions = useMemo(() => {
    if (!terminalPositionsData?.data) return [];
    return uniqueCanonicalPositions(terminalPositionsData.data).filter((position) => {
      const normalized = normalizeCanonicalPosition(position);
      return normalized.is_open !== false && normalized.position_status !== "closed";
    });
  }, [terminalPositionsData]);

  const closePosition = async (position: ReturnType<typeof normalizeCanonicalPosition>) => {
    if (!activeAccountId) return;
    const quantity = Number(position.qty ?? position.quantity ?? 0);
    if (!Number.isFinite(quantity) || quantity <= 0) return;

    await createTerminalOrder({
      account_id: activeAccountId,
      symbol: position.symbol,
      exchange: position.exchange ?? "NSE",
      segment: ticketInstrument?.exchangeSegment ?? "NSE_EQ",
      side: "SELL",
      quantity,
      order_type: "MARKET",
      time_in_force: "DAY",
      product: "CNC",
      is_overnight: false,
    });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["terminal-os"] }),
      queryClient.invalidateQueries({ queryKey: ["customer-account"] }),
    ]);
  };

  const handleProtectionChange = async (positionId: string, field: "stop_loss" | "take_profit", value: string) => {
    if (!value || !Number.isFinite(Number(value)) || Number(value) <= 0) return;
    await modifyTerminalPositionProtection(positionId, field, Number(value));
  };

  const showBottomTradingWorkspace = Boolean(chartSymbol && hasChartWorkspace && asset !== "futures");

  return (
    <div className={chartSymbol && hasChartWorkspace ? "flex h-full min-h-0 w-full flex-col" : "flex h-full min-h-0 w-full flex-col gap-4 p-3 sm:p-5"}>
      {!chartSymbol || !hasChartWorkspace ? (
        <>
          {listHeader}
          {marketDataNotice && <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-600" role="status">{marketDataNotice}</p>}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">{asset === "stocks" ? "Cash / Equity" : asset === "indices" ? "Cash / Index" : "Derivative"}</p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight">{title}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
            </div>
            <div className="flex items-center gap-2">
              {asset === "stocks" && (
                <Badge
                  variant="outline"
                  aria-label={`Market data ${marketDataLabel}${marketDataAsOf ? ` as of ${marketDataAsOf}` : ""}`}
                  className={freshQuoteCount > 0 ? "border-bullish/30 text-bullish" : "border-amber-500/30 text-amber-600"}
                >
                  {marketDataLabel}{marketDataAsOf ? ` · ${marketDataAsOf}` : ""}
                </Badge>
              )}
              <select
                aria-label={`Sort ${asset}`}
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value as typeof sortBy)}
                className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
              >
                <option value="activity">Most active</option>
                <option value="symbol">Symbol A–Z</option>
                <option value="price">Price high–low</option>
                <option value="change">Change high–low</option>
              </select>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={searchPlaceholder ?? "Search..."} className="h-8 w-56 pl-8 text-xs" />
              </div>
              <Badge variant="outline">{filteredRows.length} {footerLabel ?? "items"}</Badge>
            </div>
          </div>

          <Card>
            <CardContent className="p-0 overflow-auto">
              {isLoading ? (
                <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading instrument catalog...
                </div>
              ) : filteredRows.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  {isCatalogLoading
                    ? "The instrument catalog is loading in the background."
                    : loadError ?? `No real ${asset} instruments available.`}
                </div>
              ) : (
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-card">
                    <TableRow className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                      {asset !== "stocks" && <TableHead className="w-8" />}
                      {asset === "futures" ? <TableHead>Contract</TableHead> : <TableHead>Symbol</TableHead>}
                      {asset === "futures" && <TableHead>Underlying</TableHead>}
                      {asset === "futures" && <TableHead>Expiry</TableHead>}
                      <TableHead className="text-right">LTP</TableHead>
                      <TableHead className="text-right">Chg</TableHead>
                      <TableHead className="text-right">Chg%</TableHead>
                      {asset === "stocks" && <TableHead className="text-right">Open</TableHead>}
                      <TableHead className="text-right">High</TableHead>
                      <TableHead className="text-right">Low</TableHead>
                      {asset !== "indices" && <TableHead className="text-right">Volume</TableHead>}
                      {asset === "futures" && <TableHead className="text-right">OI</TableHead>}
                      {asset === "futures" && <TableHead className="text-right">OI Chg</TableHead>}
                      <TableHead className="w-[90px] text-center">Chart</TableHead>
                      <TableHead className="text-center">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayedRows.map((row) => {
                      const positive = (row.changePercent ?? 0) >= 0;
                      const isWatched = isWatchlisted(row.symbol, watchedSymbols);
                      const dayRange = (row.high ?? row.ltp ?? 0) - (row.low ?? row.ltp ?? 0);
                      const dayPos = dayRange > 0 ? (((row.ltp ?? row.open ?? 0) - (row.low ?? row.ltp ?? 0)) / dayRange) * 100 : 50;

                      return (
                        <TableRow key={`${row.instrument?.exchangeSegment ?? ""}-${row.instrument?.providerInstrumentId ?? row.instrument?.securityId ?? row.symbol}-${row.contract ?? ""}-${row.expiry ?? ""}`} className={`text-[11px] font-mono transition-all border-l-2 ${positive ? "hover:bg-bullish/[0.03] border-transparent hover:border-bullish/50" : "hover:bg-bearish/[0.03] border-transparent hover:border-bearish/50"}`}>
                          {asset !== "stocks" && (
                            <TableCell>
                              <button type="button" onClick={() => onToggleWatchlist(row.symbol)} aria-label={isWatched ? `Remove ${row.symbol} from watchlist` : `Add ${row.symbol} to watchlist`} className="flex h-4 w-4 items-center justify-center">
                                <Star className={`h-3.5 w-3.5 ${isWatched ? "fill-warning text-warning" : "text-muted-foreground hover:text-warning"}`} />
                              </button>
                            </TableCell>
                          )}

                          {asset === "futures" ? (
                            <TableCell className="font-sans font-medium">
                              <div className="flex items-center gap-2">
                                <span>{row.contract ?? row.label}</span>
                                {row.isFresh && <Badge variant="outline" className="text-[9px] border-bullish/30 text-bullish">POLLING</Badge>}
                              </div>
                            </TableCell>
                          ) : (
                            <TableCell className="font-sans font-medium">
                              <div className="flex items-center gap-2">
                                {positive ? <TrendingUp className="h-3 w-3 text-bullish opacity-80" /> : <TrendingDown className="h-3 w-3 text-bearish opacity-80" />}
                                {asset === "stocks" ? (
                                  <button type="button" className="hover:text-primary" onPointerEnter={preloadStockChart} onFocus={preloadStockChart} onClick={() => openChart(row.chartSymbol ?? row.symbol)} aria-label={`Open ${row.symbol} stock chart`}>
                                    {row.symbol}
                                  </button>
                                ) : (
                                  <span>{row.label || row.symbol}</span>
                                )}
                              </div>
                            </TableCell>
                          )}

                          {asset === "futures" && (
                            <TableCell className="text-muted-foreground">{row.underlying || row.symbol}</TableCell>
                          )}

                          {asset === "futures" && (
                            <TableCell className="text-muted-foreground">{row.expiry || "—"}</TableCell>
                          )}

                          <TableCell className="text-right font-semibold">{row.ltp != null && row.ltp > 0 ? `₹${row.ltp.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}</TableCell>
                          <TableCell className={`text-right ${row.change != null && row.change >= 0 ? "text-bullish" : "text-bearish"}`}>
                            {row.change != null && row.ltp != null && row.ltp > 0 ? `${row.change >= 0 ? "+" : ""}${row.change.toFixed(2)}` : "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            {row.changePercent != null && row.ltp != null && row.ltp > 0 ? (
                              <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${positive ? "bg-bullish/10 text-bullish" : "bg-bearish/10 text-bearish"}`}>
                                {positive ? "+" : ""}{row.changePercent.toFixed(2)}%
                              </span>
                            ) : "—"}
                          </TableCell>

                          {asset === "stocks" && <TableCell className="text-right text-muted-foreground">{formatNumber(row.open)}</TableCell>}
                          <TableCell className="text-right text-muted-foreground">{formatNumber(row.high)}</TableCell>
                          <TableCell className="text-right text-muted-foreground">{formatNumber(row.low)}</TableCell>

                          {asset !== "indices" && <TableCell className="text-right text-muted-foreground">{formatCompact(row.volume)}</TableCell>}
                          {asset === "futures" && <TableCell className="text-right">{formatCompact(row.oi)}</TableCell>}
                          {asset === "futures" && <TableCell className={`text-right ${((row.oiChange ?? 0) >= 0 ? "text-bullish" : "text-bearish")}`}>{row.oiChange == null || row.oiChange === 0 ? "—" : `${row.oiChange >= 0 ? "+" : ""}${formatCompact(row.oiChange)}`}</TableCell>}

                          <TableCell className="text-center">
                            <div className="flex flex-col items-center gap-1">
                              <button
                                type="button"
                                onPointerEnter={preloadStockChart}
                                onFocus={preloadStockChart}
                                onClick={() => openChart(row.chartSymbol ?? row.symbol)}
                                title="View Chart"
                                className="inline-flex h-6 w-6 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground"
                                aria-label={`View chart for ${row.symbol}`}
                              >
                                <BarChart3 className="h-3 w-3" />
                              </button>
                              {dayRange > 0 && (
                                <div className="relative w-full h-[2px] bg-muted/50 rounded-full">
                                  <div className={`absolute top-[-1px] h-[4px] w-[4px] rounded-full ${positive ? "bg-bullish" : "bg-bearish"}`} style={{ left: `${Math.min(dayPos, 95)}%` }} />
                                </div>
                              )}
                            </div>
                          </TableCell>

                          <TableCell>
                            <div className="flex items-center justify-center gap-1">
                              {onTradeOpen && (
                                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openTrade(row.symbol)} title="Open trade flow">
                                  <ExternalLink className="h-3 w-3" />
                                </Button>
                              )}
                              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onToggleWatchlist(row.symbol)} title={isWatched ? "Remove from watchlist" : "Add to watchlist"}>
                                {isWatched ? <X className="h-3 w-3" /> : <Star className="h-3 w-3" />}
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
          {visibleQuotesQuery.data?.errors.length ? (
            <p className="mt-2 text-xs text-amber-500" role="status">
              Some Terminal OS quotes are unavailable: {visibleQuotesQuery.data.errors[0]}
            </p>
          ) : null}
          <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
            <span>
              {filteredRows.length === 0 ? "0" : `${safePage * EXPLORER_PAGE_SIZE + 1}-${Math.min((safePage + 1) * EXPLORER_PAGE_SIZE, filteredRows.length)}`}
              {" of "}{filteredRows.length}
            </span>
            <Button variant="outline" size="sm" disabled={safePage === 0} onClick={() => setCurrentPage(safePage - 1)}>
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled={safePage >= pageCount - 1} onClick={() => setCurrentPage(safePage + 1)}>
              Next
            </Button>
          </div>
        </>
      ) : (
        <div className="chart-workspace flex h-full min-h-0 w-full flex-col">
          <div className="min-h-0 flex-1 overflow-hidden bg-card">
            <div className="flex h-full min-h-0">
              {isInstrumentDrawerOpen && <aside className="flex w-[260px] min-h-0 shrink-0 flex-col border-r border-border bg-muted/20">
                <div className="shrink-0 border-b border-border bg-background/60 p-3">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                    <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={searchPlaceholder ?? "Search instruments..."} className="h-8 w-full pl-8 text-xs" />
                  </div>
                </div>

                <div className="shrink-0 p-2 pb-1">
                  <div className="px-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    {asset === "indices" && workspaceContext === "stocks" ? "Indices" : workspaceContext === "stocks" ? "Stocks" : workspaceContext === "futures" ? "Futures" : "Options"}
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-2 pt-0">
                  <div className="space-y-1">
                    {workspaceContext === "stocks" && visibleRows.map((row) => {
                      const positive = (row.changePercent ?? 0) >= 0;
                      const active = (row.chartSymbol ?? row.symbol) === chartSymbol;

                      return (
                        <button
                          key={`${row.instrument?.exchangeSegment ?? ""}:${row.instrument?.providerInstrumentId ?? row.instrument?.securityId ?? row.symbol}`}
                          type="button"
                          onClick={() => setChartSymbol(row.chartSymbol ?? row.symbol)}
                          className={`flex w-full items-center justify-between rounded-lg border px-2 py-2 text-left transition ${active ? "border-primary/40 bg-primary/5" : "border-transparent hover:border-border hover:bg-muted/20"}`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-semibold text-foreground">{row.symbol}</span>
                              {positive ? <TrendingUp className="h-3 w-3 text-bullish" /> : <TrendingDown className="h-3 w-3 text-bearish" />}
                            </div>
                            <div className="mt-1 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{row.instrument ? `${row.instrument.exchange} · ${row.instrument.exchangeSegment}` : asset === "indices" ? "NSE · IDX_I" : "NSE"}</div>
                          </div>

                          <div className="ml-3 shrink-0 text-right">
                            <div className="text-xs font-semibold text-foreground">
                              {row.ltp != null && row.ltp > 0 ? `₹${row.ltp.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
                            </div>
                            <div className={`text-[10px] font-medium ${positive ? "text-bullish" : "text-bearish"}`}>
                              {row.changePercent == null ? "—" : `${positive ? "+" : ""}${row.changePercent.toFixed(2)}%`}
                            </div>
                            {row.high != null && row.low != null && row.high > row.low && (
                              <div className="relative mt-1 h-[2px] w-12 rounded-full bg-muted/60">
                                <span
                                  className={`absolute top-[-2px] h-[6px] w-[2px] rounded-sm ${positive ? "bg-bullish" : "bg-bearish"}`}
                                  style={{
                                    left: `${Math.max(2, Math.min(96, ((row.ltp ?? row.low) - row.low) / (row.high - row.low) * 100))}%`,
                                  }}
                                />
                              </div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                    {workspaceContext === "futures" && futuresContracts.map((contract) => {
                      const active = contract.tradingSymbol === chartSymbol;
                      return (
                        <button
                          key={contract.tradingSymbol}
                          type="button"
                          onClick={() => { setChartSymbol(contract.tradingSymbol); setContextUnderlying(contract.symbol); }}
                          className={`flex w-full items-center justify-between rounded-lg border px-2 py-2 text-left transition ${active ? "border-primary/40 bg-primary/5" : "border-transparent hover:border-border hover:bg-muted/20"}`}
                        >
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-foreground">{contract.tradingSymbol}</div>
                            <div className="mt-1 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{contract.symbol} · {contract.expiryDate ?? "—"}</div>
                          </div>
                          <span className="ml-2 text-[10px] text-muted-foreground">FUT</span>
                        </button>
                      );
                    })}
                    {workspaceContext === "options" && (optionUnderlyings.length > 0 ? optionUnderlyings : ["NIFTY", "BANKNIFTY", "FINNIFTY"]).map((underlying) => (
                      <button
                        key={underlying}
                        type="button"
                        onClick={() => { setContextUnderlying(underlying); setContextExpiry(undefined); }}
                        className={`flex w-full items-center justify-between rounded-lg border px-2 py-2 text-left transition ${underlying === contextUnderlying ? "border-primary/40 bg-primary/5" : "border-transparent hover:border-border hover:bg-muted/20"}`}
                      >
                        <span className="text-sm font-semibold text-foreground">{underlying}</span>
                        <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">OPT</span>
                      </button>
                    ))}
                  </div>
                </div>
              </aside>}

              <section className="flex min-w-0 min-h-0 flex-1 flex-col bg-background">
                <div className="shrink-0 border-b border-border bg-background/80 px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                    <div className="flex min-w-0 items-center gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        onClick={() => setIsInstrumentDrawerOpen((open) => !open)}
                        aria-label={isInstrumentDrawerOpen ? "Collapse instrument list" : "Expand instrument list"}
                        aria-expanded={isInstrumentDrawerOpen}
                      >
                        {isInstrumentDrawerOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
                      </Button>
                      <button
                        type="button"
                        onClick={() => setChartSymbol(null)}
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-card/80 p-0 text-xs font-medium text-foreground hover:bg-card sm:w-auto sm:gap-1.5 sm:px-2"
                        aria-label={`Back to ${asset === "indices" ? "indices" : asset === "futures" ? "futures" : "stocks"}`}
                      >
                        <ArrowLeft className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Back to {asset === "indices" ? "Indices" : asset === "futures" ? "Futures" : "Stocks"}</span>
                      </button>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2.5">
                          <span className="truncate text-xl font-bold tracking-tight">{selectedQuote?.label ?? chartSymbol}</span>
                          <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{chartInstrument ? `${chartInstrument.exchange} · ${chartInstrument.exchangeSegment}` : asset === "indices" ? "NSE · IDX_I" : workspaceContext === "stocks" ? "NSE" : "NFO"}</span>
                          {selectedQuoteIsFresh && (
                            <span className="shrink-0 rounded border border-bullish/30 bg-bullish/5 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-bullish">LIVE</span>
                          )}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                          <span className="font-mono text-lg font-bold text-foreground">
                            {selectedQuote?.ltp != null && selectedQuote.ltp > 0
                              ? `₹${selectedQuote.ltp.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                              : "—"}
                          </span>
                          <span className={`font-mono text-sm font-semibold ${((selectedQuote?.change ?? 0) >= 0) ? "text-bullish" : "text-bearish"}`}>
                            {selectedQuote?.change == null ? "" : `${selectedQuote.change >= 0 ? "+" : ""}${selectedQuote.change.toFixed(2)}`}
                            {selectedQuote?.changePercent != null ? ` (${selectedQuote.changePercent >= 0 ? "+" : ""}${selectedQuote.changePercent.toFixed(2)}%)` : ""}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <Button variant="outline" onClick={() => openOrderTicket("SELL")} className="h-9 min-w-[64px] rounded-lg border-0 bg-red-600 px-2 text-xs font-bold text-white shadow-sm hover:bg-red-700 sm:min-w-[88px] sm:px-3"><span aria-hidden="true" className="mr-1 text-[10px]">▼</span>SELL</Button>
                      <Button variant="outline" onClick={() => openOrderTicket("BUY")} className="h-9 min-w-[64px] rounded-lg border-0 bg-emerald-600 px-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 sm:min-w-[88px] sm:px-3"><span aria-hidden="true" className="mr-1 text-[10px]">▲</span>BUY</Button>
                    </div>
                  </div>

                  {/* OHLV stats row — Bloomberg/TradingView style */}
                  {(selectedQuote?.open != null || selectedQuote?.high != null || selectedQuote?.low != null) && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
                      {selectedQuote?.open != null && selectedQuote.open > 0 && (
                        <span className="flex items-center gap-1 text-muted-foreground">
                          O <span className="font-mono font-medium text-foreground">₹{selectedQuote.open.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </span>
                      )}
                      {selectedQuote?.high != null && selectedQuote.high > 0 && (
                        <span className="flex items-center gap-1 text-muted-foreground">
                          H <span className="font-mono font-medium text-bullish">₹{selectedQuote.high.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </span>
                      )}
                      {selectedQuote?.low != null && selectedQuote.low > 0 && (
                        <span className="flex items-center gap-1 text-muted-foreground">
                          L <span className="font-mono font-medium text-bearish">₹{selectedQuote.low.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </span>
                      )}
                      {selectedQuote?.volume != null && selectedQuote.volume > 0 && (
                        <span className="flex items-center gap-1 text-muted-foreground">
                          Vol <span className="font-mono font-medium text-foreground">{formatCompact(selectedQuote.volume)}</span>
                        </span>
                      )}
                      {selectedQuote?.high != null && selectedQuote?.low != null && selectedQuote.high > selectedQuote.low && (
                        <span className="ml-1 flex items-center gap-1.5 text-muted-foreground">
                          Range
                          <span className="relative inline-flex h-[3px] w-20 rounded-full bg-muted/60">
                            <span
                              className={`absolute top-[-2px] h-[7px] w-[3px] rounded-sm ${((selectedQuote?.changePercent ?? 0) >= 0) ? "bg-bullish" : "bg-bearish"}`}
                              style={{
                                left: `${Math.max(2, Math.min(97, ((selectedQuote.ltp ?? selectedQuote.low) - selectedQuote.low) / (selectedQuote.high - selectedQuote.low) * 100))}%`,
                              }}
                            />
                          </span>
                          <span className="font-mono text-foreground">₹{(selectedQuote.high - selectedQuote.low).toFixed(2)}</span>
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <div className="shrink-0 border-b border-border px-3 py-1.5">
                  <div className="flex flex-wrap gap-2">
                    {chartTabs.map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => {
                          if (tab === "Charts" || tab === "Markets") selectWorkspaceContext("stocks");
                          if (tab === "Option Chain" || tab === "Options") selectWorkspaceContext("options");
                          if (tab === "Futures") selectWorkspaceContext("futures");
                        }}
                        className={`rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition ${activeTab === tab ? "border-primary/40 bg-primary/5 text-primary" : "border-border bg-background text-muted-foreground hover:border-primary/30 hover:text-foreground"}`}
                      >
                        {tab}
                      </button>
                    ))}
                  </div>
                </div>

                {workspaceContext === "options" && (
                  <div className="shrink-0 border-b border-border bg-muted/10 px-4 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={contextUnderlying}
                        onChange={(event) => { setContextUnderlying(event.target.value); setContextExpiry(undefined); }}
                        className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
                        aria-label="Option underlying"
                      >
                        {(optionUnderlyings.length > 0 ? optionUnderlyings : ["NIFTY", "BANKNIFTY", "FINNIFTY"]).map((underlying) => <option key={underlying} value={underlying}>{underlying}</option>)}
                      </select>
                      <select
                        value={contextExpiry ?? ""}
                        onChange={(event) => setContextExpiry(event.target.value || undefined)}
                        className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
                        aria-label="Option expiry"
                      >
                        <option value="">Nearest expiry</option>
                        {(optionChainData?.expiries ?? []).map((expiry) => <option key={expiry.value} value={expiry.value}>{expiry.label}</option>)}
                      </select>
                      <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
                        {(optionChainData?.chain ?? []).slice(0, 24).flatMap((row) => (["CE", "PE"] as const).map((optionType) => {
                          const contract = resolveContract(contextUnderlying, contextExpiry, row.strikePrice, optionType);
                          if (!contract) return null;
                          const leg = row[optionType === "CE" ? "ce" : "pe"];
                          return (
                            <button
                              key={contract.tradingSymbol}
                              type="button"
                              onClick={() => setChartSymbol(contract.tradingSymbol)}
                              className={`shrink-0 rounded-md border px-2 py-1 text-[10px] font-medium ${chartSymbol === contract.tradingSymbol ? "border-primary/40 bg-primary/5 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
                            >
                              {contract.tradingSymbol} <span className="font-mono">₹{leg.ltp.toFixed(2)}</span>
                            </button>
                          );
                        }))}
                        {isOptionChainLoading && <span className="px-2 py-1 text-[10px] text-muted-foreground">Loading live option chain...</span>}
                      </div>
                    </div>
                  </div>
                )}

                {workspaceContext === "futures" && (
                  <div className="shrink-0 border-b border-border bg-muted/10 px-4 py-2">
                    <select
                      value={chartSymbol ?? ""}
                      onChange={(event) => {
                        const contract = futuresContracts.find((item) => item.tradingSymbol === event.target.value);
                        if (contract) { setChartSymbol(contract.tradingSymbol); setContextUnderlying(contract.symbol); }
                      }}
                      className="h-8 max-w-full rounded-md border border-border bg-background px-2 text-xs text-foreground"
                      aria-label="Futures contract"
                    >
                      {futuresContracts.map((contract) => <option key={contract.tradingSymbol} value={contract.tradingSymbol}>{contract.tradingSymbol} · {contract.expiryDate ?? "—"}</option>)}
                    </select>
                  </div>
                )}

                <div className="min-h-0 flex-1">
                  <div className="h-full min-h-0">
                    <Suspense fallback={<div data-testid="stock-chart-loading" className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading chart workspace…</div>}>
                      <StockChart
                        symbol={chartSymbol}
                        inline
                        fill
                        selectedInstrument={chartDataInstrument}
                        onBuy={() => openOrderTicket("BUY")}
                        onSell={() => openOrderTicket("SELL")}
                        onOrder={(order) => openOrderTicket(order.side, order)}
                        showInstrumentLabel={false}
                        showTradeActions={false}
                        unavailableMessage={workspaceContext === "stocks" ? chartUnavailableMessage : undefined}
                      />
                    </Suspense>
                  </div>
                </div>

                {showBottomTradingWorkspace && (
                  <div data-testid="bottom-trading-workspace" className="w-full shrink-0 border-t border-border bg-background">
                    <div className="flex items-center gap-0 border-b border-border bg-background/60 px-1 overflow-x-auto">
                      {[
                        { label: "New Order", key: "order" },
                        { label: "Positions", key: "positions", badge: activeCanonicalPositions.length > 0 ? activeCanonicalPositions.length : undefined },
                        { label: "Pending", key: "pending" },
                        { label: "Closed", key: "closed" },
                        { label: "History", key: "history" },
                        { label: "Balance", key: "balance" },
                        { label: "Alerts", key: "alerts" },
                      ].map((tab) => (
                        <button
                          key={tab.key}
                          type="button"
                          onClick={() => tab.key === "order" ? openOrderTicket("BUY") : undefined}
                          className="relative shrink-0 flex items-center gap-1.5 px-3 py-2 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors hover:bg-muted/30 border-b-2 border-transparent"
                        >
                          {tab.label}
                          {tab.badge != null && (
                            <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary/15 px-1 text-[9px] font-bold text-primary">
                              {tab.badge}
                            </span>
                          )}
                        </button>
                      ))}
                      <button
                        type="button"
                        className="ml-auto shrink-0 rounded border border-red-500/40 bg-red-500/5 px-2.5 py-1 text-[11px] font-semibold text-red-500 hover:bg-red-500/15 hover:text-red-400 transition-colors mr-1"
                      >
                        Close All
                      </button>
                    </div>

                    {activeCanonicalPositions.length === 0 && (
                      <div className="flex items-center gap-2 border-b border-border px-3 py-3 text-sm text-muted-foreground">
                        <span className="h-2 w-2 rounded-full bg-emerald-500" />
                        No active positions
                      </div>
                    )}

                    {activeCanonicalPositions.length > 0 && (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader className="bg-background/80">
                          <TableRow>
                            <TableHead>Instrument</TableHead>
                            <TableHead>Side</TableHead>
                            <TableHead>Qty</TableHead>
                            <TableHead className="text-right">Entry Price</TableHead>
                            <TableHead className="text-right">LTP</TableHead>
                            <TableHead>Stop Loss</TableHead>
                            <TableHead>Take Profit</TableHead>
                            <TableHead className="text-right">P&amp;L</TableHead>
                            <TableHead>Time (IST)</TableHead>
                            <TableHead className="w-8"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {activeCanonicalPositions.map((position) => {
                            const normalized = normalizeCanonicalPosition(position);
                            const stopLossValue = protectionDrafts[normalized.id]?.stopLoss ?? String(normalized.stop_loss ?? "");
                            const takeProfitValue = protectionDrafts[normalized.id]?.takeProfit ?? String(normalized.take_profit ?? "");
                            const entryValue = Number(normalized.avg_price ?? normalized.average_price ?? 0);
                            const pnlValue = Number(normalized.realized_pnl ?? normalized.unrealized_pnl ?? 0);
                            const netPnlValue = pnlValue;

                            return (
                              <TableRow key={normalized.id}>
                                <TableCell className="font-medium text-foreground">{normalized.symbol}</TableCell>
                                <TableCell>
                                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${normalized.side === "LONG" || normalized.side === "BUY" ? "bg-bullish/10 text-bullish" : "bg-bearish/10 text-bearish"}`}>
                                    {normalized.side === "LONG" || normalized.side === "BUY" ? "LONG" : "SHORT"}
                                  </span>
                                </TableCell>
                                <TableCell className="text-muted-foreground">{Number(normalized.qty ?? normalized.quantity ?? 0).toLocaleString("en-IN")}</TableCell>
                                <TableCell className="text-right font-mono text-foreground">₹{entryValue.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                <TableCell className="text-right font-mono text-foreground">₹{(Number(normalized.current_price ?? normalized.last_price ?? 0)).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                <TableCell>
                                  <input
                                    aria-label={`Stop Loss for ${normalized.symbol}`}
                                    type="number"
                                    step="0.05"
                                    value={stopLossValue}
                                    onChange={(event) => {
                                      const next = event.target.value;
                                      setProtectionDrafts((current) => ({
                                        ...current,
                                        [normalized.id]: {
                                          stopLoss: next,
                                          takeProfit: current[normalized.id]?.takeProfit ?? takeProfitValue,
                                        },
                                      }));
                                    }}
                                    onBlur={() => {
                                      const nextValue = protectionDrafts[normalized.id]?.stopLoss ?? String(normalized.stop_loss ?? "");
                                      if (nextValue) void handleProtectionChange(normalized.id, "stop_loss", nextValue);
                                    }}
                                    className="w-20 rounded border border-input bg-background px-1.5 py-1 text-xs text-foreground"
                                  />
                                </TableCell>
                                <TableCell>
                                  <input
                                    aria-label={`Take Profit for ${normalized.symbol}`}
                                    type="number"
                                    step="0.05"
                                    value={takeProfitValue}
                                    onChange={(event) => {
                                      const next = event.target.value;
                                      setProtectionDrafts((current) => ({
                                        ...current,
                                        [normalized.id]: {
                                          stopLoss: current[normalized.id]?.stopLoss ?? stopLossValue,
                                          takeProfit: next,
                                        },
                                      }));
                                    }}
                                    onBlur={() => {
                                      const nextValue = protectionDrafts[normalized.id]?.takeProfit ?? String(normalized.take_profit ?? "");
                                      if (nextValue) void handleProtectionChange(normalized.id, "take_profit", nextValue);
                                    }}
                                    className="w-20 rounded border border-input bg-background px-1.5 py-1 text-xs text-foreground"
                                  />
                                </TableCell>
                                <TableCell className={`text-right font-mono font-semibold ${pnlValue >= 0 ? "text-bullish" : "text-bearish"}`}>
                                  {pnlValue >= 0 ? "+" : "−"}₹{Math.abs(pnlValue).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </TableCell>
                                <TableCell className="text-muted-foreground text-[11px]">
                                  {normalized.updated_at ? new Date(normalized.updated_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "—"}
                                </TableCell>
                                <TableCell>
                                  <button type="button" aria-label={`Close position ${normalized.symbol}`} onClick={() => void closePosition(normalized)} className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-red-500/10 hover:text-red-500 transition-colors">
                                    <X className="h-3 w-3" />
                                  </button>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                    )}
                  </div>
                )}
              </section>
            </div>
          </div>

          {ticketSide && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4" role="dialog" aria-modal="true" aria-label={`SIMULATED ${ticketSide} order ticket`}>
              <div className="max-h-[min(90vh,760px)] w-full max-w-md overflow-y-auto rounded-lg border border-border bg-card p-5 text-card-foreground shadow-2xl">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-semibold">{chartSymbol}</h2>
                    <p className="mt-1 text-xs text-muted-foreground">{ticketInstrument?.exchangeSegment ?? (workspaceContext === "stocks" ? "NSE_EQ" : "NFO")} · simulated order ticket</p>
                  </div>
                  <button type="button" onClick={() => setTicketSide(null)} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close order ticket"><X className="h-4 w-4" /></button>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2 rounded-md bg-muted/50 p-1">
                  {(["BUY", "SELL"] as const).map((side) => (
                    <button key={side} type="button" aria-pressed={ticketSide === side} aria-label={`SIMULATED ${side}`} onClick={() => { setTicketSide(side); setTakeProfitPrice(""); setStopLossPrice(""); setTicketState("idle"); setTicketMessage(""); }} className={`rounded px-3 py-2.5 text-sm font-bold transition-colors ${ticketSide === side ? side === "BUY" ? "bg-emerald-600 text-white shadow-sm hover:bg-emerald-700" : "bg-red-600 text-white shadow-sm hover:bg-red-700" : "bg-transparent text-muted-foreground hover:bg-background hover:text-foreground"}`}>{side}</button>
                  ))}
                </div>

                <div className="mt-4 flex items-end justify-between gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground">{ticketInstrument?.exchangeSegment?.startsWith("NFO") ? "NFO" : "NSE"} · LTP</p>
                    <p className="mt-1 font-mono text-lg font-semibold">₹{(selectedQuote?.ltp ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">Est. order value</p>
                    <p className="mt-1 font-mono text-sm font-semibold">₹{(((orderType === "LIMIT" || orderType === "STOP-LIMIT") && Number(limitPrice) > 0 ? Number(limitPrice) : selectedQuote?.ltp ?? 0) * (Number(quantity) || 0)).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-4 border-b border-border" role="tablist" aria-label="Order type">
                  {(["MARKET", "LIMIT", "STOP", "STOP-LIMIT"] as const).map((type) => <button key={type} type="button" role="tab" aria-selected={orderType === type} onClick={() => setOrderType(type)} className={`border-b-2 px-1 py-2 text-[11px] font-medium ${orderType === type ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{type === "STOP-LIMIT" ? "Stop-Limit" : type === "STOP" ? "Stop" : type === "MARKET" ? "Market" : "Limit"}</button>)}
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <label className="block text-xs font-medium text-muted-foreground">Units / Quantity<input type="number" min="1" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground" /></label>
                  <div className="text-xs font-medium text-muted-foreground">Risk, INR<div className="mt-1 flex h-10 items-center rounded-md border border-input bg-muted/50 px-3 font-mono text-sm text-foreground">{estimatedRisk == null ? "—" : `₹${estimatedRisk.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</div></div>
                </div>
                {asset === "stocks" && workspaceContext === "stocks" && <label className="mt-3 block text-xs font-medium text-muted-foreground">Product<select aria-label="Stock product" value={stockProduct} onChange={(event) => setStockProduct(event.target.value as "CNC" | "MIS")} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"><option value="CNC">Delivery (CNC)</option><option value="MIS">Intraday (MIS)</option></select></label>}
                {(orderType === "LIMIT" || orderType === "STOP-LIMIT") && <label className="mt-3 block text-xs font-medium text-muted-foreground">Limit price<input type="number" min="0" step="0.05" value={limitPrice} onChange={(event) => setLimitPrice(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground" /></label>}
                {(orderType === "STOP" || orderType === "STOP-LIMIT") && <label className="mt-3 block text-xs font-medium text-muted-foreground">Trigger price<input type="number" min="0" step="0.05" value={triggerPrice} onChange={(event) => setTriggerPrice(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground" /></label>}

                <section className="mt-5 space-y-4 border-t border-border pt-4" aria-label="Order exits">
                  <div>
                    <label className="flex items-center gap-2 text-sm font-semibold text-foreground"><input type="checkbox" checked={takeProfitEnabled} onChange={(event) => setTakeProfitEnabled(event.target.checked)} className="h-4 w-4 accent-emerald-600" />Take profit</label>
                    <div className="mt-2 grid grid-cols-2 gap-3">
                      <label className="text-xs font-medium text-muted-foreground">Price<input aria-label="Take profit price" type="number" min="0" step={ORDER_TICK_SIZE} disabled={!takeProfitEnabled} value={takeProfitPrice || (getExitPrice("TAKE_PROFIT") || "")} onChange={(event) => { setTakeProfitPrice(event.target.value); const ticks = Math.abs((Number(event.target.value) || exitBasePrice) - exitBasePrice) / ORDER_TICK_SIZE; setTakeProfitTicks(String(Math.round(ticks))); }} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground disabled:bg-muted/50 disabled:text-muted-foreground" /></label>
                      <label className="text-xs font-medium text-muted-foreground">Ticks<input aria-label="Take profit ticks" type="number" min="1" step="1" disabled={!takeProfitEnabled} value={takeProfitTicks} onChange={(event) => { setTakeProfitTicks(event.target.value); setTakeProfitPrice(""); }} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground disabled:bg-muted/50 disabled:text-muted-foreground" /></label>
                    </div>
                  </div>
                  <div>
                    <label className="flex items-center gap-2 text-sm font-semibold text-foreground"><input type="checkbox" checked={stopLossEnabled} onChange={(event) => setStopLossEnabled(event.target.checked)} className="h-4 w-4 accent-red-600" />Stop loss</label>
                    <div className="mt-2 grid grid-cols-2 gap-3">
                      <label className="text-xs font-medium text-muted-foreground">Price<input aria-label="Stop loss price" type="number" min="0" step={ORDER_TICK_SIZE} disabled={!stopLossEnabled} value={stopLossPrice || (getExitPrice("STOP_LOSS") || "")} onChange={(event) => { setStopLossPrice(event.target.value); const ticks = Math.abs((Number(event.target.value) || exitBasePrice) - exitBasePrice) / ORDER_TICK_SIZE; setStopLossTicks(String(Math.round(ticks))); }} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground disabled:bg-muted/50 disabled:text-muted-foreground" /></label>
                      <label className="text-xs font-medium text-muted-foreground">Ticks<input aria-label="Stop loss ticks" type="number" min="1" step="1" disabled={!stopLossEnabled} value={stopLossTicks} onChange={(event) => { setStopLossTicks(event.target.value); setStopLossPrice(""); }} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground disabled:bg-muted/50 disabled:text-muted-foreground" /></label>
                    </div>
                  </div>
                </section>

                {ticketMessage && <p className={`mt-3 text-xs ${ticketState === "error" ? "text-destructive" : "text-emerald-500"}`}>{ticketMessage}</p>}
                <div className="mt-5 flex gap-2">
                  <Button variant="outline" onClick={() => setTicketSide(null)}>Cancel</Button>
                  <Button disabled={ticketState === "submitting" || ticketState === "submitted"} aria-label={`SIMULATED ${ticketSide} ${orderType === "MARKET" ? "Market" : orderType}`} onClick={() => void submitOrder()} className={`flex-1 font-semibold text-white ${ticketSide === "BUY" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"}`}>{ticketState === "submitting" ? "Submitting..." : ticketState === "submitted" ? "Order Accepted" : `${ticketSide} ${orderType === "MARKET" ? "Market" : orderType}`}</Button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
