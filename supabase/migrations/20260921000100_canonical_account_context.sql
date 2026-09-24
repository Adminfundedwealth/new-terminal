-- Canonical account context for New Terminal and Terminal OS.
-- Reuses trading_accounts, terminal_activity, and the existing owner/RLS boundary.

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  status text not null default 'active' check (status in ('active', 'inactive', 'archived')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.account_phases (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  code text not null,
  name text not null,
  sequence_no integer not null default 0,
  status text not null default 'active' check (status in ('active', 'inactive', 'archived')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (product_id, code)
);

create table if not exists public.rule_versions (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  phase_id uuid references public.account_phases(id) on delete restrict,
  version text not null,
  rules jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'active', 'retired')),
  effective_from timestamptz,
  effective_to timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (product_id, phase_id, version)
);

alter table public.trading_accounts
  add column if not exists product_id uuid references public.products(id) on delete restrict,
  add column if not exists phase_id uuid references public.account_phases(id) on delete restrict,
  add column if not exists rule_version_id uuid references public.rule_versions(id) on delete restrict,
  add column if not exists broker_provider text,
  add column if not exists peak_equity numeric(20, 8),
  add column if not exists available_margin numeric(20, 8),
  add column if not exists used_margin numeric(20, 8),
  add column if not exists realized_pnl numeric(20, 8) not null default 0,
  add column if not exists unrealized_pnl numeric(20, 8) not null default 0,
  add column if not exists risk_state text not null default 'ACTIVE' check (risk_state in ('ACTIVE', 'WARNING', 'LOCKED', 'BREACHED'));

create table if not exists public.account_rule_assignments (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.trading_accounts(id) on delete cascade,
  rule_version_id uuid not null references public.rule_versions(id) on delete restrict,
  assigned_by uuid references auth.users(id) on delete set null,
  assigned_at timestamptz not null default timezone('utc', now()),
  revoked_at timestamptz,
  unique (account_id, rule_version_id, assigned_at)
);

create unique index if not exists account_rule_assignments_current_idx
  on public.account_rule_assignments(account_id) where revoked_at is null;

create table if not exists public.account_permissions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.trading_accounts(id) on delete cascade,
  permission_key text not null,
  enabled boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now()),
  unique (account_id, permission_key)
);

create index if not exists account_phases_product_idx on public.account_phases(product_id, sequence_no);
create index if not exists rule_versions_lookup_idx on public.rule_versions(product_id, phase_id, status);
create index if not exists account_rule_assignments_account_idx on public.account_rule_assignments(account_id, assigned_at desc);
create index if not exists account_permissions_account_idx on public.account_permissions(account_id);

create or replace function public.validate_account_rule_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.trading_accounts a
    join public.rule_versions r on r.id = new.rule_version_id
    where a.id = new.account_id
      and a.product_id = r.product_id
      and (a.phase_id is null or r.phase_id is null or a.phase_id = r.phase_id)
  ) then
    raise exception 'rule version does not match account product or phase';
  end if;
  return new;
end;
$$;

drop trigger if exists account_rule_assignment_validation on public.account_rule_assignments;
create trigger account_rule_assignment_validation
before insert or update on public.account_rule_assignments
for each row execute function public.validate_account_rule_assignment();

create or replace function public.set_account_context_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists products_updated_at on public.products;
create trigger products_updated_at before update on public.products for each row execute function public.set_account_context_updated_at();
drop trigger if exists account_phases_updated_at on public.account_phases;
create trigger account_phases_updated_at before update on public.account_phases for each row execute function public.set_account_context_updated_at();

