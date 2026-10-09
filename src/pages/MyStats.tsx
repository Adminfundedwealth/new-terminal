import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Activity, BarChart3, ChartNoAxesCombined, CircleDollarSign, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAccountContext } from "@/hooks/useAccountContext";
import { fetchTerminalExecutions, fetchTerminalPerformance, fetchTerminalRisk } from "@/lib/terminalApi";

const rangeOptions = ["1D", "1W", "1M", "3M", "ALL"] as const;
type RangeOption = (typeof rangeOptions)[number];

function formatCurrency(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : value > 0 ? "+" : "";
  const formatter = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${sign}${formatter.format(abs).replace(/^₹/, "₹")}`;
}

function formatPercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${value.toFixed(2)}%`;
}

function formatSignedCurrency(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${value >= 0 ? "+" : "-"}${formatCurrency(Math.abs(value), 2)}`;
}

function formatShortDate(value: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

function filterPerformanceRows(rows: Array<{ date: string; daily_pnl?: number; total_trades?: number; winning_trades?: number; losing_trades?: number }>, range: RangeOption) {
  if (!rows.length) return [];
  const toDays = (value: RangeOption) => {
    switch (value) {
      case "1D": return 1;
      case "1W": return 7;
      case "1M": return 30;
      case "3M": return 90;
      default: return 3650;
    }
  };

  const days = toDays(range);
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  return rows.filter((row) => {
    const rowDate = new Date(row.date);
    if (Number.isNaN(rowDate.getTime())) return true;
    return rowDate.getTime() >= cutoff;
  });
}

export default function MyStats() {
  const { accountContext, activeAccountId, accounts, isLoading, isError, hasNoAccount } = useAccountContext();
  const [range, setRange] = useState<RangeOption>("ALL");

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

  const performanceRows = performanceQuery.data?.data ?? [];
  const filteredRows = useMemo(() => filterPerformanceRows(performanceRows, range), [performanceRows, range]);
  const executionRows = executionsQuery.data?.data ?? [];
  const account = accountContext?.account ?? {};
  const riskState = accountContext?.risk_state ?? {};
  const rules = accountContext?.rules ?? {};

  const totalTrades = filteredRows.reduce((sum, row) => sum + Number(row.total_trades ?? 0), 0);
  const totalWins = filteredRows.reduce((sum, row) => sum + Number(row.winning_trades ?? 0), 0);
  const totalLosses = filteredRows.reduce((sum, row) => sum + Number(row.losing_trades ?? 0), 0);
  const netPnl = typeof riskState.profit_current === "number" ? riskState.profit_current : filteredRows.reduce((sum, row) => sum + Number(row.daily_pnl ?? 0), 0);
  const avgTradePnl = totalTrades > 0 ? netPnl / totalTrades : 0;
  const winRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0;

  const equitySeries = filteredRows.map((row, index, all) => {
    const running = all.slice(0, index + 1).reduce((sum, item) => sum + Number(item.daily_pnl ?? 0), 0);
    return { label: formatShortDate(String(row.date)), cumulative: running, date: row.date };
  });

  const chartSeries = filteredRows.map((row) => ({
    label: formatShortDate(String(row.date)),
    pnl: Number(row.daily_pnl ?? 0),
  }));

  const selectedAccount = accounts.find((item) => item.id === activeAccountId) ?? accounts[0] ?? null;

  const summaryCards = [
    { label: "Net P&L", value: formatCurrency(netPnl, 2), tone: netPnl >= 0 ? "positive" : "negative" },
    { label: "Trades", value: String(totalTrades || performanceRows.reduce((sum, row) => sum + Number(row.total_trades ?? 0), 0) || 0), tone: "neutral" },
    { label: "Win Rate", value: formatPercent(winRate || Number((accountContext as any)?.win_rate ?? 0)), tone: winRate >= 50 ? "positive" : "negative" },
    { label: "Avg. P&L / Trade", value: formatCurrency(avgTradePnl, 2), tone: avgTradePnl >= 0 ? "positive" : "negative" },
  ];

  const status = (riskState.status ?? account?.status ?? "UNAVAILABLE").toString().toUpperCase();
  const dailyDrawdown = Number((riskState.daily_loss ?? 0) || 0);
  const maxDrawdown = Number((riskState.drawdown_amount ?? 0) || 0);
  const currentBalance = Number((account as any)?.current_balance ?? (account as any)?.balance ?? 0);
  const equityValue = Number((account as any)?.equity ?? currentBalance ?? 0);
  const profitTarget = Number((riskState.profit_target ?? 0) || 0);

  const renderValue = (value: string | number | undefined, positive?: boolean) => (
    <span className={positive === undefined ? "text-foreground" : positive ? "text-green-600" : "text-red-600"}>{value}</span>
  );

  if (isLoading) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Loading My Stats for the selected account…
      </div>
    );
  }

  if (hasNoAccount) {
    const emptyMetrics = [
      "Net P&L",
      "Trades",
      "Win Rate",
      "Avg. P&L / Trade",
      "Daily Drawdown",
      "Maximum Drawdown",
      "Current Equity",
      "Profit Target",
    ];

    return (
      <div className="space-y-4 p-4 md:p-5">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">Funded Wealth</p>
            <h1 className="mt-1 text-3xl font-black tracking-tight">MY STATS</h1>
          </div>
          <span className="rounded-full border border-border bg-muted/40 px-3 py-1.5 text-xs font-semibold text-muted-foreground">
            NO ACCOUNT
          </span>
        </header>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Empty account statistics">
          {emptyMetrics.map((label) => (
            <div key={label} className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
              <div className="text-sm text-muted-foreground">{label}</div>
              <div className="mt-2 font-mono text-3xl font-black text-muted-foreground">00</div>
            </div>
          ))}
        </section>

        <div className="rounded-xl border border-border/70 bg-card/70 p-4 text-sm text-muted-foreground" role="status">
          Account statistics will appear here when a FundedWealth trading account is available.
        </div>
      </div>
    );
  }

  if (isError || !activeAccountId) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground" role="alert">
          My Stats are unavailable because account data could not be loaded.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 md:p-5">
      <header className="rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">Funded Wealth</p>
            <h1 className="mt-1 text-3xl font-black tracking-tight">MY STATS</h1>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span className="rounded-full border border-border bg-muted/40 px-3 py-1.5 font-medium text-foreground">
              Account: {selectedAccount?.account_code ?? activeAccountId}
            </span>
            <span className="rounded-full border border-border bg-muted/40 px-3 py-1.5 font-medium text-foreground">
              Status: {status}
            </span>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {rangeOptions.map((option) => (
            <Button
              key={option}
              size="sm"
              variant={range === option ? "default" : "outline"}
              className={range === option ? "bg-primary" : ""}
              onClick={() => setRange(option)}
            >
              {option}
            </Button>
          ))}
        </div>
      </header>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map((card) => (
          <div key={card.label} className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
            <div className="text-sm text-muted-foreground">{card.label}</div>
            <div className={`mt-2 text-3xl font-black ${card.tone === "positive" ? "text-green-600" : card.tone === "negative" ? "text-red-600" : "text-foreground"}`}>
              {card.value}
            </div>
          </div>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xl font-bold">Equity Curve</h2>
            <span className="text-xs uppercase tracking-wide text-muted-foreground">{range}</span>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={equitySeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(value: number) => [formatCurrency(value, 2), "Equity"]} labelFormatter={(label) => `Date: ${label}`} />
                <Line type="monotone" dataKey="cumulative" stroke="#3b82f6" strokeWidth={3} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xl font-bold">Daily Net Cumulative P&L</h2>
            <span className="text-xs uppercase tracking-wide text-muted-foreground">actual account data</span>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(value: number) => [formatCurrency(value, 2), "Daily P&L"]} labelFormatter={(label) => `Date: ${label}`} />
                <Bar dataKey="pnl" radius={[4, 4, 0, 0]} fill={(value) => (value && value > 0 ? "#22c55e" : "#ef4444") as any} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <div className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-xl font-bold"><ShieldAlert className="h-4 w-4" /> Risk & Drawdown</div>
          <div className="space-y-4 text-sm">
            <div className="flex items-center justify-between border-b border-border/60 pb-2">
              <span className="text-muted-foreground">Daily Drawdown</span>
              {renderValue(formatCurrency(dailyDrawdown, 2), dailyDrawdown <= 0)}
            </div>
            <div className="flex items-center justify-between border-b border-border/60 pb-2">
              <span className="text-muted-foreground">Maximum Drawdown</span>
              {renderValue(formatCurrency(maxDrawdown, 2), maxDrawdown <= 0)}
            </div>
            <div className="flex items-center justify-between border-b border-border/60 pb-2">
              <span className="text-muted-foreground">Current Equity</span>
              {renderValue(formatCurrency(equityValue, 2), equityValue >= 0)}
            </div>
            <div className="flex items-center justify-between border-b border-border/60 pb-2">
              <span className="text-muted-foreground">Profit Target</span>
              {renderValue(formatCurrency(profitTarget, 2), profitTarget >= 0)}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Risk Status</span>
              <span className={`rounded-full px-2 py-1 text-xs font-semibold ${status === "ACTIVE" ? "bg-green-500/10 text-green-600" : status === "WARNING" ? "bg-yellow-500/10 text-yellow-600" : "bg-red-500/10 text-red-600"}`}>
                {status}
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-xl font-bold"><BarChart3 className="h-4 w-4" /> Trade Summary</div>
          <div className="space-y-4 text-sm">
            <div className="flex items-center justify-between border-b border-border/60 pb-2">
              <span className="text-muted-foreground">Total Trades</span>
              <span>{totalTrades}</span>
            </div>
            <div className="flex items-center justify-between border-b border-border/60 pb-2">
              <span className="text-muted-foreground">Winners</span>
              <span className="text-green-600">{totalWins}</span>
            </div>
            <div className="flex items-center justify-between border-b border-border/60 pb-2">
              <span className="text-muted-foreground">Losers</span>
              <span className="text-red-600">{totalLosses}</span>
            </div>
            <div className="flex items-center justify-between border-b border-border/60 pb-2">
              <span className="text-muted-foreground">Average Win</span>
              <span className="text-green-600">{formatCurrency(totalWins ? netPnl / totalWins : 0, 2)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Average Loss</span>
              <span className="text-red-600">{formatCurrency(totalLosses ? Math.abs(netPnl) / totalLosses : 0, 2)}</span>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-xl font-bold"><ChartNoAxesCombined className="h-4 w-4" /> Account Snapshot</div>
          <div className="space-y-4 text-sm">
            <div className="flex items-center justify-between border-b border-border/60 pb-2">
              <span className="text-muted-foreground">Current Balance</span>
              {renderValue(formatCurrency(currentBalance, 2), currentBalance >= 0)}
            </div>
            <div className="flex items-center justify-between border-b border-border/60 pb-2">
              <span className="text-muted-foreground">Available Margin</span>
              {renderValue(formatCurrency(Number((account as any)?.available_margin ?? 0), 2), Number((account as any)?.available_margin ?? 0) >= 0)}
            </div>
            <div className="flex items-center justify-between border-b border-border/60 pb-2">
              <span className="text-muted-foreground">Utilized Margin</span>
              {renderValue(formatCurrency(Number((account as any)?.used_margin ?? 0), 2), Number((account as any)?.used_margin ?? 0) >= 0)}
            </div>
            <div className="flex items-center justify-between border-b border-border/60 pb-2">
              <span className="text-muted-foreground">Executed Trades</span>
              <span>{executionRows.length}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Performance Rows</span>
              <span>{performanceRows.length}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2 text-xl font-bold"><Activity className="h-4 w-4" /> Recent Trade Breakdown</div>
        <div className="overflow-hidden rounded-xl border border-border/60">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Symbol</th>
                <th className="px-3 py-2">Qty</th>
                <th className="px-3 py-2">Price</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {executionRows.slice(0, 10).map((trade) => (
                <tr key={trade.id} className="border-t border-border/60">
                  <td className="px-3 py-2">{formatShortDate(trade.executed_at)}</td>
                  <td className="px-3 py-2 font-medium">{trade.symbol}</td>
                  <td className="px-3 py-2">{trade.qty}</td>
                  <td className="px-3 py-2">{formatCurrency(Number(trade.price ?? 0), 2)}</td>
                  <td className="px-3 py-2 text-muted-foreground">Executed</td>
                </tr>
              ))}
              {!executionRows.length && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                    No execution history is available for the selected account yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2 text-xl font-bold"><CircleDollarSign className="h-4 w-4" /> Performance by Day</div>
        <div className="overflow-hidden rounded-xl border border-border/60">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Trades</th>
                <th className="px-3 py-2">Wins</th>
                <th className="px-3 py-2">Losses</th>
                <th className="px-3 py-2">Net P&L</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.slice(0, 10).map((row) => (
                <tr key={row.date} className="border-t border-border/60">
                  <td className="px-3 py-2">{formatShortDate(String(row.date))}</td>
                  <td className="px-3 py-2">{row.total_trades ?? 0}</td>
                  <td className="px-3 py-2 text-green-600">{row.winning_trades ?? 0}</td>
                  <td className="px-3 py-2 text-red-600">{row.losing_trades ?? 0}</td>
                  <td className={`px-3 py-2 ${Number(row.daily_pnl ?? 0) >= 0 ? "text-green-600" : "text-red-600"}`}>
                    {formatCurrency(Number(row.daily_pnl ?? 0), 2)}
                  </td>
                </tr>
              ))}
              {!filteredRows.length && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                    No performance rows are available for the selected date range.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
