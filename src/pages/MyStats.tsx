import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAccountContext } from "@/hooks/useAccountContext";
import { toast } from "sonner";
import {
  fetchTerminalExecutions,
  fetchTerminalOrders,
  fetchTerminalPerformance,
  fetchTerminalPositions,
  fetchTerminalRisk,
  type TerminalPosition,
} from "@/lib/terminalApi";
import type { CanonicalOrder } from "@/lib/orderModel";

const rangeOptions = ["1D", "1W", "1M", "3M", "ALL"] as const;
type RangeOption = (typeof rangeOptions)[number];
type TradeTab = "recent" | "open";
const EMPTY_ROWS: never[] = [];

function formatCurrency(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatPercent(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(2)}%`;
}

function formatShortDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

function dateCutoff(range: RangeOption): number | null {
  const days: Record<Exclude<RangeOption, "ALL">, number> = { "1D": 1, "1W": 7, "1M": 30, "3M": 90 };
  return range === "ALL" ? null : Date.now() - days[range] * 24 * 60 * 60 * 1000;
}

function withinRange(dateValue: string, range: RangeOption): boolean {
  const cutoff = dateCutoff(range);
  const date = new Date(dateValue);
  return cutoff == null || Number.isNaN(date.getTime()) || date.getTime() >= cutoff;
}

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function recordText(record: Record<string, unknown> | undefined, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function accountNumber(account: Record<string, unknown> | undefined, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = numeric(account?.[key]);
    if (value != null) return value;
  }
  return null;
}

function Card({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-xl border border-border/70 bg-card p-4 shadow-sm ${className}`}>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold tracking-tight">
        {title}
      </h2>
      {children}
    </section>
  );
}

function MetricCard({
  label,
  value,
  note,
  tone = "neutral",
  empty = false,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: "positive" | "negative" | "neutral";
  empty?: boolean;
}) {
  const toneClass = empty ? "text-muted-foreground" : tone === "positive" ? "text-bullish" : tone === "negative" ? "text-bearish" : "text-foreground";
  return (
    <article className="min-w-0 rounded-xl border border-border/70 bg-card p-4 shadow-sm">
      <h3 className="truncate text-xs font-medium text-muted-foreground">{label}</h3>
      <p className={`mt-2 truncate font-mono text-2xl font-bold tabular-nums ${toneClass}`}>{value}</p>
      {note && <p className="mt-2 truncate text-[11px] text-muted-foreground">{note}</p>}
    </article>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex h-56 items-center justify-center rounded-lg border border-dashed border-border/70 px-5 text-center text-xs text-muted-foreground">
      {message}
    </div>
  );
}

function ChartFrame({ children, empty, message }: { children: React.ReactNode; empty: boolean; message: string }) {
  return empty ? <EmptyChart message={message} /> : <div className="h-56 min-w-0">{children}</div>;
}

