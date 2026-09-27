import { AlertCircle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import type { TerminalPosition } from "@/lib/terminalApi";

const POSITION_SIDE_LABELS = new Map<string, "LONG" | "SHORT">([
  ["long", "LONG"],
  ["short", "SHORT"],
  ["buy", "LONG"],
  ["sell", "SHORT"],
]);

export function normalizeCanonicalPosition(input: Partial<TerminalPosition>): TerminalPosition {
  const accountId = (input.trading_account_id ?? input.account_id ?? "unknown-account") as string;
  const symbol = String(input.symbol ?? "UNKNOWN").toUpperCase();
  const qty = Number(input.qty ?? input.quantity ?? 0);
  const avgPrice = Number(input.avg_price ?? input.average_price ?? input.averageEntryPrice ?? 0);
  const currentPrice = input.current_price ?? input.last_price ?? input.currentPrice ?? null;
  const sideValue = String(input.side ?? "").toLowerCase();
  const side = POSITION_SIDE_LABELS.get(sideValue) ?? ((qty >= 0 && sideValue === "buy") || sideValue === "long" ? "LONG" : (sideValue === "sell" || sideValue === "short" ? "SHORT" : "LONG"));
  const positionStatus = String(input.position_status ?? (input.is_open === false ? "closed" : input.isOpen === false ? "closed" : "open"))
    .toLowerCase();
  const normalized: TerminalPosition = {
    ...input,
    id: String(input.id ?? `${accountId}:${symbol}`),
    symbol,
    side,
    qty: qty || 0,
    quantity: qty || 0,
    avg_price: avgPrice,
    average_price: avgPrice,
    is_open: positionStatus !== "closed",
  } as TerminalPosition;

  if (input.trading_account_id != null || input.account_id != null) {
    normalized.trading_account_id = accountId;
    if (input.account_id != null) normalized.account_id = input.account_id;
  }

  if (currentPrice != null) {
    normalized.current_price = Number(currentPrice);
    normalized.last_price = Number(currentPrice);
  }

  normalized.unrealized_pnl = Number(input.unrealized_pnl ?? 0);
  normalized.realized_pnl = Number(input.realized_pnl ?? 0);
  if (Object.prototype.hasOwnProperty.call(input, "stop_loss") || Object.prototype.hasOwnProperty.call(input, "stopLoss")) {
    normalized.stop_loss = input.stop_loss ?? input.stopLoss ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(input, "take_profit") || Object.prototype.hasOwnProperty.call(input, "takeProfit")) {
    normalized.take_profit = input.take_profit ?? input.takeProfit ?? null;
  }
  normalized.position_status = positionStatus;

  if (input.updated_at || input.updatedAt || input.opened_at || input.created_at) {
    const updatedAt = String(input.updated_at ?? input.updatedAt ?? input.opened_at ?? input.created_at ?? new Date().toISOString());
    normalized.updated_at = updatedAt;
    if (input.updatedAt != null) normalized.updatedAt = updatedAt;
  }

  return normalized;
}

export function uniqueCanonicalPositions(positions: readonly TerminalPosition[]): TerminalPosition[] {
  const byKey = new Map<string, TerminalPosition>();

  for (const candidate of positions) {
    const normalized = normalizeCanonicalPosition(candidate);
    const key = normalized.id || `${normalized.trading_account_id}:${normalized.symbol}`;
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, normalized);
      continue;
    }

    const currentTimestamp = new Date(normalized.updated_at ?? normalized.updatedAt ?? normalized.opened_at ?? Date.now()).getTime();
    const existingTimestamp = new Date(existing.updated_at ?? existing.updatedAt ?? existing.opened_at ?? Date.now()).getTime();
    if (currentTimestamp >= existingTimestamp) {
      byKey.set(key, {
        ...existing,
        ...normalized,
        stop_loss: normalized.stop_loss == null && existing.stop_loss != null && !normalized.stop_loss_removed ? existing.stop_loss : normalized.stop_loss,
        take_profit: normalized.take_profit == null && existing.take_profit != null && !normalized.take_profit_removed ? existing.take_profit : normalized.take_profit,
      });
    }
  }

  return [...byKey.values()];
}

