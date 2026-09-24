-- FundedWealth Terminal database schema
-- Source: approved Terminal database audit
-- No seed or trading data is inserted here.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table public.trading_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  external_account_id text not null,
  account_code text,
  prop_firm text not null,
  challenge_type text,
  account_type text,
  starting_balance numeric(20, 4) not null default 0,
  current_balance numeric(20, 4) not null default 0,
  equity numeric(20, 4) not null default 0,
  currency text not null default 'INR',
  status text not null default 'active' check (status in ('active', 'inactive', 'suspended', 'expired', 'breached', 'closed')),
  is_active boolean not null default true,
  daily_loss_limit numeric(20, 4),
  maximum_drawdown numeric(20, 4),
  drawdown_percentage numeric(10, 4),
  profit_target numeric(20, 4),
  created_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now()),
  unique (owner_user_id, external_account_id),
  unique (id, owner_user_id)
);

create table public.instruments (
  id uuid primary key default gen_random_uuid(),
  security_id text not null unique,
  symbol text not null,
  trading_symbol text not null,
  exchange text,
  exchange_segment text not null,
  instrument_type text not null,
  lot_size integer,
  expiry_date date,
  strike_price numeric(20, 4),
  option_type text,
  tick_size numeric(20, 8),
  is_active boolean not null default true,
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  external_order_id text,
  symbol text not null,
  instrument_id uuid references public.instruments(id) on delete set null,
  exchange text,
  segment text,
  instrument_type text,
  side text not null check (side in ('buy', 'sell')),
  order_type text not null,
  quantity numeric(20, 8) not null,
  filled_quantity numeric(20, 8) not null default 0,
  price numeric(20, 8),
  average_fill_price numeric(20, 8),
  trigger_price numeric(20, 8),
  stop_loss numeric(20, 8),
  take_profit numeric(20, 8),
  status text not null default 'pending',
  rejection_reason text,
  cancellation_reason text,
  submitted_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now()),
  cancelled_at timestamptz,
  completed_at timestamptz,
  foreign key (account_id, owner_user_id) references public.trading_accounts(id, owner_user_id) on delete cascade,
  unique (account_id, external_order_id)
);

create table public.executions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  external_execution_id text,
  instrument_id uuid references public.instruments(id) on delete set null,
  symbol text not null,
  side text not null check (side in ('buy', 'sell')),
  quantity numeric(20, 8) not null,
  execution_price numeric(20, 8) not null,
  fees numeric(20, 8) not null default 0,
  taxes numeric(20, 8) not null default 0,
  net_amount numeric(20, 8),
  executed_at timestamptz not null,
  foreign key (account_id, owner_user_id) references public.trading_accounts(id, owner_user_id) on delete cascade,
  unique (account_id, external_execution_id)
);

create table public.positions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  instrument_id uuid references public.instruments(id) on delete set null,
  symbol text not null,
  exchange text,
  quantity numeric(20, 8) not null default 0,
  side text not null check (side in ('long', 'short')),
  average_price numeric(20, 8) not null default 0,
  last_price numeric(20, 8),
  unrealized_pnl numeric(20, 8) not null default 0,
  realized_pnl numeric(20, 8) not null default 0,
  stop_loss numeric(20, 8),
  take_profit numeric(20, 8),
  position_status text not null default 'open' check (position_status in ('open', 'closed')),
  opened_at timestamptz,
  closed_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now()),
  foreign key (account_id, owner_user_id) references public.trading_accounts(id, owner_user_id) on delete cascade,
  unique (account_id, instrument_id)
);

create table public.daily_performance (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  trading_date date not null,
  realized_pnl numeric(20, 8) not null default 0,
  gross_profit numeric(20, 8) not null default 0,
  gross_loss numeric(20, 8) not null default 0,
  fees numeric(20, 8) not null default 0,
  trade_count integer not null default 0,
  winning_trades integer not null default 0,
  losing_trades integer not null default 0,
  breakeven_trades integer not null default 0,
  day_result text not null default 'no_trade' check (day_result in ('win', 'loss', 'breakeven', 'no_trade')),
  opening_balance numeric(20, 8),
  closing_balance numeric(20, 8),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  foreign key (account_id, owner_user_id) references public.trading_accounts(id, owner_user_id) on delete cascade,
  unique (account_id, trading_date)
);

