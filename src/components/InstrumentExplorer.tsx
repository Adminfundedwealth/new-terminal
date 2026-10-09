import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Star, TrendingUp, TrendingDown, Radio, Loader2, BarChart3, ExternalLink, X, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StockChart } from "@/components/StockChart";
import { normalizeCanonicalPosition, uniqueCanonicalPositions } from "@/components/CustomerPositionTable";
import { isWatchlisted } from "@/lib/watchlist";
import { useLiveOptionChain } from "@/hooks/useMarketData";
import { useInstrumentLookup } from "@/hooks/useLocalDatabase";
import { classifyInstrument, isProductionInstrument } from "@/lib/instrumentClassification";
import { fetchCentralMarketQuotes } from "@/lib/centralMarketQuotes";
import { findWatchlistInstrument } from "@/lib/watchlistInstrument";
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
import type { Instrument } from "@/lib/localDatabase";

export type ExplorerAsset = "stocks" | "indices" | "futures";
const ORDER_TICK_SIZE = 0.05;
const EXPLORER_PAGE_SIZE = 50;

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
  isLive?: boolean;
  searchText?: string;
}

interface ExplorerProps {
  title: string;
  subtitle: string;
  rows: ExplorerRow[];
  asset: ExplorerAsset;
  footerLabel?: string;
  isLoading?: boolean;
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
  isLoading,
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
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(0);
  const [chartSymbol, setChartSymbol] = useState<string | null>(initialChartSymbol ?? null);
  const [activeTab, setActiveTab] = useState("Charts");
  const [workspaceContext, setWorkspaceContext] = useState<"stocks" | "options" | "futures">(initialWorkspaceContext ?? (asset === "futures" ? "futures" : "stocks"));
  const [ticketSide, setTicketSide] = useState<"BUY" | "SELL" | null>(null);
  const [orderType, setOrderType] = useState<"MARKET" | "LIMIT" | "STOP" | "STOP-LIMIT">("MARKET");
  const [quantity, setQuantity] = useState("1");
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
  const marketDataProvider = resolveTerminalMarketDataProvider(activeAccountProvider);
  const chartInstrument = workspaceInstruments.find((instrument) => instrument.tradingSymbol.toUpperCase() === (chartSymbol ?? "").toUpperCase());
  const chartInstrumentToken = chartInstrument?.provider === "zerodha"
    ? chartInstrument.providerInstrumentId || chartInstrument.securityId
    : chartSymbol === initialChartSymbol ? initialInstrumentToken : undefined;

