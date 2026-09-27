import { useQueries } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Loader2, ShieldAlert } from "lucide-react";
import { useEffect } from "react";
import {
  fetchTerminalExecutions,
  fetchTerminalOrders,
  fetchTerminalPerformance,
  fetchTerminalPositions,
  fetchTerminalRisk,
  fetchTerminalWatchlists,
  subscribeToTerminalOrders,
  subscribeToTerminalPositions,
} from "@/lib/terminalApi";
import { CustomerOrderTable } from "@/components/CustomerOrderTable";
import { CustomerPositionTable } from "@/components/CustomerPositionTable";
import { useAccountContext, accountContextQueryKeys } from "@/hooks/useAccountContext";
import { useAuth } from "@/hooks/useAuth";

function DataState({
  label,
  isLoading,
  isError,
  isEmpty,
  children,
}: {
  label: string;
  isLoading: boolean;
  isError: boolean;
  isEmpty: boolean;
  children: React.ReactNode;
}) {
  if (isLoading) {
    return <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />Loading {label}...</div>;
  }
  if (isError) {
    return <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><AlertCircle className="h-3 w-3" />Unavailable: authentication or Terminal OS required</div>;
  }
  if (isEmpty) {
    return <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><CheckCircle2 className="h-3 w-3" />No {label} recorded</div>;
  }
  return <>{children}</>;
}

