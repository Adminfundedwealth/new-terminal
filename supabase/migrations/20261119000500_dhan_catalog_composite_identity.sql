do $$
declare
  unique_index record;
begin
  if exists (
    select 1
    from public.instruments
    group by exchange_segment, security_id
    having count(*) > 1
  ) then
    raise exception 'Cannot add composite instrument identity while duplicate segment/security pairs exist.';
  end if;

  for unique_index in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.instruments'::regclass
      and c.contype = 'u'
      and pg_get_constraintdef(c.oid) = 'UNIQUE (security_id)'
  loop
    execute format('alter table public.instruments drop constraint %I', unique_index.conname);
  end loop;

  for unique_index in
    select i.indexrelid::regclass as index_name
    from pg_index i
    where i.indrelid = 'public.instruments'::regclass
      and i.indisunique
      and not i.indisprimary
      and i.indnkeyatts = 1
      and pg_get_indexdef(i.indexrelid, 1, true) = 'security_id'
      and not exists (
        select 1
        from pg_constraint c
        where c.conindid = i.indexrelid
      )
  loop
    execute format('drop index %s', unique_index.index_name);
  end loop;
end;
$$;

create unique index if not exists instruments_exchange_segment_security_id_uidx
  on public.instruments (exchange_segment, security_id);

alter table public.dhan_instrument_catalog_stage
  drop constraint if exists dhan_instrument_catalog_stage_pkey;
alter table public.dhan_instrument_catalog_stage
  drop constraint if exists dhan_instrument_catalog_stage_identity_pkey;
alter table public.dhan_instrument_catalog_stage
  add constraint dhan_instrument_catalog_stage_identity_pkey
  primary key (sync_id, exchange_segment, security_id);

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

  select count(*), count(distinct (item.exchange_segment, item.security_id))
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
    raise exception 'Dhan catalog batch is empty or contains duplicate instrument identities';
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
  on conflict (sync_id, exchange_segment, security_id) do update set
    symbol = excluded.symbol,
    trading_symbol = excluded.trading_symbol,
    exchange = excluded.exchange,
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
  on conflict (exchange_segment, security_id) do update set
    symbol = excluded.symbol,
    trading_symbol = excluded.trading_symbol,
    exchange = excluded.exchange,
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
        and staged.exchange_segment = instrument.exchange_segment
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
