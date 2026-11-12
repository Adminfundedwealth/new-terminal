import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";

import { OptionOrderPopup, type OptionContract } from "@/components/OptionOrderPopup";

import { OptionContractChartTab, type ChartTab } from "@/components/OptionContractChartTab";

import { useSearchParams, useNavigate } from "react-router-dom";

import { Card, CardContent } from "@/components/ui/card";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { Badge } from "@/components/ui/badge";

import { Button } from "@/components/ui/button";

import { Input } from "@/components/ui/input";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger } from "@/components/ui/context-menu";

import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";

import { Crosshair, Wifi, WifiOff, RefreshCw, Bell, TrendingUp, TrendingDown, Layers, ChevronLeft, ChevronRight, Settings2, Flame, Search, X, Download, BarChart3, ChevronDown, ChevronUp, History, Keyboard } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { Switch } from "@/components/ui/switch";

import { Label } from "@/components/ui/label";

import { useLiveOptionChain } from "@/hooks/useMarketData";

import { StockChart } from "@/components/StockChart";

import { OptionChainStrikeActions } from "@/components/OptionChainStrikeActions";

import { toast } from "sonner";

import { useInstrumentLookup } from "@/hooks/useLocalDatabase";

import { classifyInstrument } from "@/lib/instrumentClassification";
import { findDhanOptionInstrument } from "@/lib/marketInstrumentResolver";
import {
  optionContractWatchlistKey,
  readOptionContractWatchlist,
  saveOptionContractWatchlist,
} from "@/lib/optionContractWatchlist";

import {

  requestTerminalMarketData,
  type TerminalMarketDataQuote,
  type TerminalMarketDataOptionChain,

} from "@/lib/terminalApi";



//  Symbol categories for organized browsing 

