create or replace function public.create_simulated_kite_order(request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  account_row public.trading_accounts%rowtype;
  instrument_row public.instruments%rowtype;
  order_row public.orders%rowtype;
  execution_row public.executions%rowtype;
  position_row public.positions%rowtype;
  order_result jsonb;
  instrument_value jsonb := request->'instrument';
  account_id_value uuid;
  security_id_value text;
  symbol_value text;
  trading_symbol_value text;
  exchange_value text;
  segment_value text;
  instrument_type_value text;
  option_type_value text;
  expiry_value date;
  strike_value numeric;
  lot_size_value integer;
  tick_size_value numeric;
  side_value text;
  order_id_value uuid;
  execution_price_value numeric;
  execution_quantity_value numeric;
  incoming_position_side text;
  remaining_existing_quantity numeric;
  remaining_order_quantity numeric;
  closed_quantity numeric;
  position_quantity numeric;
  position_average_price numeric;
  position_side text;
  realized_delta numeric := 0;
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

  select * into account_row
  from public.trading_accounts
  where id = account_id_value and owner_user_id = auth.uid()
  for update;
  if not found or account_row.status <> 'active' or account_row.is_active is not true then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'ACCOUNT_NOT_ACTIVE', 'message', 'An active simulated account is required'));
  end if;
  if upper(coalesce(account_row.account_type, '')) <> 'SIMULATED' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'SIMULATION_ONLY', 'message', 'Kite derivative fills are enabled only for simulated accounts'));
  end if;
  if upper(coalesce(request->>'order_type', '')) <> 'MARKET' or upper(coalesce(request->>'product', '')) <> 'NRML' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'SIMULATION_ORDER_TYPE_UNSUPPORTED', 'message', 'Simulated Kite derivative execution currently supports NRML market orders only'));
  end if;

  security_id_value := coalesce(nullif(trim(instrument_value->>'providerInstrumentId'), ''), nullif(trim(instrument_value->>'securityId'), ''));
  symbol_value := upper(nullif(trim(instrument_value->>'symbol'), ''));
  trading_symbol_value := upper(nullif(trim(instrument_value->>'tradingSymbol'), ''));
  exchange_value := upper(nullif(trim(instrument_value->>'exchange'), ''));
  segment_value := upper(nullif(trim(instrument_value->>'exchangeSegment'), ''));
  instrument_type_value := upper(nullif(trim(instrument_value->>'instrumentType'), ''));
  option_type_value := upper(nullif(trim(instrument_value->>'optionType'), ''));
  side_value := lower(nullif(trim(request->>'side'), ''));

  begin
    lot_size_value := nullif(instrument_value->>'lotSize', '')::integer;
    tick_size_value := nullif(instrument_value->>'tickSize', '')::numeric;
    expiry_value := nullif(instrument_value->>'expiryDate', '')::date;
    strike_value := nullif(instrument_value->>'strikePrice', '')::numeric;
    execution_price_value := nullif(request->>'price', '')::numeric;
    execution_quantity_value := nullif(request->>'quantity', '')::numeric;
  exception when invalid_text_representation or numeric_value_out_of_range then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_INSTRUMENT', 'message', 'Kite instrument metadata is malformed'));
  end;

  if lower(coalesce(instrument_value->>'provider', '')) <> 'zerodha'
     or security_id_value !~ '^[0-9]+$'
     or symbol_value is null
     or trading_symbol_value is null
     or trading_symbol_value <> upper(coalesce(request->>'symbol', ''))
     or exchange_value <> 'NSE'
     or segment_value <> 'NSE_FNO'
     or instrument_type_value not in ('OPTIDX', 'OPTSTK', 'FUTIDX', 'FUTSTK')
     or lot_size_value is null or lot_size_value <= 0
     or tick_size_value is null or tick_size_value <= 0
     or expiry_value is null or expiry_value < current_date
     or side_value not in ('buy', 'sell')
     or execution_price_value is null or execution_price_value <= 0
     or execution_quantity_value is null or execution_quantity_value <= 0
     or mod(execution_quantity_value, lot_size_value) <> 0 then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_INSTRUMENT', 'message', 'Kite contract does not match the simulated NSE F&O order'));
  end if;
  if instrument_type_value in ('OPTIDX', 'OPTSTK') and (strike_value is null or strike_value <= 0 or option_type_value not in ('CE', 'PE')) then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_INSTRUMENT', 'message', 'Kite option contract is incomplete'));
  end if;

  select * into instrument_row
  from public.instruments
  where upper(trading_symbol) = trading_symbol_value and upper(exchange) = exchange_value
  order by is_active desc, updated_at desc
  limit 1
  for update;

  if found then
    if instrument_row.is_active is not true
       or upper(instrument_row.symbol) <> symbol_value
       or upper(instrument_row.exchange_segment) <> segment_value
       or upper(instrument_row.instrument_type) <> instrument_type_value
       or instrument_row.lot_size <> lot_size_value
       or instrument_row.expiry_date <> expiry_value
       or instrument_row.strike_price is distinct from strike_value
       or upper(coalesce(instrument_row.option_type, '')) <> coalesce(option_type_value, '') then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INSTRUMENT_CONFLICT', 'message', 'Canonical instrument metadata conflicts with the Kite master'));
    end if;
  else
    select * into instrument_row from public.instruments where security_id = security_id_value for update;
    if found then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INSTRUMENT_CONFLICT', 'message', 'Kite instrument token is already assigned to another contract'));
    end if;
    insert into public.instruments (security_id, symbol, trading_symbol, exchange, exchange_segment, instrument_type, lot_size, expiry_date, strike_price, option_type, tick_size, is_active)
    values (security_id_value, symbol_value, trading_symbol_value, exchange_value, segment_value, instrument_type_value, lot_size_value, expiry_value, strike_value, option_type_value, tick_size_value, true)
    returning * into instrument_row;
  end if;

  order_result := public.create_order(request);
  if order_result->>'ok' <> 'true' then return order_result; end if;
  order_id_value := (order_result->'order'->>'id')::uuid;
  if coalesce((order_result->>'replayed')::boolean, false) then return order_result; end if;

  perform set_config('app.order_lifecycle_transition', 'allowed', true);
  update public.orders
  set status = 'pending', submitted_at = now_value, updated_at = now_value
  where id = order_id_value and status = 'requested';

  insert into public.executions (account_id, owner_user_id, order_id, external_execution_id, instrument_id, symbol, side, quantity, execution_price, fees, taxes, net_amount, executed_at)
  values (
    account_id_value,
    auth.uid(),
    order_id_value,
    'SIM-' || order_id_value::text,
    instrument_row.id,
    trading_symbol_value,
    side_value,
    execution_quantity_value,
    execution_price_value,
    0,
    0,
    case when side_value = 'buy' then -execution_price_value * execution_quantity_value else execution_price_value * execution_quantity_value end,
    now_value
  )
  returning * into execution_row;

  update public.orders
  set filled_quantity = execution_quantity_value,
      average_fill_price = execution_price_value,
      status = 'filled',
      completed_at = now_value,
      updated_at = now_value
  where id = order_id_value
  returning * into order_row;

  incoming_position_side := case when side_value = 'buy' then 'long' else 'short' end;
  select * into position_row
  from public.positions
  where account_id = account_id_value and instrument_id = instrument_row.id
  for update;

  if not found then
    insert into public.positions (account_id, owner_user_id, instrument_id, symbol, exchange, quantity, side, average_price, last_price, unrealized_pnl, realized_pnl, position_status, opened_at, updated_at)
    values (account_id_value, auth.uid(), instrument_row.id, trading_symbol_value, exchange_value, execution_quantity_value, incoming_position_side, execution_price_value, execution_price_value, 0, 0, 'open', now_value, now_value)
    returning * into position_row;
  elsif position_row.position_status = 'closed' or position_row.quantity <= 0 then
    update public.positions
    set symbol = trading_symbol_value,
        exchange = exchange_value,
        quantity = execution_quantity_value,
        side = incoming_position_side,
        average_price = execution_price_value,
        last_price = execution_price_value,
        unrealized_pnl = 0,
        position_status = 'open',
        opened_at = now_value,
        closed_at = null,
        updated_at = now_value
    where id = position_row.id
    returning * into position_row;
  else
    if position_row.side = incoming_position_side then
      position_quantity := position_row.quantity + execution_quantity_value;
      position_average_price := ((position_row.quantity * position_row.average_price) + (execution_quantity_value * execution_price_value)) / position_quantity;
      position_side := position_row.side;
    else
      closed_quantity := least(position_row.quantity, execution_quantity_value);
      realized_delta := case
        when position_row.side = 'long' then (execution_price_value - position_row.average_price) * closed_quantity
        else (position_row.average_price - execution_price_value) * closed_quantity
      end;
      remaining_existing_quantity := position_row.quantity - closed_quantity;
      remaining_order_quantity := execution_quantity_value - closed_quantity;
      if remaining_existing_quantity > 0 then
        position_quantity := remaining_existing_quantity;
        position_average_price := position_row.average_price;
        position_side := position_row.side;
      elsif remaining_order_quantity > 0 then
        position_quantity := remaining_order_quantity;
        position_average_price := execution_price_value;
        position_side := incoming_position_side;
      else
        position_quantity := 0;
        position_average_price := position_row.average_price;
        position_side := position_row.side;
      end if;
    end if;

    update public.positions
    set quantity = position_quantity,
        side = position_side,
        average_price = position_average_price,
        last_price = execution_price_value,
        realized_pnl = realized_pnl + realized_delta,
        unrealized_pnl = case when position_quantity = 0 then 0 else (execution_price_value - position_average_price) * position_quantity * case when position_side = 'long' then 1 else -1 end end,
        position_status = case when position_quantity = 0 then 'closed' else 'open' end,
        closed_at = case when position_quantity = 0 then now_value else null end,
        updated_at = now_value
    where id = position_row.id
    returning * into position_row;
  end if;

  if realized_delta <> 0 then
    update public.trading_accounts account
    set current_balance = account.current_balance + realized_delta,
        equity = account.current_balance + realized_delta + coalesce((
          select sum(open_position.unrealized_pnl)
          from public.positions open_position
          where open_position.account_id = account.id and open_position.position_status = 'open'
        ), 0),
        updated_at = now_value
    where account.id = account_id_value;
  end if;

  return jsonb_build_object('ok', true, 'replayed', false, 'order', to_jsonb(order_row), 'execution', to_jsonb(execution_row), 'position', to_jsonb(position_row));
