create table public.dhan_instrument_catalog_syncs (
  id uuid primary key,
  status text not null default 'pending' check (status in ('pending', 'activated')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  synced_count integer,
  retired_count integer,
  exchange_count integer
);

create table public.dhan_instrument_catalog_stage (
  sync_id uuid not null references public.dhan_instrument_catalog_syncs(id) on delete cascade,
  security_id text not null,
  symbol text not null,
  trading_symbol text not null,
  exchange text not null,
  exchange_segment text not null,
  instrument_type text not null,
  lot_size integer,
  expiry_date date,
  strike_price numeric(20, 4),
  option_type text,
  tick_size numeric(20, 8),
  primary key (sync_id, security_id),
  check (security_id ~ '^[0-9]+$'),
  check (exchange in ('NSE', 'BSE')),
  check (exchange_segment in ('NSE_EQ', 'BSE_EQ', 'NSE_FNO', 'BSE_FNO', 'IDX_I', 'BSE_IDX')),
  check ((exchange_segment not like 'NSE_%' or exchange = 'NSE') and (exchange_segment not like 'BSE_%' or exchange = 'BSE')),
  check (instrument_type in ('EQUITY', 'INDEX', 'FUTSTK', 'FUTIDX', 'OPTSTK', 'OPTIDX')),
  check (
    (instrument_type = 'EQUITY' and exchange_segment in ('NSE_EQ', 'BSE_EQ')) or
    (instrument_type = 'INDEX' and exchange_segment in ('IDX_I', 'BSE_IDX')) or
    (instrument_type in ('FUTSTK', 'FUTIDX', 'OPTSTK', 'OPTIDX') and exchange_segment in ('NSE_FNO', 'BSE_FNO'))
  ),
  check (lot_size is null or lot_size > 0),
  check (tick_size is null or tick_size > 0),
  check (strike_price is null or strike_price >= 0),
  check (option_type is null or option_type in ('CE', 'PE')),
  check (instrument_type = 'INDEX' or (lot_size is not null and tick_size is not null)),
  check (instrument_type not in ('FUTSTK', 'FUTIDX', 'OPTSTK', 'OPTIDX') or expiry_date is not null),
  check (instrument_type not in ('OPTSTK', 'OPTIDX') or (
    expiry_date is not null and
    strike_price is not null and strike_price > 0 and
    option_type in ('CE', 'PE')
  ))
);

alter table public.dhan_instrument_catalog_syncs enable row level security;
alter table public.dhan_instrument_catalog_stage enable row level security;
revoke all on public.dhan_instrument_catalog_syncs from public, anon, authenticated;
revoke all on public.dhan_instrument_catalog_stage from public, anon, authenticated;

create or replace function public.begin_dhan_instrument_catalog_sync(p_sync_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  delete from public.dhan_instrument_catalog_syncs
  where (status = 'pending' and created_at < now() - interval '1 day')
     or (status = 'activated' and completed_at < now() - interval '30 days');

  insert into public.dhan_instrument_catalog_syncs (id)
  values (p_sync_id)
  on conflict (id) do nothing;

  return p_sync_id;
end;
$$;

create or replace function public.stage_dhan_instrument_catalog_batch(p_sync_id uuid, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_status text;
  v_input_count integer;
  v_unique_count integer;
  v_staged_count integer;
begin
  select status into v_status
  from public.dhan_instrument_catalog_syncs
  where id = p_sync_id
  for update;

  if not found or v_status <> 'pending' then
    raise exception 'Dhan catalog sync is not pending';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Dhan catalog batch must be a JSON array';
  end if;

  select count(*), count(distinct item.security_id)
  into v_input_count, v_unique_count
  from jsonb_to_recordset(p_rows) as item(
    security_id text,
    symbol text,
    trading_symbol text,
    exchange text,
    exchange_segment text,
    instrument_type text,
    lot_size integer,
    expiry_date date,
    strike_price numeric,
    option_type text,
    tick_size numeric
  );

  if v_input_count = 0 or v_input_count <> v_unique_count then
    raise exception 'Dhan catalog batch is empty or contains duplicate security IDs';
  end if;

  insert into public.dhan_instrument_catalog_stage (
    sync_id, security_id, symbol, trading_symbol, exchange, exchange_segment,
    instrument_type, lot_size, expiry_date, strike_price, option_type, tick_size
  )
  select
    p_sync_id, item.security_id, item.symbol, item.trading_symbol, item.exchange,
    item.exchange_segment, item.instrument_type, item.lot_size, item.expiry_date,
    item.strike_price, item.option_type, item.tick_size
  from jsonb_to_recordset(p_rows) as item(
    security_id text,
    symbol text,
    trading_symbol text,
    exchange text,
    exchange_segment text,
    instrument_type text,
    lot_size integer,
    expiry_date date,
    strike_price numeric,
    option_type text,
    tick_size numeric
  )
  on conflict (sync_id, security_id) do update set
    symbol = excluded.symbol,
    trading_symbol = excluded.trading_symbol,
    exchange = excluded.exchange,
    exchange_segment = excluded.exchange_segment,
    instrument_type = excluded.instrument_type,
    lot_size = excluded.lot_size,
    expiry_date = excluded.expiry_date,
    strike_price = excluded.strike_price,
    option_type = excluded.option_type,
    tick_size = excluded.tick_size;

  get diagnostics v_staged_count = row_count;
  return v_staged_count;
end;
$$;

create or replace function public.activate_dhan_instrument_catalog_sync(p_sync_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_sync public.dhan_instrument_catalog_syncs%rowtype;
  v_synced_count integer;
  v_retired_count integer;
  v_exchange_count integer;
  v_now timestamptz := now();
begin
  perform pg_advisory_xact_lock(hashtext('dhan-instrument-catalog'));

  select * into v_sync
  from public.dhan_instrument_catalog_syncs
  where id = p_sync_id
  for update;

  if not found then
    raise exception 'Dhan catalog sync was not found';
  end if;
  if v_sync.status = 'activated' then
    return jsonb_build_object(
      'synced_count', v_sync.synced_count,
      'retired_count', v_sync.retired_count,
      'exchange_count', v_sync.exchange_count,
      'synced_at', v_sync.completed_at
    );
  end if;

  select count(*), count(distinct exchange)
  into v_synced_count, v_exchange_count
  from public.dhan_instrument_catalog_stage
  where sync_id = p_sync_id;

  if v_synced_count = 0 then
    raise exception 'Dhan catalog sync contains no instruments';
  end if;

  insert into public.instruments (
    security_id, symbol, trading_symbol, exchange, exchange_segment,
    instrument_type, lot_size, expiry_date, strike_price, option_type,
    tick_size, is_active, updated_at
  )
  select
    security_id, symbol, trading_symbol, exchange, exchange_segment,
    instrument_type, lot_size, expiry_date, strike_price, option_type,
    tick_size, true, v_now
  from public.dhan_instrument_catalog_stage
  where sync_id = p_sync_id
  on conflict (security_id) do update set
    symbol = excluded.symbol,
    trading_symbol = excluded.trading_symbol,
    exchange = excluded.exchange,
    exchange_segment = excluded.exchange_segment,
    instrument_type = excluded.instrument_type,
    lot_size = excluded.lot_size,
    expiry_date = excluded.expiry_date,
    strike_price = excluded.strike_price,
    option_type = excluded.option_type,
    tick_size = excluded.tick_size,
    is_active = true,
    updated_at = excluded.updated_at;

  update public.instruments as instrument
  set is_active = false, updated_at = v_now
  where instrument.is_active
    and instrument.exchange_segment = any(array['NSE_EQ', 'BSE_EQ', 'NSE_FNO', 'BSE_FNO', 'IDX_I', 'BSE_IDX'])
    and not exists (
      select 1
      from public.dhan_instrument_catalog_stage as staged
      where staged.sync_id = p_sync_id
        and staged.security_id = instrument.security_id
    );
  get diagnostics v_retired_count = row_count;

  update public.dhan_instrument_catalog_syncs
  set status = 'activated',
      completed_at = v_now,
      synced_count = v_synced_count,
      retired_count = v_retired_count,
      exchange_count = v_exchange_count
  where id = p_sync_id;

  delete from public.dhan_instrument_catalog_stage where sync_id = p_sync_id;

  return jsonb_build_object(
    'synced_count', v_synced_count,
    'retired_count', v_retired_count,
    'exchange_count', v_exchange_count,
    'synced_at', v_now
  );
end;
$$;

create or replace function public.abort_dhan_instrument_catalog_sync(p_sync_id uuid)
returns void
language sql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  delete from public.dhan_instrument_catalog_syncs
  where id = p_sync_id and status = 'pending';
$$;

revoke all on function public.begin_dhan_instrument_catalog_sync(uuid) from public, anon, authenticated;
revoke all on function public.stage_dhan_instrument_catalog_batch(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.activate_dhan_instrument_catalog_sync(uuid) from public, anon, authenticated;
revoke all on function public.abort_dhan_instrument_catalog_sync(uuid) from public, anon, authenticated;
grant execute on function public.begin_dhan_instrument_catalog_sync(uuid) to service_role;
grant execute on function public.stage_dhan_instrument_catalog_batch(uuid, jsonb) to service_role;
grant execute on function public.activate_dhan_instrument_catalog_sync(uuid) to service_role;
grant execute on function public.abort_dhan_instrument_catalog_sync(uuid) to service_role;