create table public.risk_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  severity text not null,
  metric_name text,
  metric_value numeric(20, 8),
  limit_value numeric(20, 8),
  breach_status text not null default 'open' check (breach_status in ('open', 'resolved')),
  breach_reason text,
  occurred_at timestamptz not null default timezone('utc', now()),
  resolved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  foreign key (account_id, owner_user_id) references public.trading_accounts(id, owner_user_id) on delete cascade
);

create table public.account_metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  balance numeric(20, 8),
  equity numeric(20, 8),
  margin numeric(20, 8),
  pnl numeric(20, 8),
  drawdown numeric(20, 8),
  daily_loss numeric(20, 8),
  snapshot_at timestamptz not null default timezone('utc', now()),
  foreign key (account_id, owner_user_id) references public.trading_accounts(id, owner_user_id) on delete cascade
);

create table public.watchlists (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid,
  name text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (owner_user_id, name),
  foreign key (account_id, owner_user_id) references public.trading_accounts(id, owner_user_id) on delete cascade
);

create table public.watchlist_items (
  id uuid primary key default gen_random_uuid(),
  watchlist_id uuid not null references public.watchlists(id) on delete cascade,
  instrument_id uuid references public.instruments(id) on delete set null,
  symbol text not null,
  display_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  unique (watchlist_id, symbol)
);

create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid,
  order_id uuid,
  execution_id uuid,
  trade_notes text,
  setup text,
  reason text,
  screenshot_url text,
  tags text[] not null default '{}',
  emotions text,
  remarks text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  foreign key (account_id, owner_user_id) references public.trading_accounts(id, owner_user_id) on delete cascade,
  foreign key (order_id) references public.orders(id) on delete set null,
  foreign key (execution_id) references public.executions(id) on delete set null
);

create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid,
  instrument_id uuid references public.instruments(id) on delete set null,
  symbol text not null,
  alert_type text not null,
  condition text not null,
  target_value numeric(20, 8) not null,
  active boolean not null default true,
  triggered_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  foreign key (account_id, owner_user_id) references public.trading_accounts(id, owner_user_id) on delete cascade
);