create or replace function public.get_active_account_context(requested_account_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  selected_account public.trading_accounts%rowtype;
  selected_rule public.rule_versions%rowtype;
  selected_product public.products%rowtype;
  selected_phase public.account_phases%rowtype;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select a.* into selected_account
  from public.trading_accounts a
  where a.owner_user_id = auth.uid()
    and a.id = coalesce(
      requested_account_id,
      (select s.active_account_id from public.terminal_settings s where s.owner_user_id = auth.uid()),
      (select a2.id from public.trading_accounts a2 where a2.owner_user_id = auth.uid() and a2.is_active order by a2.created_at limit 1)
    )
  limit 1;

  if not found then
    raise exception 'account not found or not owned by current user' using errcode = '42501';
  end if;

  select p.* into selected_product from public.products p where p.id = selected_account.product_id;
  select p.* into selected_phase from public.account_phases p where p.id = selected_account.phase_id;
  select r.* into selected_rule from public.rule_versions r where r.id = selected_account.rule_version_id and r.status = 'active';

  return jsonb_build_object(
    'identity', jsonb_build_object('trader_id', selected_account.owner_user_id),
    'account', to_jsonb(selected_account),
    'product', coalesce(to_jsonb(selected_product), '{}'::jsonb),
    'phase', coalesce(to_jsonb(selected_phase), '{}'::jsonb),
    'rules', coalesce(selected_rule.rules, '{}'::jsonb) || jsonb_build_object('rule_version_id', selected_rule.id, 'version', selected_rule.version),
    'permissions', coalesce((select jsonb_object_agg(permission_key, enabled) from public.account_permissions where account_id = selected_account.id), '{}'::jsonb),
    'risk_state', jsonb_build_object(
      'status', selected_account.risk_state,
      'daily_loss', greatest(0, coalesce((select dp.opening_balance from public.daily_performance dp where dp.account_id = selected_account.id and dp.owner_user_id = auth.uid() and dp.trading_date = current_date), selected_account.starting_balance) - coalesce(selected_account.equity, selected_account.current_balance)),
      'drawdown_amount', greatest(0, (case when selected_rule.rules->>'drawdown_model' = 'trailing' then coalesce(selected_account.peak_equity, selected_account.starting_balance) else selected_account.starting_balance end) - coalesce(selected_account.equity, selected_account.current_balance)),
      'profit_target', nullif(selected_rule.rules->>'profit_target', '')::numeric,
      'profit_current', coalesce(selected_account.equity, selected_account.current_balance) - selected_account.starting_balance,
      'latest_snapshot', (select to_jsonb(s) from public.account_metric_snapshots s where s.account_id = selected_account.id and s.owner_user_id = auth.uid() order by s.snapshot_at desc limit 1),
      'open_events', (select count(*) from public.risk_events e where e.account_id = selected_account.id and e.owner_user_id = auth.uid() and e.breach_status = 'open')
    )
  );
end;
$$;

revoke all on function public.get_active_account_context(uuid) from public;
grant execute on function public.get_active_account_context(uuid) to authenticated;

alter table public.products enable row level security;
alter table public.account_phases enable row level security;
alter table public.rule_versions enable row level security;
alter table public.account_rule_assignments enable row level security;
alter table public.account_permissions enable row level security;

drop policy if exists products_authenticated_read on public.products;
create policy products_authenticated_read on public.products for select to authenticated using (status = 'active');
drop policy if exists account_phases_authenticated_read on public.account_phases;
create policy account_phases_authenticated_read on public.account_phases for select to authenticated using (status = 'active');
drop policy if exists rule_versions_authenticated_read on public.rule_versions;
create policy rule_versions_authenticated_read on public.rule_versions for select to authenticated using (status = 'active');
drop policy if exists account_rule_assignments_owner_read on public.account_rule_assignments;
create policy account_rule_assignments_owner_read on public.account_rule_assignments for select to authenticated using (exists (select 1 from public.trading_accounts a where a.id = account_id and a.owner_user_id = auth.uid()));
drop policy if exists account_permissions_owner_read on public.account_permissions;
create policy account_permissions_owner_read on public.account_permissions for select to authenticated using (exists (select 1 from public.trading_accounts a where a.id = account_id and a.owner_user_id = auth.uid()));

-- Keep configuration changes observable through the existing shared activity log.
create or replace function public.log_account_control_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.terminal_activity(owner_user_id, account_id, event_type, metadata)
  values (
    coalesce(new.owner_user_id, old.owner_user_id),
    coalesce(new.id, old.id),
    'account_control_changed',
    jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new))
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists trading_accounts_control_audit on public.trading_accounts;
create trigger trading_accounts_control_audit
after update of product_id, phase_id, rule_version_id, status, is_active on public.trading_accounts
for each row execute function public.log_account_control_change();

