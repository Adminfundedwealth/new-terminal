-- Task 7: customer RLS hardening for the canonical New Terminal contract.
-- Customer clients may read their own account-scoped state. Canonical state is
-- written by the control plane/service role and the explicitly authorized RPCs.

drop policy if exists trading_accounts_owner on public.trading_accounts;
drop policy if exists trading_accounts_owner_read on public.trading_accounts;
drop policy if exists orders_owner on public.orders;
drop policy if exists executions_owner on public.executions;
drop policy if exists positions_owner on public.positions;
drop policy if exists daily_performance_owner on public.daily_performance;
drop policy if exists risk_events_owner on public.risk_events;
drop policy if exists account_metric_snapshots_owner on public.account_metric_snapshots;

create policy trading_accounts_customer_read on public.trading_accounts
for select to authenticated
using (owner_user_id = auth.uid());

create policy orders_customer_read on public.orders
for select to authenticated
using (
  owner_user_id = auth.uid()
  and exists (
    select 1 from public.trading_accounts a
    where a.id = orders.account_id and a.owner_user_id = auth.uid()
  )
);

create policy executions_customer_read on public.executions
for select to authenticated
using (
  owner_user_id = auth.uid()
  and exists (
    select 1 from public.trading_accounts a
    where a.id = executions.account_id and a.owner_user_id = auth.uid()
  )
);

create policy positions_customer_read on public.positions
for select to authenticated
using (
  owner_user_id = auth.uid()
  and exists (
    select 1 from public.trading_accounts a
    where a.id = positions.account_id and a.owner_user_id = auth.uid()
  )
);

create policy daily_performance_customer_read on public.daily_performance
for select to authenticated
using (
  owner_user_id = auth.uid()
  and exists (
    select 1 from public.trading_accounts a
    where a.id = daily_performance.account_id and a.owner_user_id = auth.uid()
  )
);

create policy risk_events_customer_read on public.risk_events
for select to authenticated
using (
  owner_user_id = auth.uid()
  and exists (
    select 1 from public.trading_accounts a
    where a.id = risk_events.account_id and a.owner_user_id = auth.uid()
  )
);

create policy account_metric_snapshots_customer_read on public.account_metric_snapshots
for select to authenticated
using (
  owner_user_id = auth.uid()
  and exists (
    select 1 from public.trading_accounts a
    where a.id = account_metric_snapshots.account_id and a.owner_user_id = auth.uid()
  )
);

-- PostgREST grants are separate from RLS; customer clients are read-only for
-- canonical state. Control-plane writes use service_role or authorized RPCs.
revoke insert, update, delete, truncate, references, trigger
on public.trading_accounts,
   public.orders,
   public.executions,
   public.positions,
   public.daily_performance,
   public.risk_events,
   public.account_metric_snapshots
from anon, authenticated;

revoke select, insert, update, delete, truncate, references, trigger
on public.trading_accounts,
   public.orders,
   public.executions,
   public.positions,
   public.daily_performance,
   public.risk_events,
   public.account_metric_snapshots
from anon;

-- These functions are invoked by triggers or internal RPCs only. Remove their
-- default PUBLIC execute privilege, including for anonymous users.
revoke all on function public.validate_account_rule_assignment() from public;
revoke all on function public.log_account_control_change() from public;
revoke all on function public.enforce_account_lifecycle() from public;
revoke all on function public.prevent_trading_account_owner_change() from public;
revoke all on function public.validate_terminal_active_account() from public;
revoke all on function public.set_account_context_updated_at() from public;

revoke all on function public.get_active_account_context(uuid) from anon;
revoke all on function public.evaluate_pre_trade_risk(jsonb) from anon;
revoke all on function public.transition_trading_account(uuid, text, text) from anon;
revoke all on function public.evaluate_account_challenge(uuid) from anon;