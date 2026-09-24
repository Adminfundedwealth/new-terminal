import { useMemo, useState } from "react";
import { Search, Star, TrendingUp, TrendingDown, Radio, Loader2, BarChart3, ExternalLink, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StockChart } from "@/components/StockChart";
import { isWatchlisted } from "@/lib/watchlist";

export type ExplorerAsset = "stocks" | "indices" | "futures";

export interface ExplorerRow {
  symbol: string;
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
  watchedSymbols: string[];
  onToggleWatchlist: (symbol: string) => void;
  onTradeOpen?: (symbol: string) => void;
  searchPlaceholder?: string;
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
  searchPlaceholder,
}: ExplorerProps) {
  const [search, setSearch] = useState("");
  const [chartSymbol, setChartSymbol] = useState<string | null>(null);

  const filteredRows = useMemo(() => {
    const q = search.trim().toUpperCase();
    if (!q) return rows;
    return rows.filter((row) => {
      const haystack = `${row.symbol} ${row.label} ${row.contract ?? ""} ${row.underlying ?? ""} ${row.searchText ?? ""}`.toUpperCase();
      return haystack.includes(q);
    });
  }, [rows, search]);

  const openChart = (symbol: string) => {
    setChartSymbol(symbol);
  };

  const openTrade = (symbol: string) => {
    onTradeOpen?.(symbol);
  };

  return (
    <div className="space-y-4">
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
            <div className="py-12 text-center text-sm text-muted-foreground">No real {asset} instruments available.</div>
          ) : (
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow className="text-xs">
                  <TableHead className="w-8" />
                  {asset === "futures" ? <TableHead>Contract</TableHead> : <TableHead>Symbol</TableHead>}
                  {asset === "futures" && <TableHead>Underlying</TableHead>}
                  {asset === "futures" && <TableHead>Expiry</TableHead>}
                  <TableHead className="text-right">LTP</TableHead>
                  <TableHead className="text-right">Change</TableHead>
                  <TableHead className="text-right">Chg%</TableHead>
                  <TableHead className="text-right">Open</TableHead>
                  <TableHead className="text-right">High</TableHead>
                  <TableHead className="text-right">Low</TableHead>
                  {asset !== "indices" && <TableHead className="text-right">Volume</TableHead>}
                  {asset === "futures" && <TableHead className="text-right">OI</TableHead>}
                  {asset === "futures" && <TableHead className="text-right">OI Chg</TableHead>}
                  <TableHead className="text-center w-[90px]">Chart</TableHead>
                  <TableHead className="text-center">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map((row) => {
                  const positive = (row.changePercent ?? 0) >= 0;
                  const isWatched = isWatchlisted(row.symbol, watchedSymbols);
                  const dayRange = (row.high ?? row.ltp ?? 0) - (row.low ?? row.ltp ?? 0);
                  const dayPos = dayRange > 0 ? (((row.ltp ?? row.open ?? 0) - (row.low ?? row.ltp ?? 0)) / dayRange) * 100 : 50;

                  return (
                    <TableRow key={`${row.symbol}-${row.contract ?? ""}-${row.expiry ?? ""}`} className={`text-[11px] font-mono transition-all border-l-2 ${positive ? "hover:bg-bullish/[0.03] border-transparent hover:border-bullish/50" : "hover:bg-bearish/[0.03] border-transparent hover:border-bearish/50"}`}>
                      <TableCell>
                        <button type="button" onClick={() => onToggleWatchlist(row.symbol)} aria-label={isWatched ? `Remove ${row.symbol} from watchlist` : `Add ${row.symbol} to watchlist`} className="flex h-4 w-4 items-center justify-center">
                          <Star className={`h-3.5 w-3.5 ${isWatched ? "fill-warning text-warning" : "text-muted-foreground hover:text-warning"}`} />
                        </button>
                      </TableCell>

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
                            <span>{row.label || row.symbol}</span>
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

                      <TableCell className="text-right text-muted-foreground">{formatNumber(row.open)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{formatNumber(row.high)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{formatNumber(row.low)}</TableCell>

                      {asset !== "indices" && <TableCell className="text-right text-muted-foreground">{formatCompact(row.volume)}</TableCell>}
                      {asset === "futures" && <TableCell className="text-right">{formatCompact(row.oi)}</TableCell>}
                      {asset === "futures" && <TableCell className={`text-right ${((row.oiChange ?? 0) >= 0 ? "text-bullish" : "text-bearish")}`}>{row.oiChange == null || row.oiChange === 0 ? "—" : `${row.oiChange >= 0 ? "+" : ""}${formatCompact(row.oiChange)}`}</TableCell>}

                      <TableCell className="text-center">
                        <div className="flex flex-col items-center gap-1">
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openChart(row.symbol)} title="View Chart">
                            <BarChart3 className="h-3 w-3" />
                          </Button>
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

      {chartSymbol && (
        <StockChart
          symbol={chartSymbol}
          asSheet
          open={!!chartSymbol}
          onOpenChange={(open) => {
            if (!open) setChartSymbol(null);
          }}
        />
      )}
    </div>
  );
}