const SYMBOL_CATEGORIES: { label: string; symbols: { label: string; value: string }[] }[] = [

  {

    label: "Indices",

    symbols: [

      { label: "NIFTY 50", value: "NIFTY" },
      { label: "SENSEX", value: "SENSEX" },

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

      "HINDALCO", "M&M", "APOLLOHOSP", "EICHERMOT", "DIVISLAB",

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

const INDEX_SYMBOLS = new Set(["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX"]);

const STOCK_SYMBOLS = new Set(ALL_SYMBOLS.filter(s => !INDEX_SYMBOLS.has(s.value)).map(s => s.value));



//  Searchable Symbol Selector Component 

function SymbolSearch({ value, onSelect, categories }: { value: string; onSelect: (v: string) => void; categories: { label: string; symbols: { label: string; value: string }[] }[] }) {

  const [open, setOpen] = useState(false);

  const [search, setSearch] = useState("");

  const inputRef = useRef<HTMLInputElement>(null);



  const filtered = useMemo(() => {

    if (!search) return categories;

    const q = search.toUpperCase();

    return categories

      .map(cat => ({

        ...cat,

        symbols: cat.symbols.filter(s =>

          s.value.includes(q) || s.label.toUpperCase().includes(q)

        ),

      }))

      .filter(cat => cat.symbols.length > 0);

  }, [categories, search]);



  const currentLabel = categories.flatMap(cat => cat.symbols).find(s => s.value === value)?.label || value;



  useEffect(() => {

    if (open && inputRef.current) {

      setTimeout(() => inputRef.current?.focus(), 100);

    }

  }, [open]);



  return (

    <Popover open={open} onOpenChange={setOpen}>

      <PopoverTrigger asChild>

        <Button variant="outline" className="w-[160px] h-8 text-xs font-medium justify-between gap-1" role="combobox">

          <span className="truncate">{currentLabel}</span>

          <Search className="h-3 w-3 shrink-0 opacity-50" />

        </Button>

      </PopoverTrigger>

      <PopoverContent className="w-[280px] p-0" align="start">

        <div className="flex items-center border-b px-3 py-2 gap-2">

          <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />

          <Input

            ref={inputRef}

            value={search}

            onChange={e => setSearch(e.target.value)}

            placeholder="Search F&O symbols..."

            className="h-7 border-0 p-0 text-xs focus-visible:ring-0 shadow-none"

          />

          {search && (

            <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={() => setSearch("")}>

              <X className="h-3 w-3" />

            </Button>

          )}

        </div>

        <ScrollArea className="h-[320px]">

          <div className="p-1">

            {filtered.length === 0 ? (

              <p className="text-xs text-muted-foreground text-center py-4">No symbols found</p>

            ) : (

              filtered.map(cat => (

                <div key={cat.label}>

                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-2 py-1.5 sticky top-0 bg-popover">

                    {cat.label}

                  </p>

                  <div className="grid grid-cols-3 gap-0.5">

                    {cat.symbols.map(s => (

                      <button

                        key={s.value}

                        onClick={() => { onSelect(s.value); setOpen(false); setSearch(""); }}

                        className={`text-xs px-2 py-1.5 rounded text-left transition-colors hover:bg-accent ${

                          s.value === value ? "bg-primary/10 text-primary font-semibold" : ""

                        }`}

                      >

                        {s.label}

                      </button>

                    ))}

                  </div>

                </div>

              ))

            )}

          </div>

        </ScrollArea>

      </PopoverContent>

    </Popover>

  );

}



//  Volume Bar 

function VolumeBar({ value, max, side }: { value: number; max: number; side: "call" | "put" }) {

  const pct = Math.min((value / max) * 100, 100);

  return (

    <div className="flex items-center gap-1.5">

      <span className={`text-xs font-mono tabular-nums ${value > max * 0.7 ? (side === "call" ? "text-primary font-semibold" : "text-bearish font-semibold") : ""}`}>

        {value >= 1000000 ? (value / 1000000).toFixed(1) + "M" : value >= 1000 ? (value / 1000).toFixed(0) + "K" : value.toLocaleString("en-IN")}

      </span>

      <div className="w-[50px] h-[6px] rounded-sm bg-muted/40 overflow-hidden">

        <div

          className={`h-full rounded-sm transition-all ${side === "call" ? "bg-primary/60" : "bg-bearish/50"}`}

          style={{ width: `${pct}%` }}

        />

      </div>

    </div>

  );

}



//  OI Bar (colored by value intensity with smooth animations) 

function OIBar({ value, max, side }: { value: number; max: number; side: "call" | "put" }) {

  const pct = Math.min((value / max) * 100, 100);

  const isHigh = pct > 60;

  const isMega = pct > 85;

  const opacity = 0.25 + (pct / 100) * 0.65; // Scale from 0.25 to 0.9

  return (

    <div className="flex items-center gap-1.5 group" title={`${value.toLocaleString("en-IN")} (${pct.toFixed(1)}% of max)`}>

      <span className={`text-xs font-mono tabular-nums transition-colors ${isHigh ? (side === "call" ? "text-primary font-semibold" : "text-bearish font-semibold") : ""}`}>

        {value >= 1000000 ? (value / 1000000).toFixed(1) + "M" : (value / 1000).toFixed(0) + "K"}

      </span>

      <div className={`w-[55px] h-[7px] rounded-sm overflow-hidden ${side === "call" ? "bg-primary/8" : "bg-bearish/8"}`}>

        <div

          className={`h-full rounded-sm transition-all duration-500 ease-out ${

            side === "call"

              ? isMega ? "bg-primary shadow-[0_0_6px_hsl(var(--primary)/0.4)]" : "bg-primary"

              : isMega ? "bg-bearish shadow-[0_0_6px_hsl(var(--bearish)/0.4)]" : "bg-bearish"

          }`}

          style={{ width: `${pct}%`, opacity }}

        />

      </div>

    </div>

  );

}



// ── Internal tab state types ──────────────────────────────────────────────────

type OptionTab =

  | { kind: "chain" }

  | {

      kind: "chart";

      id: string;

      label: string;

      tradingSymbol: string;

      underlying: string;

      strike: number;

      optionType: "CE" | "PE";

      expiry: string;

      securityId: string;

      exchangeSegment: string;

      lotSize: number;

    };

type MultiExpiryRow = {
  expiry: string;
  greeksAvailable: boolean;
  ce: { iv: number; intrinsic: number; timeValue: number; vega: number; theta: number; gamma: number; delta: number; ltp: number; ask: number; bid: number; volume: number };
  pe: { iv: number; intrinsic: number; timeValue: number; vega: number; theta: number; gamma: number; delta: number; ltp: number; ask: number; bid: number; volume: number };
};

function contractBasketKey(contract: OptionContract): string {
  return `${contract.securityId}:${contract.type}`;
}


export default function OptionChain({ defaultMarketView = "stocks" }: { defaultMarketView?: "stocks" | "indices" }) {

  const [searchParams] = useSearchParams();

  const navigate = useNavigate();

  const { instruments: masterInstruments, isLoaded: isMasterLoaded, loadError: masterLoadError } = useInstrumentLookup();

  const [marketView, setMarketView] = useState<"stocks" | "indices">(defaultMarketView);

  const [symbol, setSymbol] = useState(searchParams.get("symbol") || (defaultMarketView === "indices" ? "NIFTY" : "RELIANCE"));

  const [selectedExpiry, setSelectedExpiry] = useState<string | undefined>(searchParams.get("expiry") || undefined);

  const [viewMode, setViewMode] = useState<"expiration" | "strike">("expiration");

  const [selectedStrike, setSelectedStrike] = useState<number | null>(null);

  const [columnConfig, setColumnConfig] = useState({
    iv: true, delta: true, gamma: false, theta: true, vega: false,
    intrinsic: false, timeValue: false, bid: false, ask: false, price: true,
    volume: true, oi: true, oiChange: true,
  });
  const [perLot, setPerLot] = useState(false);

  const atmRef = useRef<HTMLTableRowElement>(null);

  const strikeScrollRef = useRef<HTMLDivElement>(null);

  const [showChart, setShowChart] = useState(false);

  const [isDownloadingPast, setIsDownloadingPast] = useState(false);

  const [focusedStrikeIdx, setFocusedStrikeIdx] = useState<number>(-1);



  // ── Internal workspace tabs ───────────────────────────────────────────────

  const [openTabs, setOpenTabs] = useState<OptionTab[]>([{ kind: "chain" }]);

  const [activeTabId, setActiveTabId] = useState<string>("chain");



//  Order popup state 

  const [orderPopup, setOrderPopup] = useState<{ contract: OptionContract; side: "BUY" | "SELL" } | null>(null);
  const [basket, setBasket] = useState<OptionContract[]>([]);
  const [optionWatchlist, setOptionWatchlist] = useState<OptionContract[]>(() => readOptionContractWatchlist());



  useEffect(() => {
    const requestedSymbol = searchParams.get("symbol")?.trim().toUpperCase();
    if (requestedSymbol) {
      setSymbol(requestedSymbol);
      setMarketView(INDEX_SYMBOLS.has(requestedSymbol) ? "indices" : "stocks");
      return;
    }
    setMarketView(defaultMarketView);

    if (defaultMarketView === "indices") {

      setSymbol(current => INDEX_SYMBOLS.has(current) ? current : "NIFTY");

    } else {

      setSymbol(current => STOCK_SYMBOLS.has(current) ? current : "RELIANCE");

    }

  }, [defaultMarketView, searchParams]);



  const visibleCategories = useMemo(() => {

    if (isMasterLoaded) {

      const category = marketView === "indices" ? "indices" : "stocks";

      const symbols = masterInstruments

        .filter(instrument => classifyInstrument(instrument) === category)

        .reduce<{ label: string; value: string }[]>((result, instrument) => {

          if (!result.some(item => item.value === instrument.symbol)) {

            result.push({ label: instrument.symbol, value: instrument.symbol });

          }

          return result;

        }, [])

        .sort((a, b) => a.label.localeCompare(b.label));

      return [{ label: marketView === "indices" ? "Indices" : "Stocks", symbols }];

    }

    return marketView === "indices"

      ? SYMBOL_CATEGORIES.filter(cat => cat.label === "Indices")

      : SYMBOL_CATEGORIES.filter(cat => cat.label !== "Indices");

  }, [isMasterLoaded, masterInstruments, marketView]);



  const centralUnderlyingInstrument = useMemo(() => {

    const normalizedSymbol = symbol.trim().toUpperCase();

    const candidates = masterInstruments.filter((instrument) =>

      (instrument.symbol.toUpperCase() === normalizedSymbol || instrument.tradingSymbol.toUpperCase() === normalizedSymbol) &&

      ["NSE_EQ", "IDX_I", "BSE_IDX"].includes(instrument.exchangeSegment) &&

      instrument.provider === "dhan"

    );

    const preferredSegment = normalizedSymbol === "SENSEX"
      ? "BSE_IDX"
      : INDEX_SYMBOLS.has(normalizedSymbol) ? "IDX_I" : "NSE_EQ";

    const match = candidates.find((instrument) => instrument.exchangeSegment === preferredSegment) ?? candidates[0];

    return match ? {
      securityId: match.providerInstrumentId || match.securityId,
      exchangeSegment: match.exchangeSegment,
      exchange: match.exchange,
      tradingSymbol: match.tradingSymbol,
      instrumentType: match.instrumentType,
    } : undefined;

  }, [masterInstruments, symbol]);
  const underlyingExchangeLabel = centralUnderlyingInstrument?.exchangeSegment === "BSE_IDX" ? "BSE"
    : centralUnderlyingInstrument?.exchangeSegment === "NSE_EQ" || centralUnderlyingInstrument?.exchangeSegment === "IDX_I" ? "NSE"
      : undefined;
  const quoteInstrument = centralUnderlyingInstrument;
  const underlyingQuoteQuery = useQuery({
    queryKey: ["option-chain-underlying-quote", symbol, quoteInstrument?.securityId, quoteInstrument?.exchangeSegment],
    enabled: Boolean(quoteInstrument?.securityId && quoteInstrument.exchangeSegment),
    queryFn: () => {
      if (!quoteInstrument) throw new Error(`The instrument catalog could not resolve the ${symbol} underlying quote.`);
      return requestTerminalMarketData<TerminalMarketDataQuote>(null, "dhan", {
        operation: "getQuote",
        instrument: {
          provider: "dhan",
          providerInstrumentId: quoteInstrument.securityId,
          symbol,
          tradingSymbol: quoteInstrument.tradingSymbol,
          exchange: quoteInstrument.exchange || (quoteInstrument.exchangeSegment === "BSE_IDX" ? "BSE" : "NSE"),
          exchangeSegment: quoteInstrument.exchangeSegment,
          instrumentType: quoteInstrument.instrumentType,
        },
      });
    },
    staleTime: 3_000,
    refetchInterval: 5_000,
    retry: false,
  });
  const underlyingQuote = underlyingQuoteQuery.data;
  const underlyingQuoteTime = underlyingQuote?.timestamp ? Date.parse(underlyingQuote.timestamp) : Number.NaN;
  const underlyingQuoteFresh = Number.isFinite(underlyingQuoteTime)
    && Date.now() >= underlyingQuoteTime
    && Date.now() - underlyingQuoteTime <= 60_000;

  const { data, isLoading, refetch, error } = useLiveOptionChain(symbol, selectedExpiry, true, centralUnderlyingInstrument);

  const isChainLoading = isLoading;



  const chain = useMemo(() => data?.chain ?? [], [data]);

  const expiries = useMemo(() => data?.expiries ?? [], [data]);
  const activeExpiry = expiries.find((expiry) => expiry.value === (selectedExpiry || expiries[0]?.value));

  const spotPrice = data?.spotPrice ?? 0;

  const lotSize = data?.lotSize ?? 0;

  const stepSize = data?.stepSize ?? 50;

  const maxPain = data?.maxPain ?? 0;

  const isLive = data?.isLive ?? false;

  const afterHours = data?.afterHours ?? false;
  const cachedAtTimestamp = typeof data?.cachedAt === "number"
    ? data.cachedAt > 1_000_000_000_000 ? data.cachedAt : data.cachedAt * 1000
    : data?.cachedAt ? Date.parse(data.cachedAt) : Number.NaN;
  const cachedMinutesAgo = Number.isFinite(cachedAtTimestamp)
    ? Math.max(0, Math.round((Date.now() - cachedAtTimestamp) / 60000))
    : null;

  const hasData = chain.length > 0;
  const priceDisplayMultiplier = perLot && lotSize > 0 ? lotSize : 1;



  const atmStrike = useMemo(() => Math.round(spotPrice / stepSize) * stepSize, [spotPrice, stepSize]);

  const totalCEOI = chain.reduce((s, o) => s + o.ce.oi, 0);

  const totalPEOI = chain.reduce((s, o) => s + o.pe.oi, 0);

  const pcr = totalCEOI > 0 ? (totalPEOI / totalCEOI).toFixed(2) : "—";

  const maxVol = Math.max(...chain.map(o => Math.max(o.ce.volume, o.pe.volume)), 1);

  const totalCEVol = chain.reduce((s, o) => s + o.ce.volume, 0);

  const totalPEVol = chain.reduce((s, o) => s + o.pe.volume, 0);

  const atmRow = chain.find(o => o.strikePrice === atmStrike);



// Volume-spike heuristic compares each side with its mean across the displayed chain.

  const unusualActivity = useMemo(() => {

    if (chain.length === 0) return { flags: new Map<number, { ce: boolean; pe: boolean }>(), count: 0, hotStrikes: [] as number[] };

    const avgCEVolume = totalCEVol / chain.length;
    const avgPEVolume = totalPEVol / chain.length;

    const flags = new Map<number, { ce: boolean; pe: boolean }>();

    const hotStrikes: number[] = [];

    chain.forEach(row => {

      const ceUnusual = avgCEVolume > 0 && row.ce.volume > avgCEVolume * 3;
      const peUnusual = avgPEVolume > 0 && row.pe.volume > avgPEVolume * 3;

      if (ceUnusual || peUnusual) {

        flags.set(row.strikePrice, { ce: ceUnusual, pe: peUnusual });

        hotStrikes.push(row.strikePrice);

      }

    });

    return { flags, count: flags.size, hotStrikes };

  }, [chain, totalCEVol, totalPEVol]);



  useEffect(() => {

    if (chain.length > 0 && atmRef.current && viewMode === "expiration") {

      setTimeout(() => atmRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 300);

    }

  }, [chain.length, viewMode]);



  useEffect(() => {

    if (chain.length > 0 && !selectedStrike) setSelectedStrike(atmStrike);

  }, [chain.length, atmStrike, selectedStrike]);



  const scrollToATM = useCallback(() => {

    if (viewMode === "expiration") {

      atmRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });

    } else {

      setSelectedStrike(atmStrike);

    }

  }, [viewMode, atmStrike]);



  const handleContextAction = (strike: number, type: "CE" | "PE", action: string, row?: typeof enrichedChain[0]) => {

    const targetRow = row || enrichedChain.find(r => r.strikePrice === strike);

    if (!targetRow) return;

    

    switch (action) {

      case "chart": 

        openChart(strike, type, targetRow); 

        break;

      case "buy": 

        openBuyTicket(strike, type, targetRow); 

        break;

      case "sell": 

        openSellTicket(strike, type, targetRow); 

        break;

      case "straddle":
        addStraddleToBasket(strike);
        break;
      case "alert": 
        toast.info("Contract-specific option alerts are not supported by the current alert service.");
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



  // Navigate to Chart with the selected option contract (defined after enrichedChain to avoid TDZ)

  const openChart = useCallback((strike: number, type: "CE" | "PE", _row: typeof enrichedChain[0]) => {

    const contract = chain.find(c => c.strikePrice === strike);

    if (!contract) {

      toast.error("Contract details not available");

      return;

    }

    const expiryValue = selectedExpiry || expiries[0]?.value || "";

    const expiryLabel = expiries.find(e => e.value === expiryValue)?.label || expiryValue;

    const optionInstrument = findDhanOptionInstrument(masterInstruments, {
      underlying: symbol,
      expiry: expiryValue,
      strike,
      optionType: type,
      underlyingSecurityId: centralUnderlyingInstrument?.securityId,
    });
    if (!optionInstrument) {
      toast.error(`Dhan's instrument master could not resolve ${symbol} ${expiryValue} ${strike} ${type}.`);
      return;
    }

    const tradingSymbol = optionInstrument.tradingSymbol;

    const tabId = tradingSymbol;

    const label = `${symbol} ${expiryLabel} ${strike} ${type}`;



    setOpenTabs(prev => {

      const exists = prev.some(t => t.kind === "chart" && t.id === tabId);

      if (exists) return prev;

      const newTab: OptionTab = {

        kind: "chart",

        id: tabId,

        label,

        tradingSymbol,

        underlying: symbol,

        strike,

        optionType: type,

        expiry: expiryValue,

        securityId: optionInstrument.providerInstrumentId || optionInstrument.securityId,

        exchangeSegment: optionInstrument.exchangeSegment,

        lotSize: optionInstrument.lotSize,

      };

      return [...prev, newTab];

    });

    setActiveTabId(tabId);

  }, [symbol, chain, expiries, selectedExpiry, masterInstruments, centralUnderlyingInstrument]);



  // Close a contract chart tab; activates nearest neighbour or falls back to 'chain'

  const closeTab = useCallback((tabId: string) => {

    setOpenTabs(prev => {

      const next = prev.filter(t => (t.kind === "chain" ? "chain" : t.id) !== tabId);

      return next.length ? next : [{ kind: "chain" }];

    });

    setActiveTabId(prev => {

      if (prev !== tabId) return prev;

      const remaining = openTabs.filter(t => (t.kind === "chain" ? "chain" : t.id) !== tabId);

      if (!remaining.length) return "chain";

      const idx = openTabs.findIndex(t => (t.kind === "chain" ? "chain" : t.id) === tabId);

      const neighbor = remaining[Math.max(0, idx - 1)];

      return neighbor.kind === "chain" ? "chain" : neighbor.id;

    });

  }, [openTabs]);



  // Open Buy/Sell popup (defined after enrichedChain to avoid TDZ)

  const buildOrderContract = useCallback((strike: number, type: "CE" | "PE"): OptionContract | null => {

    const contract = chain.find(c => c.strikePrice === strike);

    if (!contract) return null;

    const optionSide = type === "CE" ? contract.ce : contract.pe;

    const expiryValue = selectedExpiry || expiries[0]?.value || "";

    const expiryLabel = expiries.find(e => e.value === expiryValue)?.label || expiryValue;

    const optionInstrument = findDhanOptionInstrument(masterInstruments, {
      underlying: symbol,
      expiry: expiryValue,
      strike,
      optionType: type,
      underlyingSecurityId: centralUnderlyingInstrument?.securityId,
    });
    if (!optionInstrument) {
      toast.error(`Dhan's instrument master could not resolve ${symbol} ${expiryValue} ${strike} ${type}.`);
      return null;
    }

    const tradingSymbol = optionInstrument.tradingSymbol;

    return {

      tradingSymbol,

      underlying: symbol,

      strike,

      type,

      expiry: expiryValue,

      expiryLabel: expiryLabel || expiryValue,

      lotSize: optionInstrument.lotSize,

      tickSize: optionInstrument.tickSize ?? 0.05,

      securityId: optionInstrument.providerInstrumentId || optionInstrument.securityId,

      exchangeSegment: optionInstrument.exchangeSegment,

      instrumentType: optionInstrument.instrumentType === "OPTSTK" ? "OPTSTK" : "OPTIDX",

      ltp: optionSide.ltp || 0,

      bidPrice: optionSide.bidPrice || 0,

      askPrice: optionSide.askPrice || 0,

      oi: optionSide.oi || 0,

      iv: optionSide.iv || 0,

      pcr: Number(pcr),

      maxPain,

    };

  }, [chain, expiries, selectedExpiry, symbol, pcr, maxPain, masterInstruments, centralUnderlyingInstrument]);



  const openBuyTicket = useCallback((strike: number, type: "CE" | "PE", _row: typeof enrichedChain[0]) => {

    const contract = buildOrderContract(strike, type);

    if (!contract) { toast.error("Contract details not available"); return; }

    setOrderPopup({ contract, side: "BUY" });

  }, [buildOrderContract]);

  const toggleBasketContract = useCallback((strike: number, type: "CE" | "PE") => {
    const contract = buildOrderContract(strike, type);
    if (!contract) {
      toast.error(`Could not resolve ${symbol} ${strike} ${type} from Dhan's instrument master.`);
      return;
    }
    setBasket((current) => current.some((item) => contractBasketKey(item) === contractBasketKey(contract))
      ? current.filter((item) => contractBasketKey(item) !== contractBasketKey(contract))
      : [...current, contract]);
  }, [buildOrderContract, symbol]);

  const addStraddleToBasket = useCallback((strike: number) => {
    const call = buildOrderContract(strike, "CE");
    const put = buildOrderContract(strike, "PE");
    if (!call || !put) {
      toast.error(`Could not resolve both ${strike} ${symbol} option contracts from Dhan's instrument master.`);
      return;
    }
    setBasket((current) => {
      const byId = new Map(current.map((contract) => [contractBasketKey(contract), contract]));
      byId.set(contractBasketKey(call), call);
      byId.set(contractBasketKey(put), put);
      return [...byId.values()];
    });
    toast.success(`Added ${strike} CE and PE to the basket.`);
  }, [buildOrderContract, symbol]);

  const toggleOptionWatchlist = useCallback((strike: number, type: "CE" | "PE") => {
    const contract = buildOrderContract(strike, type);
    if (!contract) {
      toast.error(`Could not resolve ${symbol} ${strike} ${type} from Dhan's instrument master.`);
      return;
    }
    const key = optionContractWatchlistKey(contract);
    const updated = optionWatchlist.some((item) => optionContractWatchlistKey(item) === key)
      ? optionWatchlist.filter((item) => optionContractWatchlistKey(item) !== key)
      : [...optionWatchlist, contract];
    try {
      saveOptionContractWatchlist(updated);
      setOptionWatchlist(updated);
    } catch (error) {
      toast.error(`Could not save option watchlist: ${error instanceof Error ? error.message : "browser storage is unavailable."}`);
    }
  }, [buildOrderContract, optionWatchlist, symbol]);

  const removeOptionWatchlistContract = (contract: OptionContract) => {
    const updated = optionWatchlist.filter((item) =>
      optionContractWatchlistKey(item) !== optionContractWatchlistKey(contract)
    );
    try {
      saveOptionContractWatchlist(updated);
      setOptionWatchlist(updated);
    } catch (error) {
      toast.error(`Could not update option watchlist: ${error instanceof Error ? error.message : "browser storage is unavailable."}`);
    }
  };



  const openSellTicket = useCallback((strike: number, type: "CE" | "PE", _row: typeof enrichedChain[0]) => {

    const contract = buildOrderContract(strike, type);

    if (!contract) { toast.error("Contract details not available"); return; }

    setOrderPopup({ contract, side: "SELL" });

  }, [buildOrderContract]);



  // "By Strike" view: show one strike across all expiries

  const byStrikeQueries = useQueries({
    queries: expiries.map((expiry) => ({
      queryKey: ["option-chain-by-strike", symbol, expiry.value],
      queryFn: () => requestTerminalMarketData<TerminalMarketDataOptionChain>(null, "dhan", {
        operation: "getOptionChain",
        underlying: symbol.toUpperCase(),
        expiry: expiry.value,
      }),
      enabled: viewMode === "strike" && Boolean(selectedStrike),
      staleTime: 3_000,
      retry: false,
    })),
  });
  const byStrikeData: MultiExpiryRow[] = expiries.flatMap((expiry, index) => {
    const result = byStrikeQueries[index]?.data;
    const row = result?.chain.find((option) => option.strikePrice === selectedStrike);
    if (!row) return [];
    const ceIntrinsic = Math.max(spotPrice - row.strikePrice, 0);
    const peIntrinsic = Math.max(row.strikePrice - spotPrice, 0);
    return [{
      expiry: expiry.label,
      greeksAvailable: result.greeksAvailable,
      ce: {
        ...row.ce,
        ltp: row.ce.ltp,
        ask: row.ce.askPrice,
        bid: row.ce.bidPrice,
        intrinsic: ceIntrinsic,
        timeValue: Math.max(row.ce.ltp - ceIntrinsic, 0),
      },
      pe: {
        ...row.pe,
        ltp: row.pe.ltp,
        ask: row.pe.askPrice,
        bid: row.pe.bidPrice,
        intrinsic: peIntrinsic,
        timeValue: Math.max(row.pe.ltp - peIntrinsic, 0),
      },
    }];
  });



  const allStrikes = enrichedChain.map(r => r.strikePrice);



//  Keyboard Navigation: J/K to move, G to jump to ATM 

  useEffect(() => {

    if (viewMode !== "expiration" || !hasData) return;

    const handler = (e: KeyboardEvent) => {

      const target = e.target as HTMLElement;

      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;

      if (e.key === "j" || e.key === "ArrowDown") {

        e.preventDefault();

        setFocusedStrikeIdx(prev => Math.min(prev + 1, enrichedChain.length - 1));

      } else if (e.key === "k" || e.key === "ArrowUp") {

        e.preventDefault();

        setFocusedStrikeIdx(prev => Math.max(prev - 1, 0));

      } else if (e.key === "g") {

        const atmIdx = enrichedChain.findIndex(r => r.strikePrice === atmStrike);

        if (atmIdx >= 0) { setFocusedStrikeIdx(atmIdx); scrollToATM(); }

      }

    };

    window.addEventListener("keydown", handler);

    return () => window.removeEventListener("keydown", handler);

  }, [viewMode, hasData, enrichedChain, atmStrike, scrollToATM]);



//  CSV Download: Export current option chain 

  const downloadCSV = useCallback(() => {

    if (enrichedChain.length === 0) {

      toast.error("No data to export");

      return;

    }

    const expLabel = expiries.find(e => e.value === (selectedExpiry || expiries[0]?.value))?.label || "current";

    const headers = ["Strike","CE_LTP","CE_IV","CE_Delta","CE_Gamma","CE_Theta","CE_Vega","CE_OI","CE_Volume","CE_Bid","CE_Ask","PE_LTP","PE_IV","PE_Delta","PE_Gamma","PE_Theta","PE_Vega","PE_OI","PE_Volume","PE_Bid","PE_Ask"];

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



//  Download a past expiry option chain through Terminal OS 

  const downloadPastOC = useCallback(async (pastExpiry: string) => {

    setIsDownloadingPast(true);

    try {

      const chainData = await requestTerminalMarketData<TerminalMarketDataOptionChain>(

        null,

        "dhan",

        { operation: "getOptionChain", underlying: symbol.toUpperCase(), expiry: pastExpiry },

      );

      if (chainData.chain.length === 0) throw new Error(`No option-chain data is available for ${pastExpiry}.`);

      const headers = ["Strike","CE_LTP","CE_IV","CE_OI","CE_Volume","CE_Delta","CE_Bid","CE_Ask","PE_LTP","PE_IV","PE_OI","PE_Volume","PE_Delta","PE_Bid","PE_Ask"];

      const rows = chainData.chain.map((row) => [

        row.strikePrice, row.ce.ltp, row.ce.iv, row.ce.oi, row.ce.volume, row.ce.delta, row.ce.bidPrice, row.ce.askPrice,

        row.pe.ltp, row.pe.iv, row.pe.oi, row.pe.volume, row.pe.delta, row.pe.bidPrice, row.pe.askPrice,

      ].join(","));

      const blob = new Blob([[headers.join(","), ...rows].join("\n")], { type: "text/csv" });

      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");

      a.href = url;

      a.download = `${symbol}_${pastExpiry}_option_chain.csv`;

      a.click();

      URL.revokeObjectURL(url);

      toast.success(`Exported ${rows.length} strikes for ${pastExpiry}`);

    } catch (error) {

      toast.error(`Failed to download: ${error instanceof Error ? error.message : "Option-chain request failed."}`);

    } finally {

      setIsDownloadingPast(false);

    }

  }, [symbol]);



  // Active columns count for colSpan

  const callCols = [columnConfig.iv, columnConfig.intrinsic, columnConfig.timeValue, columnConfig.vega, columnConfig.theta, columnConfig.gamma, columnConfig.delta, columnConfig.price, columnConfig.ask, columnConfig.bid, columnConfig.oi, columnConfig.oiChange, columnConfig.volume].filter(Boolean).length;

  const putCols = callCols;



  return (

    <div className="space-y-2.5 lg:space-y-3">

      {/* ── Internal Tab Bar ─────────────────────────────────────────────── */}

      <div className="flex items-center gap-1 border-b border-border pb-0 mb-2 overflow-x-auto">

        {openTabs.map(tab => {

          const id = tab.kind === "chain" ? "chain" : tab.id;

          const isActive = activeTabId === id;

          return (

            <div

              key={id}

              className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-t cursor-pointer whitespace-nowrap transition-colors ${

                isActive

                  ? "bg-background text-foreground border border-b-background border-border -mb-px"

                  : "text-muted-foreground hover:text-foreground"

              }`}

              onClick={() => setActiveTabId(id)}

            >

              <span>{tab.kind === "chain" ? "Option Chain" : tab.label}</span>

              {tab.kind === "chart" && (

                <button

                  className="ml-1 opacity-60 hover:opacity-100"

                  onClick={e => {

                    e.stopPropagation();

                    closeTab(id);

                  }}

                >

                  <X className="h-3 w-3" />

                </button>

              )}

            </div>

          );

        })}

      </div>



      {/* ── Option Chain content (only when active) ──────────────────────── */}

      {activeTabId === "chain" && (

        <>

      <section className="space-y-3 rounded-xl border border-border/80 bg-card/80 p-3 shadow-sm">

        <div className="flex flex-wrap items-center justify-between gap-3">

          <div className="flex flex-wrap items-center gap-3">

            <SymbolSearch value={symbol} onSelect={(v) => { setSymbol(v); setSelectedExpiry(undefined); }} categories={visibleCategories} />


            <ToggleGroup type="single" value={marketView} onValueChange={(v) => v && setMarketView(v as "stocks" | "indices")} className="bg-muted rounded-md p-0.5">

              <ToggleGroupItem value="stocks" className="text-xs h-7 px-3 data-[state=on]:bg-background data-[state=on]:shadow-sm rounded">Stocks</ToggleGroupItem>

              <ToggleGroupItem value="indices" className="text-xs h-7 px-3 data-[state=on]:bg-background data-[state=on]:shadow-sm rounded">Indices</ToggleGroupItem>

            </ToggleGroup>

            <ToggleGroup type="single" value={viewMode} onValueChange={(v) => v && setViewMode(v as "expiration" | "strike")} className="bg-muted rounded-md p-0.5">

              <ToggleGroupItem value="expiration" className="text-xs h-7 px-3 data-[state=on]:bg-background data-[state=on]:shadow-sm rounded">By expiration</ToggleGroupItem>

              <ToggleGroupItem value="strike" className="text-xs h-7 px-3 data-[state=on]:bg-background data-[state=on]:shadow-sm rounded">By strike</ToggleGroupItem>

            </ToggleGroup>

          </div>



          <div className="flex items-center gap-1.5">

            <Badge variant="outline" className={`gap-1 text-[11px] ${isLive && underlyingQuoteFresh ? "border-bullish/50 text-bullish" : afterHours ? "border-amber-500/50 text-amber-400" : "border-red-500/30 text-red-400"}`}>
              {isLive && underlyingQuoteFresh ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
              {isLive && underlyingQuoteFresh ? "LIVE · DHAN" : afterHours ? "HISTORICAL" : underlyingQuoteQuery.error ? "QUOTE ERROR" : "STALE / OFFLINE"}
            </Badge>

            <Button variant="ghost" size="icon" className="h-7 w-7" title="Refresh option chain and quote" aria-label="Refresh option chain and quote" onClick={() => {
              void refetch();
              void underlyingQuoteQuery.refetch();
            }}>

              <RefreshCw className="h-3.5 w-3.5" />

            </Button>

            <Button variant="ghost" size="icon" className="h-7 w-7" title="Scroll to ATM strike" aria-label="Scroll to ATM strike" onClick={scrollToATM}>

              <Crosshair className="h-3.5 w-3.5" />

            </Button>

            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowChart(v => !v)} title="Toggle Price Chart" aria-label="Toggle Price Chart">

              <BarChart3 className={`h-3.5 w-3.5 ${showChart ? "text-primary" : ""}`} />

            </Button>

            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={downloadCSV} title="Download CSV" aria-label="Download CSV">

              <Download className="h-3.5 w-3.5" />

            </Button>



          {/* Download Past OC Data */}

          <Popover>

            <PopoverTrigger asChild>

              <Button variant="ghost" size="icon" className="h-7 w-7" title="Download Past Option Chain" aria-label="Download Past Option Chain">

                <History className="h-3.5 w-3.5" />

              </Button>

            </PopoverTrigger>

            <PopoverContent className="w-56 p-3" align="end">

              <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Download Past Expiry</p>

              <div className="space-y-1">

                {expiries.map(exp => (

                  <button

                    key={exp.value}

                    onClick={() => downloadPastOC(exp.value)}

                    disabled={isDownloadingPast}

                    className="w-full text-left px-2 py-1.5 rounded text-xs hover:bg-accent transition-colors flex items-center justify-between"

                  >

                    <span>{exp.label} ({exp.daysToExpiry}d)</span>

                    <Download className="h-3 w-3 text-muted-foreground" />

                  </button>

                ))}

              </div>

            </PopoverContent>

          </Popover>



        {/* Column Config */}

          <Popover>

            <PopoverTrigger asChild>

              <Button variant="ghost" size="icon" className="h-7 w-7" title="Configure visible columns" aria-label="Configure visible columns"><Settings2 className="h-3.5 w-3.5" /></Button>

            </PopoverTrigger>

            <PopoverContent className="w-48 p-3" align="end">

              <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Show Columns</p>

              <div className="space-y-1.5">

                {Object.entries(columnConfig).map(([key, val]) => (

                  <div key={key} className="flex items-center justify-between">

                    <Label className="text-xs capitalize">{key === "oiChange" ? "OI Change" : key === "timeValue" ? "Time Value" : key}</Label>

                    <Switch checked={val} onCheckedChange={(v) => setColumnConfig({ ...columnConfig, [key]: v })} className="scale-[0.6]" />

                  </div>

                ))}

              </div>

            </PopoverContent>

          </Popover>



          {/* Shortcuts Info */}

          <Popover>

            <PopoverTrigger asChild>

              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary transition-colors" title="Keyboard Shortcuts" aria-label="Keyboard Shortcuts">

                <kbd className="font-mono text-[10px] px-1.5 py-0.5 rounded border border-border/50 bg-accent/30 font-semibold shadow-sm">?</kbd>

              </Button>

            </PopoverTrigger>

            <PopoverContent className="w-64 p-4" align="end">

              <p className="text-[11px] font-bold text-muted-foreground mb-3 uppercase tracking-wider flex items-center gap-2">

                <Keyboard className="h-3.5 w-3.5" />

                Keyboard Shortcuts

              </p>

              <div className="space-y-2 text-xs">

                <div className="flex justify-between items-center"><span className="text-muted-foreground">Focus Search</span><kbd className="px-1.5 py-0.5 rounded bg-muted border font-mono">K</kbd></div>

                <div className="flex justify-between items-center"><span className="text-muted-foreground">Refresh Data</span><kbd className="px-1.5 py-0.5 rounded bg-muted border font-mono">R</kbd></div>

                <div className="flex justify-between items-center"><span className="text-muted-foreground">Next Strike</span><kbd className="px-1.5 py-0.5 rounded bg-muted border font-mono">J</kbd></div>

                <div className="flex justify-between items-center"><span className="text-muted-foreground">Prev Strike</span><kbd className="px-1.5 py-0.5 rounded bg-muted border font-mono">K</kbd></div>

                <div className="flex justify-between items-center"><span className="text-muted-foreground">Add to Strategy</span><kbd className="px-1.5 py-0.5 rounded bg-muted border font-mono">A</kbd></div>

              </div>

            </PopoverContent>

          </Popover>

          </div>

        </div>

        <div className="flex flex-wrap items-end justify-between gap-x-5 gap-y-2 border-t border-border/70 pt-2.5">
          <div className="min-w-[220px]">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-sm font-semibold text-foreground">{symbol}</span>
              {underlyingExchangeLabel && (
                <Badge variant="outline" className="h-5 px-1.5 text-[9px] font-semibold tracking-wide text-muted-foreground">
                  {underlyingExchangeLabel}
                </Badge>
              )}
              <strong className="font-mono text-2xl leading-none tracking-tight text-foreground">
                {underlyingQuote && underlyingQuote.ltp > 0
                  ? underlyingQuote.ltp.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                  : spotPrice > 0
                    ? spotPrice.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                    : "—"}
              </strong>
              {underlyingQuote?.change != null && (
                <span className={`font-mono text-xs font-medium ${underlyingQuote.change >= 0 ? "text-bullish" : "text-bearish"}`}>
                  {underlyingQuote.change >= 0 ? "+" : ""}{underlyingQuote.change.toFixed(2)}
                  ({underlyingQuote.changePercent == null ? "—" : `${underlyingQuote.changePercent.toFixed(2)}%`})
                </span>
              )}
              {underlyingQuote && !underlyingQuoteFresh && <span className="text-[10px] font-semibold tracking-wide text-amber-400">HISTORICAL QUOTE</span>}
              {underlyingQuoteQuery.error && <span className="text-[10px] text-amber-400" title={underlyingQuoteQuery.error.message}>Underlying quote unavailable</span>}
            </div>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] font-mono">
            <span className="text-muted-foreground">OPEN <b className="text-foreground">{underlyingQuote?.open ?? "—"}</b></span>
            <span className="text-muted-foreground">HIGH <b className="text-foreground">{underlyingQuote?.high ?? "—"}</b></span>
            <span className="text-muted-foreground">LOW <b className="text-foreground">{underlyingQuote?.low ?? "—"}</b></span>
            <span className="text-muted-foreground">PREV CLOSE <b className="text-foreground">{underlyingQuote?.previousClose ?? "—"}</b></span>
          </div>
        </div>
      </section>



      {/* Price Chart (collapsible) */}

      {showChart && (

        <StockChart symbol={symbol} inline height={280} />

      )}



      {/* Expiry selector */}
      {viewMode === "expiration" && expiries.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-card/60 px-3 py-2">

          <span className="mr-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Expiry</span>

          {expiries.slice(0, 5).map((exp) => {

            const parts = exp.label.split(" ");

            const isSelected = (selectedExpiry || expiries[0]?.value) === exp.value;

            return (

              <button

                key={exp.value}

                onClick={() => setSelectedExpiry(exp.value)}

                className={`flex min-w-[54px] flex-col items-center rounded-md border px-2.5 py-1 text-xs transition-colors ${

                  isSelected

                    ? "border-primary/60 bg-primary/10 font-bold text-primary shadow-sm"

                    : "border-border bg-background/70 hover:border-primary/40 hover:bg-accent/50"

                }`}

              >

                <span className="text-xs opacity-70">{parts[1]}</span>

                <span className="font-bold text-sm leading-none">{parts[0]}</span>

              </button>

            );

          })}

          {expiries.length > 5 && (

            <Select value={selectedExpiry || expiries[0]?.value} onValueChange={setSelectedExpiry}>

              <SelectTrigger className="h-8 w-[112px] text-xs"><SelectValue placeholder="More expiries" /></SelectTrigger>

              <SelectContent>

                {expiries.slice(5).map(e => (

                  <SelectItem key={e.value} value={e.value}>{e.label} ({e.daysToExpiry}d)</SelectItem>

                ))}

              </SelectContent>

            </Select>

          )}
          <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2 pl-2">
            <span className="text-[11px] text-muted-foreground"><b className="font-medium text-foreground">{activeExpiry?.daysToExpiry ?? "—"} DTE</b><span className="mx-1.5 text-border">|</span>Lot <b className="font-medium text-foreground">{lotSize > 0 ? lotSize : "—"}</b></span>
            <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Switch
                checked={perLot}
                onCheckedChange={setPerLot}
                disabled={lotSize <= 0}
                aria-label="Show option prices per lot"
                className="scale-[0.75]"
              />
              Per Lot{lotSize > 0 ? ` (${lotSize})` : ""}
            </label>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[11px]"
              disabled
              title="Buildup classification is unavailable because the feed does not provide option-price change and OI change together."
            >
              Buildup unavailable
            </Button>
          </div>
        </div>
      )}



      {/* After-Hours Banner */}

      {afterHours && (

        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400">

          <WifiOff className="h-4 w-4 shrink-0" />

          <div className="flex-1">

            <p className="text-xs font-medium">Market Closed -- {hasData ? "Showing Last Available Data" : "No Cached Data Available"}</p>

            <p className="text-xs text-amber-400/60 mt-0.5">

              {hasData

                ? "Data is from the last market session. PCR, Max Pain, and OI values reflect closing snapshot."

                : "Option chain data will be available once the market opens (9:15 AM IST) or when the proxy has cached data."}

              {cachedMinutesAgo !== null && ` Cached ${cachedMinutesAgo} min ago.`}

            </p>

          </div>

        </div>

      )}



      {/* Empty State: No data and not loading */}

      {!hasData && !afterHours && !isChainLoading && (

        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground border border-dashed border-border/50 rounded-lg bg-card/30">

          <WifiOff className="h-10 w-10 mb-3 opacity-40 animate-pulse" />

          <p className="text-[15px] font-semibold text-foreground">Unable to load Option Chain</p>

          <p className="text-xs mt-1.5 max-w-sm text-center leading-relaxed">

            {error instanceof Error

              ? error.message

              : masterLoadError ?? `Central market data could not resolve ${symbol}.`}

          </p>

          <Button variant="outline" size="sm" className="mt-5 gap-1.5 hover:text-primary hover:border-primary/50 transition-colors" onClick={() => refetch()}>

            <RefreshCw className="h-3.5 w-3.5" />

            Retry Connection

          </Button>

        </div>

      )}



      {/* Strike Scroller for "By Strike" view */}

      {viewMode === "strike" && allStrikes.length > 0 && (

        <div className="flex items-center gap-1">

          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => {

            if (strikeScrollRef.current) strikeScrollRef.current.scrollLeft -= 200;

          }}>

            <ChevronLeft className="h-4 w-4" />

          </Button>

          <div className="relative flex-1">

            <p className="text-[11px] text-muted-foreground text-center mb-1">Strike</p>

            <div ref={strikeScrollRef} className="flex gap-0.5 overflow-x-auto scrollbar-hide pb-1" style={{ scrollBehavior: "smooth" }}>

              {allStrikes.map(s => {

                const isATM = s === atmStrike;

                const isSelected = s === selectedStrike;

                return (

                  <button

                    key={s}

                    onClick={() => setSelectedStrike(s)}

                    className={`shrink-0 px-2.5 py-1.5 rounded text-xs font-mono transition-colors border ${

                      isSelected

                        ? "bg-foreground text-background border-foreground font-bold"

                        : isATM

                          ? "bg-primary/10 border-primary/30 text-primary font-semibold"

                          : "border-border hover:bg-accent"

                    }`}

                  >

                    {isATM && (

                      <div className="text-[11px] leading-none mb-0.5 opacity-70">

                        {symbol} {spotPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 })}

                      </div>

                    )}

                    {s.toLocaleString("en-IN")}

                  </button>

                );

              })}

            </div>

          </div>

          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => {

            if (strikeScrollRef.current) strikeScrollRef.current.scrollLeft += 200;

          }}>

            <ChevronRight className="h-4 w-4" />

          </Button>

        </div>

      )}



      {/* Summary Stats */}

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">

        {[

          { label: "CE OI", value: hasData ? `${(totalCEOI / 100000).toFixed(1)}L` : "—" },
          { label: "PE OI", value: hasData ? `${(totalPEOI / 100000).toFixed(1)}L` : "—" },
          { label: "CE Vol", value: hasData ? `${(totalCEVol / 100000).toFixed(1)}L` : "—" },
          { label: "PE Vol", value: hasData ? `${(totalPEVol / 100000).toFixed(1)}L` : "—" },
          { label: "Straddle", value: atmRow ? ((atmRow.ce.ltp + atmRow.pe.ltp) * priceDisplayMultiplier).toFixed(2) : "—", className: "text-warning" },
          { label: "PCR", value: hasData ? pcr : "—", className: Number(pcr) > 1 ? "text-bullish" : "text-bearish" },
          { label: "Max Pain", value: hasData && maxPain > 0 ? maxPain.toLocaleString("en-IN") : "—", className: "text-warning" },
          { label: "ATM IV", value: atmRow && atmRow.ce.iv + atmRow.pe.iv > 0 ? `${((atmRow.ce.iv + atmRow.pe.iv) / 2).toFixed(1)}%` : "—" },

        ].map(stat => (

          <div key={stat.label} className="rounded-lg border border-border/70 bg-card px-2.5 py-2 text-center transition-colors hover:border-primary/30">

            <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{stat.label}</p>

            <p className={`mt-0.5 text-sm font-bold font-mono tabular-nums ${stat.className || ""}`}>{stat.value}</p>

          </div>

        ))}

      </div>



      {/* Unusual Activity Banner */}

      {unusualActivity.count > 0 && (

        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-orange-500/10 border border-orange-500/25 text-xs">

          <Flame className="h-3.5 w-3.5 text-orange-500 animate-pulse" />

          <span className="font-semibold text-orange-500">{unusualActivity.count} Volume Spikes</span>
          <span className="text-muted-foreground">strikes above 3× mean volume for this chain:</span>

          <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide">

            {unusualActivity.hotStrikes.map(s => {

              const flag = unusualActivity.flags.get(s)!;

              return (

                <button
                  key={s}
                  type="button"
                  onClick={() => document.getElementById(`option-strike-${s}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}
                  className="inline-flex shrink-0 items-center gap-1 rounded-full border border-orange-500/30 px-2 py-0.5 text-[11px] text-orange-500 hover:bg-orange-500/10"
                  aria-label={`Jump to strike ${s}`}
                >
                  {s.toLocaleString("en-IN")}
                  {flag.ce && <span className="text-primary">CE</span>}
                  {flag.ce && flag.pe && <span className="text-muted-foreground">+</span>}
                  {flag.pe && <span className="text-bearish">PE</span>}
                </button>

              );

            })}

          </div>

        </div>

      )}



      {/* Sticky ATM Bar */}

      {atmRow && viewMode === "expiration" && (

        <div className="sticky top-0 z-20 flex items-center justify-between gap-2 px-3 py-1 rounded bg-primary/5 border border-primary/20 text-xs font-mono">

          <div className="flex items-center gap-3">

            <span className="font-sans font-semibold text-primary">ATM {atmStrike}</span>

            <span>CE: <span className="text-primary font-medium">{atmRow.ce.ltp > 0 ? (atmRow.ce.ltp * priceDisplayMultiplier).toFixed(2) : "—"}</span></span>
            <span>PE: <span className="text-bearish font-medium">{atmRow.pe.ltp > 0 ? (atmRow.pe.ltp * priceDisplayMultiplier).toFixed(2) : "—"}</span></span>
            <span>Straddle: <span className="text-warning font-medium">{atmRow.ce.ltp + atmRow.pe.ltp > 0 ? ((atmRow.ce.ltp + atmRow.pe.ltp) * priceDisplayMultiplier).toFixed(2) : "—"}</span></span>

          </div>

          <div className="flex items-center gap-3 text-muted-foreground">

            <span>MP: <span className="text-warning">{maxPain > 0 ? maxPain.toLocaleString("en-IN") : "—"}</span></span>
            <span>IV: {(atmRow.ce.iv + atmRow.pe.iv) > 0 ? `${((atmRow.ce.iv + atmRow.pe.iv) / 2).toFixed(1)}%` : "—"}</span>

          </div>

        </div>

      )}



{/*  BY EXPIRATION VIEW  */}

      {viewMode === "expiration" && (

        <Card>

          <CardContent className="p-0 max-h-[65vh] [&>div]:max-h-[65vh] [&>div]:overflow-auto">

            {isChainLoading ? (

              <div className="p-4 space-y-2">

                {Array.from({ length: 12 }).map((_, i) => (

                  <div key={i} className="flex gap-2 items-center">

                    <div className="flex-1 h-6 skeleton-shimmer rounded bg-muted/20" style={{ animationDelay: `${i * 60}ms` }} />

                    <div className="w-16 h-6 skeleton-shimmer rounded bg-primary/5" />

                    <div className="flex-1 h-6 skeleton-shimmer rounded bg-muted/20" style={{ animationDelay: `${i * 60 + 30}ms` }} />

                  </div>

                ))}

              </div>

            ) : (

              <Table>

                <TableHeader className="sticky top-0 z-10 bg-card">

                  {/* CALLS / STRIKE / PUTS header */}

                  <TableRow className="text-xs border-b [&>th]:h-8 [&>th]:px-2 [&>th]:py-1">

                    <TableHead className="text-center text-primary font-bold bg-primary/[0.04]" colSpan={callCols}>Calls (CE)</TableHead>

                    <TableHead className="text-center font-bold bg-accent/50 border-x border-border" colSpan={2}>Strike / PCR</TableHead>

                    <TableHead className="text-center text-bearish font-bold bg-bearish/[0.04]" colSpan={putCols}>Puts (PE)</TableHead>

                  </TableRow>

{/* Dhan-style call columns run from Greeks to price. */}

                  <TableRow className="text-[11px] text-muted-foreground [&>th]:h-8 [&>th]:px-2 [&>th]:py-1">

                    {columnConfig.theta && <TableHead className="text-right">Theta</TableHead>}

                    {columnConfig.delta && <TableHead className="text-right">Delta</TableHead>}

                    {columnConfig.iv && <TableHead className="text-right">IV%</TableHead>}

                    {columnConfig.volume && <TableHead className="text-right">Volume</TableHead>}

                    {columnConfig.oi && <TableHead className="text-right">OI</TableHead>}
                    {columnConfig.oiChange && <TableHead className="text-right">OI Chg</TableHead>}
                    {columnConfig.price && <TableHead className="text-right font-semibold text-primary">LTP</TableHead>}

                    {columnConfig.ask && <TableHead className="text-right">Ask</TableHead>}
                    {columnConfig.bid && <TableHead className="text-right">Bid</TableHead>}
                    {columnConfig.gamma && <TableHead className="text-right">Gamma</TableHead>}
                    {columnConfig.vega && <TableHead className="text-right">Vega</TableHead>}
                    {columnConfig.timeValue && <TableHead className="text-right">Time</TableHead>}
                    {columnConfig.intrinsic && <TableHead className="text-right">Intr.</TableHead>}

                    {/* Strike and PCR stay in the center lane. */}

                    <TableHead className="text-center bg-accent/50 border-l border-border font-semibold">Strike</TableHead>

                    <TableHead className="text-center bg-accent/50 border-r border-border font-semibold">PCR</TableHead>

                    {/* Put columns mirror the call side. */}

                    {columnConfig.price && <TableHead className="text-left font-semibold text-bearish">LTP</TableHead>}
                    {columnConfig.oi && <TableHead className="text-left">OI</TableHead>}
                    {columnConfig.oiChange && <TableHead className="text-left">OI Chg</TableHead>}
                    {columnConfig.volume && <TableHead className="text-left">Volume</TableHead>}
                    {columnConfig.bid && <TableHead className="text-left">Bid</TableHead>}
                    {columnConfig.ask && <TableHead className="text-left">Ask</TableHead>}
                    {columnConfig.iv && <TableHead className="text-left">IV%</TableHead>}
                    {columnConfig.delta && <TableHead className="text-left">Delta</TableHead>}
                    {columnConfig.theta && <TableHead className="text-left">Theta</TableHead>}
                    {columnConfig.gamma && <TableHead className="text-left">Gamma</TableHead>}
                    {columnConfig.vega && <TableHead className="text-left">Vega</TableHead>}
                    {columnConfig.timeValue && <TableHead className="text-left">Time</TableHead>}
                    {columnConfig.intrinsic && <TableHead className="text-left">Intr.</TableHead>}
                  </TableRow>

                </TableHeader>

                <TableBody>

                  {enrichedChain.map((row, idx) => {

                    const isATM = row.strikePrice === atmStrike;

                    const isITMCall = row.strikePrice < spotPrice;

                    const isITMPut = row.strikePrice > spotPrice;

                    const isMP = row.strikePrice === maxPain;

                    const rowPCR = row.ce.oi > 0 ? (row.pe.oi / row.ce.oi).toFixed(2) : "—";

                    const uaFlag = unusualActivity.flags.get(row.strikePrice);

                    const hasUA = !!uaFlag;



                    const isFocused = idx === focusedStrikeIdx;



                    return (

                      <ContextMenu key={row.strikePrice}>

                        <ContextMenuTrigger asChild>

                          <TableRow

                            id={`option-strike-${row.strikePrice}`}

                            className={`group text-xs sm:text-[11px] font-mono cursor-context-menu transition-colors hover:bg-accent/30 [&>td]:px-2 ${

                              isATM ? "bg-primary/[0.08] border-y-2 border-primary/30 shadow-[inset_0_0_20px_hsl(var(--primary)/0.06)]" : ""

                            } ${hasUA ? "bg-orange-500/[0.04]" : ""} ${isFocused ? "ring-1 ring-primary/60 bg-primary/[0.04]" : ""}`}

                          >

{/*  CALL SIDE  */}

                            {columnConfig.theta && <TableCell className="text-right py-1 tabular-nums text-bearish/80 bg-primary/[0.025]">{data?.greeksAvailable ? row.ce.theta.toFixed(2) : "—"}</TableCell>}
                            {columnConfig.delta && <TableCell className="text-right py-1 tabular-nums font-medium bg-primary/[0.025]">{data?.greeksAvailable ? row.ce.delta.toFixed(2) : "—"}</TableCell>}
                            {columnConfig.iv && <TableCell className={`text-right py-1 tabular-nums bg-primary/[0.025] ${isITMCall ? "text-muted-foreground/70" : ""}`}>{row.ce.iv > 0 ? row.ce.iv.toFixed(1) : "—"}</TableCell>}

                            {columnConfig.volume && (
                              <TableCell className="text-right py-1 bg-primary/[0.025]">
                                <div className="flex items-center justify-end gap-0.5">
                                  {uaFlag?.ce && <Flame className="h-3 w-3 text-orange-500 shrink-0" />}
                                  <VolumeBar value={row.ce.volume} max={maxVol} side="call" />
                                </div>
                              </TableCell>
                            )}
                            {columnConfig.oi && <TableCell className="text-right py-1 tabular-nums bg-primary/[0.025]">{row.ce.oi.toLocaleString("en-IN")}</TableCell>}
                            {columnConfig.oiChange && <TableCell className="text-right py-1 tabular-nums bg-primary/[0.025]">{data?.oiChangeAvailable === true ? row.ce.oiChange.toLocaleString("en-IN") : "—"}</TableCell>}

                            {columnConfig.price && (

                              <TableCell className="text-right py-1 font-semibold bg-primary/[0.025]">

                                <button onClick={() => openBuyTicket(row.strikePrice, "CE", row)} className="hover:text-primary transition-colors">

                                  {row.ce.ltp > 0 ? (row.ce.ltp * priceDisplayMultiplier).toFixed(2) : "—"}

                                </button>

                              </TableCell>

                            )}

                            {columnConfig.ask && <TableCell className="text-right py-1 tabular-nums bg-primary/[0.025]">{row.ce.askPrice > 0 ? (row.ce.askPrice * priceDisplayMultiplier).toFixed(2) : "—"}</TableCell>}
                            {columnConfig.bid && <TableCell className="text-right py-1 tabular-nums bg-primary/[0.025]">{row.ce.bidPrice > 0 ? (row.ce.bidPrice * priceDisplayMultiplier).toFixed(2) : "—"}</TableCell>}
                            {columnConfig.gamma && <TableCell className="text-right py-1 tabular-nums bg-primary/[0.025]">{data?.greeksAvailable ? row.ce.gamma.toFixed(4) : "—"}</TableCell>}
                            {columnConfig.vega && <TableCell className="text-right py-1 tabular-nums bg-primary/[0.025]">{data?.greeksAvailable ? row.ce.vega.toFixed(2) : "—"}</TableCell>}
                            {columnConfig.timeValue && <TableCell className="text-right py-1 tabular-nums bg-primary/[0.025]">{row.ce.timeValue.toFixed(2)}</TableCell>}
                            {columnConfig.intrinsic && <TableCell className={`text-right py-1 tabular-nums bg-primary/[0.025] ${row.ce.intrinsic > 0 ? "" : "text-muted-foreground/50"}`}>{row.ce.intrinsic.toFixed(2)}</TableCell>}



{/*  STRIKE  */}

                            <TableCell className="relative text-center bg-accent/50 border-l border-border py-1">

                              <div className="flex flex-col items-center">

                                <div className="flex items-center gap-1">

                                  <span className={`font-bold text-[11px] ${isATM ? "text-primary" : isMP ? "text-warning" : ""}`}>

                                    {row.strikePrice.toLocaleString("en-IN")}

                                  </span>

                                  {isATM && (

                                    <span className="text-[11px] font-bold bg-primary text-primary-foreground px-1 py-0 rounded-sm leading-tight">

                                      ATM

                                    </span>

                                  )}

                                </div>

                                {isMP && <span className="text-[11px] text-warning/60 font-medium">MAX PAIN</span>}

                              </div>
                              <div className="absolute left-1/2 top-1/2 z-20 flex -translate-x-1/2 -translate-y-1/2 rounded bg-card/95 p-0.5 opacity-0 shadow-lg ring-1 ring-border transition-opacity pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto [@media(hover:none)]:relative [@media(hover:none)]:left-auto [@media(hover:none)]:top-auto [@media(hover:none)]:z-auto [@media(hover:none)]:mt-1 [@media(hover:none)]:translate-x-0 [@media(hover:none)]:translate-y-0 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100">
                                <OptionChainStrikeActions
                                  strike={row.strikePrice}
                                  onChart={(type) => openChart(row.strikePrice, type, row)}
                                  onBuy={(type) => openBuyTicket(row.strikePrice, type, row)}
                                  onSell={(type) => openSellTicket(row.strikePrice, type, row)}
                                  isSelected={(type) => basket.some((contract) =>
                                    contract.underlying === symbol
                                    && contract.expiry === (selectedExpiry || expiries[0]?.value || "")
                                    && contract.strike === row.strikePrice
                                    && contract.type === type
                                  )}
                                  onToggleSelection={(type) => toggleBasketContract(row.strikePrice, type)}
                                  isInWatchlist={(type) => optionWatchlist.some((contract) =>
                                    contract.underlying === symbol
                                    && contract.expiry === (selectedExpiry || expiries[0]?.value || "")
                                    && contract.strike === row.strikePrice
                                    && contract.type === type
                                  )}
                                  onToggleWatchlist={(type) => toggleOptionWatchlist(row.strikePrice, type)}
                                  onFullscreen={(type) => {
                                    void document.documentElement.requestFullscreen().catch((error: unknown) => {
                                      toast.error(`Could not open fullscreen chart: ${error instanceof Error ? error.message : "fullscreen is unavailable."}`);
                                    });
                                    openChart(row.strikePrice, type, row);
                                  }}
                                  onAlert={(type) => toast.info(`Option contract alerts are unsupported for ${symbol} ${row.strikePrice} ${type}.`)}
                                  onForeverOrder={(type) => toast.info(`Forever orders are unsupported for ${symbol} ${row.strikePrice} ${type} in the current order service.`)}
                                  resolveContract={(type) => buildOrderContract(row.strikePrice, type)}
                                />

                              </div>

                            </TableCell>

                            <TableCell className="text-center py-1 bg-accent/50 border-r border-border text-muted-foreground">{rowPCR}</TableCell>



{/*  PUT SIDE  */}

                            {columnConfig.price && (

                              <TableCell className="text-left py-1 font-semibold bg-bearish/[0.025]">

                                <button onClick={() => openBuyTicket(row.strikePrice, "PE", row)} className="hover:text-bearish transition-colors">

                                  {row.pe.ltp > 0 ? (row.pe.ltp * priceDisplayMultiplier).toFixed(2) : "—"}

                                </button>

                              </TableCell>

                            )}

                            {columnConfig.oi && <TableCell className="text-left py-1 tabular-nums bg-bearish/[0.025]">{row.pe.oi.toLocaleString("en-IN")}</TableCell>}
                            {columnConfig.oiChange && <TableCell className="text-left py-1 tabular-nums bg-bearish/[0.025]">{data?.oiChangeAvailable === true ? row.pe.oiChange.toLocaleString("en-IN") : "—"}</TableCell>}
                            {columnConfig.volume && (
                              <TableCell className="text-left py-1 bg-bearish/[0.025]">
                                <div className="flex items-center gap-0.5">
                                  <VolumeBar value={row.pe.volume} max={maxVol} side="put" />
                                  {uaFlag?.pe && <Flame className="h-3 w-3 text-orange-500 shrink-0" />}
                                </div>
                              </TableCell>
                            )}
                            {columnConfig.bid && <TableCell className="text-left py-1 tabular-nums bg-bearish/[0.025]">{row.pe.bidPrice > 0 ? (row.pe.bidPrice * priceDisplayMultiplier).toFixed(2) : "—"}</TableCell>}
                            {columnConfig.ask && <TableCell className="text-left py-1 tabular-nums bg-bearish/[0.025]">{row.pe.askPrice > 0 ? (row.pe.askPrice * priceDisplayMultiplier).toFixed(2) : "—"}</TableCell>}
                            {columnConfig.iv && <TableCell className={`text-left py-1 tabular-nums bg-bearish/[0.025] ${isITMPut ? "text-muted-foreground/70" : ""}`}>{row.pe.iv > 0 ? row.pe.iv.toFixed(1) : "—"}</TableCell>}
                            {columnConfig.delta && <TableCell className="text-left py-1 tabular-nums font-medium bg-bearish/[0.025]">{data?.greeksAvailable ? row.pe.delta.toFixed(2) : "—"}</TableCell>}
                            {columnConfig.theta && <TableCell className="text-left py-1 tabular-nums text-bearish/80 bg-bearish/[0.025]">{data?.greeksAvailable ? row.pe.theta.toFixed(2) : "—"}</TableCell>}
                            {columnConfig.gamma && <TableCell className="text-left py-1 tabular-nums bg-bearish/[0.025]">{data?.greeksAvailable ? row.pe.gamma.toFixed(4) : "—"}</TableCell>}
                            {columnConfig.vega && <TableCell className="text-left py-1 tabular-nums bg-bearish/[0.025]">{data?.greeksAvailable ? row.pe.vega.toFixed(2) : "—"}</TableCell>}
                            {columnConfig.timeValue && <TableCell className="text-left py-1 tabular-nums bg-bearish/[0.025]">{row.pe.timeValue.toFixed(2)}</TableCell>}
                            {columnConfig.intrinsic && <TableCell className={`text-left py-1 tabular-nums bg-bearish/[0.025] ${row.pe.intrinsic > 0 ? "" : "text-muted-foreground/50"}`}>{row.pe.intrinsic.toFixed(2)}</TableCell>}

                          </TableRow>

                        </ContextMenuTrigger>

                        <ContextMenuContent className="w-48">

                          <ContextMenuSub>

                            <ContextMenuSubTrigger className="gap-2"><BarChart3 className="h-3.5 w-3.5 text-primary" /> Chart</ContextMenuSubTrigger>

                            <ContextMenuSubContent>

                              <ContextMenuItem onClick={() => handleContextAction(row.strikePrice, "CE", "chart", row)} className="text-xs">Chart CE @ ₹{row.ce.ltp.toFixed(2)}</ContextMenuItem>

                              <ContextMenuItem onClick={() => handleContextAction(row.strikePrice, "PE", "chart", row)} className="text-xs">Chart PE @ ₹{row.pe.ltp.toFixed(2)}</ContextMenuItem>

                            </ContextMenuSubContent>

                          </ContextMenuSub>

                          <ContextMenuSub>

                            <ContextMenuSubTrigger className="gap-2"><TrendingUp className="h-3.5 w-3.5 text-primary" /> Buy</ContextMenuSubTrigger>

                            <ContextMenuSubContent>

                              <ContextMenuItem onClick={() => handleContextAction(row.strikePrice, "CE", "buy", row)} className="text-xs">Buy CE @ ₹{row.ce.ltp.toFixed(2)}</ContextMenuItem>

                              <ContextMenuItem onClick={() => handleContextAction(row.strikePrice, "PE", "buy", row)} className="text-xs">Buy PE @ ₹{row.pe.ltp.toFixed(2)}</ContextMenuItem>

                            </ContextMenuSubContent>

                          </ContextMenuSub>

                          <ContextMenuSub>

                            <ContextMenuSubTrigger className="gap-2"><TrendingDown className="h-3.5 w-3.5 text-bearish" /> Sell</ContextMenuSubTrigger>

                            <ContextMenuSubContent>

                              <ContextMenuItem onClick={() => handleContextAction(row.strikePrice, "CE", "sell", row)} className="text-xs">Sell CE @ ₹{row.ce.ltp.toFixed(2)}</ContextMenuItem>

                              <ContextMenuItem onClick={() => handleContextAction(row.strikePrice, "PE", "sell", row)} className="text-xs">Sell PE @ ₹{row.pe.ltp.toFixed(2)}</ContextMenuItem>

                            </ContextMenuSubContent>

                          </ContextMenuSub>

                          <ContextMenuSeparator />

                          <ContextMenuItem onClick={() => handleContextAction(row.strikePrice, "CE", "straddle")} className="gap-2 text-xs">

                            <Layers className="h-3.5 w-3.5" /> Build Straddle ({(row.ce.ltp + row.pe.ltp).toFixed(1)})

                          </ContextMenuItem>

                          <ContextMenuItem onClick={() => handleContextAction(row.strikePrice, "CE", "alert")} className="gap-2 text-xs">

                            <Bell className="h-3.5 w-3.5" /> Set Alert

                          </ContextMenuItem>

                        </ContextMenuContent>

                      </ContextMenu>

                    );

                  })}

                </TableBody>

{/*  Sticky Summary Footer  */}

                {hasData && (

                  <tfoot className="sticky bottom-0 z-10 bg-card border-t-2 border-primary/20">

                    <tr className="text-xs font-mono font-semibold">

                      <td colSpan={callCols} className="text-right py-2 px-2">

                        <div className="flex items-center justify-end gap-4">

                          <span className="text-muted-foreground">CE Vol: <span className="text-foreground">{totalCEVol >= 1000000 ? (totalCEVol / 1000000).toFixed(1) + 'M' : (totalCEVol / 1000).toFixed(0) + 'K'}</span></span>

                          <span className="text-muted-foreground">CE OI: <span className="text-primary font-bold">{totalCEOI >= 1000000 ? (totalCEOI / 1000000).toFixed(1) + 'M' : (totalCEOI / 100000).toFixed(1) + 'L'}</span></span>

                        </div>

                      </td>

                      <td colSpan={2} className="text-center py-2 bg-accent/50 border-x-2 border-border">

                        <span className={`text-xs font-bold ${Number(pcr) > 1 ? 'text-bullish' : 'text-bearish'}`}>

                          PCR: {pcr}

                        </span>

                      </td>

                      <td colSpan={callCols} className="text-left py-2 px-2">

                        <div className="flex items-center gap-4">

                          <span className="text-muted-foreground">PE OI: <span className="text-bearish font-bold">{totalPEOI >= 1000000 ? (totalPEOI / 1000000).toFixed(1) + 'M' : (totalPEOI / 100000).toFixed(1) + 'L'}</span></span>

                          <span className="text-muted-foreground">PE Vol: <span className="text-foreground">{totalPEVol >= 1000000 ? (totalPEVol / 1000000).toFixed(1) + 'M' : (totalPEVol / 1000).toFixed(0) + 'K'}</span></span>

                        </div>

                      </td>

                    </tr>

                  </tfoot>

                )}

              </Table>

            )}

          </CardContent>

        </Card>

      )}



{/*  BY STRIKE VIEW  */}

      {viewMode === "strike" && (

        <Card>

          <CardContent className="p-0 overflow-auto">

            {byStrikeData.length === 0 ? (

              <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">

                <Crosshair className="h-8 w-8 opacity-20" />
                <p className="text-sm">
                  {byStrikeQueries.some((query) => query.isLoading)
                    ? "Loading verified option-chain data for each expiry…"
                    : byStrikeQueries.some((query) => query.error)
                      ? `Could not load expiry comparison: ${byStrikeQueries.find((query) => query.error)?.error instanceof Error ? (byStrikeQueries.find((query) => query.error)?.error as Error).message : "Dhan request failed."}`
                      : selectedStrike
                        ? "No expiry returned data for this strike."
                        : "Select a strike price above to compare across expiries."}
                </p>
                <p className="text-xs opacity-60">Values below come from Dhan option-chain responses for the corresponding expiry.</p>

              </div>

            ) : (

              <>

              <Table>

                <TableHeader className="sticky top-0 z-10 bg-card">

                  <TableRow className="text-xs border-b-2">

                    <TableHead className="text-center text-primary font-bold" colSpan={callCols}>Calls</TableHead>

                    <TableHead className="text-center font-bold bg-accent/50 border-x-2 border-border">Exp Date</TableHead>

                    <TableHead className="text-center text-bearish font-bold" colSpan={putCols}>Puts</TableHead>

                  </TableRow>

                  <TableRow className="text-[11px] text-muted-foreground">

                    {columnConfig.iv && <TableHead className="text-right">IV%</TableHead>}

                    {columnConfig.intrinsic && <TableHead className="text-right">Intr.</TableHead>}

                    {columnConfig.timeValue && <TableHead className="text-right">Time</TableHead>}


                    {columnConfig.vega && <TableHead className="text-right">Vega</TableHead>}

                    {columnConfig.theta && <TableHead className="text-right">Theta</TableHead>}

                    {columnConfig.gamma && <TableHead className="text-right">Gamma</TableHead>}

                    {columnConfig.delta && <TableHead className="text-right">Delta</TableHead>}

                    {columnConfig.price && <TableHead className="text-right font-semibold text-primary">Price</TableHead>}

                    {columnConfig.ask && <TableHead className="text-right">Ask</TableHead>}

                    {columnConfig.bid && <TableHead className="text-right">Bid</TableHead>}

                    {columnConfig.volume && <TableHead className="text-right">Volume</TableHead>}

                    <TableHead className="text-center bg-accent/50 border-x-2 border-border font-semibold">Exp Date</TableHead>

                    {columnConfig.volume && <TableHead className="text-left">Volume</TableHead>}

                    {columnConfig.bid && <TableHead className="text-left">Bid</TableHead>}

                    {columnConfig.ask && <TableHead className="text-left">Ask</TableHead>}

                    {columnConfig.price && <TableHead className="text-left font-semibold text-bearish">Price</TableHead>}

                    {columnConfig.delta && <TableHead className="text-left">Delta</TableHead>}

                    {columnConfig.gamma && <TableHead className="text-left">Gamma</TableHead>}

                    {columnConfig.theta && <TableHead className="text-left">Theta</TableHead>}

                    {columnConfig.vega && <TableHead className="text-left">Vega</TableHead>}


                    {columnConfig.timeValue && <TableHead className="text-left">Time</TableHead>}

                    {columnConfig.intrinsic && <TableHead className="text-left">Intr.</TableHead>}

                    {columnConfig.iv && <TableHead className="text-left">IV%</TableHead>}

                  </TableRow>

                </TableHeader>

                <TableBody>

                  {byStrikeData.map((row) => (

                    <TableRow key={row.expiry} className="text-xs sm:text-[11px] font-mono hover:bg-accent/30 transition-colors">

                      {columnConfig.iv && <TableCell className="text-right py-1.5 tabular-nums">{row.ce.iv.toFixed(1)}</TableCell>}

                      {columnConfig.intrinsic && <TableCell className="text-right py-1.5 tabular-nums">{row.ce.intrinsic.toFixed(2)}</TableCell>}

                      {columnConfig.timeValue && <TableCell className="text-right py-1.5 tabular-nums">{row.ce.timeValue.toFixed(2)}</TableCell>}


                      {columnConfig.vega && <TableCell className="text-right py-1.5 tabular-nums">{row.greeksAvailable ? row.ce.vega.toFixed(2) : "—"}</TableCell>}

                      {columnConfig.theta && <TableCell className="text-right py-1.5 tabular-nums text-bearish/80">{row.greeksAvailable ? row.ce.theta.toFixed(2) : "—"}</TableCell>}

                      {columnConfig.gamma && <TableCell className="text-right py-1.5 tabular-nums">{row.greeksAvailable ? row.ce.gamma.toFixed(4) : "—"}</TableCell>}

                      {columnConfig.delta && <TableCell className="text-right py-1.5 tabular-nums font-medium">{row.greeksAvailable ? row.ce.delta.toFixed(2) : "—"}</TableCell>}

                      {columnConfig.price && <TableCell className="text-right py-1.5 font-semibold">{row.ce.ltp.toFixed(2)}</TableCell>}

                      {columnConfig.ask && <TableCell className="text-right py-1.5 tabular-nums">{row.ce.ask.toFixed(2)}</TableCell>}

                      {columnConfig.bid && <TableCell className="text-right py-1.5 tabular-nums">{row.ce.bid.toFixed(2)}</TableCell>}

                      {columnConfig.volume && <TableCell className="text-right py-1.5"><VolumeBar value={row.ce.volume} max={maxVol} side="call" /></TableCell>}

                      <TableCell className="text-center py-1.5 bg-accent/50 border-x-2 border-border font-semibold font-sans text-xs">{row.expiry}</TableCell>

                      {columnConfig.volume && <TableCell className="text-left py-1.5"><VolumeBar value={row.pe.volume} max={maxVol} side="put" /></TableCell>}

                      {columnConfig.bid && <TableCell className="text-left py-1.5 tabular-nums">{row.pe.bid.toFixed(2)}</TableCell>}

                      {columnConfig.ask && <TableCell className="text-left py-1.5 tabular-nums">{row.pe.ask.toFixed(2)}</TableCell>}

                      {columnConfig.price && <TableCell className="text-left py-1.5 font-semibold">{row.pe.ltp.toFixed(2)}</TableCell>}

                      {columnConfig.delta && <TableCell className="text-left py-1.5 tabular-nums font-medium">{row.greeksAvailable ? row.pe.delta.toFixed(2) : "—"}</TableCell>}

                      {columnConfig.gamma && <TableCell className="text-left py-1.5 tabular-nums">{row.greeksAvailable ? row.pe.gamma.toFixed(4) : "—"}</TableCell>}

                      {columnConfig.theta && <TableCell className="text-left py-1.5 tabular-nums text-bearish/80">{row.greeksAvailable ? row.pe.theta.toFixed(2) : "—"}</TableCell>}

                      {columnConfig.vega && <TableCell className="text-left py-1.5 tabular-nums">{row.greeksAvailable ? row.pe.vega.toFixed(2) : "—"}</TableCell>}


                      {columnConfig.timeValue && <TableCell className="text-left py-1.5 tabular-nums">{row.pe.timeValue.toFixed(2)}</TableCell>}

                      {columnConfig.intrinsic && <TableCell className="text-left py-1.5 tabular-nums">{row.pe.intrinsic.toFixed(2)}</TableCell>}

                      {columnConfig.iv && <TableCell className="text-left py-1.5 tabular-nums">{row.pe.iv.toFixed(1)}</TableCell>}

                    </TableRow>

                  ))}

                </TableBody>

              </Table>

              </>

            )}

          </CardContent>

        </Card>

      )}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-card px-3 py-2">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 text-xs">
              In Basket <Badge variant="secondary" className="ml-1">{basket.length}</Badge>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-3" align="start">
            <p className="mb-2 text-xs font-semibold">Selected option contracts</p>
            {basket.length === 0 ? (
              <p className="text-xs text-muted-foreground">Select CE/PE using the check buttons beside each strike.</p>
            ) : (
              <div className="space-y-2">
                {basket.map((contract) => (
                  <div key={contractBasketKey(contract)} className="flex items-center justify-between gap-2 text-xs">
                    <span className="min-w-0 truncate">{contract.tradingSymbol} · {contract.lotSize > 0 ? `${contract.lotSize} qty/lot` : "lot size unavailable"}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2"
                      onClick={() => setBasket((current) => current.filter((item) => contractBasketKey(item) !== contractBasketKey(contract)))}
                      aria-label={`Remove ${contract.tradingSymbol} from basket`}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </PopoverContent>
        </Popover>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 text-xs">
              In Watchlist <Badge variant="secondary" className="ml-1">{optionWatchlist.length}</Badge>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-3" align="start">
            <p className="mb-2 text-xs font-semibold">Saved option contracts</p>
            {optionWatchlist.length === 0 ? (
              <p className="text-xs text-muted-foreground">Use the star beside a CE/PE contract to save it.</p>
            ) : (
              <div className="space-y-2">
                {optionWatchlist.map((contract) => (
                  <div key={optionContractWatchlistKey(contract)} className="flex items-center justify-between gap-2 text-xs">
                    <span className="min-w-0 truncate">{contract.tradingSymbol} · {contract.expiryLabel}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2"
                      onClick={() => removeOptionWatchlistContract(contract)}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </PopoverContent>
        </Popover>
        <Button
          size="sm"
          className="h-8 text-xs"
          disabled={basket.length === 0}
          onClick={() => navigate(`/strategy-builder?symbol=${encodeURIComponent(symbol)}`, {
            state: { optionContracts: basket },
          })}
        >
          <Layers className="mr-1.5 h-3.5 w-3.5" />
          Build Your Strategy
        </Button>
      </div>

      {/* ── Close Option Chain conditional ───────────────────────────────── */}

      </>

      )}



      {/* ── Contract chart tabs (block/hidden to preserve loaded state) ──── */}

      {openTabs

        .filter((t): t is Extract<OptionTab, { kind: "chart" }> => t.kind === "chart")

        .map(tab => (

          <div key={tab.id} className={activeTabId === tab.id ? "block" : "hidden"}>

            <OptionContractChartTab

              tab={tab as ChartTab}

              onBuy={() => {

                const c = buildOrderContract(tab.strike, tab.optionType);

                if (c) setOrderPopup({ contract: c, side: "BUY" });

              }}

              onSell={() => {

                const c = buildOrderContract(tab.strike, tab.optionType);

                if (c) setOrderPopup({ contract: c, side: "SELL" });

              }}

            />

          </div>

        ))

      }



      {/* Buy/Sell Order Popup — always rendered at the outer level */}

      {orderPopup && (

        <OptionOrderPopup

          contract={orderPopup.contract}

          initialSide={orderPopup.side}

          onClose={() => setOrderPopup(null)}

        />

      )}

    </div>

  );

}
