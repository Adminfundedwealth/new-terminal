import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, CalendarDays, CircleAlert, TrendingDown, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getClosedPositions, type ClosedPosition } from "@/lib/positionStore";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatPnl(value: number): string {
  return `${value >= 0 ? "+" : "-"}₹${Math.abs(value).toLocaleString("en-IN")}`;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function isValidRealizedTrade(position: ClosedPosition): boolean {
  return Boolean(position.exitTimestamp && !Number.isNaN(new Date(position.exitTimestamp).getTime()));
}

export default function Calendar() {
  const [viewDate, setViewDate] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [closedPositions] = useState<ClosedPosition[]>(() => getClosedPositions());

  const realizedTrades = useMemo(
    () => closedPositions.filter(isValidRealizedTrade),
    [closedPositions],
  );

  const tradesByDay = useMemo(() => {
    const grouped = new Map<string, ClosedPosition[]>();
    for (const trade of realizedTrades) {
      const key = dateKey(new Date(trade.exitTimestamp));
      const trades = grouped.get(key) || [];
      trades.push(trade);
      grouped.set(key, trades);
    }
    return grouped;
  }, [realizedTrades]);

  const monthLabel = viewDate.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  const monthPrefix = `${viewDate.getFullYear()}-${String(viewDate.getMonth() + 1).padStart(2, "0")}`;
  const monthTrades = realizedTrades.filter((trade) => dateKey(new Date(trade.exitTimestamp)).startsWith(monthPrefix));
  const monthDays = new Set(monthTrades.map((trade) => dateKey(new Date(trade.exitTimestamp))));
  const monthPnl = monthTrades.reduce((total, trade) => total + trade.realizedPnl, 0);
  const winDays = [...monthDays].filter((key) => (tradesByDay.get(key) || []).reduce((sum, trade) => sum + trade.realizedPnl, 0) > 0).length;
  const lossDays = [...monthDays].filter((key) => (tradesByDay.get(key) || []).reduce((sum, trade) => sum + trade.realizedPnl, 0) < 0).length;
  const selectedTrades = selectedDate ? tradesByDay.get(selectedDate) || [] : [];

  const calendarCells = useMemo(() => {
    const firstDay = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
    const lastDay = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0);
    const leadingDays = (firstDay.getDay() + 6) % 7;
    const totalCells = Math.ceil((leadingDays + lastDay.getDate()) / 7) * 7;
    return Array.from({ length: totalCells }, (_, index) => {
      const day = index - leadingDays + 1;
      return day > 0 && day <= lastDay.getDate() ? new Date(viewDate.getFullYear(), viewDate.getMonth(), day) : null;
    });
  }, [viewDate]);

  const moveMonth = (amount: number) => {
    setViewDate((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1));
    setSelectedDate(null);
  };

  return (
    <main className="mx-auto w-full max-w-[1500px] space-y-4 p-3 sm:p-5">
      <section className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-primary">
            <CalendarDays className="h-5 w-5" />
            <span className="text-xs font-bold uppercase tracking-[0.2em]">Performance</span>
          </div>
          <h2 className="mt-1 text-2xl font-bold tracking-tight">Trading Calendar</h2>
          <p className="mt-1 text-sm text-muted-foreground">Realized results from closed positions only.</p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border/70 bg-card/70 p-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => moveMonth(-1)} aria-label="Previous month">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[150px] text-center text-sm font-semibold">{monthLabel}</span>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => moveMonth(1)} aria-label="Next month">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </section>

      {closedPositions.length > realizedTrades.length && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{closedPositions.length - realizedTrades.length} older closed position(s) lack an exact close timestamp and are excluded from daily totals.</span>
        </div>
      )}

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {[
          ["Month P&L", formatPnl(monthPnl), monthPnl >= 0 ? "text-bullish" : "text-bearish"],
          ["Trading Days", monthDays.size.toString(), "text-foreground"],
          ["Win Days", winDays.toString(), "text-bullish"],
          ["Loss Days", lossDays.toString(), "text-bearish"],
          ["Total Trades", monthTrades.length.toString(), "text-foreground"],
        ].map(([label, value, color]) => (
          <Card key={label} className="border-border/60 bg-card/70">
            <CardContent className="p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
              <p className={`mt-1 text-lg font-bold font-mono ${color}`}>{value}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <Card className="overflow-hidden border-border/70 bg-card/80">
        <CardContent className="p-0">
          <div className="grid grid-cols-7 border-b border-border/70 bg-muted/20">
            {WEEKDAYS.map((day, index) => (
              <div key={day} className={`px-2 py-2 text-center text-[10px] font-bold uppercase tracking-[0.12em] ${index > 4 ? "text-muted-foreground/50" : "text-muted-foreground"}`}>
                {day}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {calendarCells.map((date, index) => {
              if (!date) return <div key={`empty-${index}`} className="min-h-[108px] border-b border-r border-border/50 bg-background/30" />;
              const key = dateKey(date);
              const trades = tradesByDay.get(key) || [];
              const pnl = trades.reduce((total, trade) => total + trade.realizedPnl, 0);
              const isWeekend = date.getDay() === 0 || date.getDay() === 6;
              const isToday = key === dateKey(new Date());
              const isSelected = key === selectedDate;
              const status = pnl > 0 ? "WIN" : pnl < 0 ? "LOSS" : trades.length ? "BREAK-EVEN" : "";
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => trades.length > 0 && setSelectedDate(key)}
                  className={`min-h-[108px] border-b border-r border-border/50 p-2 text-left align-top transition-colors ${isWeekend ? "bg-muted/10" : "bg-background/50 hover:bg-primary/5"} ${isSelected ? "bg-primary/10 ring-2 ring-inset ring-primary" : ""}`}
                  aria-label={`${formatDate(date.toISOString())}${trades.length ? `, ${formatPnl(pnl)}, ${trades.length} trades` : ", no realized trades"}`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${isToday ? "bg-primary text-primary-foreground" : isWeekend ? "text-muted-foreground/50" : "text-muted-foreground"}`}>
                      {date.getDate()}
                    </span>
                    {trades.length > 0 && <span className="text-[10px] text-muted-foreground">{trades.length} trade{trades.length === 1 ? "" : "s"}</span>}
                  </div>
                  {trades.length > 0 && (
                    <div className="mt-3 space-y-1">
                      <p className={`font-mono text-sm font-bold ${pnl >= 0 ? "text-bullish" : "text-bearish"}`}>{formatPnl(pnl)}</p>
                      <Badge variant="outline" className={`h-5 px-1.5 text-[9px] ${pnl > 0 ? "border-bullish/30 text-bullish" : pnl < 0 ? "border-bearish/30 text-bearish" : "text-muted-foreground"}`}>
                        {status}
                      </Badge>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {selectedDate && (
        <Card className="border-primary/20 bg-card/80">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-base">
              <span>Trades on {formatDate(`${selectedDate}T12:00:00`)}</span>
              <span className={`font-mono ${selectedTrades.reduce((sum, trade) => sum + trade.realizedPnl, 0) >= 0 ? "text-bullish" : "text-bearish"}`}>
                {formatPnl(selectedTrades.reduce((sum, trade) => sum + trade.realizedPnl, 0))}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {selectedTrades.map((trade) => (
              <div key={`${trade.id}-${trade.exitTimestamp}`} className="grid gap-2 rounded-md border border-border/60 bg-background/40 p-3 text-xs sm:grid-cols-6 sm:items-center">
                <div className="font-semibold">{trade.symbol} {trade.strike} {trade.type}</div>
                <div><span className="text-muted-foreground">Side:</span> {trade.action}</div>
                <div><span className="text-muted-foreground">Qty:</span> {trade.lots * trade.lotSize}</div>
                <div><span className="text-muted-foreground">Entry:</span> ₹{trade.entryPrice.toLocaleString("en-IN")}</div>
                <div><span className="text-muted-foreground">Exit:</span> ₹{trade.exitPrice.toLocaleString("en-IN")}</div>
                <div className={`flex items-center gap-1 font-mono font-semibold ${trade.realizedPnl >= 0 ? "text-bullish" : "text-bearish"}`}>
                  {trade.realizedPnl >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                  {formatPnl(trade.realizedPnl)}
                </div>
                <div className="text-muted-foreground sm:col-span-6">Closed {formatDate(trade.exitTimestamp)}{trade.entryDate ? ` · Entry ${trade.entryDate}` : ""}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {realizedTrades.length === 0 && (
        <div className="rounded-lg border border-dashed border-border/80 bg-card/30 px-4 py-8 text-center">
          <CalendarDays className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-3 text-sm font-semibold">No timestamped realized trades yet</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">Close a position in Position Tracker to populate this calendar. Unrealized positions and simulated P&L are intentionally excluded.</p>
        </div>
      )}
    </main>
  );
}
