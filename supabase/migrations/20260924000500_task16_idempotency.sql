
alter table public.orders
  add column if not exists idempotency_fingerprint text;

comment on column public.orders.idempotency_fingerprint is 'Canonical request fingerprint used to distinguish replayed and conflicting client order ids.';

create unique index if not exists orders_account_client_order_uidx
  on public.orders(account_id, client_order_id)
  where client_order_id is not null;

create or replace function public.create_order(request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  account_row public.trading_accounts%rowtype;
  instrument_row public.instruments%rowtype;
  risk_result jsonb;
  existing_order public.orders%rowtype;
  order_id_value uuid := gen_random_uuid();
  account_id_value uuid;
  client_order_id_value text := nullif(trim(request->>'client_order_id'), '');
  symbol_value text := upper(nullif(trim(request->>'symbol'), ''));
  exchange_value text := upper(nullif(trim(request->>'exchange'), ''));
  segment_value text := upper(nullif(trim(request->>'segment'), ''));
  side_value text := lower(nullif(trim(request->>'side'), ''));
  order_type_value text := upper(replace(replace(nullif(trim(request->>'order_type'), ''), '_', '-'), ' ', '-'));
  quantity_value numeric;
  price_value numeric;
  trigger_price_value numeric;
  product_value text := upper(nullif(trim(request->>'product'), ''));
  time_in_force_value text := upper(nullif(trim(request->>'time_in_force'), ''));
  is_overnight_value boolean := coalesce((request->>'is_overnight')::boolean, false);
  fingerprint_value text;
  now_value timestamptz := timezone('utc', now());
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'UNAUTHENTICATED', 'message', 'Authentication is required'));
  end if;

  begin
    account_id_value := nullif(request->>'account_id', '')::uuid;
  exception when invalid_text_representation then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_ACCOUNT', 'message', 'Trading account is invalid'));
  end;
  if account_id_value is null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_ACCOUNT', 'message', 'Trading account is required'));
  end if;

  select * into account_row from public.trading_accounts where id = account_id_value and owner_user_id = auth.uid();
  if not found then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'ACCOUNT_NOT_OWNED', 'message', 'Trading account is not owned by the authenticated user'));
  end if;
  if account_row.is_active is not true or account_row.status <> 'active' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'ACCOUNT_NOT_ACTIVE', 'message', 'Trading account is not active'));
  end if;

  -- Normalize the fields that define the logical request before looking up the key.
  if symbol_value is null or exchange_value is null or side_value is null or order_type_value is null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_ORDER', 'message', 'Required order fields are missing'));
  end if;
  if side_value not in ('buy', 'sell') then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_SIDE', 'message', 'Side must be BUY or SELL'));
  end if;
  if order_type_value = 'STOP' then order_type_value := 'SL'; end if;
  if order_type_value = 'STOP-LIMIT' then order_type_value := 'SL-M'; end if;
  begin
    quantity_value := (request->>'quantity')::numeric;
    price_value := nullif(request->>'price', '')::numeric;
    trigger_price_value := nullif(request->>'trigger_price', '')::numeric;
  exception when invalid_text_representation or numeric_value_out_of_range then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_NUMBER', 'message', 'Quantity and prices must be valid numbers'));
  end;
  fingerprint_value := md5(concat_ws('|', account_id_value::text, symbol_value, exchange_value, coalesce(segment_value, ''), side_value, order_type_value, quantity_value::text, coalesce(price_value::text, ''), coalesce(trigger_price_value::text, ''), coalesce(time_in_force_value, ''), coalesce(product_value, ''), is_overnight_value::text));

  if client_order_id_value is not null then
    -- The unique index serializes concurrent claims for the same account/key.
    select * into existing_order from public.orders
    where account_id = account_id_value and client_order_id = client_order_id_value
    for update;
    if found then
      if existing_order.idempotency_fingerprint is distinct from fingerprint_value then
        return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'IDEMPOTENCY_KEY_CONFLICT', 'message', 'Idempotency key was already used for a different order request'));
      end if;
      return jsonb_build_object('ok', true, 'replayed', true, 'order', to_jsonb(existing_order));
    end if;
  end if;

  if order_type_value not in ('MARKET', 'LIMIT', 'SL', 'SL-M') then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_ORDER_TYPE', 'message', 'Order type is not supported'));
  end if;
  if quantity_value is null or quantity_value <= 0 or quantity_value <> trunc(quantity_value) then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_QUANTITY', 'message', 'Quantity must be a positive whole number'));
  end if;
  if order_type_value in ('LIMIT', 'SL-M') and (price_value is null or price_value <= 0) then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_PRICE', 'message', 'This order type requires a positive price'));
  end if;
  if order_type_value in ('SL', 'SL-M') and (trigger_price_value is null or trigger_price_value <= 0) then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_TRIGGER_PRICE', 'message', 'Stop orders require a positive trigger price'));
  end if;
  if price_value is not null and price_value <= 0 then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_PRICE', 'message', 'Price must be positive'));
  end if;
  if trigger_price_value is not null and trigger_price_value <= 0 then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_TRIGGER_PRICE', 'message', 'Trigger price must be positive'));
  end if;
  if product_value is not null and product_value not in ('CNC', 'MIS', 'NRML') then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_PRODUCT', 'message', 'Product is not supported'));
  end if;

  select * into instrument_row from public.instruments where is_active and (upper(symbol) = symbol_value or upper(trading_symbol) = symbol_value) and upper(exchange) = exchange_value order by id limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_INSTRUMENT', 'message', 'Instrument is not available'));
  end if;
  if segment_value is not null and upper(instrument_row.exchange_segment) <> segment_value then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_EXCHANGE', 'message', 'Segment does not match the instrument'));
  end if;
  if instrument_row.expiry_date is not null and instrument_row.expiry_date < current_date then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_INSTRUMENT', 'message', 'Instrument contract has expired'));
  end if;
  if product_value = 'CNC' and upper(instrument_row.instrument_type) <> 'EQUITY' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_PRODUCT', 'message', 'Product is not compatible with the instrument'));
  end if;
  if instrument_row.lot_size is null or instrument_row.lot_size <= 0 or mod(quantity_value, instrument_row.lot_size) <> 0 then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_QUANTITY', 'message', 'Quantity must be a multiple of the instrument lot size'));
  end if;

  risk_result := public.evaluate_pre_trade_risk(jsonb_build_object('account_id', account_id_value, 'symbol', symbol_value, 'segment', coalesce(segment_value, instrument_row.exchange_segment), 'side', upper(side_value), 'quantity', quantity_value, 'order_type', order_type_value, 'requested_price', price_value, 'estimated_loss', case when price_value is null then null else quantity_value * price_value * 0.01 end, 'is_overnight', is_overnight_value));
  if risk_result->>'decision' <> 'ALLOW' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', coalesce(risk_result->>'reason_code', 'RISK_REJECTED'), 'message', 'Order was rejected by the pre-trade risk gate'), 'risk', risk_result);
  end if;

  insert into public.orders (id, account_id, owner_user_id, client_order_id, idempotency_fingerprint, symbol, instrument_id, exchange, segment, instrument_type, side, order_type, quantity, filled_quantity, price, trigger_price, time_in_force, status, created_at, updated_at)
  values (order_id_value, account_id_value, auth.uid(), client_order_id_value, fingerprint_value, symbol_value, instrument_row.id, exchange_value, coalesce(segment_value, instrument_row.exchange_segment), instrument_row.instrument_type, side_value, order_type_value, quantity_value, 0, price_value, trigger_price_value, time_in_force_value, 'requested', now_value, now_value)
  returning * into existing_order;
  return jsonb_build_object('ok', true, 'replayed', false, 'order', to_jsonb(existing_order));
exception
  when unique_violation then
    select * into existing_order from public.orders where account_id = account_id_value and client_order_id = client_order_id_value;
    if found and existing_order.idempotency_fingerprint = fingerprint_value then
      return jsonb_build_object('ok', true, 'replayed', true, 'order', to_jsonb(existing_order));
    end if;
    if found then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'IDEMPOTENCY_KEY_CONFLICT', 'message', 'Idempotency key was already used for a different order request'));
    end if;
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'PERSISTENCE_FAILURE', 'message', 'Order could not be created'));
  when others then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'PERSISTENCE_FAILURE', 'message', 'Order could not be created'));
end;
$$;

revoke all on function public.create_order(jsonb) from public, anon;
grant execute on function public.create_order(jsonb) to authenticated;