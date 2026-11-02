import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  Database, Download, RefreshCw, Trash2, CheckCircle2, Clock, HardDrive, BarChart3,
  Loader2, AlertCircle, Radio, Layers, CandlestickChart, TrendingUp,
} from "lucide-react";
import {
  saveInstruments, savePriceSnapshots, saveCandleHistory, getDatabaseStats,
  clearAllData, setMetadata, type DatabaseStats, type Instrument,
  type CandleHistory, type CandleData,
} from "@/lib/localDatabase";
import { useQueryClient } from "@tanstack/react-query";
import {
  requestTerminalMarketData,
  toLocalMarketDataInstrument,
  toTerminalMarketDataInstrument,
  type TerminalMarketDataInstrument,
  type TerminalMarketDataQuote,
} from "@/lib/terminalApi";

type UpdatePhase = "idle" | "instruments" | "prices" | "candles" | "fno-candles" | "done" | "error";

interface UpdateProgress {
  phase: UpdatePhase;
  current: number;
  total: number;
  message: string;
}

const INDEX_ALIASES: Record<string, string[]> = {
  NIFTY: ["NIFTY", "NIFTY 50"],
  BANKNIFTY: ["BANKNIFTY", "NIFTY BANK"],
  FINNIFTY: ["FINNIFTY", "NIFTY FIN SERVICE"],
  MIDCPNIFTY: ["MIDCPNIFTY", "NIFTY MID SELECT"],
};
const STOCK_SYMBOLS = ["RELIANCE", "TCS", "INFY", "HDFCBANK", "SBIN", "ICICIBANK"];
const HISTORY_LOOKBACK_DAYS = 30;

function findMarketInstrument(catalog: Instrument[], symbol: string): Instrument | undefined {
  const names = new Set((INDEX_ALIASES[symbol] ?? [symbol]).map((name) => name.toUpperCase()));
  return catalog.find((instrument) =>
    names.has(instrument.symbol.trim().toUpperCase()) ||
    names.has(instrument.tradingSymbol.trim().toUpperCase())
  );
}

function asDateString(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(date);
}

function toEpochMilliseconds(value: string | number): number {
  const numericTimestamp = Number(value);
  if (Number.isFinite(numericTimestamp) && /^\d+$/.test(String(value))) {
    return numericTimestamp > 1e12 ? numericTimestamp : numericTimestamp * 1000;
  }
  const parsed = Date.parse(String(value));
  if (!Number.isFinite(parsed)) throw new Error("Dhan returned an invalid candle timestamp.");
  return parsed;
}

