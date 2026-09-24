import { AlertCircle, CheckCircle2, Clock3, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { canCancelStatus, canModifyStatus } from "@/lib/orderLifecycle";
import type { TerminalOrder } from "@/lib/terminalApi";

const STATUS_LABELS: Record<TerminalOrder["status"], string> = {
  requested: "Requested",
  pending: "Pending",
  open: "Open",
  partially_filled: "Partially filled",
  filled: "Filled",
  cancel_requested: "Cancel requested",
  cancelled: "Cancelled",
  rejected: "Rejected",
  failed: "Failed",
};

const TERMINAL_STATUSES = new Set<TerminalOrder["status"]>(["filled", "cancelled", "rejected", "failed"]);

export function uniqueCanonicalOrders(orders: readonly TerminalOrder[]): TerminalOrder[] {
  const byId = new Map<string, TerminalOrder>();
  for (const order of orders) {
    const existing = byId.get(order.id);
    if (!existing || new Date(order.updatedAt).getTime() >= new Date(existing.updatedAt).getTime()) byId.set(order.id, order);
  }
  return [...byId.values()];
}

export function CustomerOrderTable({
  orders,
  isLoading = false,
  isError = false,
  isFetching = false,
  errorMessage,
  onRetry,
  onCancel,
  onModify,
}: {
  orders: readonly TerminalOrder[];
  isLoading?: boolean;
  isError?: boolean;
  isFetching?: boolean;
  errorMessage?: string;
  onRetry?: () => void;
  onCancel?: (order: TerminalOrder) => void;
  onModify?: (order: TerminalOrder) => void;
}) {
  if (isLoading) return <div role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />Loading canonical orders...</div>;
  if (isError) return <div role="alert" className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><span className="flex items-center gap-1.5"><AlertCircle className="h-3 w-3" />{errorMessage ?? "Orders unavailable: authentication or account access is required."}</span>{onRetry && <button type="button" className="inline-flex items-center gap-1 underline" onClick={onRetry}><RefreshCw className="h-3 w-3" />Retry</button>}</div>;
  if (orders.length === 0) return <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><CheckCircle2 className="h-3 w-3" />No canonical orders recorded</div>;

  const uniqueOrders = uniqueCanonicalOrders(orders);
  return <div className="space-y-2" aria-label="Customer canonical orders">
    {isFetching && <div role="status" className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><RefreshCw className="h-3 w-3 animate-spin" />Refreshing canonical order state...</div>}
    {uniqueOrders.map((order) => {
      const terminal = TERMINAL_STATUSES.has(order.status);
      const canCancel = canCancelStatus(order.status);
      const canModify = canModifyStatus(order.status);
      const reason = order.rejectionReason ?? order.cancellationReason;
      return <article key={order.id} className="rounded border border-border/60 p-2" data-order-id={order.id} data-order-status={order.status}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold">{order.symbol} <span className="font-normal text-muted-foreground">{order.side} {order.quantity}</span></p>
            <p className="text-[10px] text-muted-foreground">{order.id}</p>
          </div>
          <span className="inline-flex items-center gap-1 text-xs font-medium"><Clock3 className="h-3 w-3" />{STATUS_LABELS[order.status]}</span>
        </div>
        {reason && <p className="mt-1 flex items-start gap-1 text-[11px] text-muted-foreground"><ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" />{reason}</p>}
        <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span>{order.filledQuantity}/{order.quantity} filled</span>
          {terminal ? <span>Immutable terminal state</span> : <span className="flex gap-2">
            {canCancel && <button type="button" onClick={() => onCancel?.(order)} disabled={!onCancel} aria-label={`Cancel ${order.id}`}>Cancel</button>}
            {canModify && <button type="button" onClick={() => onModify?.(order)} disabled={!onModify} aria-label={`Modify ${order.id}`}>Modify</button>}
          </span>}
        </div>
      </article>;
    })}
  </div>;
}