export function TerminalAccountData() {
  const { user } = useAuth();
  const { activeAccountId } = useAccountContext();
  const userId = user?.id ?? "anonymous";
  const [positions, orders, executions, risk, performance, watchlists] = useQueries({
    queries: [
      { queryKey: accountContextQueryKeys.terminal(userId, "positions", activeAccountId ?? "none"), queryFn: () => fetchTerminalPositions(activeAccountId ?? undefined), retry: false, staleTime: 30_000, enabled: Boolean(activeAccountId && user?.id) },
      { queryKey: accountContextQueryKeys.terminal(userId, "orders", activeAccountId ?? "none"), queryFn: () => fetchTerminalOrders(activeAccountId ?? undefined), retry: false, staleTime: 30_000, enabled: Boolean(activeAccountId && user?.id) },
      { queryKey: accountContextQueryKeys.terminal(userId, "executions", activeAccountId ?? "none"), queryFn: () => fetchTerminalExecutions(activeAccountId ?? undefined), retry: false, staleTime: 30_000, enabled: Boolean(activeAccountId && user?.id) },
      { queryKey: accountContextQueryKeys.terminal(userId, "risk", activeAccountId ?? "none"), queryFn: () => fetchTerminalRisk(activeAccountId ?? undefined), retry: false, staleTime: 30_000, enabled: Boolean(activeAccountId && user?.id) },
      { queryKey: accountContextQueryKeys.terminal(userId, "performance", activeAccountId ?? "none"), queryFn: () => fetchTerminalPerformance(activeAccountId ?? undefined), retry: false, staleTime: 30_000, enabled: Boolean(activeAccountId && user?.id) },
      { queryKey: accountContextQueryKeys.terminal(userId, "watchlists", activeAccountId ?? "none"), queryFn: fetchTerminalWatchlists, retry: false, staleTime: 30_000, enabled: Boolean(user?.id) },
    ],
  });

  useEffect(() => {
    if (!activeAccountId || !user?.id) return;
    return subscribeToTerminalPositions(activeAccountId, () => {
      void positions.refetch();
    });
  }, [activeAccountId, user?.id, positions.refetch]);

  useEffect(() => {
    if (!activeAccountId || !user?.id) return;
    return subscribeToTerminalOrders(activeAccountId, () => {
      void orders.refetch();
    });
  }, [activeAccountId, user?.id, orders.refetch]);

  const riskData = risk.data?.data;
  const performanceRows = performance.data?.data ?? [];
  const positionsTotal = positions.data?.meta.total ?? 0;
  const ordersTotal = orders.data?.meta.total ?? 0;
  const executionsTotal = executions.data?.meta.total ?? 0;
  const performanceTotal = performance.data?.meta.total ?? 0;
  const watchlistsTotal = watchlists.data?.meta.total ?? 0;

  return (
    <section className="rounded-lg border border-border/70 bg-card/70 p-3" aria-label="Canonical Terminal OS account data">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Canonical account data</h2>
          <p className="text-[11px] text-muted-foreground">Read-only data from Terminal OS. Local Simulated Trading is separate.</p>
        </div>
        <ShieldAlert className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded border border-border/60 p-2">
          <p className="text-[10px] uppercase text-muted-foreground">Positions</p>
          <DataState label="positions" isLoading={positions.isLoading} isError={positions.isError} isEmpty={!positions.isLoading && !positions.isError && positionsTotal === 0}>
            <p className="mt-1 text-lg font-semibold">{positionsTotal}</p>
          </DataState>
        </div>
        <div className="rounded border border-border/60 p-2">
          <p className="text-[10px] uppercase text-muted-foreground">Orders</p>
          <DataState label="orders" isLoading={orders.isLoading} isError={orders.isError} isEmpty={!orders.isLoading && !orders.isError && ordersTotal === 0}>
            <p className="mt-1 text-lg font-semibold">{ordersTotal}</p>
          </DataState>
        </div>
        <div className="rounded border border-border/60 p-2">
          <p className="text-[10px] uppercase text-muted-foreground">Executions</p>
          <DataState label="executions" isLoading={executions.isLoading} isError={executions.isError} isEmpty={!executions.isLoading && !executions.isError && executionsTotal === 0}>
            <p className="mt-1 text-lg font-semibold">{executionsTotal}</p>
          </DataState>
        </div>
        <div className="rounded border border-border/60 p-2">
          <p className="text-[10px] uppercase text-muted-foreground">Risk</p>
          <DataState label="risk events" isLoading={risk.isLoading} isError={risk.isError} isEmpty={!risk.isLoading && !risk.isError && (riskData?.recent_events.length ?? 0) === 0}>
            <p className="mt-1 text-lg font-semibold">{riskData?.critical ?? 0} critical</p>
          </DataState>
        </div>
        <div className="rounded border border-border/60 p-2">
          <p className="text-[10px] uppercase text-muted-foreground">Performance</p>
          <DataState label="performance rows" isLoading={performance.isLoading} isError={performance.isError} isEmpty={!performance.isLoading && !performance.isError && performanceTotal === 0}>
            <p className="mt-1 text-lg font-semibold">{performanceTotal} rows</p>
          </DataState>
        </div>
        <div className="rounded border border-border/60 p-2">
          <p className="text-[10px] uppercase text-muted-foreground">Watchlists</p>
          <DataState label="watchlists" isLoading={watchlists.isLoading} isError={watchlists.isError} isEmpty={!watchlists.isLoading && !watchlists.isError && watchlistsTotal === 0}>
            <p className="mt-1 text-lg font-semibold">{watchlistsTotal}</p>
          </DataState>
        </div>
      </div>
      <div className="mt-3 border-t border-border/60 pt-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold">Positions</h3>
          {positions.data && <span className="text-[10px] text-muted-foreground">Canonical public.positions · account scoped</span>}
        </div>
        <CustomerPositionTable
          positions={positions.data?.data ?? []}
          isLoading={positions.isLoading}
          isError={positions.isError}
          isFetching={positions.isFetching && !positions.isLoading}
          errorMessage={positions.error instanceof Error ? positions.error.message : undefined}
          onRetry={() => void positions.refetch()}
        />
      </div>
      <div className="mt-3 border-t border-border/60 pt-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold">Orders</h3>
          {orders.data && <span className="text-[10px] text-muted-foreground">Canonical public.orders · account scoped</span>}
        </div>
        <CustomerOrderTable
          orders={orders.data?.data ?? []}
          isLoading={orders.isLoading}
          isError={orders.isError}
          isFetching={orders.isFetching && !orders.isLoading}
          errorMessage={orders.error instanceof Error ? orders.error.message : undefined}
          onRetry={() => void orders.refetch()}
        />
      </div>
    </section>
  );
}