export function DatabaseManager() {
  const queryClient = useQueryClient();
  const [stats, setStats] = useState<DatabaseStats | null>(null);
  const [progress, setProgress] = useState<UpdateProgress>({
    phase: "idle", current: 0, total: 0, message: "",
  });
  const [isUpdating, setIsUpdating] = useState(false);

  const loadStats = useCallback(async () => {
    try {
      const s = await getDatabaseStats();
      setStats(s);
    } catch (err) {
      console.warn("Failed to load DB stats:", err);
    }
  }, []);

  // Load stats on mount
  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const handleUpdateDatabase = async () => {
    setIsUpdating(true);

    try {
      // ── Phase 1: Download Instrument Master ──
      setProgress({ phase: "instruments", current: 0, total: 1, message: "Downloading instrument master..." });

      const remoteInstruments = await requestTerminalMarketData<TerminalMarketDataInstrument[]>(
        null,
        "dhan",
        { operation: "listInstruments" },
      );
      const instruments = remoteInstruments.map(toLocalMarketDataInstrument);

      if (instruments.length === 0) {
        throw new Error("The central Dhan service returned no official instruments.");
      }

      setProgress({ phase: "instruments", current: 50, total: 100, message: `Saving ${instruments.length.toLocaleString()} instruments...` });

      // Save in batches to avoid blocking UI
      const BATCH_SIZE = 2000;
      for (let i = 0; i < instruments.length; i += BATCH_SIZE) {
        const batch = instruments.slice(i, i + BATCH_SIZE);
        await saveInstruments(batch);
        setProgress({
          phase: "instruments",
          current: Math.round(((i + batch.length) / instruments.length) * 100),
          total: 100,
          message: `Saved ${Math.min(i + BATCH_SIZE, instruments.length).toLocaleString()} / ${instruments.length.toLocaleString()} instruments`,
        });
      }

      await setMetadata("lastInstrumentUpdate", new Date().toISOString());

      // ── Phase 2: Save cash-market price snapshots from Dhan quotes ──
      setProgress({ phase: "prices", current: 0, total: 100, message: "Fetching central Dhan cash-market quotes..." });

      try {
        const quoteTargets = [...Object.keys(INDEX_ALIASES), ...STOCK_SYMBOLS].flatMap((symbol) => {
          const instrument = findMarketInstrument(instruments, symbol);
          return instrument ? [{ symbol, instrument }] : [];
        });
        const terminalInstruments = quoteTargets.map(({ instrument }) =>
          toTerminalMarketDataInstrument(instrument, "dhan")
        );
        const quotes = await requestTerminalMarketData<TerminalMarketDataQuote[]>(
          null,
          "dhan",
          { operation: "getQuotes", instruments: terminalInstruments },
        );
        const quotesByInstrument = new Map(quotes.map((quote) => [`${quote.exchange}:${quote.tradingSymbol}`, quote]));
        const priceSnapshots = quoteTargets.flatMap(({ symbol, instrument }) => {
          const exchange = instrument.exchange ?? (instrument.exchangeSegment.startsWith("BSE") ? "BSE" : "NSE");
          const quote = quotesByInstrument.get(`${exchange}:${instrument.tradingSymbol}`);
          const timestamp = quote ? Date.parse(quote.timestamp) : Number.NaN;
          if (!quote || !Number.isFinite(timestamp) || quote.open === null || quote.high === null ||
              quote.low === null || quote.previousClose === null || quote.change === null ||
              quote.changePercent === null || quote.volume === null) return [];
          return [{
            securityId: instrument.securityId,
            symbol,
            ltp: quote.ltp,
            open: quote.open,
            high: quote.high,
            low: quote.low,
            close: quote.previousClose,
            change: quote.change,
            changePercent: quote.changePercent,
            volume: quote.volume,
            oi: quote.openInterest ?? 0,
            timestamp,
          }];
        });
        if (priceSnapshots.length === 0) throw new Error("The central Dhan service returned no complete cash-market quotes.");
        await savePriceSnapshots(priceSnapshots);
        await setMetadata("lastPriceUpdate", new Date().toISOString());
        setProgress({ phase: "prices", current: 100, total: 100, message: `Saved ${priceSnapshots.length} cash-market price snapshots` });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown quote error";
        setProgress({ phase: "prices", current: 100, total: 100, message: `Price snapshots unavailable: ${message}` });
      }

      // ── Phase 3: Download Historical Candles for supported indices and stocks ──
      const allCandleTargets = [...Object.keys(INDEX_ALIASES), ...STOCK_SYMBOLS].flatMap((symbol) => {
        const instrument = findMarketInstrument(instruments, symbol);
        return instrument ? [{ symbol, instrument }] : [];
      });
      setProgress({ phase: "candles", current: 0, total: allCandleTargets.length, message: "Downloading historical candles..." });

      let successCount = 0;
      const candleErrors: string[] = [];
      for (let i = 0; i < allCandleTargets.length; i++) {
        const target = allCandleTargets[i];
        const isIndex = target.instrument.exchangeSegment === "IDX_I";
        setProgress({
          phase: isIndex ? "candles" : "fno-candles",
          current: i,
          total: allCandleTargets.length,
          message: `Fetching ${target.symbol} ${isIndex ? "index" : "stock"} candles...`,
        });

        try {
          const now = new Date();
          const from = new Date(now.getTime() - HISTORY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
          const candlesFromService = await requestTerminalMarketData<Array<{
            timestamp: string;
            open: number;
            high: number;
            low: number;
            close: number;
            volume: number;
            openInterest?: number;
          }>>(
            null,
            "dhan",
            {
              operation: "getHistoricalCandles",
              instrument: toTerminalMarketDataInstrument(target.instrument, "dhan"),
              interval: "5m",
              fromDate: asDateString(from),
              toDate: asDateString(now),
            },
          );
          if (candlesFromService.length > 0) {
            const candles: CandleData[] = candlesFromService.map((candle) => ({
              timestamp: toEpochMilliseconds(candle.timestamp),
              open: candle.open,
              high: candle.high,
              low: candle.low,
              close: candle.close,
              volume: candle.volume,
              oi: candle.openInterest,
            }));
            const history: CandleHistory = {
              securityId: target.instrument.securityId,
              symbol: target.symbol,
              exchangeSegment: target.instrument.exchangeSegment,
              provider: "dhan",
              interval: "5m",
              candles,
              lastUpdated: Date.now(),
            };

            await saveCandleHistory(history);
            successCount++;
          } else {
            candleErrors.push(`${target.symbol}: no candles returned`);
          }
        } catch (error) {
          candleErrors.push(`${target.symbol}: ${error instanceof Error ? error.message : "request failed"}`);
        }

        // Small delay between requests to avoid rate limiting
        if (i < allCandleTargets.length - 1) {
          await new Promise((r) => setTimeout(r, 400));
        }
      }

      await setMetadata("lastCandleUpdate", new Date().toISOString());

      // ── Done ──
      // Invalidate all caches so hook refreshes pull from IndexedDB
      queryClient.invalidateQueries({ queryKey: ["global-dhan-indices"] });
      queryClient.invalidateQueries({ queryKey: ["global-dhan-fno-stocks"] });
      queryClient.invalidateQueries({ queryKey: ["stored-candles"] });

      setProgress({ phase: "done", current: 100, total: 100, message: "Database updated successfully!" });
      const completionMessage = `Database updated: ${instruments.length.toLocaleString()} instruments, ${successCount} candle charts stored`;
      if (candleErrors.length > 0) toast.warning(`${completionMessage}. ${candleErrors.length} candle requests were unavailable.`, { duration: 7000 });
      else toast.success(completionMessage, { duration: 5000 });
      await loadStats();
    } catch (err: any) {
      setProgress({ phase: "error", current: 0, total: 0, message: err.message || "Update failed" });
      toast.error(`Database update failed: ${err.message}`);
    } finally {
      setIsUpdating(false);
      setTimeout(() => {
        setProgress({ phase: "idle", current: 0, total: 0, message: "" });
      }, 8000);
    }
  };

  const handleClearDatabase = async () => {
    try {
      await clearAllData();
      queryClient.invalidateQueries();
      await loadStats();
      toast.info("Local database cleared");
    } catch (err: any) {
      toast.error(`Clear failed: ${err.message}`);
    }
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return "Never";
    const d = new Date(iso);
    return d.toLocaleDateString("en-IN", {
      day: "numeric", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  };

  const overallProgress = progress.phase === "instruments"
    ? (progress.current * 0.4)
    : progress.phase === "prices"
    ? 40 + (progress.current * 0.15)
    : progress.phase === "candles"
    ? 55 + ((progress.current / Math.max(progress.total, 1)) * 20)
    : progress.phase === "fno-candles"
    ? 75 + ((progress.current / Math.max(progress.total, 1)) * 25)
    : progress.phase === "done" ? 100 : 0;

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/[0.02] to-transparent">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Database className="h-5 w-5 text-primary" />
          Market Database
          {stats && stats.instruments > 0 && (
            <Badge variant="outline" className="text-[11px] h-5 px-1.5 border-bullish/30 text-bullish gap-1">
              <Radio className="h-2 w-2" />
              {stats.instruments.toLocaleString()} instruments
            </Badge>
          )}
        </CardTitle>
        <CardDescription className="text-xs">
          Download and store F&O instruments, prices, and candle history locally for instant access.
          Data persists offline in IndexedDB and powers charts, watchlist, and analytics.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Stats Grid */}
        {stats && (
          <div className="grid grid-cols-3 gap-3">
            <StatCard
              icon={<Layers className="h-3.5 w-3.5" />}
              label="Instruments"
              value={stats.instruments > 0 ? stats.instruments.toLocaleString() : "—"}
              sub={formatDate(stats.lastInstrumentUpdate)}
            />
            <StatCard
              icon={<BarChart3 className="h-3.5 w-3.5" />}
              label="Prices"
              value={stats.prices > 0 ? stats.prices.toLocaleString() : "—"}
              sub={formatDate(stats.lastPriceUpdate)}
            />
            <StatCard
              icon={<CandlestickChart className="h-3.5 w-3.5" />}
              label="Candle Charts"
              value={stats.candles > 0 ? stats.candles.toLocaleString() : "—"}
              sub={formatDate(stats.lastCandleUpdate)}
            />
          </div>
        )}

        {/* Progress Bar */}
        {progress.phase !== "idle" && (
          <div className="space-y-2 p-3 rounded-lg bg-card border">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium flex items-center gap-1.5">
                {progress.phase === "done" ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-bullish" />
                ) : progress.phase === "error" ? (
                  <AlertCircle className="h-3.5 w-3.5 text-destructive" />
                ) : (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                )}
                {progress.phase === "instruments" && "Step 1/4: Instruments"}
                {progress.phase === "prices" && "Step 2/4: Price Snapshots"}
                {progress.phase === "candles" && "Step 3/4: Index Candles"}
                {progress.phase === "fno-candles" && "Step 4/4: F&O Stock Candles"}
                {progress.phase === "done" && "Complete!"}
                {progress.phase === "error" && "Error"}
              </span>
              <span className="text-xs text-muted-foreground font-mono">{Math.round(overallProgress)}%</span>
            </div>
            <Progress value={overallProgress} className={`h-1.5 ${progress.phase === "error" ? "[&>div]:bg-destructive" : progress.phase === "done" ? "[&>div]:bg-bullish" : ""}`} />
            <p className="text-xs text-muted-foreground">{progress.message}</p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-2">
          <Button
            onClick={handleUpdateDatabase}
            disabled={isUpdating}
            className="flex-1 gap-2"
            size="sm"
          >
            {isUpdating ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Updating...
              </>
            ) : (
              <>
                <Download className="h-3.5 w-3.5" />
                {stats && stats.instruments > 0 ? "Update Database" : "Download Database"}
              </>
            )}
          </Button>

          {stats && stats.instruments > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleClearDatabase}
              className="text-muted-foreground hover:text-destructive gap-1.5"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear
            </Button>
          )}
        </div>

        {/* What gets downloaded */}
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">What gets stored:</p>
          <div className="grid grid-cols-2 gap-1.5">
            {[
              { icon: <Layers className="h-2.5 w-2.5" />, text: "NSE F&O instrument master" },
              { icon: <TrendingUp className="h-2.5 w-2.5" />, text: "Live F&O price snapshots" },
              { icon: <CandlestickChart className="h-2.5 w-2.5" />, text: "2-day index candles (5m)" },
              { icon: <BarChart3 className="h-2.5 w-2.5" />, text: "Top 10 F&O stock candles" },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {item.icon}
                <span>{item.text}</span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className="p-2.5 rounded-lg bg-card border">
      <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="text-sm font-bold font-mono">{value}</p>
      <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">
        <Clock className="h-2.5 w-2.5" />
        {sub}
      </p>
    </div>
  );
}