exception when invalid_text_representation or numeric_value_out_of_range then
  return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_SIMULATED_ORDER', 'message', 'Simulated derivative order metadata is malformed'));
when others then
  return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'SIMULATED_ORDER_FAILED', 'message', sqlerrm));
end;
$$;

create or replace function public.get_terminal_orders(requested_account_id uuid default null)
returns setof public.orders
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  return query select orders.* from public.orders
    where owner_user_id = auth.uid()
      and (requested_account_id is null or account_id = requested_account_id)
    order by created_at desc;
end;
$$;

create or replace function public.get_terminal_executions(requested_account_id uuid default null)
returns table (
  id uuid,
  trading_account_id uuid,
  order_id uuid,
  position_id uuid,
  symbol text,
  qty numeric,
  price numeric,
  executed_at timestamptz,
  account_id uuid,
  side text,
  quantity numeric,
  execution_price numeric,
  instrument_id uuid,
  external_execution_id text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  return query
    select execution.id, execution.account_id, execution.order_id, position.id,
      execution.symbol, execution.quantity, execution.execution_price, execution.executed_at,
      execution.account_id, execution.side, execution.quantity, execution.execution_price,
      execution.instrument_id, execution.external_execution_id
    from public.executions execution
    left join public.positions position
      on position.account_id = execution.account_id
      and position.instrument_id = execution.instrument_id
      and position.owner_user_id = auth.uid()
    where execution.owner_user_id = auth.uid()
      and (requested_account_id is null or execution.account_id = requested_account_id)
    order by execution.executed_at desc;
end;
$$;

create or replace function public.get_terminal_positions(requested_account_id uuid default null)
returns setof public.positions
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  return query select positions.* from public.positions
    where owner_user_id = auth.uid()
      and (requested_account_id is null or account_id = requested_account_id)
    order by updated_at desc;
end;
$$;

revoke all on function public.create_simulated_kite_order(jsonb) from public, anon;
revoke all on function public.get_terminal_orders(uuid) from public, anon;
revoke all on function public.get_terminal_executions(uuid) from public, anon;
revoke all on function public.get_terminal_positions(uuid) from public, anon;
grant execute on function public.create_simulated_kite_order(jsonb) to authenticated;
grant execute on function public.get_terminal_orders(uuid) to authenticated;
grant execute on function public.get_terminal_executions(uuid) to authenticated;
grant execute on function public.get_terminal_positions(uuid) to authenticated;