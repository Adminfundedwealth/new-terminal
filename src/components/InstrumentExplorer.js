import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useMemo, useState } from "react";
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
import { normalizeTerminalMarketQuote } from "@/lib/marketApi";
import { createTerminalOrder, fetchTerminalPositions, modifyTerminalPositionProtection, requestTerminalMarketData, resolveTerminalMarketDataProvider, toTerminalMarketDataInstrument, } from "@/lib/terminalApi";
const ORDER_TICK_SIZE = 0.05;
function formatNumber(value, digits = 2) {
    if (value == null || Number.isNaN(value) || !Number.isFinite(value) || value === 0)
        return "—";
    return value.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function formatCompact(value) {
    if (value == null || Number.isNaN(value) || !Number.isFinite(value) || value <= 0)
        return "—";
    if (value >= 100000)
        return `${(value / 100000).toFixed(1)}L`;
    if (value >= 1000)
        return `${(value / 1000).toFixed(1)}K`;
    return value.toLocaleString("en-IN");
}
export function InstrumentExplorer({ title, subtitle, rows, asset, footerLabel, isLoading, watchedSymbols, onToggleWatchlist, onTradeOpen, activeAccountId, activeAccountProvider, searchPlaceholder, initialWorkspaceContext, initialChartSymbol, initialUnderlying, initialExpiry, initialInstrumentToken, }) {
    const [search, setSearch] = useState("");
    const [chartSymbol, setChartSymbol] = useState(initialChartSymbol ?? null);
    const [activeTab, setActiveTab] = useState("Charts");
    const [workspaceContext, setWorkspaceContext] = useState(initialWorkspaceContext ?? (asset === "futures" ? "futures" : "stocks"));
    const [ticketSide, setTicketSide] = useState(null);
    const [orderType, setOrderType] = useState("MARKET");
    const [quantity, setQuantity] = useState("1");
    const [limitPrice, setLimitPrice] = useState("");
    const [triggerPrice, setTriggerPrice] = useState("");
    const [takeProfitEnabled, setTakeProfitEnabled] = useState(false);
    const [takeProfitPrice, setTakeProfitPrice] = useState("");
    const [takeProfitTicks, setTakeProfitTicks] = useState("75");
    const [stopLossEnabled, setStopLossEnabled] = useState(false);
    const [stopLossPrice, setStopLossPrice] = useState("");
    const [stopLossTicks, setStopLossTicks] = useState("25");
    const [ticketState, setTicketState] = useState("idle");
    const [ticketMessage, setTicketMessage] = useState("");
    const [contextUnderlying, setContextUnderlying] = useState(initialUnderlying ?? "NIFTY");
    const [contextExpiry, setContextExpiry] = useState(initialExpiry);
    const { instruments } = useInstrumentLookup();
    const availableInstruments = instruments;
    const rowInstruments = rows.flatMap((row) => row.instrument ? [row.instrument] : []);
    const workspaceInstruments = rowInstruments.length > 0 ? rowInstruments : availableInstruments;
    const chartInstrument = workspaceInstruments.find((instrument) => instrument.tradingSymbol.toUpperCase() === (chartSymbol ?? "").toUpperCase());
    const chartInstrumentToken = chartInstrument?.provider === "zerodha"
        ? chartInstrument.providerInstrumentId || chartInstrument.securityId
        : chartSymbol === initialChartSymbol ? initialInstrumentToken : undefined;
    const filteredRows = useMemo(() => {
        const q = search.trim().toUpperCase();
        if (!q)
            return rows;
        return rows.filter((row) => {
            const haystack = `${row.symbol} ${row.label} ${row.contract ?? ""} ${row.underlying ?? ""} ${row.searchText ?? ""}`.toUpperCase();
            return haystack.includes(q);
        });
    }, [rows, search]);
    const ticketInstrument = useMemo(() => {
        const matches = workspaceInstruments.filter((instrument) => {
            if (!isProductionInstrument(instrument))
                return false;
            if (workspaceContext === "stocks") {
                return classifyInstrument(instrument) === "stocks" && (instrument.tradingSymbol.toUpperCase() === (chartSymbol ?? "").toUpperCase() ||
                    instrument.symbol.toUpperCase() === (chartSymbol ?? "").toUpperCase());
            }
            return instrument.tradingSymbol.toUpperCase() === (chartSymbol ?? "").toUpperCase();
        });
        if (matches.length === 0)
            return undefined;
        return matches.find((instrument) => instrument.exchange === "NSE" || instrument.exchangeSegment === "NSE_EQ") ?? matches[0];
    }, [workspaceInstruments, chartSymbol, workspaceContext]);
    const activeProvider = resolveTerminalMarketDataProvider(activeAccountProvider);
    const { data: optionChainData, isLoading: isOptionChainLoading } = useLiveOptionChain(contextUnderlying, contextExpiry, workspaceContext === "options");
    const { data: derivativeQuote } = useQuery({
        queryKey: ["terminal-derivative-quote", activeAccountId, activeProvider, chartSymbol, ticketInstrument?.providerInstrumentId],
        queryFn: async () => {
            if (!ticketInstrument || !activeProvider ||
                resolveTerminalMarketDataProvider(ticketInstrument.provider) !== activeProvider ||
                !["futures", "options"].includes(classifyInstrument(ticketInstrument)))
                return null;
            const instrument = toTerminalMarketDataInstrument(ticketInstrument, activeProvider);
            const quote = await requestTerminalMarketData(activeAccountId ?? "", activeProvider, {
                operation: "getQuote",
                instrument,
            });
            return normalizeTerminalMarketQuote(quote, instrument, ticketInstrument.securityId);
        },
        enabled: Boolean(activeAccountId && activeProvider === "kite" && ticketInstrument && workspaceContext !== "stocks"),
        retry: false,
        staleTime: 5000,
    });
    const selectedQuote = useMemo(() => {
        const rowQuote = rows.find((row) => (row.chartSymbol ?? row.symbol) === chartSymbol)
            ?? filteredRows.find((row) => (row.chartSymbol ?? row.symbol) === chartSymbol);
        if (rowQuote || workspaceContext !== "options" || !ticketInstrument?.strikePrice || !ticketInstrument.optionType) {
            return rowQuote ?? null;
        }
        const optionRow = optionChainData?.chain.find((row) => row.strikePrice === ticketInstrument.strikePrice);
        const leg = optionRow?.[ticketInstrument.optionType === "CE" ? "ce" : "pe"];
        if (!leg || !Number.isFinite(leg.ltp) || leg.ltp <= 0) {
            if (!derivativeQuote?.ltp || derivativeQuote.ltp <= 0)
                return null;
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
    }, [chartSymbol, derivativeQuote, filteredRows, optionChainData, rows, ticketInstrument, workspaceContext]);
    const futuresContracts = useMemo(() => workspaceInstruments
        .filter((instrument) => isProductionInstrument(instrument) && classifyInstrument(instrument) === "futures")
        .sort((a, b) => a.symbol.localeCompare(b.symbol) || (a.expiryDate ?? "").localeCompare(b.expiryDate ?? "")), [workspaceInstruments]);
    const optionUnderlyings = useMemo(() => Array.from(new Set(workspaceInstruments
        .filter((instrument) => isProductionInstrument(instrument) && classifyInstrument(instrument) === "options")
        .map((instrument) => instrument.symbol)))
        .sort(), [workspaceInstruments]);
    const resolveContract = (underlying, expiry, strike, optionType) => workspaceInstruments.find((instrument) => isProductionInstrument(instrument) &&
        classifyInstrument(instrument) === "options" &&
        instrument.symbol === underlying &&
        instrument.strikePrice === strike &&
        instrument.optionType === optionType &&
        (!expiry || instrument.expiryDate === expiry));
    const selectWorkspaceContext = (context) => {
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
    const openChart = (symbol) => {
        setChartSymbol(symbol);
        setWorkspaceContext(asset === "futures" ? "futures" : "stocks");
        setActiveTab("Charts");
    };
    const openTrade = (symbol) => {
        if (symbol !== chartSymbol)
            setChartSymbol(symbol);
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
    const openOrderTicket = (side) => {
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
        const stockMatches = availableInstruments.filter((instrument) => isProductionInstrument(instrument) &&
            instrument.symbol.toUpperCase() === chartSymbol.toUpperCase() &&
            classifyInstrument(instrument) === "stocks");
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
                client_order_id: `customer-${crypto.randomUUID()}`,
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
        }
        catch (error) {
            setTicketState("error");
            setTicketMessage(error instanceof Error ? error.message : "Order creation failed.");
        }
    };
    const exitBasePrice = (orderType === "LIMIT" || orderType === "STOP-LIMIT") && Number(limitPrice) > 0
        ? Number(limitPrice)
        : orderType === "STOP" && Number(triggerPrice) > 0
            ? Number(triggerPrice)
            : selectedQuote?.ltp ?? 0;
    const getExitPrice = (kind) => {
        const ticks = Number(kind === "TAKE_PROFIT" ? takeProfitTicks : stopLossTicks);
        if (!Number.isFinite(ticks) || ticks <= 0 || exitBasePrice <= 0)
            return 0;
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
        staleTime: 30000,
    });
    const [protectionDrafts, setProtectionDrafts] = useState({});
    const activeCanonicalPositions = useMemo(() => {
        if (!terminalPositionsData?.data)
            return [];
        return uniqueCanonicalPositions(terminalPositionsData.data).filter((position) => {
            const normalized = normalizeCanonicalPosition(position);
            return normalized.is_open !== false && normalized.position_status !== "closed";
        });
    }, [terminalPositionsData]);
    const closePosition = async (position) => {
        if (!activeAccountId)
            return;
        const quantity = Number(position.qty ?? position.quantity ?? 0);
        if (!Number.isFinite(quantity) || quantity <= 0)
            return;
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
    const handleProtectionChange = async (positionId, field, value) => {
        if (!value || !Number.isFinite(Number(value)) || Number(value) <= 0)
            return;
        await modifyTerminalPositionProtection(positionId, field, Number(value));
    };
    const showBottomTradingWorkspace = Boolean(chartSymbol && hasChartWorkspace && asset !== "futures");
    return (_jsx("div", { className: chartSymbol && hasChartWorkspace ? "flex h-full min-h-0 flex-col" : "space-y-4", children: !chartSymbol || !hasChartWorkspace ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: "flex flex-wrap items-center justify-between gap-3", children: [_jsxs("div", { children: [_jsx("p", { className: "text-xs font-bold uppercase tracking-[0.2em] text-primary", children: asset === "stocks" ? "Cash / Equity" : asset === "indices" ? "Cash / Index" : "Derivative" }), _jsx("h1", { className: "mt-1 text-2xl font-bold tracking-tight", children: title }), _jsx("p", { className: "mt-1 text-sm text-muted-foreground", children: subtitle })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsxs("div", { className: "relative", children: [_jsx(Search, { className: "absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" }), _jsx(Input, { value: search, onChange: (event) => setSearch(event.target.value), placeholder: searchPlaceholder ?? "Search...", className: "h-8 w-56 pl-8 text-xs" })] }), _jsxs(Badge, { variant: "outline", children: [filteredRows.length, " ", footerLabel ?? "items"] })] })] }), _jsx(Card, { children: _jsx(CardContent, { className: "p-0 overflow-auto", children: isLoading ? (_jsxs("div", { className: "flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground", children: [_jsx(Loader2, { className: "h-4 w-4 animate-spin" }), "Loading live market data..."] })) : filteredRows.length === 0 ? (_jsxs("div", { className: "py-12 text-center text-sm text-muted-foreground", children: ["No real ", asset, " instruments available."] })) : (_jsxs(Table, { children: [_jsx(TableHeader, { className: "sticky top-0 z-10 bg-card", children: _jsxs(TableRow, { className: "text-xs", children: [_jsx(TableHead, { className: "w-8" }), asset === "futures" ? _jsx(TableHead, { children: "Contract" }) : _jsx(TableHead, { children: "Symbol" }), asset === "futures" && _jsx(TableHead, { children: "Underlying" }), asset === "futures" && _jsx(TableHead, { children: "Expiry" }), _jsx(TableHead, { className: "text-right", children: "LTP" }), _jsx(TableHead, { className: "text-right", children: "Change" }), _jsx(TableHead, { className: "text-right", children: "Chg%" }), _jsx(TableHead, { className: "text-right", children: "Open" }), _jsx(TableHead, { className: "text-right", children: "High" }), _jsx(TableHead, { className: "text-right", children: "Low" }), asset !== "indices" && _jsx(TableHead, { className: "text-right", children: "Volume" }), asset === "futures" && _jsx(TableHead, { className: "text-right", children: "OI" }), asset === "futures" && _jsx(TableHead, { className: "text-right", children: "OI Chg" }), _jsx(TableHead, { className: "text-center w-[90px]", children: "Chart" }), _jsx(TableHead, { className: "text-center", children: "Actions" })] }) }), _jsx(TableBody, { children: filteredRows.map((row) => {
                                        const positive = (row.changePercent ?? 0) >= 0;
                                        const isWatched = isWatchlisted(row.symbol, watchedSymbols);
                                        const dayRange = (row.high ?? row.ltp ?? 0) - (row.low ?? row.ltp ?? 0);
                                        const dayPos = dayRange > 0 ? (((row.ltp ?? row.open ?? 0) - (row.low ?? row.ltp ?? 0)) / dayRange) * 100 : 50;
                                        return (_jsxs(TableRow, { className: `text-[11px] font-mono transition-all border-l-2 ${positive ? "hover:bg-bullish/[0.03] border-transparent hover:border-bullish/50" : "hover:bg-bearish/[0.03] border-transparent hover:border-bearish/50"}`, children: [_jsx(TableCell, { children: _jsx("button", { type: "button", onClick: () => onToggleWatchlist(row.symbol), "aria-label": isWatched ? `Remove ${row.symbol} from watchlist` : `Add ${row.symbol} to watchlist`, className: "flex h-4 w-4 items-center justify-center", children: _jsx(Star, { className: `h-3.5 w-3.5 ${isWatched ? "fill-warning text-warning" : "text-muted-foreground hover:text-warning"}` }) }) }), asset === "futures" ? (_jsx(TableCell, { className: "font-sans font-medium", children: _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { children: row.contract ?? row.label }), row.isLive && _jsxs(Badge, { variant: "outline", className: "text-[9px] border-bullish/30 text-bullish", children: [_jsx(Radio, { className: "mr-1 h-2 w-2 animate-pulse" }), "LIVE"] })] }) })) : (_jsx(TableCell, { className: "font-sans font-medium", children: _jsxs("div", { className: "flex items-center gap-2", children: [positive ? _jsx(TrendingUp, { className: "h-3 w-3 text-bullish opacity-80" }) : _jsx(TrendingDown, { className: "h-3 w-3 text-bearish opacity-80" }), _jsx("span", { children: row.label || row.symbol })] }) })), asset === "futures" && (_jsx(TableCell, { className: "text-muted-foreground", children: row.underlying || row.symbol })), asset === "futures" && (_jsx(TableCell, { className: "text-muted-foreground", children: row.expiry || "—" })), _jsx(TableCell, { className: "text-right font-semibold", children: row.ltp != null && row.ltp > 0 ? `₹${row.ltp.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—" }), _jsx(TableCell, { className: `text-right ${row.change != null && row.change >= 0 ? "text-bullish" : "text-bearish"}`, children: row.change != null && row.ltp != null && row.ltp > 0 ? `${row.change >= 0 ? "+" : ""}${row.change.toFixed(2)}` : "—" }), _jsx(TableCell, { className: "text-right", children: row.changePercent != null && row.ltp != null && row.ltp > 0 ? (_jsxs("span", { className: `px-1.5 py-0.5 rounded text-xs font-medium ${positive ? "bg-bullish/10 text-bullish" : "bg-bearish/10 text-bearish"}`, children: [positive ? "+" : "", row.changePercent.toFixed(2), "%"] })) : "—" }), _jsx(TableCell, { className: "text-right text-muted-foreground", children: formatNumber(row.open) }), _jsx(TableCell, { className: "text-right text-muted-foreground", children: formatNumber(row.high) }), _jsx(TableCell, { className: "text-right text-muted-foreground", children: formatNumber(row.low) }), asset !== "indices" && _jsx(TableCell, { className: "text-right text-muted-foreground", children: formatCompact(row.volume) }), asset === "futures" && _jsx(TableCell, { className: "text-right", children: formatCompact(row.oi) }), asset === "futures" && _jsx(TableCell, { className: `text-right ${((row.oiChange ?? 0) >= 0 ? "text-bullish" : "text-bearish")}`, children: row.oiChange == null || row.oiChange === 0 ? "—" : `${row.oiChange >= 0 ? "+" : ""}${formatCompact(row.oiChange)}` }), _jsx(TableCell, { className: "text-center", children: _jsxs("div", { className: "flex flex-col items-center gap-1", children: [_jsx("button", { type: "button", onClick: () => openChart(row.chartSymbol ?? row.symbol), title: "View Chart", className: "inline-flex h-6 w-6 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground", "aria-label": `View chart for ${row.symbol}`, children: _jsx(BarChart3, { className: "h-3 w-3" }) }), dayRange > 0 && (_jsx("div", { className: "relative w-full h-[2px] bg-muted/50 rounded-full", children: _jsx("div", { className: `absolute top-[-1px] h-[4px] w-[4px] rounded-full ${positive ? "bg-bullish" : "bg-bearish"}`, style: { left: `${Math.min(dayPos, 95)}%` } }) }))] }) }), _jsx(TableCell, { children: _jsxs("div", { className: "flex items-center justify-center gap-1", children: [onTradeOpen && (_jsx(Button, { variant: "ghost", size: "icon", className: "h-6 w-6", onClick: () => openTrade(row.symbol), title: "Open trade flow", children: _jsx(ExternalLink, { className: "h-3 w-3" }) })), _jsx(Button, { variant: "ghost", size: "icon", className: "h-6 w-6", onClick: () => onToggleWatchlist(row.symbol), title: isWatched ? "Remove from watchlist" : "Add to watchlist", children: isWatched ? _jsx(X, { className: "h-3 w-3" }) : _jsx(Star, { className: "h-3 w-3" }) })] }) })] }, `${row.symbol}-${row.contract ?? ""}-${row.expiry ?? ""}`));
                                    }) })] })) }) })] })) : (_jsxs("div", { className: "chart-workspace flex h-full min-h-0 flex-col", children: [_jsxs("div", { className: "flex shrink-0 items-center justify-between gap-3 pb-3", children: [_jsxs("button", { type: "button", onClick: () => setChartSymbol(null), className: "inline-flex h-8 items-center gap-2 rounded-md border border-border bg-card/80 px-2 text-xs font-medium text-foreground hover:bg-card", children: [_jsx(ArrowLeft, { className: "h-3.5 w-3.5" }), "Back to ", asset === "indices" ? "Indices" : asset === "futures" ? "Futures" : "Stocks"] }), _jsxs("div", { className: "flex items-center gap-2 text-xs text-muted-foreground", children: [_jsx("span", { className: "rounded-md border border-bullish/30 bg-bullish/5 px-2 py-1 font-medium text-bullish", children: "LIVE" }), _jsx("span", { children: chartSymbol })] })] }), _jsx("div", { className: "min-h-0 flex-1 overflow-hidden rounded-2xl border border-border bg-card shadow-[0_12px_40px_rgba(15,23,42,0.10)]", children: _jsxs("div", { className: "flex h-full min-h-0", children: [_jsxs("aside", { className: "flex w-[290px] min-h-0 shrink-0 flex-col border-r border-border bg-muted/20", children: [_jsx("div", { className: "shrink-0 border-b border-border bg-background/60 p-3", children: _jsxs("div", { className: "relative", children: [_jsx(Search, { className: "absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" }), _jsx(Input, { value: search, onChange: (event) => setSearch(event.target.value), placeholder: searchPlaceholder ?? "Search instruments...", className: "h-8 w-full pl-8 text-xs" })] }) }), _jsx("div", { className: "shrink-0 p-2 pb-1", children: _jsx("div", { className: "px-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground", children: asset === "indices" && workspaceContext === "stocks" ? "Indices" : workspaceContext === "stocks" ? "Stocks" : workspaceContext === "futures" ? "Futures" : "Options" }) }), _jsx("div", { className: "min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-2 pt-0", children: _jsxs("div", { className: "space-y-1", children: [workspaceContext === "stocks" && filteredRows.map((row) => {
                                                    const positive = (row.changePercent ?? 0) >= 0;
                                                    const active = (row.chartSymbol ?? row.symbol) === chartSymbol;
                                                    return (_jsxs("button", { type: "button", onClick: () => setChartSymbol(row.chartSymbol ?? row.symbol), className: `flex w-full items-center justify-between rounded-lg border px-2 py-2 text-left transition ${active ? "border-primary/40 bg-primary/5" : "border-transparent hover:border-border hover:bg-muted/20"}`, children: [_jsxs("div", { className: "min-w-0 flex-1", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "truncate text-sm font-semibold text-foreground", children: row.symbol }), positive ? _jsx(TrendingUp, { className: "h-3 w-3 text-bullish" }) : _jsx(TrendingDown, { className: "h-3 w-3 text-bearish" })] }), _jsx("div", { className: "mt-1 text-[10px] uppercase tracking-[0.12em] text-muted-foreground", children: asset === "indices" ? "NSE · IDX_I" : "NSE" })] }), _jsxs("div", { className: "ml-3 text-right", children: [_jsxs("div", { className: "text-xs font-semibold text-foreground", children: ["\u20B9", (row.ltp ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })] }), _jsxs("div", { className: `text-[10px] font-medium ${positive ? "text-bullish" : "text-bearish"}`, children: [positive ? "+" : "", (row.changePercent ?? 0).toFixed(2), "%"] })] })] }, row.symbol));
                                                }), workspaceContext === "futures" && futuresContracts.map((contract) => {
                                                    const active = contract.tradingSymbol === chartSymbol;
                                                    return (_jsxs("button", { type: "button", onClick: () => { setChartSymbol(contract.tradingSymbol); setContextUnderlying(contract.symbol); }, className: `flex w-full items-center justify-between rounded-lg border px-2 py-2 text-left transition ${active ? "border-primary/40 bg-primary/5" : "border-transparent hover:border-border hover:bg-muted/20"}`, children: [_jsxs("div", { className: "min-w-0", children: [_jsx("div", { className: "truncate text-sm font-semibold text-foreground", children: contract.tradingSymbol }), _jsxs("div", { className: "mt-1 text-[10px] uppercase tracking-[0.12em] text-muted-foreground", children: [contract.symbol, " \u00B7 ", contract.expiryDate ?? "—"] })] }), _jsx("span", { className: "ml-2 text-[10px] text-muted-foreground", children: "FUT" })] }, contract.tradingSymbol));
                                                }), workspaceContext === "options" && (optionUnderlyings.length > 0 ? optionUnderlyings : ["NIFTY", "BANKNIFTY", "FINNIFTY"]).map((underlying) => (_jsxs("button", { type: "button", onClick: () => { setContextUnderlying(underlying); setContextExpiry(undefined); }, className: `flex w-full items-center justify-between rounded-lg border px-2 py-2 text-left transition ${underlying === contextUnderlying ? "border-primary/40 bg-primary/5" : "border-transparent hover:border-border hover:bg-muted/20"}`, children: [_jsx("span", { className: "text-sm font-semibold text-foreground", children: underlying }), _jsx("span", { className: "text-[10px] uppercase tracking-[0.12em] text-muted-foreground", children: "OPT" })] }, underlying)))] }) })] }), _jsxs("section", { className: "flex min-w-0 min-h-0 flex-1 flex-col bg-background", children: [_jsxs("div", { className: "flex shrink-0 items-center justify-between gap-3 border-b border-border bg-background/80 px-4 py-3", children: [_jsxs("div", { children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("span", { className: "text-2xl font-bold tracking-tight", children: selectedQuote?.label ?? chartSymbol }), _jsx("span", { className: "rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground", children: asset === "indices" ? "NSE · IDX_I" : workspaceContext === "stocks" ? "NSE" : "NFO" })] }), _jsxs("div", { className: "mt-1 flex items-center gap-3 text-sm", children: [_jsxs("span", { className: "font-mono font-semibold text-foreground", children: ["\u20B9", (selectedQuote?.ltp ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })] }), _jsxs("span", { className: `font-mono ${((selectedQuote?.change ?? 0) >= 0) ? "text-bullish" : "text-bearish"}`, children: [((selectedQuote?.change ?? 0) >= 0 ? "+" : ""), (selectedQuote?.change ?? 0).toFixed(2)] }), _jsxs("span", { className: `font-mono ${((selectedQuote?.changePercent ?? 0) >= 0) ? "text-bullish" : "text-bearish"}`, children: [((selectedQuote?.changePercent ?? 0) >= 0 ? "+" : ""), (selectedQuote?.changePercent ?? 0).toFixed(2), "%"] })] })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsxs(Button, { variant: "outline", onClick: () => openOrderTicket("SELL"), className: "h-12 min-w-[134px] rounded-lg border-0 bg-red-600 px-4 text-sm font-bold text-white shadow-sm hover:bg-red-700", children: [_jsx("span", { "aria-hidden": "true", className: "mr-1.5 text-[10px]", children: "\u25BC" }), "SELL"] }), _jsxs(Button, { variant: "outline", onClick: () => openOrderTicket("BUY"), className: "h-12 min-w-[134px] rounded-lg border-0 bg-emerald-600 px-4 text-sm font-bold text-white shadow-sm hover:bg-emerald-700", children: [_jsx("span", { "aria-hidden": "true", className: "mr-1.5 text-[10px]", children: "\u25B2" }), "BUY"] })] })] }), _jsx("div", { className: "shrink-0 border-b border-border px-4 py-2", children: _jsx("div", { className: "flex flex-wrap gap-2", children: chartTabs.map((tab) => (_jsx("button", { type: "button", onClick: () => {
                                                    if (tab === "Charts" || tab === "Markets")
                                                        selectWorkspaceContext("stocks");
                                                    if (tab === "Option Chain" || tab === "Options")
                                                        selectWorkspaceContext("options");
                                                    if (tab === "Futures")
                                                        selectWorkspaceContext("futures");
                                                }, className: `rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition ${activeTab === tab ? "border-primary/40 bg-primary/5 text-primary" : "border-border bg-background text-muted-foreground hover:border-primary/30 hover:text-foreground"}`, children: tab }, tab))) }) }), workspaceContext === "options" && (_jsx("div", { className: "shrink-0 border-b border-border bg-muted/10 px-4 py-2", children: _jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [_jsx("select", { value: contextUnderlying, onChange: (event) => { setContextUnderlying(event.target.value); setContextExpiry(undefined); }, className: "h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground", "aria-label": "Option underlying", children: (optionUnderlyings.length > 0 ? optionUnderlyings : ["NIFTY", "BANKNIFTY", "FINNIFTY"]).map((underlying) => _jsx("option", { value: underlying, children: underlying }, underlying)) }), _jsxs("select", { value: contextExpiry ?? "", onChange: (event) => setContextExpiry(event.target.value || undefined), className: "h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground", "aria-label": "Option expiry", children: [_jsx("option", { value: "", children: "Nearest expiry" }), (optionChainData?.expiries ?? []).map((expiry) => _jsx("option", { value: expiry.value, children: expiry.label }, expiry.value))] }), _jsxs("div", { className: "flex min-w-0 flex-1 gap-1 overflow-x-auto", children: [(optionChainData?.chain ?? []).slice(0, 24).flatMap((row) => ["CE", "PE"].map((optionType) => {
                                                            const contract = resolveContract(contextUnderlying, contextExpiry, row.strikePrice, optionType);
                                                            if (!contract)
                                                                return null;
                                                            const leg = row[optionType === "CE" ? "ce" : "pe"];
                                                            return (_jsxs("button", { type: "button", onClick: () => setChartSymbol(contract.tradingSymbol), className: `shrink-0 rounded-md border px-2 py-1 text-[10px] font-medium ${chartSymbol === contract.tradingSymbol ? "border-primary/40 bg-primary/5 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`, children: [contract.tradingSymbol, " ", _jsxs("span", { className: "font-mono", children: ["\u20B9", leg.ltp.toFixed(2)] })] }, contract.tradingSymbol));
                                                        })), isOptionChainLoading && _jsx("span", { className: "px-2 py-1 text-[10px] text-muted-foreground", children: "Loading live option chain..." })] })] }) })), workspaceContext === "futures" && (_jsx("div", { className: "shrink-0 border-b border-border bg-muted/10 px-4 py-2", children: _jsx("select", { value: chartSymbol ?? "", onChange: (event) => {
                                                const contract = futuresContracts.find((item) => item.tradingSymbol === event.target.value);
                                                if (contract) {
                                                    setChartSymbol(contract.tradingSymbol);
                                                    setContextUnderlying(contract.symbol);
                                                }
                                            }, className: "h-8 max-w-full rounded-md border border-border bg-background px-2 text-xs text-foreground", "aria-label": "Futures contract", children: futuresContracts.map((contract) => _jsxs("option", { value: contract.tradingSymbol, children: [contract.tradingSymbol, " \u00B7 ", contract.expiryDate ?? "—"] }, contract.tradingSymbol)) }) })), _jsx("div", { className: "min-h-0 flex-1 p-3", children: _jsx("div", { className: "h-full min-h-0 rounded-xl border border-border bg-background/60 p-2", children: _jsx(StockChart, { symbol: chartSymbol, inline: true, fill: true, candleOnly: activeTab === "Markets", instrumentToken: chartInstrumentToken }) }) }), showBottomTradingWorkspace && (_jsxs("div", { "data-testid": "bottom-trading-workspace", className: "w-full shrink-0 border-t border-border bg-background/80", children: [_jsxs("div", { className: "flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-[11px] text-muted-foreground", children: [_jsx("button", { type: "button", className: "rounded border border-border bg-muted/20 px-2 py-1 text-foreground", children: "Enter the Market" }), _jsxs("button", { type: "button", className: "rounded border border-border bg-muted/20 px-2 py-1 text-foreground", children: ["Positions [", activeCanonicalPositions.length, "]"] }), _jsx("button", { type: "button", className: "rounded border border-border bg-muted/20 px-2 py-1 text-foreground", children: "Pending [0]" }), _jsx("button", { type: "button", className: "rounded border border-border bg-muted/20 px-2 py-1 text-foreground", children: "Closed Positions" }), _jsx("button", { type: "button", className: "rounded border border-border bg-muted/20 px-2 py-1 text-foreground", children: "Order History" }), _jsx("button", { type: "button", className: "rounded border border-border bg-muted/20 px-2 py-1 text-foreground", children: "Balance" }), _jsx("button", { type: "button", className: "rounded border border-border bg-muted/20 px-2 py-1 text-foreground", children: "Trades" }), _jsx("button", { type: "button", className: "rounded border border-border bg-muted/20 px-2 py-1 text-foreground", children: "Alerts [0]" }), _jsx("button", { type: "button", className: "ml-auto rounded border border-border bg-muted/20 px-2 py-1 text-foreground", children: "Close All" })] }), activeCanonicalPositions.length === 0 && (_jsxs("div", { className: "flex items-center gap-2 border-b border-border px-3 py-3 text-sm text-muted-foreground", children: [_jsx("span", { className: "h-2 w-2 rounded-full bg-emerald-500" }), "No active positions"] })), activeCanonicalPositions.length > 0 && (_jsx("div", { className: "overflow-x-auto", children: _jsxs(Table, { children: [_jsx(TableHeader, { className: "bg-background/80", children: _jsxs(TableRow, { children: [_jsx(TableHead, { children: "Instrument" }), _jsx(TableHead, { children: "Entry Time (UTC)" }), _jsx(TableHead, { children: "Type" }), _jsx(TableHead, { children: "Side" }), _jsx(TableHead, { children: "Amount" }), _jsx(TableHead, { children: "Entry Price" }), _jsx(TableHead, { children: "Stop Loss" }), _jsx(TableHead, { children: "Take Profit" }), _jsx(TableHead, { children: "Exit Time (UTC)" }), _jsx(TableHead, { children: "Exit Price" }), _jsx(TableHead, { children: "P&L" }), _jsx(TableHead, { children: "Net P&L" }), _jsx(TableHead, { children: "X" })] }) }), _jsx(TableBody, { children: activeCanonicalPositions.map((position) => {
                                                                const normalized = normalizeCanonicalPosition(position);
                                                                const stopLossValue = protectionDrafts[normalized.id]?.stopLoss ?? String(normalized.stop_loss ?? "");
                                                                const takeProfitValue = protectionDrafts[normalized.id]?.takeProfit ?? String(normalized.take_profit ?? "");
                                                                const entryValue = Number(normalized.avg_price ?? normalized.average_price ?? 0);
                                                                const pnlValue = Number(normalized.realized_pnl ?? normalized.unrealized_pnl ?? 0);
                                                                const netPnlValue = pnlValue;
                                                                return (_jsxs(TableRow, { children: [_jsx(TableCell, { className: "font-medium text-foreground", children: normalized.symbol }), _jsx(TableCell, { className: "text-muted-foreground", children: normalized.updated_at ? new Date(normalized.updated_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—" }), _jsx(TableCell, { className: "text-muted-foreground", children: normalized.side === "LONG" ? "LONG" : "SHORT" }), _jsx(TableCell, { className: "text-muted-foreground", children: String(normalized.side).toUpperCase() }), _jsx(TableCell, { className: "text-muted-foreground", children: Number(normalized.qty ?? normalized.quantity ?? 0).toLocaleString("en-IN") }), _jsxs(TableCell, { className: "font-mono text-foreground", children: ["\u20B9", entryValue.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })] }), _jsx(TableCell, { children: _jsx("input", { "aria-label": `Stop Loss for ${normalized.symbol}`, type: "number", step: "0.05", value: stopLossValue, onChange: (event) => {
                                                                                    const next = event.target.value;
                                                                                    setProtectionDrafts((current) => ({
                                                                                        ...current,
                                                                                        [normalized.id]: {
                                                                                            stopLoss: next,
                                                                                            takeProfit: current[normalized.id]?.takeProfit ?? takeProfitValue,
                                                                                        },
                                                                                    }));
                                                                                }, onBlur: () => {
                                                                                    const nextValue = protectionDrafts[normalized.id]?.stopLoss ?? String(normalized.stop_loss ?? "");
                                                                                    if (nextValue)
                                                                                        void handleProtectionChange(normalized.id, "stop_loss", nextValue);
                                                                                }, className: "w-20 rounded border border-input bg-background px-1.5 py-1 text-xs text-foreground" }) }), _jsx(TableCell, { children: _jsx("input", { "aria-label": `Take Profit for ${normalized.symbol}`, type: "number", step: "0.05", value: takeProfitValue, onChange: (event) => {
                                                                                    const next = event.target.value;
                                                                                    setProtectionDrafts((current) => ({
                                                                                        ...current,
                                                                                        [normalized.id]: {
                                                                                            stopLoss: current[normalized.id]?.stopLoss ?? stopLossValue,
                                                                                            takeProfit: next,
                                                                                        },
                                                                                    }));
                                                                                }, onBlur: () => {
                                                                                    const nextValue = protectionDrafts[normalized.id]?.takeProfit ?? String(normalized.take_profit ?? "");
                                                                                    if (nextValue)
                                                                                        void handleProtectionChange(normalized.id, "take_profit", nextValue);
                                                                                }, className: "w-20 rounded border border-input bg-background px-1.5 py-1 text-xs text-foreground" }) }), _jsx(TableCell, { className: "text-muted-foreground", children: "\u2014" }), _jsxs(TableCell, { className: "font-mono text-foreground", children: ["\u20B9", (Number(normalized.current_price ?? normalized.last_price ?? 0)).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })] }), _jsxs(TableCell, { className: pnlValue >= 0 ? "font-mono text-bullish" : "font-mono text-bearish", children: ["\u20B9", Math.abs(pnlValue).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })] }), _jsxs(TableCell, { className: netPnlValue >= 0 ? "font-mono text-bullish" : "font-mono text-bearish", children: ["\u20B9", Math.abs(netPnlValue).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })] }), _jsx(TableCell, { children: _jsx("button", { type: "button", "aria-label": `Close position ${normalized.symbol}`, onClick: () => void closePosition(normalized), className: "text-xs text-red-500 hover:text-red-400", children: "X" }) })] }, normalized.id));
                                                            }) })] }) }))] }))] })] }) }), ticketSide && (_jsx("div", { className: "fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4", role: "dialog", "aria-modal": "true", "aria-label": `SIMULATED ${ticketSide} order ticket`, children: _jsxs("div", { className: "max-h-[min(90vh,760px)] w-full max-w-md overflow-y-auto rounded-lg border border-border bg-card p-5 text-card-foreground shadow-2xl", children: [_jsxs("div", { className: "flex items-start justify-between gap-4", children: [_jsxs("div", { className: "min-w-0", children: [_jsx("h2", { className: "truncate text-base font-semibold", children: chartSymbol }), _jsxs("p", { className: "mt-1 text-xs text-muted-foreground", children: [ticketInstrument?.exchangeSegment ?? (workspaceContext === "stocks" ? "NSE_EQ" : "NFO"), " \u00B7 simulated order ticket"] })] }), _jsx("button", { type: "button", onClick: () => setTicketSide(null), className: "rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground", "aria-label": "Close order ticket", children: _jsx(X, { className: "h-4 w-4" }) })] }), _jsx("div", { className: "mt-4 grid grid-cols-2 gap-2 rounded-md bg-muted/50 p-1", children: ["BUY", "SELL"].map((side) => (_jsx("button", { type: "button", "aria-pressed": ticketSide === side, "aria-label": `SIMULATED ${side}`, onClick: () => { setTicketSide(side); setTakeProfitPrice(""); setStopLossPrice(""); setTicketState("idle"); setTicketMessage(""); }, className: `rounded px-3 py-2.5 text-sm font-bold transition-colors ${ticketSide === side ? side === "BUY" ? "bg-emerald-600 text-white shadow-sm hover:bg-emerald-700" : "bg-red-600 text-white shadow-sm hover:bg-red-700" : "bg-transparent text-muted-foreground hover:bg-background hover:text-foreground"}`, children: side }, side))) }), _jsxs("div", { className: "mt-4 flex items-end justify-between gap-3", children: [_jsxs("div", { children: [_jsxs("p", { className: "text-xs text-muted-foreground", children: [ticketInstrument?.exchangeSegment?.startsWith("NFO") ? "NFO" : "NSE", " \u00B7 LTP"] }), _jsxs("p", { className: "mt-1 font-mono text-lg font-semibold", children: ["\u20B9", (selectedQuote?.ltp ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })] })] }), _jsxs("div", { className: "text-right", children: [_jsx("p", { className: "text-xs text-muted-foreground", children: "Est. order value" }), _jsxs("p", { className: "mt-1 font-mono text-sm font-semibold", children: ["\u20B9", (((orderType === "LIMIT" || orderType === "STOP-LIMIT") && Number(limitPrice) > 0 ? Number(limitPrice) : selectedQuote?.ltp ?? 0) * (Number(quantity) || 0)).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })] })] })] }), _jsx("div", { className: "mt-5 grid grid-cols-4 border-b border-border", role: "tablist", "aria-label": "Order type", children: ["MARKET", "LIMIT", "STOP", "STOP-LIMIT"].map((type) => _jsx("button", { type: "button", role: "tab", "aria-selected": orderType === type, onClick: () => setOrderType(type), className: `border-b-2 px-1 py-2 text-[11px] font-medium ${orderType === type ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`, children: type === "STOP-LIMIT" ? "Stop-Limit" : type === "STOP" ? "Stop" : type === "MARKET" ? "Market" : "Limit" }, type)) }), _jsxs("div", { className: "mt-4 grid grid-cols-2 gap-3", children: [_jsxs("label", { className: "block text-xs font-medium text-muted-foreground", children: ["Units / Quantity", _jsx("input", { type: "number", min: "1", step: "1", value: quantity, onChange: (event) => setQuantity(event.target.value), className: "mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground" })] }), _jsxs("div", { className: "text-xs font-medium text-muted-foreground", children: ["Risk, INR", _jsx("div", { className: "mt-1 flex h-10 items-center rounded-md border border-input bg-muted/50 px-3 font-mono text-sm text-foreground", children: estimatedRisk == null ? "—" : `₹${estimatedRisk.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` })] })] }), (orderType === "LIMIT" || orderType === "STOP-LIMIT") && _jsxs("label", { className: "mt-3 block text-xs font-medium text-muted-foreground", children: ["Limit price", _jsx("input", { type: "number", min: "0", step: "0.05", value: limitPrice, onChange: (event) => setLimitPrice(event.target.value), className: "mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground" })] }), (orderType === "STOP" || orderType === "STOP-LIMIT") && _jsxs("label", { className: "mt-3 block text-xs font-medium text-muted-foreground", children: ["Trigger price", _jsx("input", { type: "number", min: "0", step: "0.05", value: triggerPrice, onChange: (event) => setTriggerPrice(event.target.value), className: "mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground" })] }), _jsxs("section", { className: "mt-5 space-y-4 border-t border-border pt-4", "aria-label": "Order exits", children: [_jsxs("div", { children: [_jsxs("label", { className: "flex items-center gap-2 text-sm font-semibold text-foreground", children: [_jsx("input", { type: "checkbox", checked: takeProfitEnabled, onChange: (event) => setTakeProfitEnabled(event.target.checked), className: "h-4 w-4 accent-emerald-600" }), "Take profit"] }), _jsxs("div", { className: "mt-2 grid grid-cols-2 gap-3", children: [_jsxs("label", { className: "text-xs font-medium text-muted-foreground", children: ["Price", _jsx("input", { "aria-label": "Take profit price", type: "number", min: "0", step: ORDER_TICK_SIZE, disabled: !takeProfitEnabled, value: takeProfitPrice || (getExitPrice("TAKE_PROFIT") || ""), onChange: (event) => { setTakeProfitPrice(event.target.value); const ticks = Math.abs((Number(event.target.value) || exitBasePrice) - exitBasePrice) / ORDER_TICK_SIZE; setTakeProfitTicks(String(Math.round(ticks))); }, className: "mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground disabled:bg-muted/50 disabled:text-muted-foreground" })] }), _jsxs("label", { className: "text-xs font-medium text-muted-foreground", children: ["Ticks", _jsx("input", { "aria-label": "Take profit ticks", type: "number", min: "1", step: "1", disabled: !takeProfitEnabled, value: takeProfitTicks, onChange: (event) => { setTakeProfitTicks(event.target.value); setTakeProfitPrice(""); }, className: "mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground disabled:bg-muted/50 disabled:text-muted-foreground" })] })] })] }), _jsxs("div", { children: [_jsxs("label", { className: "flex items-center gap-2 text-sm font-semibold text-foreground", children: [_jsx("input", { type: "checkbox", checked: stopLossEnabled, onChange: (event) => setStopLossEnabled(event.target.checked), className: "h-4 w-4 accent-red-600" }), "Stop loss"] }), _jsxs("div", { className: "mt-2 grid grid-cols-2 gap-3", children: [_jsxs("label", { className: "text-xs font-medium text-muted-foreground", children: ["Price", _jsx("input", { "aria-label": "Stop loss price", type: "number", min: "0", step: ORDER_TICK_SIZE, disabled: !stopLossEnabled, value: stopLossPrice || (getExitPrice("STOP_LOSS") || ""), onChange: (event) => { setStopLossPrice(event.target.value); const ticks = Math.abs((Number(event.target.value) || exitBasePrice) - exitBasePrice) / ORDER_TICK_SIZE; setStopLossTicks(String(Math.round(ticks))); }, className: "mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground disabled:bg-muted/50 disabled:text-muted-foreground" })] }), _jsxs("label", { className: "text-xs font-medium text-muted-foreground", children: ["Ticks", _jsx("input", { "aria-label": "Stop loss ticks", type: "number", min: "1", step: "1", disabled: !stopLossEnabled, value: stopLossTicks, onChange: (event) => { setStopLossTicks(event.target.value); setStopLossPrice(""); }, className: "mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground disabled:bg-muted/50 disabled:text-muted-foreground" })] })] })] })] }), ticketMessage && _jsx("p", { className: `mt-3 text-xs ${ticketState === "error" ? "text-destructive" : "text-emerald-500"}`, children: ticketMessage }), _jsxs("div", { className: "mt-5 flex gap-2", children: [_jsx(Button, { variant: "outline", onClick: () => setTicketSide(null), children: "Cancel" }), _jsx(Button, { disabled: ticketState === "submitting" || ticketState === "submitted", "aria-label": `SIMULATED ${ticketSide} ${orderType === "MARKET" ? "Market" : orderType}`, onClick: () => void submitOrder(), className: `flex-1 font-semibold text-white ${ticketSide === "BUY" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"}`, children: ticketState === "submitting" ? "Submitting..." : ticketState === "submitted" ? "Order Created" : `${ticketSide} ${orderType === "MARKET" ? "Market" : orderType}` })] })] }) }))] })) }));
}
