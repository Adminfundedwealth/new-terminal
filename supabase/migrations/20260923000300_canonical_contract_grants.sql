-- Canonical trading-state privileges.
-- RLS remains the customer isolation boundary; these grants only make the
-- canonical tables reachable through PostgREST for their intended roles.

grant select on public.trading_accounts,
  public.orders,
  public.executions,
  public.positions,
  public.daily_performance,
  public.risk_events,
  public.account_metric_snapshots
to authenticated;

grant all privileges on public.trading_accounts,
  public.orders,
  public.executions,
  public.positions,
  public.daily_performance,
  public.risk_events,
  public.account_metric_snapshots
to service_role;