function formatHour(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

function isOpenPosition(position: TerminalPosition): boolean {
  return position.is_open === true || position.isOpen === true || position.position_status?.toLowerCase() === "open";
}

export default function MyStats() {
  const { accountContext, activeAccountId, accounts, isLoading, isError, hasNoAccount, selectAccount } = useAccountContext();
  const [range, setRange] = useState<RangeOption>("ALL");
  const [tradeTab, setTradeTab] = useState<TradeTab>("recent");

  const performanceQuery = useQuery({
    queryKey: ["my-stats", "performance", activeAccountId],
    queryFn: () => fetchTerminalPerformance(activeAccountId ?? undefined),
    enabled: Boolean(activeAccountId),
    staleTime: 30_000,
    retry: false,
  });
  const riskQuery = useQuery({
    queryKey: ["my-stats", "risk", activeAccountId],
    queryFn: () => fetchTerminalRisk(activeAccountId ?? undefined),
    enabled: Boolean(activeAccountId),
    staleTime: 30_000,
    retry: false,
  });
  const executionsQuery = useQuery({
    queryKey: ["my-stats", "executions", activeAccountId],
    queryFn: () => fetchTerminalExecutions(activeAccountId ?? undefined),
    enabled: Boolean(activeAccountId),
    staleTime: 30_000,
    retry: false,
  });
  const ordersQuery = useQuery({
    queryKey: ["my-stats", "orders", activeAccountId],
    queryFn: () => fetchTerminalOrders(activeAccountId ?? undefined),
    enabled: Boolean(activeAccountId),
    staleTime: 30_000,
    retry: false,
  });
  const positionsQuery = useQuery({
    queryKey: ["my-stats", "positions", activeAccountId],
    queryFn: () => fetchTerminalPositions(activeAccountId ?? undefined),
    enabled: Boolean(activeAccountId),
    staleTime: 30_000,
    retry: false,
  });

  const performanceRows = performanceQuery.data?.data ?? EMPTY_ROWS;
  const executionRows = executionsQuery.data?.data ?? EMPTY_ROWS;
  const orderRows = ordersQuery.data?.data ?? EMPTY_ROWS;
  const positionRows = positionsQuery.data?.data ?? EMPTY_ROWS;
  const filteredRows = useMemo(
    () => performanceRows.filter((row) => withinRange(row.date, range)).sort((a, b) => a.date.localeCompare(b.date)),
    [performanceRows, range],
  );
  const filteredExecutions = useMemo(
    () => executionRows.filter((row) => withinRange(row.executed_at, range)).sort((a, b) => b.executed_at.localeCompare(a.executed_at)),
    [executionRows, range],
  );
  const openPositions = useMemo(() => positionRows.filter(isOpenPosition), [positionRows]);

  const stats = useMemo(() => {
    const dailyPnl = filteredRows.map((row) => numeric(row.daily_pnl)).filter((value): value is number => value != null);
    const tradeCount = filteredRows.reduce((sum, row) => sum + (numeric(row.total_trades) ?? 0), 0);
    const winCount = filteredRows.reduce((sum, row) => sum + (numeric(row.winning_trades) ?? 0), 0);
    const lossCount = filteredRows.reduce((sum, row) => sum + (numeric(row.losing_trades) ?? 0), 0);
    const netPnl = dailyPnl.length ? dailyPnl.reduce((sum, value) => sum + value, 0) : null;
    const positiveDays = dailyPnl.filter((value) => value > 0).length;
    const activityDays = dailyPnl.filter((value) => value !== 0).length;
    const maxProfitDay = dailyPnl.length ? Math.max(...dailyPnl) : null;
    const equityPoints = filteredRows
      .filter((row) => numeric(row.closing_balance) != null)
      .map((row) => ({ date: row.date, label: formatShortDate(row.date), equity: numeric(row.closing_balance) as number }));
    const cumulativePoints: Array<{ date: string; label: string; pnl: number }> = [];
    let cumulative = 0;
    for (const row of filteredRows) {
      const value = numeric(row.daily_pnl);
      if (value == null) continue;
      cumulative += value;
      cumulativePoints.push({ date: row.date, label: formatShortDate(row.date), pnl: cumulative });
    }
    let peak: number | null = null;
    let maxObservedDrawdown = 0;
    for (const point of equityPoints) {
      peak = peak == null ? point.equity : Math.max(peak, point.equity);
      maxObservedDrawdown = Math.max(maxObservedDrawdown, peak - point.equity);
    }
    return {
      tradeCount,
      winCount,
      lossCount,
      netPnl,
      avgPnlPerTrade: tradeCount > 0 && netPnl != null ? netPnl / tradeCount : null,
      winRate: tradeCount > 0 ? (winCount / tradeCount) * 100 : null,
      maxProfitDay,
      consistency: activityDays > 0 ? (positiveDays / activityDays) * 100 : null,
      equityPoints,
      cumulativePoints,
      observedDrawdown: equityPoints.length ? maxObservedDrawdown : null,
    };
  }, [filteredRows]);

  const executionAnalysis = useMemo(() => {
    const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour: formatHour(hour), fills: 0 }));
    const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => ({ day, fills: 0 }));
    const instruments = new Map<string, number>();
    const sessions = new Map<string, number>([["Morning (before 12:00)", 0], ["Afternoon (12:00 onward)", 0]]);
    for (const fill of filteredExecutions) {
      const date = new Date(fill.executed_at);
      if (Number.isNaN(date.getTime())) continue;
      hourly[date.getHours()].fills += 1;
      weekdays[date.getDay()].fills += 1;
      instruments.set(fill.symbol, (instruments.get(fill.symbol) ?? 0) + 1);
      const session = date.getHours() < 12 ? "Morning (before 12:00)" : "Afternoon (12:00 onward)";
      sessions.set(session, (sessions.get(session) ?? 0) + 1);
    }
    return {
      hourly: hourly.filter((item) => item.fills > 0),
      weekdays,
      instruments: [...instruments.entries()].map(([symbol, fills]) => ({ symbol, fills })).sort((a, b) => b.fills - a.fills),
      sessions: [...sessions.entries()].map(([session, fills]) => ({ session, fills })),
    };
  }, [filteredExecutions]);

  const weeklyRows = useMemo(() => {
    const weeks = new Map<string, { week: string; pnl: number; trades: number; days: number }>();
    for (const row of filteredRows) {
      const date = new Date(row.date);
      if (Number.isNaN(date.getTime())) continue;
      const monday = new Date(date);
      monday.setDate(date.getDate() - ((date.getDay() + 6) % 7));
      const key = monday.toISOString().slice(0, 10);
      const current = weeks.get(key) ?? { week: formatShortDate(key), pnl: 0, trades: 0, days: 0 };
      current.pnl += numeric(row.daily_pnl) ?? 0;
      current.trades += numeric(row.total_trades) ?? 0;
      current.days += 1;
      weeks.set(key, current);
    }
    return [...weeks.values()].reverse();
  }, [filteredRows]);

  const account = accountContext?.account;
  const riskState = accountContext?.risk_state;
  const rules = accountContext?.rules;
  const selectedAccount = accounts.find((item) => item.id === activeAccountId) ?? null;
  const status = String(riskState?.status ?? account?.status ?? (hasNoAccount ? "NO ACCOUNT" : "UNAVAILABLE")).toUpperCase();
  const challengeName = recordText(accountContext?.product, "name", "code")
    ?? recordText(account, "challenge_type", "account_type")
    ?? "FundedWealth account";
  const phaseName = recordText(accountContext?.phase, "name", "code") ?? "Phase unavailable";
  const maxDrawdown = numeric(riskState?.drawdown_amount);
  const dailyDrawdown = numeric(riskState?.daily_loss);
  const equityValue = accountNumber(account, "equity");
  const profitTarget = numeric(riskState?.profit_target);
  const totalMetric = hasNoAccount ? "00" : stats.netPnl == null ? "—" : formatCurrency(stats.netPnl);
  const tradeMetric = hasNoAccount ? "00" : performanceQuery.isLoading ? "…" : String(stats.tradeCount);
  const noAccountNote = hasNoAccount ? "No account data" : undefined;
  const valueTone = (value: number | null) => value == null ? "neutral" : value >= 0 ? "positive" : "negative";
  const chartUnavailable = hasNoAccount
    ? "Charts will populate when a FundedWealth trading account is available."
    : "No records are available for this account and date range.";

  const tradeRows = filteredExecutions.slice(0, 20);
  const orderById = new Map<string, CanonicalOrder>(orderRows.map((order) => [order.id, order]));
  const loadError = !hasNoAccount && [performanceQuery, riskQuery, executionsQuery, ordersQuery, positionsQuery].some((query) => query.isError);

  return (
    <div className="min-h-full space-y-4 p-4 md:p-5 xl:p-6">
      <header className="flex flex-col gap-4 rounded-xl border border-border/70 bg-card/80 p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Trader analytics</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">My Stats</h1>
          <p className="mt-1 truncate text-sm text-muted-foreground">{challengeName} <span className="px-1">/</span> {phaseName}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {accounts.length > 1 && (
            <label className="sr-only" htmlFor="stats-account">Trading account</label>
          )}
          {accounts.length > 1 ? (
            <select
              id="stats-account"
              aria-label="Trading account"
              value={activeAccountId ?? ""}
              onChange={(event) => {
                void selectAccount(event.target.value).catch((error: unknown) => {
                  toast.error(error instanceof Error ? error.message : "Unable to switch trading account.");
                });
              }}
              className="h-9 max-w-56 rounded-md border border-input bg-background px-3 text-sm"
            >
              {accounts.map((item) => <option key={item.id} value={item.id}>{item.account_code ?? item.id}</option>)}
            </select>
          ) : (
            <span className="max-w-56 truncate rounded-md border border-border bg-background px-3 py-2 text-xs font-medium">
              {selectedAccount?.account_code ?? (hasNoAccount ? "No account selected" : "Account unavailable")}
            </span>
          )}
          <span className={`rounded-full border px-3 py-2 text-[11px] font-semibold ${status === "ACTIVE" ? "border-bullish/40 bg-bullish/10 text-bullish" : status === "NO ACCOUNT" ? "border-border bg-muted/40 text-muted-foreground" : status === "WARNING" ? "border-warning/40 bg-warning/10 text-warning" : "border-bearish/40 bg-bearish/10 text-bearish"}`}>
            {status}
          </span>
          <label className="sr-only" htmlFor="stats-date-range">Date range</label>
          <select
            id="stats-date-range"
            value={range}
            onChange={(event) => setRange(event.target.value as RangeOption)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            {rangeOptions.map((option) => <option key={option} value={option}>{option === "ALL" ? "All time" : `Last ${option}`}</option>)}
          </select>
        </div>
      </header>

      {isError && (
        <div className="rounded-lg border border-bearish/30 bg-bearish/5 px-4 py-3 text-sm text-bearish" role="alert">
          Account details could not be loaded. Analytics are not combined across accounts.
        </div>
      )}
      {loadError && (
        <div className="rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-warning" role="status">
          Some account analytics could not be loaded. Affected values are shown as unavailable.
        </div>
      )}
      {isLoading && !hasNoAccount && (
        <div className="text-xs text-muted-foreground" role="status">Loading selected-account analytics…</div>
      )}

      <section aria-label="Performance summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total P&L" value={totalMetric} note="Selected account · selected period" tone={valueTone(stats.netPnl)} empty={hasNoAccount} />
        <MetricCard label="Profit Factor" value={hasNoAccount ? "00" : "—"} note="Trade-level gross wins/losses unavailable" empty={hasNoAccount} />
        <MetricCard label="Average Winning Trade" value={hasNoAccount ? "00" : "—"} note="Requires closed-trade P&L records" empty={hasNoAccount} />
        <MetricCard label="Average Losing Trade" value={hasNoAccount ? "00" : "—"} note="Requires closed-trade P&L records" empty={hasNoAccount} />
        <MetricCard label="Win Rate" value={hasNoAccount ? "00" : formatPercent(stats.tradeCount > 0 ? stats.winRate : null)} note={hasNoAccount ? noAccountNote : `${stats.winCount} winning · ${stats.lossCount} losing`} tone={stats.winRate == null ? "neutral" : stats.winRate >= 50 ? "positive" : "negative"} empty={hasNoAccount} />
        <MetricCard label="Number of Trades Taken" value={tradeMetric} note="From daily account performance records" empty={hasNoAccount} />
        <MetricCard label="P&L per Trade" value={hasNoAccount ? "00" : formatCurrency(stats.avgPnlPerTrade)} note="Net P&L divided by reported trade count" tone={valueTone(stats.avgPnlPerTrade)} empty={hasNoAccount} />
        <MetricCard label="Risk-to-Reward Ratio" value={hasNoAccount ? "00" : "—"} note="Trade-level average win/loss unavailable" empty={hasNoAccount} />
      </section>

      <section aria-label="Risk and consistency" className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Daily Drawdown Level" value={hasNoAccount ? "00" : formatCurrency(dailyDrawdown)} note={numeric(rules?.daily_loss_limit) == null ? "Limit unavailable" : `Configured limit ${formatCurrency(numeric(rules?.daily_loss_limit))}`} tone={dailyDrawdown != null && dailyDrawdown > 0 ? "negative" : "neutral"} empty={hasNoAccount} />
        <MetricCard label="Maximum Drawdown Level" value={hasNoAccount ? "00" : formatCurrency(maxDrawdown)} note={numeric(rules?.maximum_drawdown) == null ? "Limit unavailable" : `Configured limit ${formatCurrency(numeric(rules?.maximum_drawdown))}`} tone={maxDrawdown != null && maxDrawdown > 0 ? "negative" : "neutral"} empty={hasNoAccount} />
        <MetricCard label="Consistency" value={hasNoAccount ? "00" : formatPercent(stats.consistency)} note="Profitable days ÷ active days" empty={hasNoAccount} />
        <MetricCard label="Maximum Profit Day" value={hasNoAccount ? "00" : formatCurrency(stats.maxProfitDay)} note="Highest daily net P&L in range" tone={valueTone(stats.maxProfitDay)} empty={hasNoAccount} />
        <MetricCard label="Edge Score" value={hasNoAccount ? "00" : "—"} note="Not calculable without trade-level outcomes" empty={hasNoAccount} />
        <MetricCard label="Current Equity" value={hasNoAccount ? "00" : formatCurrency(equityValue)} note="Current selected-account snapshot" empty={hasNoAccount} />
        <MetricCard label="Profit Target" value={hasNoAccount ? "00" : formatCurrency(profitTarget)} note="Account risk state" empty={hasNoAccount} />
        <MetricCard label="Observed Maximum Drawdown" value={hasNoAccount ? "00" : formatCurrency(stats.observedDrawdown)} note="From available daily closing-equity records" tone={stats.observedDrawdown != null && stats.observedDrawdown > 0 ? "negative" : "neutral"} empty={hasNoAccount} />
      </section>

      <section aria-label="Performance charts" className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-3">
        <Card title="Equity Line">
          <ChartFrame empty={!stats.equityPoints.length} message={chartUnavailable}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={stats.equityPoints}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} width={62} />
                <Tooltip formatter={(value: number) => [formatCurrency(value), "Closing equity"]} />
                <Line type="monotone" dataKey="equity" stroke="#1688ff" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </ChartFrame>
        </Card>
        <Card title="Daily Net Cumulative P&L">
          <ChartFrame empty={!stats.cumulativePoints.length} message={chartUnavailable}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats.cumulativePoints}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} width={62} />
                <Tooltip formatter={(value: number) => [formatCurrency(value), "Cumulative net P&L"]} />
                <Area type="monotone" dataKey="pnl" stroke="#10b981" fill="#10b981" fillOpacity={0.16} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartFrame>
        </Card>
        <Card title="Winning versus Losing P&L">
          <EmptyChart message={hasNoAccount ? chartUnavailable : "Individual winning and losing trade P&L is not present in the available account records."} />
        </Card>
        <Card title="Performance by Hour · executions">
          <ChartFrame empty={!executionAnalysis.hourly.length} message={chartUnavailable}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={executionAnalysis.hourly}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                <XAxis dataKey="hour" tick={{ fontSize: 10 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={30} />
                <Tooltip />
                <Bar dataKey="fills" name="Executions" fill="#1688ff" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartFrame>
        </Card>
        <Card title="Gross Daily P&L">
          <EmptyChart message={hasNoAccount ? chartUnavailable : "Gross daily P&L is unavailable; only daily net P&L is recorded."} />
        </Card>
        <Card title="Trade Distribution by Day of Week · executions">
          <ChartFrame empty={!filteredExecutions.length} message={chartUnavailable}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={executionAnalysis.weekdays}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={30} />
                <Tooltip />
                <Bar dataKey="fills" name="Executions" fill="#7c6cf0" radius={[3, 3, 0, 0]}>
                  {executionAnalysis.weekdays.map((item) => <Cell key={item.day} fill="#7c6cf0" />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartFrame>
        </Card>
      </section>

      <section aria-label="Trade statistics" className="grid gap-3 xl:grid-cols-3">
        <Card title="Long / Short Trades">
          <div className="grid grid-cols-2 gap-3">
            {(["Long", "Short"] as const).map((direction) => {
              const matches = openPositions.filter((position) => {
                const side = String(position.side ?? "").toLowerCase();
                return direction === "Long" ? side === "long" || side === "buy" : side === "short" || side === "sell";
              });
              const pnl = matches.reduce((sum, position) => sum + (numeric(position.unrealized_pnl) ?? 0), 0);
              return (
                <div key={direction} className="rounded-lg border border-border/60 p-3">
                  <p className="text-xs text-muted-foreground">{direction} open positions</p>
                  <p className="mt-1 font-mono text-xl font-semibold">{hasNoAccount ? "00" : String(matches.length)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Unrealized P&L {hasNoAccount ? "00" : matches.length ? formatCurrency(pnl) : "—"}</p>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">Closed-trade direction statistics are unavailable without a closed-trades ledger.</p>
        </Card>
        <Card title="Win / Loss / Breakeven Totals">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-bullish/5 p-3"><p className="text-[11px] text-muted-foreground">Winning</p><p className="mt-1 font-mono text-lg text-bullish">{hasNoAccount ? "00" : stats.winCount}</p></div>
            <div className="rounded-lg bg-bearish/5 p-3"><p className="text-[11px] text-muted-foreground">Losing</p><p className="mt-1 font-mono text-lg text-bearish">{hasNoAccount ? "00" : stats.lossCount}</p></div>
            <div className="rounded-lg bg-muted/50 p-3"><p className="text-[11px] text-muted-foreground">Breakeven</p><p className="mt-1 font-mono text-lg">{hasNoAccount ? "00" : "—"}</p></div>
          </div>
          <div className="mt-4 space-y-2 text-xs">
            <div className="flex justify-between"><span className="text-muted-foreground">Average win / loss</span><span>{hasNoAccount ? "00" : "— / —"}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Best win / worst loss</span><span>{hasNoAccount ? "00" : "— / —"}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Average / max win streak</span><span>{hasNoAccount ? "00" : "— / —"}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Average / max loss streak</span><span>{hasNoAccount ? "00" : "— / —"}</span></div>
          </div>
        </Card>
        <Card title="Daily Net P&L Stats">
          <div className="space-y-3 text-xs">
            <StatRow label="Trading days" value={hasNoAccount ? "00" : String(filteredRows.length)} />
            <StatRow label="Profitable days" value={hasNoAccount ? "00" : stats.consistency == null ? "—" : `${filteredRows.filter((row) => (numeric(row.daily_pnl) ?? 0) > 0).length}`} />
            <StatRow label="Winning-day consistency" value={hasNoAccount ? "00" : formatPercent(stats.consistency)} />
            <StatRow label="Average daily net P&L" value={hasNoAccount ? "00" : stats.netPnl != null && filteredRows.length ? formatCurrency(stats.netPnl / filteredRows.length) : "—"} />
            <StatRow label="Maximum daily net P&L" value={hasNoAccount ? "00" : formatCurrency(stats.maxProfitDay)} />
          </div>
        </Card>
      </section>

      <section aria-label="Daily and period statistics" className="grid gap-3 xl:grid-cols-2">
        <Card title="Summary Week">
          <DataTable
            headers={["Week of", "Days", "Trades", "Net P&L"]}
            rows={weeklyRows.map((row) => [row.week, String(row.days), String(row.trades), formatCurrency(row.pnl)])}
            empty={hasNoAccount ? "No account selected." : "No daily performance records in this range."}
          />
        </Card>
        <Card title="Summary Instruments">
          <DataTable
            headers={["Instrument", "Executions"]}
            rows={executionAnalysis.instruments.slice(0, 8).map((item) => [item.symbol, String(item.fills)])}
            empty={hasNoAccount ? "No account selected." : "No executions are available for this account and date range."}
          />
        </Card>
        <Card title="Summary Session">
          <DataTable
            headers={["Local-time bucket", "Executions"]}
            rows={executionAnalysis.sessions.map((item) => [item.session, String(item.fills)])}
            empty={hasNoAccount ? "No account selected." : "No executions are available for this account and date range."}
          />
        </Card>
        <Card title="Daily Trading Statistics">
          <DataTable
            headers={["Date", "Trades", "Wins", "Losses", "Net P&L"]}
            rows={[...filteredRows].reverse().slice(0, 10).map((row) => [
              formatShortDate(row.date),
              String(numeric(row.total_trades) ?? "—"),
              String(numeric(row.winning_trades) ?? "—"),
              String(numeric(row.losing_trades) ?? "—"),
              formatCurrency(numeric(row.daily_pnl)),
            ])}
            empty={hasNoAccount ? "No account selected." : "No daily performance records in this range."}
          />
        </Card>
      </section>

      <section aria-label="Advanced statistics" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Expectancy" value={hasNoAccount ? "00" : formatCurrency(stats.avgPnlPerTrade)} note="Net P&L per reported trade" empty={hasNoAccount} />
        <MetricCard label="Recovery Factor" value={hasNoAccount ? "00" : stats.netPnl != null && maxDrawdown != null && maxDrawdown > 0 ? (stats.netPnl / maxDrawdown).toFixed(2) : "—"} note="Net P&L ÷ account drawdown" empty={hasNoAccount} />
        <MetricCard label="Sharpe Ratio" value={hasNoAccount ? "00" : "—"} note="Daily return series / risk-free input unavailable" empty={hasNoAccount} />
        <MetricCard label="Sortino Ratio" value={hasNoAccount ? "00" : "—"} note="Trade/daily downside deviation unavailable" empty={hasNoAccount} />
        <MetricCard label="Maximum Drawdown" value={hasNoAccount ? "00" : formatCurrency(maxDrawdown ?? stats.observedDrawdown)} note="Account risk state, when available" tone="negative" empty={hasNoAccount} />
        <MetricCard label="Profit Factor" value={hasNoAccount ? "00" : "—"} note="Trade-level gross wins/losses unavailable" empty={hasNoAccount} />
        <MetricCard label="Consistency Score" value={hasNoAccount ? "00" : formatPercent(stats.consistency)} note="Profitable days ÷ active days" empty={hasNoAccount} />
      </section>

      <Card title="Recent Trade Breakdown" className="overflow-hidden">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button size="sm" variant={tradeTab === "recent" ? "default" : "outline"} onClick={() => setTradeTab("recent")}>Recent Trades</Button>
            <Button size="sm" variant={tradeTab === "open" ? "default" : "outline"} onClick={() => setTradeTab("open")}>Open Trades ({hasNoAccount ? "00" : openPositions.length})</Button>
          </div>
          <div className="flex items-center gap-1" aria-label="Trade outcome filters">
            <Button size="sm" variant="secondary" aria-pressed="true">All Trades</Button>
            <Button size="sm" variant="outline" disabled title="Individual trade outcomes are unavailable">Winning</Button>
            <Button size="sm" variant="outline" disabled title="Individual trade outcomes are unavailable">Losing</Button>
          </div>
        </div>
        {tradeTab === "recent" ? (
          <DataTable
            headers={["Date", "Instrument", "Side", "Quantity", "Fill price", "Order status", "Trade P&L"]}
            rows={tradeRows.map((fill) => {
              const order = orderById.get(fill.order_id);
              return [
                formatShortDate(fill.executed_at),
                fill.symbol,
                order?.side?.toUpperCase() ?? "—",
                String(fill.qty),
                formatCurrency(fill.price),
                order?.status ?? "Executed",
                "—",
              ];
            })}
            empty={hasNoAccount ? "No account selected." : executionsQuery.isLoading ? "Loading execution history…" : "No executions are available for this account and date range."}
          />
        ) : (
          <DataTable
            headers={["Opened", "Instrument", "Side", "Quantity", "Average price", "Last price", "Unrealized P&L"]}
            rows={openPositions.map((position) => [
              formatShortDate(position.opened_at ?? position.created_at),
              position.symbol,
              String(position.side ?? "—").toUpperCase(),
              String(position.qty ?? position.quantity ?? "—"),
              formatCurrency(numeric(position.avg_price) ?? numeric(position.average_price)),
              formatCurrency(numeric(position.current_price) ?? numeric(position.last_price)),
              formatCurrency(numeric(position.unrealized_pnl)),
            ])}
            empty={hasNoAccount ? "No account selected." : positionsQuery.isLoading ? "Loading open positions…" : "No open positions for this account."}
          />
        )}
      </Card>

      {hasNoAccount && (
        <div className="rounded-lg border border-border/70 bg-card/70 px-4 py-3 text-sm text-muted-foreground" role="status">
          No FundedWealth trading account is currently available. The analytics workspace is ready and will populate from the selected account’s canonical records when one is assigned. No sample trades, charts, or financial values are shown.
        </div>
      )}
      {!hasNoAccount && riskQuery.isError && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-xs text-warning">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" /> Risk snapshot could not be loaded; risk values remain unavailable.
        </div>
      )}
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-3 border-b border-border/50 pb-2 last:border-0 last:pb-0"><span className="text-muted-foreground">{label}</span><span className="font-mono tabular-nums">{value}</span></div>;
}

function DataTable({ headers, rows, empty }: { headers: string[]; rows: string[][]; empty: string }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border/60">
      <table className="w-full min-w-max text-left text-xs">
        <thead className="bg-muted/50 text-[10px] uppercase tracking-wide text-muted-foreground">
          <tr>{headers.map((header) => <th key={header} className="whitespace-nowrap px-3 py-2.5 font-semibold">{header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row[0]}-${row[1]}-${index}`} className="border-t border-border/50">
              {row.map((cell, cellIndex) => <td key={`${cellIndex}-${cell}`} className="whitespace-nowrap px-3 py-2.5">{cell}</td>)}
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={headers.length} className="px-3 py-8 text-center text-muted-foreground">{empty}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