create table public.terminal_settings (
  owner_user_id uuid primary key references auth.users(id) on delete cascade,
  active_account_id uuid,
  theme text,
  layout jsonb not null default '{}'::jsonb,
  chart_preferences jsonb not null default '{}'::jsonb,
  selected_settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.terminal_activity (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid,
  event_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default timezone('utc', now()),
  foreign key (account_id, owner_user_id) references public.trading_accounts(id, owner_user_id) on delete cascade
);

create table public.provider_config (
  id uuid primary key default gen_random_uuid(),
  provider_key text not null unique,
  display_name text not null,
  enabled boolean not null default true,
  priority integer not null default 0,
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.provider_health (
  id uuid primary key default gen_random_uuid(),
  provider_config_id uuid not null references public.provider_config(id) on delete cascade,
  status text not null,
  websocket_status text,
  fallback_status text,
  details jsonb not null default '{}'::jsonb,
  checked_at timestamptz not null default timezone('utc', now())
);

create or replace function public.validate_terminal_active_account()
returns trigger
language plpgsql
security invoker
as $$
begin
  if new.active_account_id is not null and not exists (
    select 1
    from public.trading_accounts
    where id = new.active_account_id
      and owner_user_id = new.owner_user_id
  ) then
    raise exception 'active_account_id is not owned by owner_user_id';
  end if;
  return new;
end;
$$;

create trigger terminal_settings_active_account_check
before insert or update of active_account_id, owner_user_id on public.terminal_settings
for each row execute function public.validate_terminal_active_account();

create trigger trading_accounts_updated_at before update on public.trading_accounts for each row execute function public.set_updated_at();
create trigger instruments_updated_at before update on public.instruments for each row execute function public.set_updated_at();
create trigger orders_updated_at before update on public.orders for each row execute function public.set_updated_at();
create trigger positions_updated_at before update on public.positions for each row execute function public.set_updated_at();
create trigger daily_performance_updated_at before update on public.daily_performance for each row execute function public.set_updated_at();
create trigger watchlists_updated_at before update on public.watchlists for each row execute function public.set_updated_at();
create trigger journal_entries_updated_at before update on public.journal_entries for each row execute function public.set_updated_at();
create trigger alerts_updated_at before update on public.alerts for each row execute function public.set_updated_at();
create trigger terminal_settings_updated_at before update on public.terminal_settings for each row execute function public.set_updated_at();
create trigger provider_config_updated_at before update on public.provider_config for each row execute function public.set_updated_at();

create index trading_accounts_owner_idx on public.trading_accounts(owner_user_id);
create index orders_account_status_idx on public.orders(account_id, status);
create index orders_owner_idx on public.orders(owner_user_id);
create index executions_account_time_idx on public.executions(account_id, executed_at desc);
create index executions_order_idx on public.executions(order_id);
create index positions_account_status_idx on public.positions(account_id, position_status);
create index daily_performance_account_date_idx on public.daily_performance(account_id, trading_date desc);
create index risk_events_account_time_idx on public.risk_events(account_id, occurred_at desc);
create index account_metric_snapshots_account_time_idx on public.account_metric_snapshots(account_id, snapshot_at desc);
create index instruments_symbol_idx on public.instruments(symbol);
create index instruments_exchange_segment_idx on public.instruments(exchange_segment);
create index instruments_type_idx on public.instruments(instrument_type);
create index watchlists_owner_idx on public.watchlists(owner_user_id);
create index watchlist_items_watchlist_order_idx on public.watchlist_items(watchlist_id, display_order);
create index journal_entries_owner_time_idx on public.journal_entries(owner_user_id, created_at desc);
create index alerts_owner_active_idx on public.alerts(owner_user_id, active);
create index terminal_activity_owner_time_idx on public.terminal_activity(owner_user_id, occurred_at desc);
create index terminal_activity_account_time_idx on public.terminal_activity(account_id, occurred_at desc);
create index provider_health_config_time_idx on public.provider_health(provider_config_id, checked_at desc);

alter table public.trading_accounts enable row level security;
alter table public.instruments enable row level security;
alter table public.orders enable row level security;
alter table public.executions enable row level security;
alter table public.positions enable row level security;
alter table public.daily_performance enable row level security;
alter table public.risk_events enable row level security;
alter table public.account_metric_snapshots enable row level security;
alter table public.watchlists enable row level security;
alter table public.watchlist_items enable row level security;
alter table public.journal_entries enable row level security;
alter table public.alerts enable row level security;
alter table public.terminal_settings enable row level security;
alter table public.terminal_activity enable row level security;
alter table public.provider_config enable row level security;
alter table public.provider_health enable row level security;

create policy trading_accounts_owner on public.trading_accounts for all to authenticated using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy instruments_authenticated_read on public.instruments for select to authenticated using (true);
create policy orders_owner on public.orders for all to authenticated using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy executions_owner on public.executions for all to authenticated using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy positions_owner on public.positions for all to authenticated using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy daily_performance_owner on public.daily_performance for all to authenticated using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy risk_events_owner on public.risk_events for all to authenticated using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy account_metric_snapshots_owner on public.account_metric_snapshots for all to authenticated using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy watchlists_owner on public.watchlists for all to authenticated using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy watchlist_items_owner on public.watchlist_items for all to authenticated using (exists (select 1 from public.watchlists w where w.id = watchlist_id and w.owner_user_id = auth.uid())) with check (exists (select 1 from public.watchlists w where w.id = watchlist_id and w.owner_user_id = auth.uid()));
create policy journal_entries_owner on public.journal_entries for all to authenticated using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy alerts_owner on public.alerts for all to authenticated using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy terminal_settings_owner on public.terminal_settings for all to authenticated using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy terminal_activity_owner_read on public.terminal_activity for select to authenticated using (owner_user_id = auth.uid());

-- Provider configuration and health are server/Admin OS records. With RLS enabled
-- and no authenticated policies, only service-role/Admin execution can access them.