  const filteredRows = useMemo(() => {
    const q = search.trim().toUpperCase();
    if (!q) return rows;
    return rows.filter((row) => {
      const haystack = `${row.symbol} ${row.label} ${row.contract ?? ""} ${row.underlying ?? ""} ${row.searchText ?? ""}`.toUpperCase();
      return haystack.includes(q);
    });
  }, [rows, search]);
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / EXPLORER_PAGE_SIZE));
  const safePage = Math.min(currentPage, pageCount - 1);
  const visibleRows = useMemo(
    () => filteredRows.slice(safePage * EXPLORER_PAGE_SIZE, (safePage + 1) * EXPLORER_PAGE_SIZE),
    [filteredRows, safePage],
  );

  useEffect(() => setCurrentPage(0), [search]);

  const visibleQuotesQuery = useQuery({
    queryKey: [
      "terminal-explorer-quotes",
      asset,
      activeAccountId,
      marketDataProvider,
      visibleRows.map((row) => row.instrument?.providerInstrumentId ?? row.instrument?.securityId ?? row.chartSymbol ?? row.symbol),
    ],
    enabled: Boolean(visibleRows.length > 0 && (
      (activeAccountId && marketDataProvider) ||
      (!activeAccountId && !isAccountLoading)
    )),
    queryFn: async () => {
      const quotes: Record<string, TerminalMarketDataQuote> = {};
      if (!activeAccountId) {
        return fetchCentralMarketQuotes(visibleRows.map((row) => ({
          key: row.chartSymbol ?? row.symbol,
          instrument: row.instrument,
        })));
      }

      const errors: string[] = [];
      if (!marketDataProvider) throw new Error("The selected account has no supported market-data provider.");
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
            activeAccountId,
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
      return { quotes, errors: [...new Set(errors)] };
    },
    staleTime: 5_000,
    refetchInterval: 30_000,
    retry: false,
  });
  const marketDataNotice = !activeAccountId && isAccountLoading
    ? null
    : activeAccountId && !marketDataProvider
      ? "Account-specific market data is unavailable for the selected account."
      : visibleQuotesQuery.data?.errors[0] ?? (visibleQuotesQuery.error instanceof Error ? visibleQuotesQuery.error.message : null);
  const centralChartInstrument = chartSymbol
    ? findWatchlistInstrument(instruments, chartSymbol)
    : undefined;

  const displayedRows = useMemo(() => visibleRows.map((row) => {
    const quote = visibleQuotesQuery.data?.quotes[row.chartSymbol ?? row.symbol];
    if (!quote || !Number.isFinite(quote.ltp) || quote.ltp <= 0) return row;
    const quoteAge = Date.now() - Date.parse(quote.timestamp);
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
      isLive: Number.isFinite(quoteAge) && quoteAge >= 0 && quoteAge <= 60_000,
    };
  }), [visibleRows, visibleQuotesQuery.data]);

  const ticketInstrument = useMemo(() => {
    const matches = workspaceInstruments.filter((instrument) => {
      if (!isProductionInstrument(instrument)) return false;
      if (workspaceContext === "stocks") {
        return classifyInstrument(instrument) === "stocks" && (
          instrument.tradingSymbol.toUpperCase() === (chartSymbol ?? "").toUpperCase() ||
          instrument.symbol.toUpperCase() === (chartSymbol ?? "").toUpperCase()
        );
      }

      return instrument.tradingSymbol.toUpperCase() === (chartSymbol ?? "").toUpperCase();
    });

    if (matches.length === 0) return undefined;
    return matches.find((instrument) => instrument.exchange === "NSE" || instrument.exchangeSegment === "NSE_EQ") ?? matches[0];
  }, [workspaceInstruments, chartSymbol, workspaceContext]);

  const { data: selectedTerminalQuote } = useQuery({
    queryKey: ["terminal-selected-quote", activeAccountId, marketDataProvider, chartSymbol],
    queryFn: async () => {
      if (!activeAccountId || !marketDataProvider || !chartSymbol) return null;
      const instrument = rows.find((row) => (row.chartSymbol ?? row.symbol) === chartSymbol)?.instrument
        ?? workspaceInstruments.find((candidate) =>
        candidate.tradingSymbol.toUpperCase() === chartSymbol.toUpperCase() ||
        candidate.symbol.toUpperCase() === chartSymbol.toUpperCase()
      ) ?? (await requestTerminalMarketData<Instrument[]>(
        activeAccountId,
        marketDataProvider,
        { operation: "searchInstruments", query: chartSymbol },
      )).find((candidate) =>
        candidate.tradingSymbol.toUpperCase() === chartSymbol.toUpperCase() ||
        candidate.symbol.toUpperCase() === chartSymbol.toUpperCase()
      );
      if (!instrument) throw new Error(`Terminal OS could not resolve ${chartSymbol}.`);
      return requestTerminalMarketData<TerminalMarketDataQuote>(
        activeAccountId,
        marketDataProvider,
        { operation: "getQuote", instrument: toTerminalMarketDataInstrument(instrument, marketDataProvider) },
      );
    },
    enabled: Boolean(activeAccountId && marketDataProvider && chartSymbol && workspaceContext !== "options"),
    staleTime: 5_000,
    refetchInterval: 15_000,
    retry: false,
  });

  const centralChartQuoteQuery = useQuery({
    queryKey: ["terminal-central-chart-quote", chartSymbol, centralChartInstrument?.exchangeSegment, centralChartInstrument?.securityId],
    queryFn: async () => {
      if (!chartSymbol || !centralChartInstrument) return null;
      const result = await fetchCentralMarketQuotes([{ key: chartSymbol, instrument: centralChartInstrument }]);
      return result.quotes[chartSymbol] ?? null;
    },
    enabled: Boolean(
      !activeAccountId &&
      !isAccountLoading &&
      centralChartInstrument?.provider === "dhan" &&
      chartSymbol &&
      workspaceContext !== "options" &&
      (visibleRows.length === 0 ? !isLoading : visibleQuotesQuery.isFetched) &&
      (
        !visibleRows.some((row) => (row.chartSymbol ?? row.symbol).toUpperCase() === chartSymbol.toUpperCase()) ||
        (visibleQuotesQuery.isFetched && !visibleQuotesQuery.data?.quotes[chartSymbol])
      )
    ),
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
    if (centralChartQuoteQuery.data && Number.isFinite(centralChartQuoteQuery.data.ltp) && centralChartQuoteQuery.data.ltp > 0) {
      return {
        symbol: centralChartQuoteQuery.data.symbol,
        chartSymbol: centralChartQuoteQuery.data.tradingSymbol,
        label: centralChartQuoteQuery.data.tradingSymbol,
        ltp: centralChartQuoteQuery.data.ltp,
        change: centralChartQuoteQuery.data.change,
        changePercent: centralChartQuoteQuery.data.changePercent,
        open: centralChartQuoteQuery.data.open,
        high: centralChartQuoteQuery.data.high,
        low: centralChartQuoteQuery.data.low,
        volume: centralChartQuoteQuery.data.volume,
        instrument: centralChartInstrument,
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
  }, [centralChartInstrument, centralChartQuoteQuery.data, chartSymbol, derivativeQuote, filteredRows, optionChainData, rows, selectedRowQuote, selectedTerminalQuote, ticketInstrument, workspaceContext]);
  const selectedQuoteIsAvailable = Boolean(
    selectedQuote && Number.isFinite(selectedQuote.ltp) && selectedQuote.ltp > 0
  );
  const selectedQuoteIsLive = Boolean(
    selectedQuoteIsAvailable && (
      selectedRowQuote?.isLive ||
      (centralChartQuoteQuery.data != null &&
        Number.isFinite(Date.parse(centralChartQuoteQuery.data.timestamp)) &&
        Date.now() - Date.parse(centralChartQuoteQuery.data.timestamp) >= 0 &&
        Date.now() - Date.parse(centralChartQuoteQuery.data.timestamp) <= 60_000) ||
      (selectedTerminalQuote != null &&
        Number.isFinite(Date.parse(selectedTerminalQuote.timestamp)) &&
        Date.now() - Date.parse(selectedTerminalQuote.timestamp) >= 0 &&
        Date.now() - Date.parse(selectedTerminalQuote.timestamp) <= 60_000)
    )
  );
  const chartQuoteStatus = workspaceContext === "options" && selectedQuote?.ltp
    ? "AVAILABLE"
    : selectedQuoteIsLive
      ? "LIVE"
      : selectedQuoteIsAvailable
        ? "STALE"
        : "UNAVAILABLE";
  const chartUnavailableMessage = isAccountLoading
    ? "Checking account-specific historical data availability."
    : !activeAccountId
      ? "Historical market data is currently unavailable for this chart."
      : !marketDataProvider
        ? "Historical market data is unavailable for the selected account."
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
    workspaceInstruments.find((instrument) =>
      isProductionInstrument(instrument) &&
      classifyInstrument(instrument) === "options" &&
      instrument.symbol === underlying &&
      instrument.strikePrice === strike &&
      instrument.optionType === optionType &&
      (!expiry || instrument.expiryDate === expiry)
    );

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
    setChartSymbol(symbol);
    setWorkspaceContext(asset === "futures" ? "futures" : "stocks");
    setActiveTab("Charts");
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

  const openOrderTicket = (side: "BUY" | "SELL") => {
    setTicketSide(side);
    setOrderType("MARKET");
    const ticketCategory = ticketInstrument ? classifyInstrument(ticketInstrument) : null;
    setQuantity(ticketCategory === "futures" || ticketCategory === "options" ? String(ticketInstrument?.lotSize ?? 1) : "1");
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

  const submitOrder = async () => {
    if (!ticketSide || !chartSymbol || !activeAccountId) {
      setTicketState("error");
      setTicketMessage("Select an active trading account before placing an order.");
      return;
    }

    const stockMatches = workspaceInstruments.filter((instrument) =>
      isProductionInstrument(instrument) &&
      instrument.symbol.toUpperCase() === chartSymbol.toUpperCase() &&
      classifyInstrument(instrument) === "stocks"
    );

    const preferredSelectedInstrument = stockMatches.find((instrument) => instrument.exchange === "NSE" || instrument.exchangeSegment === "NSE_EQ")
      ?? stockMatches.find((instrument) => instrument.exchange === "BSE" || instrument.exchangeSegment === "BSE_EQ")
      ?? stockMatches[0];
    const ticketCategory = ticketInstrument ? classifyInstrument(ticketInstrument) : null;
    const isDerivative = ticketCategory === "futures" || ticketCategory === "options";
    if (workspaceContext !== "stocks" && (!ticketInstrument || !isDerivative || ticketInstrument.provider !== "zerodha")) {
      setTicketState("error");
      setTicketMessage("Select a valid Kite futures or options contract.");
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
      const orderInstrument = isDerivative && ticketInstrument
        ? { ...ticketInstrument, exchange: "NSE", exchangeSegment: "NSE_FNO" }
        : undefined;
      const result = await createTerminalOrder({
        account_id: activeAccountId,
        client_order_id: `customer-${createClientOrderId()}`,
        symbol: orderInstrument?.tradingSymbol ?? chartSymbol,
        exchange: orderInstrument?.exchange ?? "NSE",
        segment: orderInstrument?.exchangeSegment ?? preferredSelectedInstrument?.exchangeSegment ?? "NSE_EQ",
        side: ticketSide,
        quantity: parsedQuantity,
        order_type: orderType,
        ...(orderType === "MARKET" || requiresLimitPrice ? { price: requestedPrice } : {}),
        ...(requiresTriggerPrice ? { trigger_price: Number(triggerPrice) } : {}),
        ...(parsedStopLoss != null ? { stop_loss: parsedStopLoss } : {}),
        ...(parsedTakeProfit != null ? { take_profit: parsedTakeProfit } : {}),
        time_in_force: "DAY",
        product: orderInstrument ? "NRML" : "CNC",
        is_overnight: false,
        ...(orderInstrument ? { instrument: orderInstrument } : {}),
      });
      setTicketState("submitted");
      setTicketMessage(`Canonical order created: ${String(result.order?.id ?? "pending")}`);
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
  };

  const handleProtectionChange = async (positionId: string, field: "stop_loss" | "take_profit", value: string) => {
    if (!value || !Number.isFinite(Number(value)) || Number(value) <= 0) return;
    await modifyTerminalPositionProtection(positionId, field, Number(value));
  };

  const showBottomTradingWorkspace = Boolean(chartSymbol && hasChartWorkspace && asset !== "futures");

  return (
    <div className={chartSymbol && hasChartWorkspace ? "flex h-full min-h-0 flex-col" : "space-y-4"}>
      {marketDataNotice && <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-600" role="status">{marketDataNotice}</p>}
      {!chartSymbol || !hasChartWorkspace ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">{asset === "stocks" ? "Cash / Equity" : asset === "indices" ? "Cash / Index" : "Derivative"}</p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight">{title}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
            </div>
            <div className="flex items-center gap-2">
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
                  Loading live market data...
                </div>
              ) : filteredRows.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  {loadError ?? `No real ${asset} instruments available.`}
                </div>
              ) : (
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-card">
                    <TableRow className="text-xs">
                      {asset !== "stocks" && <TableHead className="w-8" />}
                      {asset === "futures" ? <TableHead>Contract</TableHead> : <TableHead>{asset === "stocks" ? "SYMBOL" : "Symbol"}</TableHead>}
                      {asset === "futures" && <TableHead>Underlying</TableHead>}
                      {asset === "futures" && <TableHead>Expiry</TableHead>}
                      {asset !== "stocks" && <TableHead>Segment</TableHead>}
                      {asset !== "stocks" && <TableHead>Security ID</TableHead>}
                      <TableHead className="text-right">LTP</TableHead>
                      <TableHead className="text-right">{asset === "stocks" ? "CHG" : "Change"}</TableHead>
                      <TableHead className="text-right">{asset === "stocks" ? "CHG%" : "Chg%"}</TableHead>
                      <TableHead className="text-right">{asset === "stocks" ? "OPEN" : "Open"}</TableHead>
                      <TableHead className="text-right">{asset === "stocks" ? "HIGH" : "High"}</TableHead>
                      <TableHead className="text-right">{asset === "stocks" ? "LOW" : "Low"}</TableHead>
                      {asset !== "indices" && <TableHead className="text-right">{asset === "stocks" ? "VOLUME" : "Volume"}</TableHead>}
                      {asset === "futures" && <TableHead className="text-right">OI</TableHead>}
                      {asset === "futures" && <TableHead className="text-right">OI Chg</TableHead>}
                      <TableHead className="text-center w-[90px]">{asset === "stocks" ? "CHART" : "Chart"}</TableHead>
                      <TableHead className="text-center">{asset === "stocks" ? "ACTIONS" : "Actions"}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayedRows.map((row) => {
                      const positive = (row.changePercent ?? 0) >= 0;
                      const isWatched = isWatchlisted(row.symbol, watchedSymbols);
                      const dayRange = (row.high ?? row.ltp ?? 0) - (row.low ?? row.ltp ?? 0);
                      const dayPos = dayRange > 0 ? (((row.ltp ?? row.open ?? 0) - (row.low ?? row.ltp ?? 0)) / dayRange) * 100 : 50;

                      return (
                        <TableRow key={`${row.symbol}-${row.contract ?? ""}-${row.expiry ?? ""}`} className={`text-[11px] font-mono transition-all border-l-2 ${positive ? "hover:bg-bullish/[0.03] border-transparent hover:border-bullish/50" : "hover:bg-bearish/[0.03] border-transparent hover:border-bearish/50"}`}>
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
                                {row.isLive && <Badge variant="outline" className="text-[9px] border-bullish/30 text-bullish"><Radio className="mr-1 h-2 w-2 animate-pulse" />LIVE</Badge>}
                              </div>
                            </TableCell>
                          ) : (
                            <TableCell className="font-sans font-medium">
                              <div className="flex items-center gap-2">
                                {positive ? <TrendingUp className="h-3 w-3 text-bullish opacity-80" /> : <TrendingDown className="h-3 w-3 text-bearish opacity-80" />}
                                {asset === "stocks" ? (
                                  <button type="button" className="hover:text-primary" onClick={() => openChart(row.chartSymbol ?? row.symbol)} aria-label={`Open ${row.symbol} stock chart`}>
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

                          {asset !== "stocks" && <TableCell className="text-muted-foreground">{row.instrument?.exchangeSegment ?? "—"}</TableCell>}
                          {asset !== "stocks" && <TableCell className="font-mono text-muted-foreground">{row.instrument?.providerInstrumentId ?? row.instrument?.securityId ?? "—"}</TableCell>}

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

                          <TableCell className="text-right text-muted-foreground">{formatNumber(row.open)}</TableCell>
                          <TableCell className="text-right text-muted-foreground">{formatNumber(row.high)}</TableCell>
                          <TableCell className="text-right text-muted-foreground">{formatNumber(row.low)}</TableCell>

                          {asset !== "indices" && <TableCell className="text-right text-muted-foreground">{formatCompact(row.volume)}</TableCell>}
                          {asset === "futures" && <TableCell className="text-right">{formatCompact(row.oi)}</TableCell>}
                          {asset === "futures" && <TableCell className={`text-right ${((row.oiChange ?? 0) >= 0 ? "text-bullish" : "text-bearish")}`}>{row.oiChange == null || row.oiChange === 0 ? "—" : `${row.oiChange >= 0 ? "+" : ""}${formatCompact(row.oiChange)}`}</TableCell>}

                          <TableCell className="text-center">
                            <div className="flex flex-col items-center gap-1">
                              <button
                                type="button"
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
        <div className="chart-workspace flex h-full min-h-0 flex-col">
          <div className="flex shrink-0 items-center justify-between gap-3 pb-3">
            <button
              type="button"
              onClick={() => setChartSymbol(null)}
              className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-card/80 px-2 text-xs font-medium text-foreground hover:bg-card"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to {asset === "indices" ? "Indices" : asset === "futures" ? "Futures" : "Stocks"}
            </button>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className={`rounded-md border px-2 py-1 font-medium ${selectedQuoteIsLive ? "border-bullish/30 bg-bullish/5 text-bullish" : "border-amber-500/30 bg-amber-500/5 text-amber-600"}`}>{chartQuoteStatus}</span>
              <span>{chartSymbol}</span>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-border bg-card shadow-[0_12px_40px_rgba(15,23,42,0.10)]">
            <div className="flex h-full min-h-0">
              <aside className="flex w-[290px] min-h-0 shrink-0 flex-col border-r border-border bg-muted/20">
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
                    {workspaceContext === "stocks" && filteredRows.map((row) => {
                      const positive = (row.changePercent ?? 0) >= 0;
                      const active = (row.chartSymbol ?? row.symbol) === chartSymbol;

                      return (
                        <button
                          key={row.symbol}
                          type="button"
                          onClick={() => setChartSymbol(row.chartSymbol ?? row.symbol)}
                          className={`flex w-full items-center justify-between rounded-lg border px-2 py-2 text-left transition ${active ? "border-primary/40 bg-primary/5" : "border-transparent hover:border-border hover:bg-muted/20"}`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-semibold text-foreground">{row.symbol}</span>
                              {positive ? <TrendingUp className="h-3 w-3 text-bullish" /> : <TrendingDown className="h-3 w-3 text-bearish" />}
                            </div>
                            <div className="mt-1 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{asset === "indices" ? "NSE · IDX_I" : "NSE"}</div>
                          </div>

                          <div className="ml-3 text-right">
                            <div className="text-xs font-semibold text-foreground">
                              {row.ltp != null && row.ltp > 0 ? `₹${row.ltp.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
                            </div>
                            <div className={`text-[10px] font-medium ${positive ? "text-bullish" : "text-bearish"}`}>
                              {row.changePercent == null ? "—" : `${positive ? "+" : ""}${row.changePercent.toFixed(2)}%`}
                            </div>
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
              </aside>

              <section className="flex min-w-0 min-h-0 flex-1 flex-col bg-background">
                <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-background/80 px-4 py-3">
                  <div>
                    <div className="flex items-center gap-3">
                      <span className="text-2xl font-bold tracking-tight">{selectedQuote?.label ?? chartSymbol}</span>
                      <span className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{asset === "indices" ? "NSE · IDX_I" : workspaceContext === "stocks" ? "NSE" : "NFO"}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-sm">
                      <span className="font-mono font-semibold text-foreground">
                        {selectedQuote?.ltp != null && selectedQuote.ltp > 0
                          ? `₹${selectedQuote.ltp.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                          : "—"}
                      </span>
                      <span className={`font-mono ${((selectedQuote?.change ?? 0) >= 0) ? "text-bullish" : "text-bearish"}`}>
                        {selectedQuote?.change == null ? "—" : `${selectedQuote.change >= 0 ? "+" : ""}${selectedQuote.change.toFixed(2)}`}
                      </span>
                      <span className={`font-mono ${((selectedQuote?.changePercent ?? 0) >= 0) ? "text-bullish" : "text-bearish"}`}>
                        {selectedQuote?.changePercent == null ? "—" : `${selectedQuote.changePercent >= 0 ? "+" : ""}${selectedQuote.changePercent.toFixed(2)}%`}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={() => openOrderTicket("SELL")} className="h-12 min-w-[134px] rounded-lg border-0 bg-red-600 px-4 text-sm font-bold text-white shadow-sm hover:bg-red-700"><span aria-hidden="true" className="mr-1.5 text-[10px]">▼</span>SELL</Button>
                    <Button variant="outline" onClick={() => openOrderTicket("BUY")} className="h-12 min-w-[134px] rounded-lg border-0 bg-emerald-600 px-4 text-sm font-bold text-white shadow-sm hover:bg-emerald-700"><span aria-hidden="true" className="mr-1.5 text-[10px]">▲</span>BUY</Button>
                  </div>
                </div>

                <div className="shrink-0 border-b border-border px-4 py-2">
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

                <div className="min-h-0 flex-1 p-3">
                  <div className="h-full min-h-0 rounded-xl border border-border bg-background/60 p-2">
                    <StockChart
                      symbol={chartSymbol}
                      inline
                      fill
                      candleOnly={activeTab === "Markets"}
                      instrumentToken={chartInstrumentToken}
                      unavailableMessage={workspaceContext === "stocks" ? chartUnavailableMessage : undefined}
                    />
                  </div>
                </div>

                {showBottomTradingWorkspace && (
                  <div data-testid="bottom-trading-workspace" className="w-full shrink-0 border-t border-border bg-background/80">
                    <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-[11px] text-muted-foreground">
                      <button type="button" className="rounded border border-border bg-muted/20 px-2 py-1 text-foreground">Enter the Market</button>
                      <button type="button" className="rounded border border-border bg-muted/20 px-2 py-1 text-foreground">Positions [{activeCanonicalPositions.length}]</button>
                      <button type="button" className="rounded border border-border bg-muted/20 px-2 py-1 text-foreground">Pending [0]</button>
                      <button type="button" className="rounded border border-border bg-muted/20 px-2 py-1 text-foreground">Closed Positions</button>
                      <button type="button" className="rounded border border-border bg-muted/20 px-2 py-1 text-foreground">Order History</button>
                      <button type="button" className="rounded border border-border bg-muted/20 px-2 py-1 text-foreground">Balance</button>
                      <button type="button" className="rounded border border-border bg-muted/20 px-2 py-1 text-foreground">Trades</button>
                      <button type="button" className="rounded border border-border bg-muted/20 px-2 py-1 text-foreground">Alerts [0]</button>
                      <button type="button" className="ml-auto rounded border border-border bg-muted/20 px-2 py-1 text-foreground">Close All</button>
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
                            <TableHead>Entry Time (UTC)</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Side</TableHead>
                            <TableHead>Amount</TableHead>
                            <TableHead>Entry Price</TableHead>
                            <TableHead>Stop Loss</TableHead>
                            <TableHead>Take Profit</TableHead>
                            <TableHead>Exit Time (UTC)</TableHead>
                            <TableHead>Exit Price</TableHead>
                            <TableHead>P&L</TableHead>
                            <TableHead>Net P&L</TableHead>
                            <TableHead>X</TableHead>
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
                                <TableCell className="text-muted-foreground">{normalized.updated_at ? new Date(normalized.updated_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}</TableCell>
                                <TableCell className="text-muted-foreground">{normalized.side === "LONG" ? "LONG" : "SHORT"}</TableCell>
                                <TableCell className="text-muted-foreground">{String(normalized.side).toUpperCase()}</TableCell>
                                <TableCell className="text-muted-foreground">{Number(normalized.qty ?? normalized.quantity ?? 0).toLocaleString("en-IN")}</TableCell>
                                <TableCell className="font-mono text-foreground">₹{entryValue.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
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
                                <TableCell className="text-muted-foreground">—</TableCell>
                                <TableCell className="font-mono text-foreground">₹{(Number(normalized.current_price ?? normalized.last_price ?? 0)).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                <TableCell className={pnlValue >= 0 ? "font-mono text-bullish" : "font-mono text-bearish"}>₹{Math.abs(pnlValue).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                <TableCell className={netPnlValue >= 0 ? "font-mono text-bullish" : "font-mono text-bearish"}>₹{Math.abs(netPnlValue).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                <TableCell>
                                  <button type="button" aria-label={`Close position ${normalized.symbol}`} onClick={() => void closePosition(normalized)} className="text-xs text-red-500 hover:text-red-400">X</button>
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
                  <Button disabled={ticketState === "submitting" || ticketState === "submitted"} aria-label={`SIMULATED ${ticketSide} ${orderType === "MARKET" ? "Market" : orderType}`} onClick={() => void submitOrder()} className={`flex-1 font-semibold text-white ${ticketSide === "BUY" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"}`}>{ticketState === "submitting" ? "Submitting..." : ticketState === "submitted" ? "Order Created" : `${ticketSide} ${orderType === "MARKET" ? "Market" : orderType}`}</Button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
