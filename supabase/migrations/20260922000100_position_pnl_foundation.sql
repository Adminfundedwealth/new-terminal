-- Phase 4 reuses positions and executions. These additions persist valuation state
-- without creating a second position or accounting model.
alter table public.positions
  add column if not exists fees numeric(20, 8) not null default 0,
  add column if not exists total_pnl numeric(20, 8),
  add column if not exists valuation_status text not null default 'UNAVAILABLE',
  add column if not exists last_valued_at timestamptz;

alter table public.positions
  drop constraint if exists positions_quantity_check,
  add constraint positions_quantity_check check (quantity >= 0),
  drop constraint if exists positions_average_price_check,
  add constraint positions_average_price_check check (average_price > 0),
  drop constraint if exists positions_fees_check,
  add constraint positions_fees_check check (fees >= 0),
  drop constraint if exists positions_valuation_status_check,
  add constraint positions_valuation_status_check check (valuation_status in ('VALUED', 'UNAVAILABLE', 'STALE'));

create unique index if not exists positions_account_instrument_or_symbol_uidx
  on public.positions (account_id, coalesce(instrument_id, '00000000-0000-0000-0000-000000000000'::uuid), symbol);

alter table public.executions
  drop constraint if exists executions_quantity_check,
  add constraint executions_quantity_check check (quantity > 0),
  drop constraint if exists executions_execution_price_check,
  add constraint executions_execution_price_check check (execution_price > 0),
  drop constraint if exists executions_fees_check,
  add constraint executions_fees_check check (fees >= 0),
  drop constraint if exists executions_taxes_check,
  add constraint executions_taxes_check check (taxes >= 0);

comment on column public.positions.total_pnl is 'Realized plus unrealized P&L less recorded execution fees';
comment on column public.positions.valuation_status is 'VALUED, STALE, or UNAVAILABLE; no fabricated market price is stored';