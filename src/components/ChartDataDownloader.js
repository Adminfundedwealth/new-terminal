import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { Download, Loader2, CheckCircle2, Search, CandlestickChart, FileDown, Clock, BarChart3, TrendingUp, Database, XCircle, CheckSquare, Square, } from "lucide-react";
import { useAccountContext } from "@/hooks/useAccountContext";
import { requestTerminalMarketData, resolveTerminalMarketDataProvider } from "@/lib/terminalApi";
import { saveCandleHistory, setMetadata, } from "@/lib/localDatabase";
// ── All F&O Stocks + Indices ──
const ALL_SYMBOLS = [
    // Indices
    { symbol: "NIFTY", securityId: "13", segment: "IDX_I", instrument: "INDEX", category: "Index" },
    { symbol: "BANKNIFTY", securityId: "25", segment: "IDX_I", instrument: "INDEX", category: "Index" },
    { symbol: "FINNIFTY", securityId: "27", segment: "IDX_I", instrument: "INDEX", category: "Index" },
    { symbol: "MIDCPNIFTY", securityId: "442", segment: "IDX_I", instrument: "INDEX", category: "Index" },
    { symbol: "INDIAVIX", securityId: "26", segment: "IDX_I", instrument: "INDEX", category: "Index" },
    { symbol: "SENSEX", securityId: "1", segment: "IDX_I", instrument: "INDEX", category: "Index" },
    // Top F&O Stocks
    { symbol: "RELIANCE", securityId: "2885", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
    { symbol: "TCS", securityId: "11536", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
    { symbol: "HDFCBANK", securityId: "1333", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
    { symbol: "INFY", securityId: "1594", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
    { symbol: "ICICIBANK", securityId: "4963", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
    { symbol: "SBIN", securityId: "3045", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
    { symbol: "BHARTIARTL", securityId: "10604", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
    { symbol: "ITC", securityId: "1660", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
    { symbol: "KOTAKBANK", securityId: "1922", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
    { symbol: "LT", securityId: "11483", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
    { symbol: "AXISBANK", securityId: "5900", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
    { symbol: "HINDUNILVR", securityId: "1394", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
    { symbol: "TATAMOTORS", securityId: "3456", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
    { symbol: "TATASTEEL", securityId: "3499", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
    { symbol: "BAJFINANCE", securityId: "317", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
    { symbol: "SUNPHARMA", securityId: "3351", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
    { symbol: "MARUTI", securityId: "10999", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
    { symbol: "TITAN", securityId: "3506", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
    { symbol: "WIPRO", securityId: "3787", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
    { symbol: "HCLTECH", securityId: "7229", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
    { symbol: "NTPC", securityId: "11630", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
    { symbol: "POWERGRID", securityId: "14977", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
    { symbol: "ONGC", securityId: "2475", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
    { symbol: "JSWSTEEL", securityId: "11723", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
    { symbol: "ASIANPAINT", securityId: "236", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
    { symbol: "ADANIPORTS", securityId: "15083", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
    { symbol: "ULTRACEMCO", securityId: "11532", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
    { symbol: "TECHM", securityId: "13538", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
    { symbol: "INDUSINDBK", securityId: "5258", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
    { symbol: "DRREDDY", securityId: "881", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
    { symbol: "CIPLA", securityId: "694", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
    { symbol: "EICHERMOT", securityId: "910", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
    { symbol: "DIVISLAB", securityId: "10940", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
    { symbol: "BPCL", securityId: "526", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
    { symbol: "COALINDIA", securityId: "20374", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
    { symbol: "APOLLOHOSP", securityId: "157", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
    { symbol: "HEROMOTOCO", securityId: "1348", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
    { symbol: "BRITANNIA", securityId: "547", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
    { symbol: "NESTLEIND", securityId: "17963", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
    { symbol: "HINDALCO", securityId: "1363", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
    { symbol: "VEDL", securityId: "3063", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
    { symbol: "BANKBARODA", securityId: "4668", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
    { symbol: "PNB", securityId: "10666", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
    { symbol: "DLF", securityId: "14732", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
    { symbol: "TRENT", securityId: "1964", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
];
// Timeframe → date range mapping
const TIMEFRAMES = [
    { label: "1 Day", value: "1D", days: 2 },
    { label: "1 Week", value: "1W", days: 10 },
    { label: "1 Month", value: "1M", days: 35 },
    { label: "3 Months", value: "3M", days: 95 },
    { label: "6 Months", value: "6M", days: 185 },
    { label: "1 Year", value: "1Y", days: 370 },
];
// Interval → Dhan API interval code
const INTERVALS = [
    { label: "1 Min", value: "1", minTimeframe: "1D" },
    { label: "5 Min", value: "5", minTimeframe: "1D" },
    { label: "15 Min", value: "15", minTimeframe: "1W" },
    { label: "1 Hour", value: "60", minTimeframe: "1M" },
    { label: "Daily", value: "D", minTimeframe: "1M" },
];
export function ChartDataDownloader() {
    const { activeAccountId, accounts } = useAccountContext();
    const provider = resolveTerminalMarketDataProvider(accounts.find((account) => account.id === activeAccountId)?.broker_provider);
    const [search, setSearch] = useState("");
    const [selectedSymbols, setSelectedSymbols] = useState(new Set(ALL_SYMBOLS.map(s => s.symbol)));
    const [timeframe, setTimeframe] = useState("3M");
    const [interval, setInterval] = useState("D");
    const [isDownloading, setIsDownloading] = useState(false);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [results, setResults] = useState([]);
    const [currentSymbol, setCurrentSymbol] = useState("");
    // Filter symbols by search
    const filteredSymbols = useMemo(() => {
        if (!search)
            return ALL_SYMBOLS;
        const q = search.toUpperCase();
        return ALL_SYMBOLS.filter(s => s.symbol.includes(q) || s.category.toUpperCase().includes(q));
    }, [search]);
    const selectedCount = selectedSymbols.size;
    const totalSymbols = ALL_SYMBOLS.length;
    const toggleSymbol = (symbol) => {
        setSelectedSymbols(prev => {
            const next = new Set(prev);
            if (next.has(symbol))
                next.delete(symbol);
            else
                next.add(symbol);
            return next;
        });
    };
    const selectAll = () => setSelectedSymbols(new Set(ALL_SYMBOLS.map(s => s.symbol)));
    const deselectAll = () => setSelectedSymbols(new Set());
    const selectIndices = () => {
        const indices = ALL_SYMBOLS.filter(s => s.category === "Index").map(s => s.symbol);
        setSelectedSymbols(new Set(indices));
    };
    const getDateRange = () => {
        const tf = TIMEFRAMES.find(t => t.value === timeframe);
        const days = tf?.days || 95;
        const now = new Date();
        const from = new Date(now);
        from.setDate(from.getDate() - days);
        return {
            fromDate: from.toISOString().split("T")[0],
            toDate: now.toISOString().split("T")[0],
        };
    };
    // Export single symbol as CSV
    const exportCSV = useCallback((symbol, candles) => {
        const header = "Date,Time,Open,High,Low,Close,Volume\n";
        const rows = candles.map(c => {
            const d = new Date(c.timestamp);
            return `${d.toLocaleDateString("en-IN")},${d.toLocaleTimeString("en-IN", { hour12: false })},${c.open},${c.high},${c.low},${c.close},${c.volume}`;
        }).join("\n");
        const blob = new Blob([header + rows], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${symbol}_${timeframe}_${interval}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }, [timeframe, interval]);
    // Batch download
    const handleDownload = async () => {
        const symbols = ALL_SYMBOLS.filter(s => selectedSymbols.has(s.symbol));
        if (symbols.length === 0) {
            toast.error("Select at least one symbol");
            return;
        }
        setIsDownloading(true);
        setResults([]);
        setCurrentIndex(0);
        const { fromDate, toDate } = getDateRange();
        const newResults = [];
        for (let i = 0; i < symbols.length; i++) {
            const sym = symbols[i];
            setCurrentIndex(i + 1);
            setCurrentSymbol(sym.symbol);
            try {
                if (!activeAccountId || !provider)
                    throw new Error("An active Terminal OS market-data account is required.");
                const instruments = await requestTerminalMarketData(activeAccountId, provider, { operation: "searchInstruments", query: sym.symbol });
                const instrument = instruments.find((item) => item.provider === provider && (item.symbol.toUpperCase() === sym.symbol || item.tradingSymbol.toUpperCase() === sym.symbol));
                if (!instrument)
                    throw new Error(`Terminal OS instrument not found for ${sym.symbol}`);
                const apiInterval = interval === "D" ? "day" : provider === "kite" ? (interval === "15" ? "15minute" : "60minute") : `${interval}m`;
                const candles = await requestTerminalMarketData(activeAccountId, provider, {
                    operation: "getHistoricalCandles",
                    instrument,
                    interval: apiInterval,
                    fromDate,
                    toDate,
                });
                const candleData = candles
                    .map((candle) => ({
                    timestamp: Date.parse(candle.timestamp),
                    open: candle.open,
                    high: candle.high,
                    low: candle.low,
                    close: candle.close,
                    volume: candle.volume,
                    oi: candle.openInterest,
                }))
                    .filter((candle) => Number.isFinite(candle.timestamp));
                if (candleData.length > 0) {
                    // Store in IndexedDB
                    const history = {
                        securityId: sym.securityId,
                        symbol: sym.symbol,
                        exchangeSegment: sym.segment,
                        interval: `${interval}_${timeframe}`,
                        candles: candleData,
                        lastUpdated: Date.now(),
                    };
                    await saveCandleHistory(history);
                    newResults.push({ symbol: sym.symbol, status: "done", candles: candleData.length });
                }
                else {
                    newResults.push({ symbol: sym.symbol, status: "skipped", candles: 0, error: "No data from Terminal OS" });
                }
            }
            catch (err) {
                newResults.push({ symbol: sym.symbol, status: "error", candles: 0, error: err.message || "Fetch failed" });
            }
            setResults([...newResults]);
            // Rate limit: 300ms between requests
            if (i < symbols.length - 1) {
                await new Promise(r => setTimeout(r, 350));
            }
        }
        await setMetadata("lastChartDownload", new Date().toISOString());
        const successCount = newResults.filter(r => r.status === "done").length;
        const totalCandles = newResults.reduce((s, r) => s + r.candles, 0);
        toast.success(`Downloaded ${successCount}/${symbols.length} symbols — ${totalCandles.toLocaleString()} candles stored`, { duration: 6000 });
        setIsDownloading(false);
        setCurrentSymbol("");
    };
    // Export all results as combined CSV
    const handleExportAll = () => {
        const successResults = results.filter(r => r.status === "done");
        if (successResults.length === 0) {
            toast.error("No data to export. Run download first.");
            return;
        }
        toast.info(`Export requires downloading from IndexedDB — use per-symbol export for now.`);
    };
    const progressPct = isDownloading ? (currentIndex / Math.max(selectedCount, 1)) * 100 : 0;
    const doneCount = results.filter(r => r.status === "done").length;
    const errorCount = results.filter(r => r.status === "error").length;
    return (_jsxs(Card, { className: "border-primary/20 bg-gradient-to-br from-primary/[0.02] to-transparent", children: [_jsxs(CardHeader, { className: "pb-3", children: [_jsxs(CardTitle, { className: "text-base flex items-center gap-2", children: [_jsx(CandlestickChart, { className: "h-5 w-5 text-primary" }), "Chart Data Downloader", _jsxs(Badge, { variant: "outline", className: "text-[11px] h-5 px-1.5 ml-auto", children: [selectedCount, "/", totalSymbols, " selected"] })] }), _jsx(CardDescription, { className: "text-xs", children: "Download OHLCV chart data for all F&O stocks and indices. Select timeframe and interval, then batch download to local database for offline charting." })] }), _jsxs(CardContent, { className: "space-y-4", children: [_jsxs("div", { className: "grid grid-cols-2 gap-3", children: [_jsxs("div", { className: "space-y-1.5", children: [_jsxs(Label, { className: "text-xs text-muted-foreground flex items-center gap-1", children: [_jsx(Clock, { className: "h-3 w-3" }), " Timeframe (Date Range)"] }), _jsxs(Select, { value: timeframe, onValueChange: setTimeframe, disabled: isDownloading, children: [_jsx(SelectTrigger, { className: "h-8 text-xs", children: _jsx(SelectValue, {}) }), _jsx(SelectContent, { children: TIMEFRAMES.map(tf => (_jsx(SelectItem, { value: tf.value, className: "text-xs", children: tf.label }, tf.value))) })] })] }), _jsxs("div", { className: "space-y-1.5", children: [_jsxs(Label, { className: "text-xs text-muted-foreground flex items-center gap-1", children: [_jsx(BarChart3, { className: "h-3 w-3" }), " Candle Interval"] }), _jsxs(Select, { value: interval, onValueChange: setInterval, disabled: isDownloading, children: [_jsx(SelectTrigger, { className: "h-8 text-xs", children: _jsx(SelectValue, {}) }), _jsx(SelectContent, { children: INTERVALS.map(iv => (_jsx(SelectItem, { value: iv.value, className: "text-xs", children: iv.label }, iv.value))) })] })] })] }), _jsxs("div", { className: "space-y-2", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsxs("div", { className: "relative flex-1", children: [_jsx(Search, { className: "absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" }), _jsx(Input, { placeholder: "Search symbols...", value: search, onChange: e => setSearch(e.target.value), className: "h-7 text-xs pl-7", disabled: isDownloading })] }), _jsxs(Button, { variant: "outline", size: "sm", className: "h-7 text-xs gap-1", onClick: selectAll, disabled: isDownloading, children: [_jsx(CheckSquare, { className: "h-3 w-3" }), " All"] }), _jsxs(Button, { variant: "outline", size: "sm", className: "h-7 text-xs gap-1", onClick: selectIndices, disabled: isDownloading, children: [_jsx(TrendingUp, { className: "h-3 w-3" }), " Indices"] }), _jsxs(Button, { variant: "outline", size: "sm", className: "h-7 text-xs gap-1", onClick: deselectAll, disabled: isDownloading, children: [_jsx(Square, { className: "h-3 w-3" }), " None"] })] }), _jsx(ScrollArea, { className: "h-[180px] rounded-md border p-2", children: _jsx("div", { className: "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-1", children: filteredSymbols.map(sym => {
                                        const result = results.find(r => r.symbol === sym.symbol);
                                        const statusIcon = result?.status === "done"
                                            ? _jsx(CheckCircle2, { className: "h-3 w-3 text-bullish" })
                                            : result?.status === "error"
                                                ? _jsx(XCircle, { className: "h-3 w-3 text-bearish" })
                                                : result?.status === "downloading"
                                                    ? _jsx(Loader2, { className: "h-3 w-3 animate-spin text-primary" })
                                                    : null;
                                        return (_jsxs("label", { className: `flex items-center gap-1.5 px-2 py-1 rounded text-[11px] cursor-pointer transition-colors border ${selectedSymbols.has(sym.symbol)
                                                ? "bg-primary/5 border-primary/20 text-foreground"
                                                : "border-transparent text-muted-foreground hover:text-foreground"} ${currentSymbol === sym.symbol ? "ring-1 ring-primary" : ""}`, children: [_jsx(Checkbox, { checked: selectedSymbols.has(sym.symbol), onCheckedChange: () => toggleSymbol(sym.symbol), disabled: isDownloading, className: "h-3 w-3" }), _jsx("span", { className: "font-mono font-medium truncate", children: sym.symbol }), sym.category === "Index" && (_jsx(Badge, { variant: "outline", className: "text-[11px] h-3 px-1 shrink-0", children: "IDX" })), statusIcon] }, sym.symbol));
                                    }) }) })] }), isDownloading && (_jsxs("div", { className: "space-y-2 p-3 rounded-lg bg-card border animate-in fade-in", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("span", { className: "text-xs font-medium flex items-center gap-1.5", children: [_jsx(Loader2, { className: "h-3.5 w-3.5 animate-spin text-primary" }), "Downloading ", currentSymbol, "..."] }), _jsxs("span", { className: "text-xs text-muted-foreground font-mono", children: [currentIndex, "/", selectedCount, " \u2014 ", Math.round(progressPct), "%"] })] }), _jsx(Progress, { value: progressPct, className: "h-1.5" }), _jsxs("p", { className: "text-xs text-muted-foreground", children: ["\u2705 ", doneCount, " done \u00B7 \u274C ", errorCount, " failed \u00B7 \u23F3 ", selectedCount - currentIndex, " remaining"] })] })), !isDownloading && results.length > 0 && (_jsxs("div", { className: "space-y-2 p-3 rounded-lg bg-card border", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("span", { className: "text-xs font-medium flex items-center gap-1.5", children: [_jsx(CheckCircle2, { className: "h-3.5 w-3.5 text-bullish" }), "Download Complete"] }), _jsxs(Badge, { variant: "outline", className: "text-xs", children: [doneCount, " success \u00B7 ", errorCount, " errors \u00B7 ", results.reduce((s, r) => s + r.candles, 0).toLocaleString(), " candles"] })] }), errorCount > 0 && (_jsxs("div", { className: "text-xs text-bearish", children: ["Failed: ", results.filter(r => r.status === "error").map(r => r.symbol).join(", ")] }))] })), _jsx("div", { className: "flex gap-2", children: _jsx(Button, { onClick: handleDownload, disabled: isDownloading || selectedCount === 0, className: "flex-1 gap-2", size: "sm", children: isDownloading ? (_jsxs(_Fragment, { children: [_jsx(Loader2, { className: "h-3.5 w-3.5 animate-spin" }), "Downloading... (", currentIndex, "/", selectedCount, ")"] })) : (_jsxs(_Fragment, { children: [_jsx(Download, { className: "h-3.5 w-3.5" }), "Download ", selectedCount, " Symbols (", timeframe, " / ", INTERVALS.find(i => i.value === interval)?.label, ")"] })) }) }), _jsxs("div", { className: "space-y-1.5", children: [_jsx("p", { className: "text-xs font-medium text-muted-foreground", children: "Download Details:" }), _jsx("div", { className: "grid grid-cols-2 gap-1.5", children: [
                                    { icon: _jsx(Database, { className: "h-2.5 w-2.5" }), text: "Stored in IndexedDB (offline access)" },
                                    { icon: _jsx(CandlestickChart, { className: "h-2.5 w-2.5" }), text: `${TIMEFRAMES.find(t => t.value === timeframe)?.label} of OHLCV candles` },
                                    { icon: _jsx(BarChart3, { className: "h-2.5 w-2.5" }), text: `${INTERVALS.find(i => i.value === interval)?.label} interval candles` },
                                    { icon: _jsx(FileDown, { className: "h-2.5 w-2.5" }), text: "Export individual symbols as CSV" },
                                ].map((item, i) => (_jsxs("div", { className: "flex items-center gap-1.5 text-xs text-muted-foreground", children: [item.icon, _jsx("span", { children: item.text })] }, i))) })] })] })] }));
}
