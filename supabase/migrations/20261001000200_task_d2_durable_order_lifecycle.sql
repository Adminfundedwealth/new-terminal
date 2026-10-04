-- Task D2: persist each accepted order command and its execution handoff atomically.
-- Customer clients may create requests and read their own orders, but only the
-- trusted service role may advance lifecycle state.

begin;

alter table public.orders
  add column if not exists idempotency_fingerprint text,
  add column if not exists product text;

create table if not exists public.order_execution_outbox (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  account_id uuid not null,
  client_order_id text not null,
  payload jsonb not null,
  state text not null default 'pending'
    check (state in ('pending', 'processing', 'completed', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint order_execution_outbox_order_id_key unique (order_id),
  constraint order_execution_outbox_account_client_key unique (account_id, client_order_id)
);

create index if not exists order_execution_outbox_pending_idx
  on public.order_execution_outbox (available_at, created_at)
  where state = 'pending';

insert into public.order_execution_outbox (order_id, account_id, client_order_id, payload)
select o.id, o.account_id, o.client_order_id,
  jsonb_build_object(
    'account_id', o.account_id,
    'client_order_id', o.client_order_id,
    'symbol', upper(o.symbol),
    'exchange', upper(coalesce(o.exchange, '')),
    'segment', upper(coalesce(o.segment, '')),
    'side', upper(o.side),
    'quantity', trim_scale(o.quantity),
    'order_type', upper(o.order_type),
    'price', trim_scale(o.price),
    'trigger_price', trim_scale(o.trigger_price),
    'stop_loss', trim_scale(o.stop_loss),
    'take_profit', trim_scale(o.take_profit),
    'time_in_force', upper(coalesce(o.time_in_force, 'DAY')),
    'product', upper(o.product),
    'is_overnight', false
  )
from public.orders o
where o.status = 'requested'
  and o.client_order_id is not null
  and o.idempotency_fingerprint is not null
on conflict (order_id) do nothing;

alter table public.order_execution_outbox enable row level security;
revoke all on public.order_execution_outbox from public, anon, authenticated;
grant select, insert, update on public.order_execution_outbox to service_role;

create unique index if not exists orders_account_client_order_uidx
  on public.orders(account_id, client_order_id)
  where client_order_id is not null;

create or replace function public.create_order_command(request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  account_row public.trading_accounts%rowtype;
  instrument_row public.instruments%rowtype;
  order_row public.orders%rowtype;
  binding_row public.trading_account_broker_connections%rowtype;
  connection_row public.broker_connections%rowtype;
  risk_result jsonb;
  account_id_value uuid;
  client_order_id_value text;
  symbol_value text;
  exchange_value text;
  segment_value text;
  side_value text;
  order_type_value text;
  quantity_value numeric;
  price_value numeric;
  trigger_price_value numeric;
  stop_loss_value numeric;
  take_profit_value numeric;
  product_value text;
  time_in_force_value text;
  is_overnight_value boolean;
  fingerprint_value text;
  legacy_fingerprint_value text;
  command_payload jsonb;
  entry_reference_value numeric;
  now_value timestamptz := timezone('utc', now());
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'replayed', false, 'error', jsonb_build_object('code', 'UNAUTHENTICATED', 'message', 'Authentication is required'));
  end if;

  account_id_value := nullif(request->>'account_id', '')::uuid;
  client_order_id_value := nullif(trim(request->>'client_order_id'), '');
  symbol_value := upper(nullif(trim(request->>'symbol'), ''));
  exchange_value := upper(nullif(trim(request->>'exchange'), ''));
  segment_value := upper(nullif(trim(request->>'segment'), ''));
  side_value := lower(nullif(trim(request->>'side'), ''));
  order_type_value := upper(replace(replace(nullif(trim(request->>'order_type'), ''), '_', '-'), ' ', '-'));
  quantity_value := nullif(request->>'quantity', '')::numeric;
  price_value := nullif(request->>'price', '')::numeric(20, 8);
  trigger_price_value := nullif(request->>'trigger_price', '')::numeric(20, 8);
  stop_loss_value := nullif(request->>'stop_loss', '')::numeric(20, 8);
  take_profit_value := nullif(request->>'take_profit', '')::numeric(20, 8);
  product_value := upper(nullif(trim(request->>'product'), ''));
  time_in_force_value := upper(coalesce(nullif(trim(request->>'time_in_force'), ''), 'DAY'));
  is_overnight_value := coalesce((request->>'is_overnight')::boolean, false);

  if account_id_value is null or client_order_id_value is null or length(client_order_id_value) > 128 then
    return jsonb_build_object('ok', false, 'replayed', false, 'error', jsonb_build_object('code', 'INVALID_REQUEST', 'message', 'Account and client order identity are required'));
  end if;

  select * into account_row from public.trading_accounts
    where id = account_id_value and owner_user_id = auth.uid() for update;
  if not found then
    return jsonb_build_object('ok', false, 'replayed', false, 'error', jsonb_build_object('code', 'ACCOUNT_NOT_OWNED', 'message', 'Trading account is not owned by the authenticated user'));
  end if;

  if symbol_value is null or exchange_value is null or side_value not in ('buy', 'sell') then
    return jsonb_build_object('ok', false, 'replayed', false, 'error', jsonb_build_object('code', 'INVALID_ORDER', 'message', 'Order identity is invalid'));
  end if;
  if order_type_value = 'STOP' then order_type_value := 'SL'; end if;
  if order_type_value = 'STOP-LIMIT' then order_type_value := 'SL-M'; end if;
  if order_type_value not in ('MARKET', 'LIMIT', 'SL', 'SL-M') then
    return jsonb_build_object('ok', false, 'replayed', false, 'error', jsonb_build_object('code', 'INVALID_ORDER_TYPE', 'message', 'Order type is not supported'));
  end if;
  if quantity_value is null or quantity_value <= 0 or quantity_value <> trunc(quantity_value) then
    return jsonb_build_object('ok', false, 'replayed', false, 'error', jsonb_build_object('code', 'INVALID_QUANTITY', 'message', 'Quantity must be a positive whole number'));
  end if;
  if price_value is not null and price_value <= 0 then
    return jsonb_build_object('ok', false, 'replayed', false, 'error', jsonb_build_object('code', 'INVALID_PRICE', 'message', 'Price must be positive'));
  end if;
  if trigger_price_value is not null and trigger_price_value <= 0 then
    return jsonb_build_object('ok', false, 'replayed', false, 'error', jsonb_build_object('code', 'INVALID_TRIGGER_PRICE', 'message', 'Trigger price must be positive'));
  end if;
  if stop_loss_value is not null and stop_loss_value <= 0 then
    return jsonb_build_object('ok', false, 'replayed', false, 'error', jsonb_build_object('code', 'INVALID_STOP_LOSS', 'message', 'Stop loss must be positive'));
  end if;
  if take_profit_value is not null and take_profit_value <= 0 then
    return jsonb_build_object('ok', false, 'replayed', false, 'error', jsonb_build_object('code', 'INVALID_TAKE_PROFIT', 'message', 'Take profit must be positive'));
  end if;
  if order_type_value in ('LIMIT', 'SL-M') and price_value is null then
    return jsonb_build_object('ok', false, 'replayed', false, 'error', jsonb_build_object('code', 'INVALID_PRICE', 'message', 'This order type requires a positive price'));
  end if;
  if order_type_value in ('SL', 'SL-M') and trigger_price_value is null then
    return jsonb_build_object('ok', false, 'replayed', false, 'error', jsonb_build_object('code', 'INVALID_TRIGGER_PRICE', 'message', 'Stop orders require a positive trigger price'));
  end if;
  if product_value is not null and product_value not in ('CNC', 'MIS', 'NRML') then
    return jsonb_build_object('ok', false, 'replayed', false, 'error', jsonb_build_object('code', 'INVALID_PRODUCT', 'message', 'Product is not supported'));
  end if;
  if time_in_force_value not in ('DAY', 'IOC', 'GTC') then
    return jsonb_build_object('ok', false, 'replayed', false, 'error', jsonb_build_object('code', 'INVALID_TIME_IN_FORCE', 'message', 'Time in force is not supported'));
  end if;

  -- JSONB key ordering plus normalized values makes field order and numeric scale irrelevant.
  fingerprint_value := 'v2:' || jsonb_build_object(
    'account_id', account_id_value,
    'symbol', symbol_value,
    'exchange', exchange_value,
    'segment', coalesce(segment_value, ''),
    'side', side_value,
    'order_type', order_type_value,
    'quantity', trim_scale(quantity_value),
    'price', trim_scale(round(price_value, 8)),
    'trigger_price', trim_scale(round(trigger_price_value, 8)),
    'stop_loss', trim_scale(round(stop_loss_value, 8)),
    'take_profit', trim_scale(round(take_profit_value, 8)),
    'time_in_force', time_in_force_value,
    'product', coalesce(product_value, ''),
    'is_overnight', is_overnight_value
  )::text;
  legacy_fingerprint_value := md5(concat_ws('|', account_id_value::text, symbol_value, exchange_value, coalesce(segment_value, ''), side_value, order_type_value, quantity_value::text, coalesce(price_value::text, ''), coalesce(trigger_price_value::text, ''), coalesce(stop_loss_value::text, ''), coalesce(take_profit_value::text, ''), time_in_force_value, coalesce(product_value, ''), is_overnight_value::text));

  command_payload := jsonb_build_object(
    'account_id', account_id_value,
    'client_order_id', client_order_id_value,
    'symbol', symbol_value,
    'exchange', exchange_value,
    'segment', segment_value,
    'side', upper(side_value),
    'quantity', trim_scale(quantity_value),
    'order_type', order_type_value,
    'price', trim_scale(round(price_value, 8)),
    'trigger_price', trim_scale(round(trigger_price_value, 8)),
    'stop_loss', trim_scale(round(stop_loss_value, 8)),
    'take_profit', trim_scale(round(take_profit_value, 8)),
    'time_in_force', time_in_force_value,
    'product', product_value,
    'is_overnight', is_overnight_value
  );

  select * into order_row from public.orders
    where account_id = account_id_value and client_order_id = client_order_id_value
    for update;
  if found then
    if order_row.idempotency_fingerprint is distinct from fingerprint_value
       and order_row.idempotency_fingerprint is distinct from legacy_fingerprint_value then
      return jsonb_build_object('ok', false, 'replayed', false, 'error', jsonb_build_object('code', 'IDEMPOTENCY_KEY_CONFLICT', 'message', 'Client order id was already used for a different command'));
    end if;
    if order_row.status = 'requested' then
      insert into public.order_execution_outbox (order_id, account_id, client_order_id, payload)
      values (order_row.id, account_id_value, client_order_id_value, command_payload)
      on conflict (order_id) do nothing;
    end if;
    return jsonb_build_object('ok', true, 'replayed', true, 'order', to_jsonb(order_row));
  end if;

  if account_row.is_active is not true or account_row.status <> 'active' or account_row.risk_state in ('LOCKED', 'BREACHED') then
    return jsonb_build_object('ok', false, 'replayed', false, 'error', jsonb_build_object('code', 'ACCOUNT_NOT_TRADABLE', 'message', 'Trading account is not tradable'));
  end if;

  select b.* into binding_row from public.trading_account_broker_connections b
    where b.trading_account_id = account_row.id and b.is_active is true limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'replayed', false, 'error', jsonb_build_object('code', 'BROKER_BINDING_MISSING', 'message', 'No active broker binding is configured for this account'));
  end if;
  select c.* into connection_row from public.broker_connections c
    where c.id = binding_row.broker_connection_id
      and c.is_active is true and c.is_connected is true and c.connection_status = 'connected'
      and c.broker_id in ('dhan', 'zerodha') and c.broker_id = account_row.broker_provider;
  if not found then
    return jsonb_build_object('ok', false, 'replayed', false, 'error', jsonb_build_object('code', 'BROKER_CONNECTION_UNAVAILABLE', 'message', 'The account broker connection is not active'));
  end if;

  select * into instrument_row from public.instruments
    where is_active and upper(exchange) = exchange_value
      and (upper(symbol) = symbol_value or upper(trading_symbol) = symbol_value)
    order by id limit 1;
  if not found or (segment_value is not null and upper(instrument_row.exchange_segment) <> segment_value) then
    return jsonb_build_object('ok', false, 'replayed', false, 'error', jsonb_build_object('code', 'INVALID_INSTRUMENT', 'message', 'Instrument is not available for this command'));
  end if;
  if instrument_row.expiry_date is not null and instrument_row.expiry_date < current_date then
    return jsonb_build_object('ok', false, 'replayed', false, 'error', jsonb_build_object('code', 'INVALID_INSTRUMENT', 'message', 'Instrument contract has expired'));
  end if;
  if instrument_row.lot_size is null or instrument_row.lot_size <= 0 or mod(quantity_value, instrument_row.lot_size) <> 0 then
    return jsonb_build_object('ok', false, 'replayed', false, 'error', jsonb_build_object('code', 'INVALID_QUANTITY', 'message', 'Quantity must be a multiple of the instrument lot size'));
  end if;

  risk_result := public.evaluate_pre_trade_risk(jsonb_build_object(
    'account_id', account_id_value, 'symbol', symbol_value, 'exchange', exchange_value,
    'segment', coalesce(segment_value, instrument_row.exchange_segment), 'side', upper(side_value),
    'quantity', quantity_value, 'order_type', order_type_value, 'requested_price', price_value,
    'estimated_loss', case when stop_loss_value is not null then quantity_value * abs(coalesce(price_value, trigger_price_value) - stop_loss_value) when price_value is null then null else quantity_value * price_value * 0.01 end,
    'is_overnight', is_overnight_value));
  if risk_result->>'decision' <> 'ALLOW' then
    return jsonb_build_object('ok', false, 'replayed', false, 'error', jsonb_build_object('code', coalesce(risk_result->>'reason_code', 'RISK_REJECTED'), 'message', 'Order was rejected by the pre-trade risk gate'), 'risk', risk_result);
  end if;

  entry_reference_value := coalesce(price_value, trigger_price_value);
  if (stop_loss_value is not null or take_profit_value is not null) and entry_reference_value is null then
    return jsonb_build_object('ok', false, 'replayed', false, 'error', jsonb_build_object('code', 'INVALID_PRICE', 'message', 'An entry price is required when exit levels are set'));
  end if;

  insert into public.orders (id, account_id, owner_user_id, client_order_id, idempotency_fingerprint, symbol, instrument_id, exchange, segment, instrument_type, side, order_type, quantity, filled_quantity, price, trigger_price, stop_loss, take_profit, product, time_in_force, status, created_at, updated_at)
  values (gen_random_uuid(), account_id_value, auth.uid(), client_order_id_value, fingerprint_value, symbol_value, instrument_row.id, exchange_value, coalesce(segment_value, instrument_row.exchange_segment), instrument_row.instrument_type, side_value, order_type_value, quantity_value, 0, price_value, trigger_price_value, stop_loss_value, take_profit_value, product_value, time_in_force_value, 'requested', now_value, now_value)
  returning * into order_row;

  insert into public.order_execution_outbox (order_id, account_id, client_order_id, payload)
  values (order_row.id, account_id_value, client_order_id_value, command_payload);

  return jsonb_build_object('ok', true, 'replayed', false, 'order', to_jsonb(order_row));
exception
  when unique_violation then
    select * into order_row from public.orders
      where account_id = account_id_value and client_order_id = client_order_id_value;
    if found and (order_row.idempotency_fingerprint = fingerprint_value
                  or order_row.idempotency_fingerprint = legacy_fingerprint_value) then
      if order_row.status = 'requested' then
        insert into public.order_execution_outbox (order_id, account_id, client_order_id, payload)
        values (order_row.id, account_id_value, client_order_id_value, command_payload)
        on conflict (order_id) do nothing;
      end if;
      return jsonb_build_object('ok', true, 'replayed', true, 'order', to_jsonb(order_row));
    end if;
    return jsonb_build_object('ok', false, 'replayed', false, 'error', jsonb_build_object('code', 'IDEMPOTENCY_KEY_CONFLICT', 'message', 'Client order id was already used for a different command'));
  when others then
    return jsonb_build_object('ok', false, 'replayed', false, 'error', jsonb_build_object('code', 'ORDER_COMMAND_FAILED', 'message', 'Order command could not be persisted'));
end;
$$;

revoke all on function public.create_order_command(jsonb) from public, anon;
grant execute on function public.create_order_command(jsonb) to authenticated;

create or replace function public.order_status_transition_allowed(
  current_status text,
  next_status text
)
returns boolean
language sql
immutable
as $$
  select case current_status
    when 'requested' then next_status in ('pending', 'rejected', 'failed')
    when 'pending' then next_status in ('open', 'partially_filled', 'filled', 'cancel_requested', 'cancelled', 'rejected', 'failed')
    when 'open' then next_status in ('partially_filled', 'filled', 'cancel_requested', 'cancelled', 'failed')
    when 'partially_filled' then next_status in ('filled', 'cancel_requested', 'cancelled', 'failed')
    when 'cancel_requested' then next_status in ('cancelled', 'failed')
    else false
  end
$$;

create or replace function public.enforce_order_lifecycle_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
  transition_at timestamptz := timezone('utc', now());
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if actor_role <> 'service_role' then
      raise exception 'ORDER_STATUS_MUTATION_REQUIRES_TRUSTED_SERVICE' using errcode = '42501';
    end if;
    if not public.order_status_transition_allowed(old.status, new.status) then
      raise exception 'INVALID_ORDER_TRANSITION' using errcode = 'P0001';
    end if;

    insert into public.terminal_activity(owner_user_id, account_id, event_type, metadata, occurred_at)
    values (
      new.owner_user_id,
      new.account_id,
      'order_lifecycle_transitioned',
      jsonb_build_object(
        'order_id', new.id,
        'from_status', old.status,
        'to_status', new.status,
        'reason', case
          when lower(current_setting('app.order_transition_reason', true)) ~ '(access[_-]?token|api[_-]?key|password|secret|authorization|credential|private[_-]?key)' then '[redacted]'
          else nullif(left(current_setting('app.order_transition_reason', true), 500), '')
        end,
        'actor_user_id', auth.uid(),
        'actor_role', actor_role,
        'actor_source', coalesce(nullif(current_setting('app.order_transition_source', true), ''), 'trusted_service')
      ),
      transition_at
    );
  end if;
  return new;
end;
$$;

drop trigger if exists orders_lifecycle_guard on public.orders;
create trigger orders_lifecycle_guard
before update of status on public.orders
for each row execute function public.enforce_order_lifecycle_transition();

create or replace function public.transition_order_status(
  requested_order_id uuid,
  requested_account_id uuid,
  requested_status text,
  transition_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  order_row public.orders%rowtype;
  updated_order public.orders%rowtype;
  transition_at timestamptz := timezone('utc', now());
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'ORDER_NOT_AUTHORIZED' using errcode = '42501';
  end if;

  if requested_status not in ('requested', 'pending', 'open', 'partially_filled', 'filled', 'cancel_requested', 'cancelled', 'rejected', 'failed') then
    raise exception 'INVALID_ORDER_STATE' using errcode = '22P02';
  end if;

  select * into order_row
  from public.orders
  where id = requested_order_id and account_id = requested_account_id
  for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = '42501';
  end if;
  if order_row.status = requested_status then
    raise exception 'INVALID_ORDER_TRANSITION' using errcode = 'P0001';
  end if;
  if order_row.status in ('filled', 'cancelled', 'rejected', 'failed') then
    raise exception 'ORDER_ALREADY_TERMINAL' using errcode = 'P0001';
  end if;
  if not public.order_status_transition_allowed(order_row.status, requested_status) then
    raise exception 'INVALID_ORDER_TRANSITION' using errcode = 'P0001';
  end if;

  perform set_config('app.order_transition_reason', coalesce(transition_reason, ''), true);
  perform set_config('app.order_transition_source', 'transition_order_status', true);
  update public.orders
  set status = requested_status,
      updated_at = transition_at,
      submitted_at = case when requested_status = 'pending' and submitted_at is null then transition_at else submitted_at end,
      cancel_requested_at = case when requested_status = 'cancel_requested' and cancel_requested_at is null then transition_at else cancel_requested_at end,
      cancelled_at = case when requested_status = 'cancelled' and cancelled_at is null then transition_at else cancelled_at end,
      completed_at = case when requested_status in ('filled', 'cancelled', 'rejected', 'failed') and completed_at is null then transition_at else completed_at end
  where id = order_row.id
  returning * into updated_order;

  return jsonb_build_object('order', to_jsonb(updated_order), 'audit_event', 'order_lifecycle_transitioned');
end;
$$;

revoke all on function public.enforce_order_lifecycle_transition() from public, anon, authenticated;
revoke all on function public.order_status_transition_allowed(text, text) from public, anon, authenticated;
grant execute on function public.order_status_transition_allowed(text, text) to service_role;
revoke all on function public.transition_order_status(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.transition_order_status(uuid, uuid, text, text) to service_role;

-- Close legacy customer RPCs that could persist an order or synthetic fill
-- without passing through the durable Terminal OS command gateway.
revoke all on function public.create_order(jsonb) from public, anon, authenticated;
grant execute on function public.create_order(jsonb) to service_role;
revoke all on function public.create_simulated_kite_order(jsonb) from public, anon, authenticated;
grant execute on function public.create_simulated_kite_order(jsonb) to service_role;

commit;