function formatCurrency(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatSignedCurrency(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  const absoluteValue = Math.abs(value);
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}₹${absoluteValue.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatTimestamp(value?: string | null): string {
  if (!value) return "No timestamp";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function CustomerPositionTable({
  positions,
  isLoading = false,
  isError = false,
  isFetching = false,
  errorMessage,
  onRetry,
}: {
  positions: readonly TerminalPosition[];
  isLoading?: boolean;
  isError?: boolean;
  isFetching?: boolean;
  errorMessage?: string;
  onRetry?: () => void;
}) {
  if (isLoading) return <div role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />Loading canonical positions...</div>;
  if (isError) return <div role="alert" className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><span className="flex items-center gap-1.5"><AlertCircle className="h-3 w-3" />{errorMessage ?? "Positions unavailable: authentication or account access is required."}</span>{onRetry && <button type="button" className="inline-flex items-center gap-1 underline" onClick={onRetry}><RefreshCw className="h-3 w-3" />Retry</button>}</div>;

  const activePositions = uniqueCanonicalPositions(positions).filter((position) => {
    const normalized = normalizeCanonicalPosition(position);
    return normalized.is_open !== false && normalized.position_status !== "closed";
  });

  if (activePositions.length === 0) return <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><CheckCircle2 className="h-3 w-3" />No canonical positions recorded</div>;

  return <div className="space-y-2" aria-label="Customer canonical positions">
    {isFetching && <div role="status" className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><RefreshCw className="h-3 w-3 animate-spin" />Refreshing canonical position state...</div>}
    {activePositions.map((position) => {
      const normalized = normalizeCanonicalPosition(position);
      const sideClassName = normalized.side === "LONG" ? "border-bullish/40 bg-bullish/10 text-bullish" : "border-bearish/40 bg-bearish/10 text-bearish";
      return <article key={normalized.id} className="rounded border border-border/60 p-2" data-position-id={normalized.id} data-position-status={normalized.position_status}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="truncate text-xs font-semibold">{normalized.symbol}</p>
              {normalized.exchange && <span className="text-[10px] uppercase text-muted-foreground">{normalized.exchange}</span>}
            </div>
            <p className="text-[10px] text-muted-foreground">{formatTimestamp(normalized.updated_at ?? normalized.updatedAt)}</p>
          </div>
          <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${sideClassName}`}>
            {normalized.side}
          </span>
        </div>

        <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
          <div>
            <p className="text-[10px] uppercase tracking-wide">Qty</p>
            <p className="mt-0.5 font-mono text-sm text-foreground">{Number(normalized.qty ?? normalized.quantity ?? 0).toLocaleString("en-IN")}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide">Avg entry</p>
            <p className="mt-0.5 font-mono text-sm text-foreground">{formatCurrency(normalized.avg_price ?? normalized.average_price)}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide">Current</p>
            <p className="mt-0.5 font-mono text-sm text-foreground">{formatCurrency(normalized.current_price ?? normalized.last_price)}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide">State</p>
            <p className="mt-0.5 text-sm font-medium text-foreground uppercase">{normalized.position_status === "closed" ? "Closed" : "Open"}</p>
          </div>
          <div data-protection="stop-loss">
            <p className="text-[10px] uppercase tracking-wide">Stop loss</p>
            <p className="mt-0.5 font-mono text-sm text-foreground">{formatCurrency(normalized.stop_loss)}</p>
          </div>
          <div data-protection="take-profit">
            <p className="text-[10px] uppercase tracking-wide">Take profit</p>
            <p className="mt-0.5 font-mono text-sm text-foreground">{formatCurrency(normalized.take_profit)}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide">Realized P&L</p>
            <p className={`mt-0.5 font-mono text-sm ${Number(normalized.realized_pnl ?? 0) >= 0 ? "text-bullish" : "text-bearish"}`}>
              {formatSignedCurrency(Number(normalized.realized_pnl ?? 0))}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide">Unrealized P&L</p>
            <p className={`mt-0.5 font-mono text-sm ${Number(normalized.unrealized_pnl ?? 0) >= 0 ? "text-bullish" : "text-bearish"}`}>
              {formatSignedCurrency(Number(normalized.unrealized_pnl ?? 0))}
            </p>
          </div>
        </div>
      </article>;
    })}
  </div>;
}
