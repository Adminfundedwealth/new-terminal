import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger } from "@/components/ui/context-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Crosshair, Wifi, WifiOff, RefreshCw, Bell, TrendingUp, TrendingDown, Layers, ChevronLeft, ChevronRight, Settings2, Flame, Search, X, Download, BarChart3, History, Keyboard } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useLiveOptionChain } from "@/hooks/useMarketData";
import { StockChart } from "@/components/StockChart";
import { toast } from "sonner";
import { useInstrumentLookup } from "@/hooks/useLocalDatabase";
import { classifyInstrument } from "@/lib/instrumentClassification";
import { requestTerminalMarketData, resolveTerminalMarketDataProvider } from "@/lib/terminalApi";
import { useAccountContext } from "@/hooks/useAccountContext";
// ── Symbol categories for organized browsing ──
const SYMBOL_CATEGORIES = [
    {
        label: "Indices",
        symbols: [
            { label: "NIFTY 50", value: "NIFTY" },
            { label: "BANK NIFTY", value: "BANKNIFTY" },
            { label: "FIN NIFTY", value: "FINNIFTY" },
            { label: "MIDCAP NIFTY", value: "MIDCPNIFTY" },
        ],
    },
    {
        label: "Nifty 50 Stocks",
        symbols: [
            "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK", "HINDUNILVR",
            "SBIN", "BHARTIARTL", "ITC", "KOTAKBANK", "LT", "AXISBANK",
            "ASIANPAINT", "MARUTI", "TATAMOTORS", "SUNPHARMA", "TITAN",
            "WIPRO", "ULTRACEMCO", "BAJFINANCE", "HCLTECH", "NTPC",
            "POWERGRID", "ONGC", "ADANIENT", "ADANIPORTS", "COALINDIA",
            "DRREDDY", "NESTLEIND", "CIPLA", "BAJAJFINSV", "GRASIM",
            "JSWSTEEL", "BRITANNIA", "TECHM", "INDUSINDBK",
            "BPCL", "HEROMOTOCO", "TATASTEEL", "SBILIFE", "HDFCLIFE",
            "SHRIRAMFIN", "TRENT", "BAJAJ-AUTO",
        ].map(s => ({ label: s, value: s })),
    },
    {
        label: "Banking & Finance",
        symbols: [
            "BANKBARODA", "PNB", "CANBK", "IDFCFIRSTB", "FEDERALBNK",
            "BANDHANBNK", "RBLBANK", "AUBANK", "MANAPPURAM", "MUTHOOTFIN",
            "CHOLAFIN", "LICHSGFIN", "CANFINHOME", "ICICIGI", "ICICIPRULI",
            "HDFCAMC", "SBICARD", "RECLTD", "PFC",
        ].map(s => ({ label: s, value: s })),
    },
    {
        label: "IT & Technology",
        symbols: [
            "LTIM", "MPHASIS", "COFORGE", "PERSISTENT", "LTTS",
            "HAPPSTMNDS", "TATAELXSI", "DIXON",
        ].map(s => ({ label: s, value: s })),
    },
    {
        label: "Pharma & Healthcare",
        symbols: [
            "TORNTPHARM", "LUPIN", "AUROPHARMA", "BIOCON", "ALKEM",
            "IPCALAB", "LALPATHLAB", "METROPOLIS", "ABBOTINDIA", "SYNGENE", "GLENMARK",
        ].map(s => ({ label: s, value: s })),
    },
    {
        label: "Auto & Ancillary",
        symbols: [
            "ASHOKLEY", "ESCORTS", "TVSMOTOR", "MRF", "MOTHERSON",
            "EXIDEIND", "BALKRISIND", "BHARATFORG",
        ].map(s => ({ label: s, value: s })),
    },
    {
        label: "Metals & Mining",
        symbols: [
            "VEDL", "JINDALSTEL", "SAIL", "NMDC", "NATIONALUM",
            "MOIL", "HINDALCO", "TATASTEEL",
        ].map(s => ({ label: s, value: s })),
    },
    {
        label: "Energy & Oil",
        symbols: [
            "IOC", "GAIL", "PETRONET", "IGL", "MGL", "PIIND", "NHPC", "TATAPOWER",
        ].map(s => ({ label: s, value: s })),
    },
    {
        label: "Defence & PSU",
        symbols: [
            "HAL", "BEL", "BHEL", "IRCTC", "IRFC", "RVNL", "CONCOR", "SUZLON",
        ].map(s => ({ label: s, value: s })),
    },
    {
        label: "Infra & Capital Goods",
        symbols: [
            "SIEMENS", "ABB", "CUMMINSIND", "VOLTAS", "HAVELLS",
            "CROMPTON", "POLYCAB", "ADANIGREEN", "ADANITRANS",
        ].map(s => ({ label: s, value: s })),
    },
    {
        label: "FMCG & Consumer",
        symbols: [
            "GODREJCP", "DABUR", "MARICO", "COLPAL", "EMAMILTD", "UBL",
            "PAGEIND", "BATAINDIA", "JUBLFOOD",
        ].map(s => ({ label: s, value: s })),
    },
    {
        label: "Real Estate",
        symbols: [
            "DLF", "GODREJPROP", "OBEROIRLTY", "PRESTIGE", "BRIGADE", "PHOENIXLTD",
        ].map(s => ({ label: s, value: s })),
    },
    {
        label: "New Age & Others",
        symbols: [
            "ZOMATO", "PAYTM", "NYKAA", "POLICYBZR", "DELHIVERY", "INDIGO",
            "MCX", "PVRINOX", "SUNTV", "ZEEL", "IDEA",
        ].map(s => ({ label: s, value: s })),
    },
];
// Flat list for search
const ALL_SYMBOLS = SYMBOL_CATEGORIES.flatMap(cat => cat.symbols);
// ── Searchable Symbol Selector Component ──
function SymbolSearch({ value, onSelect, categories }) {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState("");
    const inputRef = useRef(null);
    const filtered = useMemo(() => {
        if (!search)
            return categories;
        const q = search.toUpperCase();
        return categories
            .map(cat => ({
            ...cat,
            symbols: cat.symbols.filter(s => s.value.includes(q) || s.label.toUpperCase().includes(q)),
        }))
            .filter(cat => cat.symbols.length > 0);
    }, [categories, search]);
    const currentLabel = categories.flatMap(cat => cat.symbols).find(s => s.value === value)?.label || value;
    useEffect(() => {
        if (open && inputRef.current) {
            setTimeout(() => inputRef.current?.focus(), 100);
        }
    }, [open]);
    return (_jsxs(Popover, { open: open, onOpenChange: setOpen, children: [_jsx(PopoverTrigger, { asChild: true, children: _jsxs(Button, { variant: "outline", className: "w-[160px] h-8 text-xs font-medium justify-between gap-1", role: "combobox", children: [_jsx("span", { className: "truncate", children: currentLabel }), _jsx(Search, { className: "h-3 w-3 shrink-0 opacity-50" })] }) }), _jsxs(PopoverContent, { className: "w-[280px] p-0", align: "start", children: [_jsxs("div", { className: "flex items-center border-b px-3 py-2 gap-2", children: [_jsx(Search, { className: "h-3.5 w-3.5 text-muted-foreground shrink-0" }), _jsx(Input, { ref: inputRef, value: search, onChange: e => setSearch(e.target.value), placeholder: "Search F&O symbols...", className: "h-7 border-0 p-0 text-xs focus-visible:ring-0 shadow-none" }), search && (_jsx(Button, { variant: "ghost", size: "icon", className: "h-5 w-5 shrink-0", onClick: () => setSearch(""), children: _jsx(X, { className: "h-3 w-3" }) }))] }), _jsx(ScrollArea, { className: "h-[320px]", children: _jsx("div", { className: "p-1", children: filtered.length === 0 ? (_jsx("p", { className: "text-xs text-muted-foreground text-center py-4", children: "No symbols found" })) : (filtered.map(cat => (_jsxs("div", { children: [_jsx("p", { className: "text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-2 py-1.5 sticky top-0 bg-popover", children: cat.label }), _jsx("div", { className: "grid grid-cols-3 gap-0.5", children: cat.symbols.map(s => (_jsx("button", { onClick: () => { onSelect(s.value); setOpen(false); setSearch(""); }, className: `text-xs px-2 py-1.5 rounded text-left transition-colors hover:bg-accent ${s.value === value ? "bg-primary/10 text-primary font-semibold" : ""}`, children: s.label }, s.value))) })] }, cat.label)))) }) })] })] }));
}
// ── Volume Bar ──
function VolumeBar({ value, max, side }) {
    const pct = Math.min((value / max) * 100, 100);
    return (_jsxs("div", { className: "flex items-center gap-1.5", children: [_jsx("span", { className: `text-xs font-mono tabular-nums ${value > max * 0.7 ? (side === "call" ? "text-primary font-semibold" : "text-bearish font-semibold") : ""}`, children: value >= 1000000 ? (value / 1000000).toFixed(1) + "M" : value >= 1000 ? (value / 1000).toFixed(0) + "K" : value.toLocaleString("en-IN") }), _jsx("div", { className: "w-[50px] h-[6px] rounded-sm bg-muted/40 overflow-hidden", children: _jsx("div", { className: `h-full rounded-sm transition-all ${side === "call" ? "bg-primary/60" : "bg-bearish/50"}`, style: { width: `${pct}%` } }) })] }));
}
// ── OI Bar (colored by value intensity with smooth animations) ──
function OIBar({ value, max, side }) {
    const pct = Math.min((value / max) * 100, 100);
    const isHigh = pct > 60;
    const isMega = pct > 85;
    const opacity = 0.25 + (pct / 100) * 0.65; // Scale from 0.25 to 0.9
    return (_jsxs("div", { className: "flex items-center gap-1.5 group", title: `${value.toLocaleString("en-IN")} (${pct.toFixed(1)}% of max)`, children: [_jsx("span", { className: `text-xs font-mono tabular-nums transition-colors ${isHigh ? (side === "call" ? "text-primary font-semibold" : "text-bearish font-semibold") : ""}`, children: value >= 1000000 ? (value / 1000000).toFixed(1) + "M" : (value / 1000).toFixed(0) + "K" }), _jsx("div", { className: `w-[55px] h-[7px] rounded-sm overflow-hidden ${side === "call" ? "bg-primary/8" : "bg-bearish/8"}`, children: _jsx("div", { className: `h-full rounded-sm transition-all duration-500 ease-out ${side === "call"
                        ? isMega ? "bg-primary shadow-[0_0_6px_hsl(var(--primary)/0.4)]" : "bg-primary"
                        : isMega ? "bg-bearish shadow-[0_0_6px_hsl(var(--bearish)/0.4)]" : "bg-bearish"}`, style: { width: `${pct}%`, opacity } }) })] }));
}
export default function OptionChain({ defaultMarketView = "stocks" }) {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { activeAccountId, accounts } = useAccountContext();
    const { instruments: masterInstruments, isLoaded: isMasterLoaded } = useInstrumentLookup();
    const indexSymbols = new Set(["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"]);
    const stockSymbols = new Set(ALL_SYMBOLS.filter(s => !indexSymbols.has(s.value)).map(s => s.value));
    const [marketView, setMarketView] = useState(defaultMarketView);
    const [symbol, setSymbol] = useState(searchParams.get("symbol") || (defaultMarketView === "indices" ? "NIFTY" : "RELIANCE"));
    const [selectedExpiry, setSelectedExpiry] = useState(undefined);
    const [viewMode, setViewMode] = useState("expiration");
    const [selectedStrike, setSelectedStrike] = useState(null);
    const [columnConfig, setColumnConfig] = useState({
        iv: true, delta: true, gamma: false, theta: false, vega: false, rho: false,
        intrinsic: false, timeValue: false, bid: true, ask: true, price: true,
        volume: true, oi: true, oiChange: true,
    });
    const atmRef = useRef(null);
    const strikeScrollRef = useRef(null);
    const [showChart, setShowChart] = useState(false);
    const [isDownloadingPast, setIsDownloadingPast] = useState(false);
    const [focusedStrikeIdx, setFocusedStrikeIdx] = useState(-1);
    useEffect(() => {
        const routeSymbol = searchParams.get("symbol");
        if (!routeSymbol)
            return;
        const isIndex = indexSymbols.has(routeSymbol);
        setSymbol(routeSymbol);
        setMarketView(isIndex ? "indices" : "stocks");
        setSelectedExpiry(undefined);
    }, [searchParams]);
    useEffect(() => {
        if (searchParams.get("symbol"))
            return;
        setMarketView(defaultMarketView);
        if (defaultMarketView === "indices") {
            setSymbol(current => indexSymbols.has(current) ? current : "NIFTY");
        }
        else {
            setSymbol(current => stockSymbols.has(current) ? current : "RELIANCE");
        }
    }, [defaultMarketView]);
    const visibleCategories = useMemo(() => {
        if (isMasterLoaded) {
            const category = marketView === "indices" ? "indices" : "stocks";
            const symbols = masterInstruments
                .filter(instrument => classifyInstrument(instrument) === category)
                .reduce((result, instrument) => {
                if (!result.some(item => item.value === instrument.symbol)) {
                    result.push({ label: instrument.symbol, value: instrument.symbol });
                }
                return result;
            }, [])
                .sort((a, b) => a.label.localeCompare(b.label));
            if (symbols.length > 0)
                return [{ label: marketView === "indices" ? "Indices" : "Stocks", symbols }];
        }
        return marketView === "indices"
            ? SYMBOL_CATEGORIES.filter(cat => cat.label === "Indices")
            : SYMBOL_CATEGORIES.filter(cat => cat.label !== "Indices");
    }, [isMasterLoaded, masterInstruments, marketView]);
    const quickTrade = useCallback((strike, type, action) => {
        navigate(`/strategy-builder?${new URLSearchParams({ symbol, strike: String(strike), type, action })}`);
    }, [symbol, navigate]);
    const { data, isLoading, refetch } = useLiveOptionChain(symbol, selectedExpiry);
    const marketDataProvider = resolveTerminalMarketDataProvider(accounts.find((account) => account.id === activeAccountId)?.broker_provider);
    const chain = useMemo(() => data?.chain ?? [], [data]);
    const expiries = useMemo(() => data?.expiries ?? [], [data]);
    const spotPrice = data?.spotPrice ?? 0;
    const lotSize = data?.lotSize ?? 25;
    const stepSize = data?.stepSize ?? 50;
    const maxPain = data?.maxPain ?? 0;
    const isLive = data?.isLive ?? false;
    const afterHours = data?.afterHours ?? false;
    const hasData = chain.length > 0;
    const greeksAvailable = data?.greeksAvailable !== false;
    const formatGreek = (value, digits = 2) => greeksAvailable ? value.toFixed(digits) : "—";
    const openOptionChart = useCallback(async (strike, type) => {
        const expiry = selectedExpiry || expiries[0]?.value;
        if (!expiry) {
            toast.error("No option expiry is available to chart");
            return;
        }
        const matchesContract = (instrument) => instrument.symbol === symbol &&
            instrument.expiryDate === expiry &&
            instrument.strikePrice === strike &&
            instrument.optionType === type;
        try {
            if (!marketDataProvider) {
                toast.error("Connect a Terminal OS market-data account to chart live option contracts");
                return;
            }
            const contract = masterInstruments.find((instrument) => matchesContract(instrument) &&
                (instrument.provider === marketDataProvider || (marketDataProvider === "kite" && instrument.provider === "zerodha")));
            if (!contract?.tradingSymbol) {
                toast.error(`Terminal OS instrument cache has no ${symbol} ${strike} ${type} contract for ${expiry}`);
                return;
            }
            const params = new URLSearchParams({
                workspace: "options",
                contract: contract.tradingSymbol,
                underlying: symbol,
                expiry,
                instrumentToken: contract.providerInstrumentId || contract.securityId,
            });
            navigate(`/stocks?${params.toString()}`);
        }
        catch (error) {
            toast.error(error instanceof Error ? error.message : "Unable to resolve the option contract");
        }
    }, [selectedExpiry, expiries, masterInstruments, symbol, navigate, marketDataProvider]);
    const atmStrike = useMemo(() => Math.round(spotPrice / stepSize) * stepSize, [spotPrice, stepSize]);
    const totalCEOI = chain.reduce((s, o) => s + o.ce.oi, 0);
    const totalPEOI = chain.reduce((s, o) => s + o.pe.oi, 0);
    const pcr = totalCEOI > 0 ? (totalPEOI / totalCEOI).toFixed(2) : "0";
    const maxOI = Math.max(...chain.map(o => Math.max(o.ce.oi, o.pe.oi)), 1);
    const maxVol = Math.max(...chain.map(o => Math.max(o.ce.volume, o.pe.volume)), 1);
    const totalCEVol = chain.reduce((s, o) => s + o.ce.volume, 0);
    const totalPEVol = chain.reduce((s, o) => s + o.pe.volume, 0);
    const atmRow = chain.find(o => o.strikePrice === atmStrike);
    // ── Unusual Activity Detection: volume > 3x average OI ratio ──
    const unusualActivity = useMemo(() => {
        if (chain.length === 0)
            return { flags: new Map(), count: 0, hotStrikes: [] };
        const avgCEOI = totalCEOI / chain.length || 1;
        const avgPEOI = totalPEOI / chain.length || 1;
        const flags = new Map();
        const hotStrikes = [];
        chain.forEach(row => {
            const ceUnusual = row.ce.volume > avgCEOI * 3 && row.ce.volume > 50000;
            const peUnusual = row.pe.volume > avgPEOI * 3 && row.pe.volume > 50000;
            if (ceUnusual || peUnusual) {
                flags.set(row.strikePrice, { ce: ceUnusual, pe: peUnusual });
                hotStrikes.push(row.strikePrice);
            }
        });
        return { flags, count: flags.size, hotStrikes };
    }, [chain, totalCEOI, totalPEOI]);
    useEffect(() => {
        if (chain.length > 0 && atmRef.current && viewMode === "expiration") {
            setTimeout(() => atmRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 300);
        }
    }, [chain.length, viewMode]);
    useEffect(() => {
        if (chain.length > 0 && !selectedStrike)
            setSelectedStrike(atmStrike);
    }, [chain.length, atmStrike, selectedStrike]);
    const scrollToATM = useCallback(() => {
        if (viewMode === "expiration") {
            atmRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        else {
            setSelectedStrike(atmStrike);
        }
    }, [viewMode, atmStrike]);
    const handleContextAction = (strike, type, action) => {
        switch (action) {
            case "buy":
                quickTrade(strike, type, "BUY");
                break;
            case "sell":
                quickTrade(strike, type, "SELL");
                break;
            case "straddle":
                toast.success(`Added ${strike} Straddle to Strategy Builder`);
                navigate(`/strategy-builder?symbol=${symbol}&strike=${strike}&type=CE&action=BUY`);
                break;
            case "alert":
                toast.success(`Alert set for ${symbol} ${strike} ${type}`);
                break;
            case "oi-analysis":
                navigate(`/oi-analysis`);
                break;
        }
    };
    // Compute intrinsic + time values
    const enrichedChain = useMemo(() => chain.map(row => {
        const ceIntrinsic = Math.max(spotPrice - row.strikePrice, 0);
        const peIntrinsic = Math.max(row.strikePrice - spotPrice, 0);
        return {
            ...row,
            ce: { ...row.ce, intrinsic: ceIntrinsic, timeValue: Math.max(row.ce.ltp - ceIntrinsic, 0) },
            pe: { ...row.pe, intrinsic: peIntrinsic, timeValue: Math.max(row.pe.ltp - peIntrinsic, 0) },
        };
    }), [chain, spotPrice]);
    // "By Strike" view shows the selected strike from the currently loaded expiry only.
    const byStrikeData = useMemo(() => {
        if (!selectedStrike)
            return [];
        const row = enrichedChain.find(r => r.strikePrice === selectedStrike);
        if (!row)
            return [];
        const activeExpiry = expiries.find((expiry) => expiry.value === selectedExpiry) ?? expiries[0];
        return [{
                expiry: activeExpiry?.label ?? activeExpiry?.value ?? "—",
                daysToExpiry: activeExpiry?.daysToExpiry ?? 0,
                ce: { ...row.ce, bid: row.ce.bidPrice, ask: row.ce.askPrice },
                pe: { ...row.pe, bid: row.pe.bidPrice, ask: row.pe.askPrice },
            }];
    }, [selectedStrike, enrichedChain, expiries, selectedExpiry]);
    const allStrikes = enrichedChain.map(r => r.strikePrice);
    // ── Keyboard Navigation: J/K to move, G to jump to ATM ──
    useEffect(() => {
        if (viewMode !== "expiration" || !hasData)
            return;
        const handler = (e) => {
            const target = e.target;
            if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
                return;
            if (e.key === "j" || e.key === "ArrowDown") {
                e.preventDefault();
                setFocusedStrikeIdx(prev => Math.min(prev + 1, enrichedChain.length - 1));
            }
            else if (e.key === "k" || e.key === "ArrowUp") {
                e.preventDefault();
                setFocusedStrikeIdx(prev => Math.max(prev - 1, 0));
            }
            else if (e.key === "g") {
                const atmIdx = enrichedChain.findIndex(r => r.strikePrice === atmStrike);
                if (atmIdx >= 0) {
                    setFocusedStrikeIdx(atmIdx);
                    scrollToATM();
                }
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [viewMode, hasData, enrichedChain, atmStrike, scrollToATM]);
    // ── CSV Download: Export current option chain ──
    const downloadCSV = useCallback(() => {
        if (enrichedChain.length === 0) {
            toast.error("No data to export");
            return;
        }
        const expLabel = expiries.find(e => e.value === (selectedExpiry || expiries[0]?.value))?.label || "current";
        const headers = ["Strike", "CE_LTP", "CE_IV", "CE_Delta", "CE_Gamma", "CE_Theta", "CE_Vega", "CE_OI", "CE_Volume", "CE_Bid", "CE_Ask", "PE_LTP", "PE_IV", "PE_Delta", "PE_Gamma", "PE_Theta", "PE_Vega", "PE_OI", "PE_Volume", "PE_Bid", "PE_Ask"];
        const rows = enrichedChain.map(r => [
            r.strikePrice, r.ce.ltp, r.ce.iv, r.ce.delta, r.ce.gamma, r.ce.theta, r.ce.vega, r.ce.oi, r.ce.volume, r.ce.bidPrice, r.ce.askPrice,
            r.pe.ltp, r.pe.iv, r.pe.delta, r.pe.gamma, r.pe.theta, r.pe.vega, r.pe.oi, r.pe.volume, r.pe.bidPrice, r.pe.askPrice,
        ].join(","));
        const csv = [headers.join(","), ...rows].join("\n");
        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${symbol}_${expLabel.replace(/\s+/g, "_")}_option_chain.csv`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success(`Exported ${enrichedChain.length} strikes to CSV`);
    }, [enrichedChain, symbol, expiries, selectedExpiry]);
    // ── Download a past option chain through Terminal OS ──
    const downloadPastOC = useCallback(async (pastExpiry) => {
        setIsDownloadingPast(true);
        try {
            if (!activeAccountId || !marketDataProvider)
                throw new Error("An active Terminal OS market-data account is required.");
            const chainData = await requestTerminalMarketData(activeAccountId, marketDataProvider, { operation: "getOptionChain", underlying: symbol, expiry: pastExpiry });
            const headers = ["Strike", "CE_LTP", "CE_IV", "CE_OI", "CE_Volume", "CE_Delta", "CE_Bid", "CE_Ask", "PE_LTP", "PE_IV", "PE_OI", "PE_Volume", "PE_Delta", "PE_Bid", "PE_Ask"];
            const rows = chainData.chain.map((row) => [row.strikePrice, row.ce.ltp, row.ce.iv, row.ce.oi, row.ce.volume, row.ce.delta, row.ce.bidPrice, row.ce.askPrice, row.pe.ltp, row.pe.iv, row.pe.oi, row.pe.volume, row.pe.delta, row.pe.bidPrice, row.pe.askPrice].join(","));
            const csv = [headers.join(","), ...rows].join("\n");
            const blob = new Blob([csv], { type: "text/csv" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${symbol}_${pastExpiry}_option_chain.csv`;
            a.click();
            URL.revokeObjectURL(url);
            toast.success(`Exported ${rows.length} strikes for ${pastExpiry}`);
        }
        catch (err) {
            toast.error(`Failed to download: ${err.message}`);
        }
        finally {
            setIsDownloadingPast(false);
        }
    }, [activeAccountId, marketDataProvider, symbol]);
    // Active columns count for colSpan
    const callCols = [columnConfig.iv, columnConfig.intrinsic, columnConfig.timeValue, columnConfig.rho, columnConfig.vega, columnConfig.theta, columnConfig.gamma, columnConfig.delta, columnConfig.price, columnConfig.ask, columnConfig.bid, columnConfig.volume].filter(Boolean).length;
    const putCols = callCols;
    return (_jsxs("div", { className: "space-y-2.5 lg:space-y-3", children: [_jsxs("div", { className: "flex flex-col sm:flex-row sm:items-center justify-between gap-2", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx(SymbolSearch, { value: symbol, onSelect: (v) => { setSymbol(v); setSelectedExpiry(undefined); }, categories: visibleCategories }), _jsxs(ToggleGroup, { type: "single", value: marketView, onValueChange: (v) => v && setMarketView(v), className: "bg-muted rounded-md p-0.5", children: [_jsx(ToggleGroupItem, { value: "stocks", className: "text-xs h-7 px-3 data-[state=on]:bg-background data-[state=on]:shadow-sm rounded", children: "Stocks" }), _jsx(ToggleGroupItem, { value: "indices", className: "text-xs h-7 px-3 data-[state=on]:bg-background data-[state=on]:shadow-sm rounded", children: "Indices" })] }), _jsxs(ToggleGroup, { type: "single", value: viewMode, onValueChange: (v) => v && setViewMode(v), className: "bg-muted rounded-md p-0.5", children: [_jsx(ToggleGroupItem, { value: "expiration", className: "text-xs h-7 px-3 data-[state=on]:bg-background data-[state=on]:shadow-sm rounded", children: "By expiration" }), _jsx(ToggleGroupItem, { value: "strike", className: "text-xs h-7 px-3 data-[state=on]:bg-background data-[state=on]:shadow-sm rounded", children: "By strike" })] })] }), _jsxs("div", { className: "flex items-center gap-1.5", children: [_jsxs(Badge, { variant: "outline", className: `gap-1 text-[11px] ${isLive ? "border-bullish/50 text-bullish" : afterHours ? "border-amber-500/50 text-amber-400" : "border-red-500/30 text-red-400"}`, children: [isLive ? _jsx(Wifi, { className: "h-3 w-3" }) : _jsx(WifiOff, { className: "h-3 w-3" }), isLive ? (data?.source === "zerodha" ? "KITE" : data?.source?.toUpperCase() ?? "LIVE") : afterHours ? "CLOSED" : "OFFLINE"] }), _jsxs("span", { className: "text-xs font-mono", children: [symbol, " ", _jsx("span", { className: "font-semibold text-foreground", children: spotPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 }) }), afterHours && _jsx("span", { className: "text-amber-400/60 ml-1 text-xs", children: "(Last Close)" })] }), _jsx(Button, { variant: "ghost", size: "icon", className: "h-7 w-7", onClick: () => refetch(), children: _jsx(RefreshCw, { className: "h-3.5 w-3.5" }) }), _jsx(Button, { variant: "ghost", size: "icon", className: "h-7 w-7", onClick: scrollToATM, children: _jsx(Crosshair, { className: "h-3.5 w-3.5" }) }), _jsx(Button, { variant: "ghost", size: "icon", className: "h-7 w-7", onClick: () => setShowChart(v => !v), title: "Toggle Price Chart", children: _jsx(BarChart3, { className: `h-3.5 w-3.5 ${showChart ? "text-primary" : ""}` }) }), _jsx(Button, { variant: "ghost", size: "icon", className: "h-7 w-7", onClick: downloadCSV, title: "Download CSV", children: _jsx(Download, { className: "h-3.5 w-3.5" }) }), _jsxs(Popover, { children: [_jsx(PopoverTrigger, { asChild: true, children: _jsx(Button, { variant: "ghost", size: "icon", className: "h-7 w-7", title: "Download Past Option Chain", children: _jsx(History, { className: "h-3.5 w-3.5" }) }) }), _jsxs(PopoverContent, { className: "w-56 p-3", align: "end", children: [_jsx("p", { className: "text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider", children: "Download Past Expiry" }), _jsx("div", { className: "space-y-1", children: expiries.map(exp => (_jsxs("button", { onClick: () => downloadPastOC(exp.value), disabled: isDownloadingPast, className: "w-full text-left px-2 py-1.5 rounded text-xs hover:bg-accent transition-colors flex items-center justify-between", children: [_jsxs("span", { children: [exp.label, " (", exp.daysToExpiry, "d)"] }), _jsx(Download, { className: "h-3 w-3 text-muted-foreground" })] }, exp.value))) })] })] }), _jsxs(Popover, { children: [_jsx(PopoverTrigger, { asChild: true, children: _jsx(Button, { variant: "ghost", size: "icon", className: "h-7 w-7", children: _jsx(Settings2, { className: "h-3.5 w-3.5" }) }) }), _jsxs(PopoverContent, { className: "w-48 p-3", align: "end", children: [_jsx("p", { className: "text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider", children: "Show Columns" }), _jsx("div", { className: "space-y-1.5", children: Object.entries(columnConfig).map(([key, val]) => (_jsxs("div", { className: "flex items-center justify-between", children: [_jsx(Label, { className: "text-xs capitalize", children: key === "oiChange" ? "OI Change" : key === "timeValue" ? "Time Value" : key }), _jsx(Switch, { checked: val, onCheckedChange: (v) => setColumnConfig({ ...columnConfig, [key]: v }), className: "scale-[0.6]" })] }, key))) })] })] }), _jsxs(Popover, { children: [_jsx(PopoverTrigger, { asChild: true, children: _jsx(Button, { variant: "ghost", size: "icon", className: "h-7 w-7 text-muted-foreground hover:text-primary transition-colors", title: "Keyboard Shortcuts", children: _jsx("kbd", { className: "font-mono text-[10px] px-1.5 py-0.5 rounded border border-border/50 bg-accent/30 font-semibold shadow-sm", children: "?" }) }) }), _jsxs(PopoverContent, { className: "w-64 p-4", align: "end", children: [_jsxs("p", { className: "text-[11px] font-bold text-muted-foreground mb-3 uppercase tracking-wider flex items-center gap-2", children: [_jsx(Keyboard, { className: "h-3.5 w-3.5" }), "Keyboard Shortcuts"] }), _jsxs("div", { className: "space-y-2 text-xs", children: [_jsxs("div", { className: "flex justify-between items-center", children: [_jsx("span", { className: "text-muted-foreground", children: "Focus Search" }), _jsx("kbd", { className: "px-1.5 py-0.5 rounded bg-muted border font-mono", children: "\u2318K" })] }), _jsxs("div", { className: "flex justify-between items-center", children: [_jsx("span", { className: "text-muted-foreground", children: "Refresh Data" }), _jsx("kbd", { className: "px-1.5 py-0.5 rounded bg-muted border font-mono", children: "R" })] }), _jsxs("div", { className: "flex justify-between items-center", children: [_jsx("span", { className: "text-muted-foreground", children: "Next Strike" }), _jsx("kbd", { className: "px-1.5 py-0.5 rounded bg-muted border font-mono", children: "J" })] }), _jsxs("div", { className: "flex justify-between items-center", children: [_jsx("span", { className: "text-muted-foreground", children: "Prev Strike" }), _jsx("kbd", { className: "px-1.5 py-0.5 rounded bg-muted border font-mono", children: "K" })] }), _jsxs("div", { className: "flex justify-between items-center", children: [_jsx("span", { className: "text-muted-foreground", children: "Add to Strategy" }), _jsx("kbd", { className: "px-1.5 py-0.5 rounded bg-muted border font-mono", children: "A" })] })] })] })] })] })] }), showChart && (_jsx(StockChart, { symbol: symbol, inline: true, height: 280 })), viewMode === "expiration" && expiries.length > 0 && (_jsxs("div", { className: "flex items-center gap-1", children: [expiries.slice(0, 5).map((exp, i) => {
                        const parts = exp.label.split(" ");
                        const isSelected = (selectedExpiry || expiries[0]?.value) === exp.value;
                        return (_jsxs("button", { onClick: () => setSelectedExpiry(exp.value), className: `flex flex-col items-center px-3 py-1.5 rounded-md text-xs transition-all border ${isSelected
                                ? "bg-primary text-primary-foreground border-primary font-bold shadow-[0_0_15px_-3px_hsl(var(--primary)/0.5)] scale-105"
                                : "bg-card border-border hover:bg-accent/50 hover:border-primary/30"}`, children: [_jsx("span", { className: "text-xs opacity-70", children: parts[1] }), _jsx("span", { className: "font-bold text-sm leading-none", children: parts[0] })] }, exp.value));
                    }), expiries.length > 5 && (_jsxs(Select, { value: selectedExpiry || expiries[0]?.value, onValueChange: setSelectedExpiry, children: [_jsx(SelectTrigger, { className: "w-[100px] h-8 text-xs", children: _jsx(SelectValue, { placeholder: "More..." }) }), _jsx(SelectContent, { children: expiries.slice(5).map(e => (_jsxs(SelectItem, { value: e.value, children: [e.label, " (", e.daysToExpiry, "d)"] }, e.value))) })] }))] })), afterHours && (_jsxs("div", { className: "flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400", children: [_jsx(WifiOff, { className: "h-4 w-4 shrink-0" }), _jsxs("div", { className: "flex-1", children: [_jsxs("p", { className: "text-xs font-medium", children: ["Market Closed \u2014 ", hasData ? "Showing Last Available Data" : "No Cached Data Available"] }), _jsxs("p", { className: "text-xs text-amber-400/60 mt-0.5", children: [hasData
                                        ? "Data is from the last market session. PCR, Max Pain, and OI values reflect closing snapshot."
                                        : "Option chain data will be available once the market opens (9:15 AM IST) or when the proxy has cached data.", data?.cachedAt && ` Cached ${Math.round((Date.now() - Number(data.cachedAt)) / 60000)} min ago.`] })] })] })), !hasData && !afterHours && data !== undefined && (_jsxs("div", { className: "flex flex-col items-center justify-center py-16 text-muted-foreground border border-dashed border-border/50 rounded-lg bg-card/30", children: [_jsx(WifiOff, { className: "h-10 w-10 mb-3 opacity-40 animate-pulse" }), _jsx("p", { className: "text-[15px] font-semibold text-foreground", children: "Unable to load Option Chain" }), _jsxs("p", { className: "text-xs mt-1.5 max-w-sm text-center leading-relaxed", children: ["Connect Kite OAuth in Broker API Keys and confirm the market-data proxy is available on port ", _jsx("code", { className: "font-mono text-primary/70 bg-primary/10 px-1 rounded", children: "4002" }), "."] }), _jsxs(Button, { variant: "outline", size: "sm", className: "mt-5 gap-1.5 hover:text-primary hover:border-primary/50 transition-colors", onClick: () => refetch(), children: [_jsx(RefreshCw, { className: "h-3.5 w-3.5" }), "Retry Connection"] })] })), viewMode === "strike" && allStrikes.length > 0 && (_jsxs("div", { className: "flex items-center gap-1", children: [_jsx(Button, { variant: "ghost", size: "icon", className: "h-7 w-7 shrink-0", onClick: () => {
                            if (strikeScrollRef.current)
                                strikeScrollRef.current.scrollLeft -= 200;
                        }, children: _jsx(ChevronLeft, { className: "h-4 w-4" }) }), _jsxs("div", { className: "relative flex-1", children: [_jsx("p", { className: "text-[11px] text-muted-foreground text-center mb-1", children: "Strike" }), _jsx("div", { ref: strikeScrollRef, className: "flex gap-0.5 overflow-x-auto scrollbar-hide pb-1", style: { scrollBehavior: "smooth" }, children: allStrikes.map(s => {
                                    const isATM = s === atmStrike;
                                    const isSelected = s === selectedStrike;
                                    return (_jsxs("button", { onClick: () => setSelectedStrike(s), className: `shrink-0 px-2.5 py-1.5 rounded text-xs font-mono transition-colors border ${isSelected
                                            ? "bg-foreground text-background border-foreground font-bold"
                                            : isATM
                                                ? "bg-primary/10 border-primary/30 text-primary font-semibold"
                                                : "border-border hover:bg-accent"}`, children: [isATM && (_jsxs("div", { className: "text-[11px] leading-none mb-0.5 opacity-70", children: [symbol, " ", spotPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 })] })), s.toLocaleString("en-IN")] }, s));
                                }) })] }), _jsx(Button, { variant: "ghost", size: "icon", className: "h-7 w-7 shrink-0", onClick: () => {
                            if (strikeScrollRef.current)
                                strikeScrollRef.current.scrollLeft += 200;
                        }, children: _jsx(ChevronRight, { className: "h-4 w-4" }) })] })), _jsx("div", { className: "grid grid-cols-3 md:grid-cols-6 gap-1.5", children: [
                    { label: "CE OI", value: `${(totalCEOI / 100000).toFixed(1)}L` },
                    { label: "PE OI", value: `${(totalPEOI / 100000).toFixed(1)}L` },
                    { label: "CE Vol", value: `${(totalCEVol / 100000).toFixed(1)}L` },
                    { label: "PE Vol", value: `${(totalPEVol / 100000).toFixed(1)}L` },
                    { label: "Straddle", value: atmRow ? (atmRow.ce.ltp + atmRow.pe.ltp).toFixed(2) : "—", className: "text-warning" },
                    { label: "PCR", value: pcr, className: Number(pcr) > 1 ? "text-bullish" : "text-bearish" },
                ].map(stat => (_jsxs("div", { className: "bg-card rounded-md border px-2 py-1.5 text-center", children: [_jsx("p", { className: "text-xs text-muted-foreground", children: stat.label }), _jsx("p", { className: `text-xs font-bold font-mono ${stat.className || ""}`, children: stat.value })] }, stat.label))) }), unusualActivity.count > 0 && (_jsxs("div", { className: "flex items-center gap-2 px-3 py-1.5 rounded-md bg-orange-500/10 border border-orange-500/25 text-xs", children: [_jsx(Flame, { className: "h-3.5 w-3.5 text-orange-500 animate-pulse" }), _jsxs("span", { className: "font-semibold text-orange-500", children: [unusualActivity.count, " Unusual Activity"] }), _jsx("span", { className: "text-muted-foreground", children: "strikes detected (Vol > 3\u00D7 avg OI):" }), _jsx("div", { className: "flex items-center gap-1 overflow-x-auto scrollbar-hide", children: unusualActivity.hotStrikes.map(s => {
                            const flag = unusualActivity.flags.get(s);
                            return (_jsxs(Badge, { variant: "outline", className: "text-[11px] gap-1 border-orange-500/30 text-orange-500 shrink-0", children: [s.toLocaleString("en-IN"), flag.ce && _jsx("span", { className: "text-primary", children: "CE" }), flag.ce && flag.pe && _jsx("span", { className: "text-muted-foreground", children: "+" }), flag.pe && _jsx("span", { className: "text-bearish", children: "PE" })] }, s));
                        }) })] })), atmRow && viewMode === "expiration" && (_jsxs("div", { className: "sticky top-0 z-20 flex items-center justify-between gap-2 px-3 py-1 rounded bg-primary/5 border border-primary/20 text-xs font-mono", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsxs("span", { className: "font-sans font-semibold text-primary", children: ["ATM ", atmStrike] }), _jsxs("span", { children: ["CE: ", _jsx("span", { className: "text-primary font-medium", children: atmRow.ce.ltp.toFixed(2) })] }), _jsxs("span", { children: ["PE: ", _jsx("span", { className: "text-bearish font-medium", children: atmRow.pe.ltp.toFixed(2) })] }), _jsxs("span", { children: ["Straddle: ", _jsx("span", { className: "text-warning font-medium", children: (atmRow.ce.ltp + atmRow.pe.ltp).toFixed(2) })] })] }), _jsxs("div", { className: "flex items-center gap-3 text-muted-foreground", children: [_jsxs("span", { children: ["MP: ", _jsx("span", { className: "text-warning", children: maxPain.toLocaleString("en-IN") })] }), _jsxs("span", { children: ["IV: ", greeksAvailable ? ((atmRow.ce.iv + atmRow.pe.iv) / 2).toFixed(1) : "—", "%"] })] })] })), viewMode === "expiration" && (_jsx(Card, { children: _jsx(CardContent, { className: "p-0 overflow-auto max-h-[65vh]", children: isLoading ? (_jsx("div", { className: "p-4 space-y-2", children: Array.from({ length: 12 }).map((_, i) => (_jsxs("div", { className: "flex gap-2 items-center", children: [_jsx("div", { className: "flex-1 h-6 skeleton-shimmer rounded bg-muted/20", style: { animationDelay: `${i * 60}ms` } }), _jsx("div", { className: "w-16 h-6 skeleton-shimmer rounded bg-primary/5" }), _jsx("div", { className: "flex-1 h-6 skeleton-shimmer rounded bg-muted/20", style: { animationDelay: `${i * 60 + 30}ms` } })] }, i))) })) : (_jsxs(Table, { children: [_jsxs(TableHeader, { className: "sticky top-0 z-10 bg-card", children: [_jsxs(TableRow, { className: "text-xs border-b-2", children: [_jsx(TableHead, { className: "text-center text-primary font-bold", colSpan: callCols, children: "Calls" }), _jsx(TableHead, { className: "text-center font-bold bg-accent/50 border-x-2 border-border", colSpan: 2, children: "Strike \u00B7 IV%" }), _jsx(TableHead, { className: "text-center text-bearish font-bold", colSpan: putCols, children: "Puts" })] }), _jsxs(TableRow, { className: "text-[11px] text-muted-foreground", children: [columnConfig.iv && _jsx(TableHead, { className: "text-right", children: "IV%" }), columnConfig.intrinsic && _jsx(TableHead, { className: "text-right", children: "Intr." }), columnConfig.timeValue && _jsx(TableHead, { className: "text-right", children: "Time" }), columnConfig.rho && _jsx(TableHead, { className: "text-right", children: "Rho" }), columnConfig.vega && _jsx(TableHead, { className: "text-right", children: "Vega" }), columnConfig.theta && _jsx(TableHead, { className: "text-right", children: "Theta" }), columnConfig.gamma && _jsx(TableHead, { className: "text-right", children: "Gamma" }), columnConfig.delta && _jsx(TableHead, { className: "text-right", children: "Delta" }), columnConfig.price && _jsx(TableHead, { className: "text-right font-semibold text-primary", children: "Price" }), columnConfig.ask && _jsx(TableHead, { className: "text-right", children: "Ask" }), columnConfig.bid && _jsx(TableHead, { className: "text-right", children: "Bid" }), columnConfig.volume && _jsx(TableHead, { className: "text-right", children: "Volume" }), _jsx(TableHead, { className: "text-center bg-accent/50 border-l-2 border-border font-semibold", children: "\u2191 Strike" }), _jsx(TableHead, { className: "text-center bg-accent/50 border-r-2 border-border font-semibold", children: "IV%" }), columnConfig.volume && _jsx(TableHead, { className: "text-left", children: "Volume" }), columnConfig.bid && _jsx(TableHead, { className: "text-left", children: "Bid" }), columnConfig.ask && _jsx(TableHead, { className: "text-left", children: "Ask" }), columnConfig.price && _jsx(TableHead, { className: "text-left font-semibold text-bearish", children: "Price" }), columnConfig.delta && _jsx(TableHead, { className: "text-left", children: "Delta" }), columnConfig.gamma && _jsx(TableHead, { className: "text-left", children: "Gamma" }), columnConfig.theta && _jsx(TableHead, { className: "text-left", children: "Theta" }), columnConfig.vega && _jsx(TableHead, { className: "text-left", children: "Vega" }), columnConfig.rho && _jsx(TableHead, { className: "text-left", children: "Rho" }), columnConfig.timeValue && _jsx(TableHead, { className: "text-left", children: "Time" }), columnConfig.intrinsic && _jsx(TableHead, { className: "text-left", children: "Intr." }), columnConfig.iv && _jsx(TableHead, { className: "text-left", children: "IV%" })] })] }), _jsx(TableBody, { children: enrichedChain.map((row, idx) => {
                                    const isATM = row.strikePrice === atmStrike;
                                    const isITMCall = row.strikePrice < spotPrice;
                                    const isITMPut = row.strikePrice > spotPrice;
                                    const isMP = row.strikePrice === maxPain;
                                    const avgIV = greeksAvailable ? ((row.ce.iv + row.pe.iv) / 2).toFixed(1) : "—";
                                    const uaFlag = unusualActivity.flags.get(row.strikePrice);
                                    const hasUA = !!uaFlag;
                                    const isFocused = idx === focusedStrikeIdx;
                                    return (_jsxs(ContextMenu, { children: [_jsx(ContextMenuTrigger, { asChild: true, children: _jsxs(TableRow, { ref: isATM ? atmRef : undefined, className: `text-xs sm:text-[11px] font-mono cursor-context-menu transition-colors hover:bg-accent/30 ${isATM ? "bg-primary/[0.08] border-y-2 border-primary/30 shadow-[inset_0_0_20px_hsl(var(--primary)/0.06)]" : ""} ${hasUA ? "bg-orange-500/[0.04]" : ""} ${isFocused ? "ring-1 ring-primary/60 bg-primary/[0.04]" : ""}`, children: [columnConfig.iv && _jsx(TableCell, { className: `text-right py-1.5 tabular-nums ${isITMCall ? "text-muted-foreground/70" : ""}`, children: formatGreek(row.ce.iv, 1) }), columnConfig.intrinsic && _jsx(TableCell, { className: `text-right py-1.5 tabular-nums ${row.ce.intrinsic > 0 ? "" : "text-muted-foreground/50"}`, children: row.ce.intrinsic.toFixed(2) }), columnConfig.timeValue && _jsx(TableCell, { className: "text-right py-1.5 tabular-nums", children: row.ce.timeValue.toFixed(2) }), columnConfig.rho && _jsx(TableCell, { className: "text-right py-1.5 tabular-nums text-muted-foreground", children: "\u2014" }), columnConfig.vega && _jsx(TableCell, { className: "text-right py-1.5 tabular-nums", children: formatGreek(row.ce.vega) }), columnConfig.theta && _jsx(TableCell, { className: "text-right py-1.5 tabular-nums text-bearish/80", children: formatGreek(row.ce.theta) }), columnConfig.gamma && _jsx(TableCell, { className: "text-right py-1.5 tabular-nums", children: formatGreek(row.ce.gamma, 4) }), columnConfig.delta && _jsx(TableCell, { className: "text-right py-1.5 tabular-nums font-medium", children: formatGreek(row.ce.delta) }), columnConfig.price && (_jsx(TableCell, { className: "text-right py-1.5 font-semibold", children: _jsxs("div", { className: "flex items-center justify-end gap-1", children: [_jsx("button", { onClick: () => quickTrade(row.strikePrice, "CE", "BUY"), className: "hover:text-primary transition-colors", children: row.ce.ltp.toFixed(2) }), _jsx("button", { type: "button", "aria-label": `Chart ${symbol} ${row.strikePrice} CE`, title: "Chart call contract", onClick: () => void openOptionChart(row.strikePrice, "CE"), className: "inline-flex h-5 w-5 items-center justify-center rounded hover:bg-accent hover:text-primary", children: _jsx(BarChart3, { className: "h-3 w-3" }) })] }) })), columnConfig.ask && _jsx(TableCell, { className: "text-right py-1.5 tabular-nums", children: row.ce.askPrice.toFixed(2) }), columnConfig.bid && _jsx(TableCell, { className: "text-right py-1.5 tabular-nums", children: row.ce.bidPrice.toFixed(2) }), columnConfig.volume && (_jsx(TableCell, { className: "text-right py-1.5", children: _jsxs("div", { className: "flex items-center justify-end gap-0.5", children: [uaFlag?.ce && _jsx(Flame, { className: "h-3 w-3 text-orange-500 shrink-0" }), _jsx(VolumeBar, { value: row.ce.volume, max: maxVol, side: "call" })] }) })), _jsx(TableCell, { className: "text-center bg-accent/50 border-l-2 border-border py-1.5", children: _jsxs("div", { className: "flex flex-col items-center", children: [_jsxs("div", { className: "flex items-center gap-1", children: [_jsx("span", { className: `font-bold text-[11px] ${isATM ? "text-primary" : isMP ? "text-warning" : ""}`, children: row.strikePrice.toLocaleString("en-IN") }), isATM && (_jsx("span", { className: "text-[11px] font-bold bg-primary text-primary-foreground px-1 py-0 rounded-sm leading-tight", children: "ATM" }))] }), isMP && _jsx("span", { className: "text-[11px] text-warning/60 font-medium", children: "MAX PAIN" })] }) }), _jsx(TableCell, { className: "text-center py-1.5 bg-accent/50 border-r-2 border-border text-muted-foreground", children: avgIV }), columnConfig.volume && (_jsx(TableCell, { className: "text-left py-1.5", children: _jsxs("div", { className: "flex items-center gap-0.5", children: [_jsx(VolumeBar, { value: row.pe.volume, max: maxVol, side: "put" }), uaFlag?.pe && _jsx(Flame, { className: "h-3 w-3 text-orange-500 shrink-0" })] }) })), columnConfig.bid && _jsx(TableCell, { className: "text-left py-1.5 tabular-nums", children: row.pe.bidPrice.toFixed(2) }), columnConfig.ask && _jsx(TableCell, { className: "text-left py-1.5 tabular-nums", children: row.pe.askPrice.toFixed(2) }), columnConfig.price && (_jsx(TableCell, { className: "text-left py-1.5 font-semibold", children: _jsxs("div", { className: "flex items-center justify-start gap-1", children: [_jsx("button", { onClick: () => quickTrade(row.strikePrice, "PE", "BUY"), className: "hover:text-bearish transition-colors", children: row.pe.ltp.toFixed(2) }), _jsx("button", { type: "button", "aria-label": `Chart ${symbol} ${row.strikePrice} PE`, title: "Chart put contract", onClick: () => void openOptionChart(row.strikePrice, "PE"), className: "inline-flex h-5 w-5 items-center justify-center rounded hover:bg-accent hover:text-bearish", children: _jsx(BarChart3, { className: "h-3 w-3" }) })] }) })), columnConfig.delta && _jsx(TableCell, { className: "text-left py-1.5 tabular-nums font-medium", children: formatGreek(row.pe.delta) }), columnConfig.gamma && _jsx(TableCell, { className: "text-left py-1.5 tabular-nums", children: formatGreek(row.pe.gamma, 4) }), columnConfig.theta && _jsx(TableCell, { className: "text-left py-1.5 tabular-nums text-bearish/80", children: formatGreek(row.pe.theta) }), columnConfig.vega && _jsx(TableCell, { className: "text-left py-1.5 tabular-nums", children: formatGreek(row.pe.vega) }), columnConfig.rho && _jsx(TableCell, { className: "text-left py-1.5 tabular-nums text-muted-foreground", children: "\u2014" }), columnConfig.timeValue && _jsx(TableCell, { className: "text-left py-1.5 tabular-nums", children: row.pe.timeValue.toFixed(2) }), columnConfig.intrinsic && _jsx(TableCell, { className: `text-left py-1.5 tabular-nums ${row.pe.intrinsic > 0 ? "" : "text-muted-foreground/50"}`, children: row.pe.intrinsic.toFixed(2) }), columnConfig.iv && _jsx(TableCell, { className: `text-left py-1.5 tabular-nums ${isITMPut ? "text-muted-foreground/70" : ""}`, children: formatGreek(row.pe.iv, 1) })] }) }), _jsxs(ContextMenuContent, { className: "w-48", children: [_jsxs(ContextMenuSub, { children: [_jsxs(ContextMenuSubTrigger, { className: "gap-2", children: [_jsx(TrendingUp, { className: "h-3.5 w-3.5 text-primary" }), " Buy"] }), _jsxs(ContextMenuSubContent, { children: [_jsxs(ContextMenuItem, { onClick: () => handleContextAction(row.strikePrice, "CE", "buy"), className: "text-xs", children: ["Buy CE @ \u20B9", row.ce.ltp.toFixed(2)] }), _jsxs(ContextMenuItem, { onClick: () => handleContextAction(row.strikePrice, "PE", "buy"), className: "text-xs", children: ["Buy PE @ \u20B9", row.pe.ltp.toFixed(2)] })] })] }), _jsxs(ContextMenuSub, { children: [_jsxs(ContextMenuSubTrigger, { className: "gap-2", children: [_jsx(TrendingDown, { className: "h-3.5 w-3.5 text-bearish" }), " Sell"] }), _jsxs(ContextMenuSubContent, { children: [_jsxs(ContextMenuItem, { onClick: () => handleContextAction(row.strikePrice, "CE", "sell"), className: "text-xs", children: ["Sell CE @ \u20B9", row.ce.ltp.toFixed(2)] }), _jsxs(ContextMenuItem, { onClick: () => handleContextAction(row.strikePrice, "PE", "sell"), className: "text-xs", children: ["Sell PE @ \u20B9", row.pe.ltp.toFixed(2)] })] })] }), _jsx(ContextMenuSeparator, {}), _jsxs(ContextMenuItem, { onClick: () => handleContextAction(row.strikePrice, "CE", "straddle"), className: "gap-2 text-xs", children: [_jsx(Layers, { className: "h-3.5 w-3.5" }), " Build Straddle (", (row.ce.ltp + row.pe.ltp).toFixed(1), ")"] }), _jsxs(ContextMenuItem, { onClick: () => handleContextAction(row.strikePrice, "CE", "alert"), className: "gap-2 text-xs", children: [_jsx(Bell, { className: "h-3.5 w-3.5" }), " Set Alert"] })] })] }, row.strikePrice));
                                }) }), hasData && (_jsx("tfoot", { className: "sticky bottom-0 z-10 bg-card border-t-2 border-primary/20", children: _jsxs("tr", { className: "text-xs font-mono font-semibold", children: [_jsx("td", { colSpan: callCols, className: "text-right py-2 px-2", children: _jsxs("div", { className: "flex items-center justify-end gap-4", children: [_jsxs("span", { className: "text-muted-foreground", children: ["CE Vol: ", _jsx("span", { className: "text-foreground", children: totalCEVol >= 1000000 ? (totalCEVol / 1000000).toFixed(1) + 'M' : (totalCEVol / 1000).toFixed(0) + 'K' })] }), _jsxs("span", { className: "text-muted-foreground", children: ["CE OI: ", _jsx("span", { className: "text-primary font-bold", children: totalCEOI >= 1000000 ? (totalCEOI / 1000000).toFixed(1) + 'M' : (totalCEOI / 100000).toFixed(1) + 'L' })] })] }) }), _jsx("td", { colSpan: 2, className: "text-center py-2 bg-accent/50 border-x-2 border-border", children: _jsxs("span", { className: `text-xs font-bold ${Number(pcr) > 1 ? 'text-bullish' : 'text-bearish'}`, children: ["PCR: ", pcr] }) }), _jsx("td", { colSpan: callCols, className: "text-left py-2 px-2", children: _jsxs("div", { className: "flex items-center gap-4", children: [_jsxs("span", { className: "text-muted-foreground", children: ["PE OI: ", _jsx("span", { className: "text-bearish font-bold", children: totalPEOI >= 1000000 ? (totalPEOI / 1000000).toFixed(1) + 'M' : (totalPEOI / 100000).toFixed(1) + 'L' })] }), _jsxs("span", { className: "text-muted-foreground", children: ["PE Vol: ", _jsx("span", { className: "text-foreground", children: totalPEVol >= 1000000 ? (totalPEVol / 1000000).toFixed(1) + 'M' : (totalPEVol / 1000).toFixed(0) + 'K' })] })] }) })] }) }))] })) }) })), viewMode === "strike" && (_jsx(Card, { children: _jsx(CardContent, { className: "p-0 overflow-auto", children: byStrikeData.length === 0 ? (_jsxs("div", { className: "flex flex-col items-center justify-center h-40 text-muted-foreground gap-2", children: [_jsx(Crosshair, { className: "h-8 w-8 opacity-20" }), _jsx("p", { className: "text-sm", children: "Select a strike price above to view its active-expiry quotes" }), _jsx("p", { className: "text-xs opacity-60", children: "Use the strike selector in the header bar" })] })) : (_jsx(_Fragment, { children: _jsxs(Table, { children: [_jsxs(TableHeader, { className: "sticky top-0 z-10 bg-card", children: [_jsxs(TableRow, { className: "text-xs border-b-2", children: [_jsx(TableHead, { className: "text-center text-primary font-bold", colSpan: callCols, children: "Calls" }), _jsx(TableHead, { className: "text-center font-bold bg-accent/50 border-x-2 border-border", children: "Exp Date" }), _jsx(TableHead, { className: "text-center text-bearish font-bold", colSpan: putCols, children: "Puts" })] }), _jsxs(TableRow, { className: "text-[11px] text-muted-foreground", children: [columnConfig.iv && _jsx(TableHead, { className: "text-right", children: "IV%" }), columnConfig.intrinsic && _jsx(TableHead, { className: "text-right", children: "Intr." }), columnConfig.timeValue && _jsx(TableHead, { className: "text-right", children: "Time" }), columnConfig.rho && _jsx(TableHead, { className: "text-right", children: "Rho" }), columnConfig.vega && _jsx(TableHead, { className: "text-right", children: "Vega" }), columnConfig.theta && _jsx(TableHead, { className: "text-right", children: "Theta" }), columnConfig.gamma && _jsx(TableHead, { className: "text-right", children: "Gamma" }), columnConfig.delta && _jsx(TableHead, { className: "text-right", children: "Delta" }), columnConfig.price && _jsx(TableHead, { className: "text-right font-semibold text-primary", children: "Price" }), columnConfig.ask && _jsx(TableHead, { className: "text-right", children: "Ask" }), columnConfig.bid && _jsx(TableHead, { className: "text-right", children: "Bid" }), columnConfig.volume && _jsx(TableHead, { className: "text-right", children: "Volume" }), _jsx(TableHead, { className: "text-center bg-accent/50 border-x-2 border-border font-semibold", children: "Exp Date" }), columnConfig.volume && _jsx(TableHead, { className: "text-left", children: "Volume" }), columnConfig.bid && _jsx(TableHead, { className: "text-left", children: "Bid" }), columnConfig.ask && _jsx(TableHead, { className: "text-left", children: "Ask" }), columnConfig.price && _jsx(TableHead, { className: "text-left font-semibold text-bearish", children: "Price" }), columnConfig.delta && _jsx(TableHead, { className: "text-left", children: "Delta" }), columnConfig.gamma && _jsx(TableHead, { className: "text-left", children: "Gamma" }), columnConfig.theta && _jsx(TableHead, { className: "text-left", children: "Theta" }), columnConfig.vega && _jsx(TableHead, { className: "text-left", children: "Vega" }), columnConfig.rho && _jsx(TableHead, { className: "text-left", children: "Rho" }), columnConfig.timeValue && _jsx(TableHead, { className: "text-left", children: "Time" }), columnConfig.intrinsic && _jsx(TableHead, { className: "text-left", children: "Intr." }), columnConfig.iv && _jsx(TableHead, { className: "text-left", children: "IV%" })] })] }), _jsx(TableBody, { children: byStrikeData.map((row) => (_jsxs(TableRow, { className: "text-xs sm:text-[11px] font-mono hover:bg-accent/30 transition-colors", children: [columnConfig.iv && _jsx(TableCell, { className: "text-right py-1.5 tabular-nums", children: formatGreek(row.ce.iv, 1) }), columnConfig.intrinsic && _jsx(TableCell, { className: "text-right py-1.5 tabular-nums", children: row.ce.intrinsic.toFixed(2) }), columnConfig.timeValue && _jsx(TableCell, { className: "text-right py-1.5 tabular-nums", children: row.ce.timeValue.toFixed(2) }), columnConfig.rho && _jsx(TableCell, { className: "text-right py-1.5 tabular-nums", children: "\u2014" }), columnConfig.vega && _jsx(TableCell, { className: "text-right py-1.5 tabular-nums", children: formatGreek(row.ce.vega) }), columnConfig.theta && _jsx(TableCell, { className: "text-right py-1.5 tabular-nums text-bearish/80", children: formatGreek(row.ce.theta) }), columnConfig.gamma && _jsx(TableCell, { className: "text-right py-1.5 tabular-nums", children: formatGreek(row.ce.gamma, 4) }), columnConfig.delta && _jsx(TableCell, { className: "text-right py-1.5 tabular-nums font-medium", children: formatGreek(row.ce.delta) }), columnConfig.price && _jsx(TableCell, { className: "text-right py-1.5 font-semibold", children: row.ce.ltp.toFixed(2) }), columnConfig.ask && _jsx(TableCell, { className: "text-right py-1.5 tabular-nums", children: row.ce.ask.toFixed(2) }), columnConfig.bid && _jsx(TableCell, { className: "text-right py-1.5 tabular-nums", children: row.ce.bid.toFixed(2) }), columnConfig.volume && _jsx(TableCell, { className: "text-right py-1.5", children: _jsx(VolumeBar, { value: row.ce.volume, max: maxVol, side: "call" }) }), _jsx(TableCell, { className: "text-center py-1.5 bg-accent/50 border-x-2 border-border font-semibold font-sans text-xs", children: row.expiry }), columnConfig.volume && _jsx(TableCell, { className: "text-left py-1.5", children: _jsx(VolumeBar, { value: row.pe.volume, max: maxVol, side: "put" }) }), columnConfig.bid && _jsx(TableCell, { className: "text-left py-1.5 tabular-nums", children: row.pe.bid.toFixed(2) }), columnConfig.ask && _jsx(TableCell, { className: "text-left py-1.5 tabular-nums", children: row.pe.ask.toFixed(2) }), columnConfig.price && _jsx(TableCell, { className: "text-left py-1.5 font-semibold", children: row.pe.ltp.toFixed(2) }), columnConfig.delta && _jsx(TableCell, { className: "text-left py-1.5 tabular-nums font-medium", children: formatGreek(row.pe.delta) }), columnConfig.gamma && _jsx(TableCell, { className: "text-left py-1.5 tabular-nums", children: formatGreek(row.pe.gamma, 4) }), columnConfig.theta && _jsx(TableCell, { className: "text-left py-1.5 tabular-nums text-bearish/80", children: formatGreek(row.pe.theta) }), columnConfig.vega && _jsx(TableCell, { className: "text-left py-1.5 tabular-nums", children: formatGreek(row.pe.vega) }), columnConfig.rho && _jsx(TableCell, { className: "text-left py-1.5 tabular-nums", children: "\u2014" }), columnConfig.timeValue && _jsx(TableCell, { className: "text-left py-1.5 tabular-nums", children: row.pe.timeValue.toFixed(2) }), columnConfig.intrinsic && _jsx(TableCell, { className: "text-left py-1.5 tabular-nums", children: row.pe.intrinsic.toFixed(2) }), columnConfig.iv && _jsx(TableCell, { className: "text-left py-1.5 tabular-nums", children: formatGreek(row.pe.iv, 1) })] }, row.expiry))) })] }) })) }) }))] }));
}
