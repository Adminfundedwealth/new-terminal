import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { useMarketStatus } from "@/hooks/useMarketData";
import { isMeaningfulMarketValue } from "@/lib/marketDataState";
import { useNavigate } from "react-router-dom";
import { Search, Star, TrendingUp, TrendingDown, ExternalLink, Radio, Loader2, Plus, X, BarChart3 } from "lucide-react";
import { MiniChart } from "@/components/MiniChart";
import { useAccountContext } from "@/hooks/useAccountContext";
import { useInstrumentLookup } from "@/hooks/useLocalDatabase";
import { canonicalIndexSymbol, classifyInstrument, isCashEquityListing } from "@/lib/instrumentClassification";
import type { Instrument } from "@/lib/localDatabase";
import { fetchCentralMarketQuotes } from "@/lib/centralMarketQuotes";
import {
  requestTerminalMarketData,
  resolveTerminalMarketDataProvider,
  toLocalMarketDataInstrument,
  toTerminalMarketDataInstrument,
  type TerminalMarketDataInstrument,
  type TerminalMarketDataQuote,
} from "@/lib/terminalApi";
import { useQuery } from "@tanstack/react-query";

const STORAGE_KEY = "optionsdesk_watchlist";
const DEFAULT_WATCHLIST = ["NIFTY", "BANKNIFTY", "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK", "SBIN", "TATAMOTORS", "BAJFINANCE", "ADANIENT", "LT", "KOTAKBANK", "ITC", "HINDUNILVR"];
const INDEX_SYMBOLS = new Set(["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "INDIAVIX", "NIFTY_MIDCAP_50", "SENSEX"]);

function findSupportedInstrument(instruments: Instrument[], symbol: string): Instrument | undefined {
  const canonicalSymbol = canonicalIndexSymbol(symbol).toUpperCase();
  const category = INDEX_SYMBOLS.has(canonicalSymbol) ? "indices" : "stocks";
  const normalizedSymbol = canonicalSymbol.replace(/[^A-Z0-9]/g, "");
  return instruments.find((instrument) => {
    const actualCategory = classifyInstrument(instrument);
    if (actualCategory !== category) return false;
    if (category === "stocks" && !isCashEquityListing(instrument)) return false;
    return [instrument.symbol, instrument.tradingSymbol].some((value) =>
      (category === "indices" ? canonicalIndexSymbol(value) : value).toUpperCase().replace(/[^A-Z0-9]/g, "") === normalizedSymbol
    );
  });
}

function getSavedWatchlist(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : DEFAULT_WATCHLIST;
  } catch {
    return DEFAULT_WATCHLIST;
  }
}

function saveWatchlist(symbols: string[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(symbols));
}

export default function Watchlist() {
  const navigate = useNavigate();
  const [watchedSymbols, setWatchedSymbols] = useState<string[]>(() => getSavedWatchlist());
  const [search, setSearch] = useState("");
  const [addSymbol, setAddSymbol] = useState("");
  const [addSymbolError, setAddSymbolError] = useState<string | null>(null);
  const { instruments, isLoaded: instrumentsLoaded, loadError: instrumentLoadError } = useInstrumentLookup();
  const { activeAccountId, accounts, hasNoAccount } = useAccountContext();
  const { data: marketStatusData } = useMarketStatus();
  const provider = resolveTerminalMarketDataProvider(accounts.find((account) => account.id === activeAccountId)?.broker_provider);

  const supportedInstruments = useMemo(
    () => instruments.filter((instrument) =>
      classifyInstrument(instrument) === "indices" || isCashEquityListing(instrument)
    ),
    [instruments],
  );
  const quoteQuery = useQuery({
    queryKey: ["terminal-watchlist-quotes", activeAccountId ?? "central-dhan", provider, watchedSymbols, instrumentsLoaded],
    enabled: Boolean(instrumentsLoaded && watchedSymbols.length > 0 && (activeAccountId ? provider : hasNoAccount)),
    queryFn: async () => {
      if (!activeAccountId && hasNoAccount) {
        return fetchCentralMarketQuotes(watchedSymbols.map((symbol) => ({
          key: symbol,
          instrument: findSupportedInstrument(supportedInstruments, symbol),
        })));
      }
      if (!activeAccountId || !provider) throw new Error("An active account and market-data provider are required for account-scoped watchlist quotes.");
      const results = await Promise.allSettled(watchedSymbols.map(async (symbol) => {
        let instrument = findSupportedInstrument(supportedInstruments, symbol);

        if (!instrument) {
          const searchResults = await requestTerminalMarketData<TerminalMarketDataInstrument[]>(
            activeAccountId,
            provider,
            { operation: "searchInstruments", query: symbol },
          );
          const localSearchResults = searchResults
            .filter((candidate) =>
              candidate.providerInstrumentId && candidate.symbol && candidate.tradingSymbol
            )
            .map(toLocalMarketDataInstrument);
          instrument = findSupportedInstrument(localSearchResults, symbol);
        }
        if (!instrument) throw new Error(`Terminal OS could not resolve ${symbol} as a supported cash-equity or index instrument.`);
        const quote = await requestTerminalMarketData<TerminalMarketDataQuote>(
          activeAccountId,
          provider,
          { operation: "getQuote", instrument: toTerminalMarketDataInstrument(instrument, provider) },
        );
        return [symbol, quote] as const;
      }));
      const quotes: Record<string, TerminalMarketDataQuote> = {};
      const errors: string[] = [];
      for (const result of results) {
        if (result.status === "fulfilled") quotes[result.value[0]] = result.value[1];
        else errors.push(result.reason instanceof Error ? result.reason.message : "A watchlist quote request failed.");
      }
      return { quotes, errors: [...new Set(errors)] };
    },
    staleTime: 5_000,
    refetchInterval: 15_000,
    retry: false,
  });

  const quotes = useMemo(() => quoteQuery.data?.quotes ?? {}, [quoteQuery.data?.quotes]);
  const hasQuotes = Object.keys(quotes).length > 0;
  const marketClosed = marketStatusData?.isOpen === false;
  const hasFreshQuote = Object.values(quotes).some((quote) => {
    const age = Date.now() - Date.parse(quote.timestamp);
    return Number.isFinite(age) && age >= 0 && age <= 60_000;
  });
  const statusLabel = hasFreshQuote && !marketClosed ? "LIVE" : hasQuotes ? "HISTORICAL" : "UNAVAILABLE";
  const baseStatusText = hasNoAccount
    ? statusLabel === "LIVE"
      ? "Central Dhan quotes · market data is independent of trading account status."
      : statusLabel === "HISTORICAL"
        ? "Latest available central Dhan quotes · market data is independent of trading account status."
        : "No current central Dhan watchlist quotes are available."
    : statusLabel === "LIVE"
      ? "Account-scoped Terminal OS quotes"
      : statusLabel === "HISTORICAL"
        ? "Latest available account quote"
        : instrumentLoadError ?? quoteQuery.error?.message ?? "No account quotes are available";
  const statusText = quoteQuery.data?.errors.length
    ? `${baseStatusText}. ${quoteQuery.data.errors[0]}`
    : baseStatusText;
  const isLoading = !instrumentsLoaded || quoteQuery.isLoading;

  const watchlistRows = useMemo(() => {
    return watchedSymbols
      .map((sym) => {
        if (!findSupportedInstrument(supportedInstruments, sym)) return null;
        const quote = quotes[sym];
        if (quote) {
          return {
            symbol: sym,
            ltp: quote.ltp,
            change: quote.change,
            changePercent: quote.changePercent,
            open: quote.open,
            high: quote.high,
            low: quote.low,
            volume: quote.volume,
            oi: quote.openInterest,
            oiChange: null,
            isLive: (() => {
              const age = Date.now() - Date.parse(quote.timestamp);
              return Number.isFinite(age) && age >= 0 && age <= 60_000;
            })(),
          };
        }
        return {
          symbol: sym,
          ltp: null,
          change: null,
          changePercent: null,
          open: null,
          high: null,
          low: null,
          volume: null,
          oi: null,
          oiChange: null,
          isLive: false,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .filter((row) => {
        if (!search) return true;
        return row.symbol.includes(search.toUpperCase());
      });
  }, [watchedSymbols, quotes, search, supportedInstruments]);

  const availableSymbols = useMemo(() => {
    return supportedInstruments
      .map((instrument) => instrument.tradingSymbol)
      .filter((symbol, index, allSymbols) => allSymbols.indexOf(symbol) === index)
      .filter((sym) => !watchedSymbols.includes(sym))
      .sort();
  }, [supportedInstruments, watchedSymbols]);

  const openInstrumentChart = (symbol: string) => {
    const normalized = symbol.toUpperCase();
    const canonicalSymbol = canonicalIndexSymbol(normalized).toUpperCase();
    const isIndex = INDEX_SYMBOLS.has(canonicalSymbol) || supportedInstruments.some((instrument) =>
      classifyInstrument(instrument) === "indices" &&
      [instrument.symbol, instrument.tradingSymbol].some((value) =>
        canonicalIndexSymbol(value).toUpperCase() === canonicalSymbol
      )
    );
    navigate(`${isIndex ? "/indices" : "/stocks"}?symbol=${encodeURIComponent(symbol)}`);
  };

  const addToWatchlist = () => {
    const sym = addSymbol.toUpperCase().trim();
    if (!sym || watchedSymbols.includes(sym)) return;
    if (!instrumentsLoaded) {
      setAddSymbolError("Wait for the cash-equity instrument list to load before adding a symbol.");
      return;
    }
    if (!findSupportedInstrument(supportedInstruments, sym)) {
      setAddSymbolError("Only supported cash-equity stocks and indices can be added.");
      return;
    }
    setAddSymbolError(null);
    const updated = [...watchedSymbols, sym];
    setWatchedSymbols(updated);
    saveWatchlist(updated);
    setAddSymbol("");
  };

  const removeFromWatchlist = (sym: string) => {
    const updated = watchedSymbols.filter((s) => s !== sym);
    setWatchedSymbols(updated);
    saveWatchlist(updated);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            Watchlist
            <Badge variant="outline" className={`text-[11px] h-5 px-1.5 ${statusLabel === "LIVE" ? "border-bullish/30 text-bullish" : statusLabel === "HISTORICAL" ? "border-amber-500/40 text-amber-400" : "border-border text-muted-foreground"}`}>
              {statusLabel === "LIVE" && <Radio className="h-2 w-2 mr-1 animate-pulse" />}
              {statusLabel}
            </Badge>
          </h1>
          <p className="text-sm text-muted-foreground">
            {watchlistRows.length} supported symbols · {statusText}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input placeholder="Filter..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-8 w-[140px] text-xs" />
          </div>
          <Input
            placeholder="Add symbol..."
            value={addSymbol}
            onChange={e => setAddSymbol(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addToWatchlist()}
            className="h-8 w-[130px] text-xs"
            list="available-symbols"
          />
          <datalist id="available-symbols">
            {availableSymbols.slice(0, 20).map((sym) => (
              <option key={sym} value={sym} />
            ))}
          </datalist>
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={addToWatchlist}>
            <Plus className="h-3 w-3" /> Add
          </Button>
        </div>
      </div>
      {addSymbolError && <p className="text-xs text-destructive" role="alert">{addSymbolError}</p>}

      <Card>
        <CardContent className="p-0 overflow-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Loading live data...</span>
            </div>
          ) : (
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow className="text-xs">
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Symbol</TableHead>
                  <TableHead className="text-right">LTP</TableHead>
                  <TableHead className="text-right">Change</TableHead>
                  <TableHead className="text-right">Chg%</TableHead>
                  <TableHead className="text-right">Open</TableHead>
                  <TableHead className="text-right">High</TableHead>
                  <TableHead className="text-right">Low</TableHead>
                  <TableHead className="text-right">Volume</TableHead>
                  <TableHead className="text-right">OI</TableHead>
                  <TableHead className="text-right">OI Chg</TableHead>
                  <TableHead className="text-center w-[90px]">Chart</TableHead>
                  <TableHead className="text-center">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {watchlistRows.map(w => {
                  const hasPrice = isMeaningfulMarketValue(w.ltp);
                  const safeHigh = isMeaningfulMarketValue(w.high) ? w.high : w.ltp ?? 0;
                  const safeLow = isMeaningfulMarketValue(w.low) ? w.low : w.ltp ?? 0;
                  const dayRange = Math.max(safeHigh - safeLow, 0);
                  const dayPos = dayRange > 0 && hasPrice ? ((w.ltp! - safeLow) / dayRange) * 100 : 50;
                  return (
                  <TableRow key={w.symbol} className={`text-[11px] font-mono transition-all duration-150 group border-l-2 ${(w.changePercent ?? 0) >= 0 ? "hover:bg-bullish/[0.03] border-transparent hover:border-bullish/50" : "hover:bg-bearish/[0.03] border-transparent hover:border-bearish/50"}`}>
                    <TableCell>
                      <Star
                        className="h-3 w-3 text-warning fill-warning cursor-pointer hover:opacity-60 transition-opacity"
                        onClick={() => removeFromWatchlist(w.symbol)}
                      />
                    </TableCell>
                    <TableCell className="font-sans font-medium">
                      <button type="button" className="flex items-center gap-1 text-left hover:text-primary" onClick={() => openInstrumentChart(w.symbol)} aria-label={`Open ${w.symbol} chart`}>
                        {(w.changePercent ?? 0) >= 0 ? <TrendingUp className="h-3 w-3 text-bullish opacity-0 group-hover:opacity-100 transition-opacity" /> : <TrendingDown className="h-3 w-3 text-bearish opacity-0 group-hover:opacity-100 transition-opacity" />}
                        {w.symbol}
                      </button>
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      {hasPrice ? `₹${w.ltp!.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
                    </TableCell>
                    <TableCell className={`text-right ${w.change != null && w.change >= 0 ? "text-bullish" : "text-bearish"}`}>
                      {hasPrice && w.change != null ? `${w.change >= 0 ? "+" : ""}${w.change.toFixed(2)}` : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {hasPrice && w.changePercent != null ? (
                        <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${w.changePercent >= 0 ? "bg-bullish/10 text-bullish" : "bg-bearish/10 text-bearish"}`}>
                          {w.changePercent >= 0 ? "+" : ""}{w.changePercent.toFixed(2)}%
                        </span>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {isMeaningfulMarketValue(w.open) ? w.open.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—"}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {isMeaningfulMarketValue(w.high) ? w.high.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—"}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {isMeaningfulMarketValue(w.low) ? w.low.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—"}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {isMeaningfulMarketValue(w.volume) ? `${(w.volume! / 100000).toFixed(1)}L` : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {isMeaningfulMarketValue(w.oi) ? `${(w.oi! / 100000).toFixed(1)}L` : "—"}
                    </TableCell>
                    <TableCell className={`text-right ${isMeaningfulMarketValue(w.oiChange) && (w.oiChange ?? 0) >= 0 ? "text-bullish" : "text-bearish"}`}>
                      {w.oiChange != null && isMeaningfulMarketValue(w.oiChange) ? `${w.oiChange >= 0 ? "+" : ""}${(w.oiChange / 100000).toFixed(1)}L` : "—"}
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex flex-col items-center gap-0.5">
                        <MiniChart symbol={w.symbol} width={80} height={24} />
                        {/* Day range indicator */}
                        {dayRange > 0 && hasPrice && w.changePercent != null && (
                          <div className="relative w-full h-[2px] bg-muted/50 rounded-full">
                            <div className={`absolute top-[-1px] h-[4px] w-[4px] rounded-full ${w.changePercent >= 0 ? "bg-bullish" : "bg-bearish"}`} style={{ left: `${Math.min(dayPos, 95)}%` }} />
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-center gap-1">
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openInstrumentChart(w.symbol)} title="View instrument chart" aria-label={`View chart for ${w.symbol}`}>
                          <BarChart3 className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => navigate(`/option-chain?symbol=${w.symbol}`)}>
                          <ExternalLink className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => removeFromWatchlist(w.symbol)}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  );
                })}
                {watchlistRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={12} className="text-center py-8 text-muted-foreground text-sm">
                      {search ? "No symbols match your filter" : "Add symbols to your watchlist to track them here"}
                    </TableCell>
                  </TableRow>
                )}
                {watchlistRows.length > 0 && (
                  <TableRow className="bg-accent/20 border-t-2 border-border font-medium">
                    <TableCell className="text-xs text-muted-foreground py-2">
                      {watchlistRows.length} symbols
                    </TableCell>
                    <TableCell />
                    <TableCell />
                    <TableCell className="text-right text-xs py-2">
                      <span className="text-bullish">{watchlistRows.filter(w => (w.changePercent || 0) >= 0).length}↑</span>
                      {" / "}
                      <span className="text-bearish">{watchlistRows.filter(w => (w.changePercent || 0) < 0).length}↓</span>
                    </TableCell>
                    <TableCell className={`text-right text-xs font-mono py-2 ${
                      (watchlistRows.reduce((s, w) => s + (w.changePercent || 0), 0) / Math.max(watchlistRows.length, 1)) >= 0 ? "text-bullish" : "text-bearish"
                    }`}>
                      Avg: {((watchlistRows.reduce((s, w) => s + (w.changePercent || 0), 0) / Math.max(watchlistRows.length, 1))).toFixed(2)}%
                    </TableCell>
                    <TableCell colSpan={7} />
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

    </div>
  );
}