-- Add account-control tables to Realtime only when the standard publication exists.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'trading_accounts') then alter publication supabase_realtime add table public.trading_accounts; end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'account_permissions') then alter publication supabase_realtime add table public.account_permissions; end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rule_versions') then alter publication supabase_realtime add table public.rule_versions; end if;
  end if;
end;
$$;

-- Server-authoritative pre-trade decision. This stops at ALLOW/REJECT and
-- never creates or routes an order.
create or replace function public.evaluate_pre_trade_risk(request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  account_row public.trading_accounts%rowtype;
  rule_row public.rule_versions%rowtype;
  rules jsonb;
  permission_enabled boolean;
  account_id_value uuid := nullif(request->>'account_id', '')::uuid;
  symbol_value text := nullif(request->>'symbol', '');
  segment_value text := nullif(request->>'segment', '');
  quantity_value numeric := nullif(request->>'quantity', '')::numeric;
  estimated_loss_value numeric := nullif(request->>'estimated_loss', '')::numeric;
  is_overnight_value boolean := coalesce((request->>'is_overnight')::boolean, false);
  daily_row public.daily_performance%rowtype;
  daily_loss numeric;
  drawdown_base numeric;
  drawdown_amount numeric;
  open_positions_count integer;
  daily_trades_count integer;
  latest_snapshot_at timestamptz;
  result jsonb;
  reason_code text;
  reason_text text;
  rule_name text;
  current_value jsonb;
  configured_limit jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select * into account_row
  from public.trading_accounts
  where id = account_id_value and owner_user_id = auth.uid();
  if not found then
    raise exception 'account not found or not owned by current user' using errcode = '42501';
  end if;

  select r.* into rule_row
  from public.account_rule_assignments assignment
  join public.rule_versions r on r.id = assignment.rule_version_id
  where assignment.account_id = account_row.id
    and assignment.revoked_at is null
    and r.status = 'active'
  order by assignment.assigned_at desc
  limit 1;

  if not found and account_row.rule_version_id is not null then
    select * into rule_row from public.rule_versions where id = account_row.rule_version_id and status = 'active';
  end if;
  if rule_row.id is null then
    reason_code := 'RULE_CONFIGURATION_MISSING';
    reason_text := 'No active rule version is assigned to this account';
  end if;

  rules := coalesce(rule_row.rules, '{}'::jsonb);
  select coalesce(enabled, false) into permission_enabled
  from public.account_permissions
  where account_id = account_row.id and permission_key in ('trade', 'trading')
  order by case when permission_key = 'trade' then 0 else 1 end
  limit 1;

  select * into daily_row
  from public.daily_performance
  where account_id = account_row.id and owner_user_id = auth.uid() and trading_date = current_date;

  daily_loss := greatest(0, coalesce(daily_row.opening_balance, account_row.starting_balance) - (coalesce(account_row.equity, account_row.current_balance) + coalesce(daily_row.fees, 0)));
  select max(snapshot_at) into latest_snapshot_at
  from public.account_metric_snapshots
  where account_id = account_row.id and owner_user_id = auth.uid();
  drawdown_base := case when rules->>'drawdown_model' = 'trailing' then coalesce(account_row.peak_equity, account_row.starting_balance) else account_row.starting_balance end;
  drawdown_amount := greatest(0, drawdown_base - coalesce(account_row.equity, account_row.current_balance));

  select count(*) into open_positions_count
  from public.positions
  where account_id = account_row.id and owner_user_id = auth.uid() and position_status = 'open';

  select count(*) into daily_trades_count
  from public.orders
  where account_id = account_row.id and owner_user_id = auth.uid() and submitted_at >= date_trunc('day', timezone('utc', now()));

  if reason_code is null and account_row.status = 'locked' then
    reason_code := 'ACCOUNT_LOCKED'; reason_text := 'Account is locked'; rule_name := 'account.status'; current_value := '"locked"'::jsonb; configured_limit := '"active"'::jsonb;
  elsif reason_code is null and account_row.status = 'breached' then
    reason_code := 'ACCOUNT_BREACHED'; reason_text := 'Account has breached a configured rule'; rule_name := 'account.status'; current_value := '"breached"'::jsonb; configured_limit := '"active"'::jsonb;
  elsif reason_code is null and account_row.status <> 'active' then
    reason_code := 'ACCOUNT_NOT_ACTIVE'; reason_text := format('Account status is %s', account_row.status); rule_name := 'account.status'; current_value := to_jsonb(account_row.status); configured_limit := '"active"'::jsonb;
  elsif reason_code is null and permission_enabled is null then
    reason_code := 'RULE_CONFIGURATION_MISSING'; reason_text := 'Trading permission is not configured'; rule_name := 'trading_permission';
  elsif reason_code is null and not permission_enabled then
    reason_code := 'TRADING_PERMISSION_DISABLED'; reason_text := 'Trading permission is disabled'; rule_name := 'trading_permission'; current_value := 'false'::jsonb; configured_limit := 'true'::jsonb;
  elsif reason_code is null and not (rules ? 'allowed_segments') then
    reason_code := 'RULE_CONFIGURATION_MISSING'; reason_text := 'Allowed segments are not configured'; rule_name := 'allowed_segments';
  elsif reason_code is null and segment_value is not null and not (rules->'allowed_segments' ? segment_value) then
    reason_code := 'INSTRUMENT_NOT_ALLOWED'; reason_text := format('Segment %s is not allowed', segment_value); rule_name := 'allowed_segments'; current_value := to_jsonb(segment_value); configured_limit := rules->'allowed_segments';
  elsif reason_code is null and not (rules ? 'allowed_instruments') then
    reason_code := 'RULE_CONFIGURATION_MISSING'; reason_text := 'Allowed instruments are not configured'; rule_name := 'allowed_instruments';
  elsif reason_code is null and not (rules->'allowed_instruments' ? symbol_value) then
    reason_code := 'INSTRUMENT_NOT_ALLOWED'; reason_text := format('Instrument %s is not allowed', symbol_value); rule_name := 'allowed_instruments'; current_value := to_jsonb(symbol_value); configured_limit := rules->'allowed_instruments';
  elsif reason_code is null and not (rules ? 'trading_hours') then
    reason_code := 'RULE_CONFIGURATION_MISSING'; reason_text := 'Trading hours are not configured'; rule_name := 'trading_hours';
  elsif reason_code is null and not exists (
    select 1 from jsonb_array_elements(rules->'trading_hours') slot
    where (
      ((slot->>'start')::time <= (slot->>'end')::time and localtime between (slot->>'start')::time and (slot->>'end')::time)
      or ((slot->>'start')::time > (slot->>'end')::time and (localtime >= (slot->>'start')::time or localtime <= (slot->>'end')::time))
    )
  ) then
    reason_code := 'TRADING_SESSION_CLOSED'; reason_text := 'Trading session is closed'; rule_name := 'trading_hours'; current_value := to_jsonb(localtime::text); configured_limit := rules->'trading_hours';
  elsif reason_code is null and is_overnight_value and not (rules ? 'overnight_allowed') then
    reason_code := 'RULE_CONFIGURATION_MISSING'; reason_text := 'Overnight permission is not configured'; rule_name := 'overnight_allowed';
  elsif reason_code is null and is_overnight_value and not coalesce((rules->>'overnight_allowed')::boolean, false) then
    reason_code := 'OVERNIGHT_NOT_ALLOWED'; reason_text := 'Overnight trading is not allowed'; rule_name := 'overnight_allowed'; current_value := 'true'::jsonb; configured_limit := 'false'::jsonb;
  elsif reason_code is null and not (rules ? 'max_position_quantity') then
    reason_code := 'RULE_CONFIGURATION_MISSING'; reason_text := 'Maximum position quantity is not configured'; rule_name := 'max_position_quantity';
  elsif reason_code is null and (quantity_value is null or quantity_value <= 0 or quantity_value > (rules->>'max_position_quantity')::numeric) then
    reason_code := 'QUANTITY_EXCEEDED'; reason_text := 'Requested quantity exceeds the configured limit'; rule_name := 'max_position_quantity'; current_value := to_jsonb(quantity_value); configured_limit := to_jsonb((rules->>'max_position_quantity')::numeric);
  elsif reason_code is null and not (rules ? 'max_open_positions') then
    reason_code := 'RULE_CONFIGURATION_MISSING'; reason_text := 'Maximum open positions is not configured'; rule_name := 'max_open_positions';
  elsif reason_code is null and open_positions_count >= (rules->>'max_open_positions')::integer then
    reason_code := 'MAX_OPEN_POSITIONS_EXCEEDED'; reason_text := 'Maximum open positions reached'; rule_name := 'max_open_positions'; current_value := to_jsonb(open_positions_count); configured_limit := to_jsonb((rules->>'max_open_positions')::integer);
  elsif reason_code is null and not (rules ? 'max_daily_trades') then
    reason_code := 'RULE_CONFIGURATION_MISSING'; reason_text := 'Maximum daily trades is not configured'; rule_name := 'max_daily_trades';
  elsif reason_code is null and daily_trades_count >= (rules->>'max_daily_trades')::integer then
    reason_code := 'MAX_DAILY_TRADES_EXCEEDED'; reason_text := 'Maximum daily trades reached'; rule_name := 'max_daily_trades'; current_value := to_jsonb(daily_trades_count); configured_limit := to_jsonb((rules->>'max_daily_trades')::integer);
  elsif reason_code is null and account_row.risk_state = 'LOCKED' then
    reason_code := 'ACCOUNT_LOCKED'; reason_text := 'Account is locked'; rule_name := 'risk_state'; current_value := to_jsonb(account_row.risk_state); configured_limit := '"ACTIVE"'::jsonb;
  elsif reason_code is null and account_row.risk_state = 'BREACHED' then
    reason_code := 'ACCOUNT_BREACHED'; reason_text := 'Account has breached a configured rule'; rule_name := 'risk_state'; current_value := to_jsonb(account_row.risk_state); configured_limit := '"ACTIVE"'::jsonb;
  elsif reason_code is null and not (rules ? 'daily_loss_limit') then
    reason_code := 'RULE_CONFIGURATION_MISSING'; reason_text := 'Daily loss limit is not configured'; rule_name := 'daily_loss_limit';
  elsif reason_code is null and daily_loss >= (rules->>'daily_loss_limit')::numeric then
    reason_code := 'DAILY_LOSS_EXCEEDED'; reason_text := 'Daily loss limit reached'; rule_name := 'daily_loss_limit'; current_value := to_jsonb(daily_loss); configured_limit := to_jsonb((rules->>'daily_loss_limit')::numeric);
  elsif reason_code is null and not (rules ? 'maximum_drawdown') then
    reason_code := 'RULE_CONFIGURATION_MISSING'; reason_text := 'Maximum drawdown is not configured'; rule_name := 'maximum_drawdown';
  elsif reason_code is null and drawdown_amount >= (rules->>'maximum_drawdown')::numeric then
    reason_code := 'DRAWDOWN_EXCEEDED'; reason_text := 'Maximum drawdown reached'; rule_name := 'maximum_drawdown'; current_value := to_jsonb(drawdown_amount); configured_limit := to_jsonb((rules->>'maximum_drawdown')::numeric);
  elsif reason_code is null and not (rules ? 'risk_per_trade') then
    reason_code := 'RULE_CONFIGURATION_MISSING'; reason_text := 'Risk per trade is not configured'; rule_name := 'risk_per_trade';
  elsif reason_code is null and estimated_loss_value is null then
    reason_code := 'RULE_CONFIGURATION_MISSING'; reason_text := 'Estimated loss is required for risk per trade evaluation'; rule_name := 'estimated_loss';
  elsif reason_code is null and estimated_loss_value > (rules->>'risk_per_trade')::numeric then
    reason_code := 'RISK_PER_TRADE_EXCEEDED'; reason_text := 'Estimated trade risk exceeds the configured limit'; rule_name := 'risk_per_trade'; current_value := to_jsonb(estimated_loss_value); configured_limit := to_jsonb((rules->>'risk_per_trade')::numeric);
  elsif reason_code is null and rules ? 'margin_requirement' and coalesce(account_row.available_margin, account_row.current_balance - coalesce(account_row.used_margin, 0)) < (rules->>'margin_requirement')::numeric then
    reason_code := 'MARGIN_REQUIREMENT_EXCEEDED'; reason_text := 'Available margin is below the configured requirement'; rule_name := 'margin_requirement'; current_value := to_jsonb(coalesce(account_row.available_margin, account_row.current_balance - coalesce(account_row.used_margin, 0))); configured_limit := to_jsonb((rules->>'margin_requirement')::numeric);
  elsif reason_code is null and latest_snapshot_at is null and coalesce(rules->>'stale_market_policy', 'reject') = 'reject' then
    reason_code := 'MARKET_DATA_STALE'; reason_text := 'No current account market snapshot is available'; rule_name := 'stale_market_policy'; current_value := '"missing_snapshot"'::jsonb; configured_limit := to_jsonb(coalesce(rules->>'stale_market_policy', 'reject'));
  elsif reason_code is null and latest_snapshot_at < timezone('utc', now()) - interval '5 minutes' and coalesce(rules->>'stale_market_policy', 'reject') = 'reject' then
    reason_code := 'MARKET_DATA_STALE'; reason_text := 'Account market snapshot is stale'; rule_name := 'stale_market_policy'; current_value := to_jsonb(latest_snapshot_at); configured_limit := to_jsonb('5 minutes');
  end if;

  if reason_code is null then
    reason_code := 'ORDER_ALLOWED'; reason_text := 'Order passed all configured risk checks'; rule_name := 'pre_trade_pipeline';
  end if;

  result := jsonb_build_object(
    'decision', case when reason_code = 'ORDER_ALLOWED' then 'ALLOW' else 'REJECT' end,
    'reason_code', nullif(reason_code, 'ORDER_ALLOWED'),
    'reason', reason_text,
    'account_id', account_row.id,
    'rule_evaluated', rule_name,
    'current_value', current_value,
    'configured_limit', configured_limit,
    'daily_loss', daily_loss,
    'drawdown_amount', drawdown_amount,
    'drawdown_base', drawdown_base,
    'timestamp', timezone('utc', now())
  );

  insert into public.risk_events(account_id, owner_user_id, event_type, severity, metric_name, metric_value, limit_value, breach_status, breach_reason, metadata)
  values (account_row.id, auth.uid(), case when reason_code = 'ORDER_ALLOWED' then 'order_allowed' else 'order_rejected' end, case when reason_code = 'ORDER_ALLOWED' then 'info' else 'warning' end, rule_name, case when jsonb_typeof(current_value) = 'number' then (current_value #>> '{}')::numeric else null end, case when jsonb_typeof(configured_limit) = 'number' then (configured_limit #>> '{}')::numeric else null end, case when reason_code = 'ORDER_ALLOWED' then 'resolved' else 'open' end, reason_text, jsonb_build_object('request', request, 'decision', result));

  return result;
end;
$$;

revoke all on function public.evaluate_pre_trade_risk(jsonb) from public;
grant execute on function public.evaluate_pre_trade_risk(jsonb) to authenticated;
