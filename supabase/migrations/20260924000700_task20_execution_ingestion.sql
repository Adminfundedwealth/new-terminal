-- Task 20: authoritative broker execution ingestion.
-- Only the internal control plane may execute this function. Customer clients
-- retain read-only access to public.executions through Task 7 RLS.

create or replace function public.ingest_execution(request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_account_id uuid;
  requested_order_id uuid;
  requested_owner_user_id uuid;
  requested_external_execution_id text;
  requested_instrument_id uuid;
  requested_symbol text;
  requested_side text;
  requested_quantity numeric;
  requested_execution_price numeric;
  requested_executed_at timestamptz;
  requested_fees numeric := 0;
  requested_taxes numeric := 0;
  requested_net_amount numeric;
  existing_execution public.executions%rowtype;
  current_order public.orders%rowtype;
  next_filled_quantity numeric;
  next_average_fill_price numeric;
  inserted_execution public.executions%rowtype;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Execution ingestion requires the internal service role';
  end if;
  if coalesce(request->>'source', '') not in ('broker', 'internal') then
    raise exception using errcode = '22023', message = 'Execution source must be broker or internal';
  end if;
  if nullif(trim(request->>'auth_user_id'), '') is null then
    raise exception using errcode = '22023', message = 'Authenticated source user is required';
  end if;

  requested_account_id := nullif(trim(request->>'account_id'), '')::uuid;
  requested_order_id := nullif(trim(request->>'order_id'), '')::uuid;
  requested_owner_user_id := nullif(trim(request->>'owner_user_id'), '')::uuid;
  requested_external_execution_id := nullif(trim(request->>'external_execution_id'), '');
  requested_instrument_id := nullif(trim(request->>'instrument_id'), '')::uuid;
  requested_symbol := upper(nullif(trim(request->>'symbol'), ''));
  requested_side := lower(nullif(trim(request->>'side'), ''));
  requested_quantity := (request->>'quantity')::numeric;
  requested_execution_price := (request->>'execution_price')::numeric;
  requested_executed_at := (request->>'executed_at')::timestamptz;
  if request ? 'fees' then requested_fees := (request->>'fees')::numeric; end if;
  if request ? 'taxes' then requested_taxes := (request->>'taxes')::numeric; end if;
  if request ? 'net_amount' and nullif(trim(request->>'net_amount'), '') is not null then requested_net_amount := (request->>'net_amount')::numeric; end if;

  if requested_account_id is null or requested_order_id is null or requested_owner_user_id is null
     or requested_external_execution_id is null or requested_symbol is null or requested_side is null
     or requested_executed_at is null then
    raise exception using errcode = '22023', message = 'Malformed broker execution payload';
  end if;
  if requested_owner_user_id::text <> nullif(trim(request->>'auth_user_id'), '') then
    raise exception using errcode = '42501', message = 'Execution owner does not match authenticated source';
  end if;
  if requested_side not in ('buy', 'sell') then raise exception using errcode = '22023', message = 'Invalid execution side'; end if;
  if requested_quantity is null or requested_quantity <= 0 then raise exception using errcode = '22023', message = 'Invalid execution quantity'; end if;
  if requested_execution_price is null or requested_execution_price <= 0 then raise exception using errcode = '22023', message = 'Invalid execution price'; end if;
  if requested_fees < 0 or requested_taxes < 0 or (requested_net_amount is not null and requested_net_amount < 0) then
    raise exception using errcode = '22023', message = 'Invalid execution charges';
  end if;

  select * into existing_execution
    from public.executions
   where account_id = requested_account_id
     and lower(trim(external_execution_id)) = lower(trim(requested_external_execution_id));
  if found then
    if existing_execution.order_id <> requested_order_id
       or existing_execution.quantity <> requested_quantity
       or existing_execution.execution_price <> requested_execution_price
       or existing_execution.executed_at <> requested_executed_at then
      raise exception using errcode = '23505', message = 'Broker execution ID conflicts with existing execution';
    end if;
    return jsonb_build_object('replayed', true, 'execution', to_jsonb(existing_execution));
  end if;

  select * into current_order from public.orders
   where id = requested_order_id and account_id = requested_account_id and owner_user_id = requested_owner_user_id
   for update;
  if not found then raise exception using errcode = 'P0002', message = 'Order not found or ownership mismatch'; end if;
  if current_order.status in ('filled', 'cancelled', 'rejected', 'failed') then
    raise exception using errcode = 'P0001', message = 'Order cannot receive an execution in its current state';
  end if;
  if upper(current_order.symbol) <> requested_symbol or current_order.side <> requested_side then
    raise exception using errcode = '22023', message = 'Execution instrument or side does not match the order';
  end if;
  if current_order.instrument_id is distinct from requested_instrument_id then
    raise exception using errcode = '22023', message = 'Execution instrument does not match the order';
  end if;

  next_filled_quantity := current_order.filled_quantity + requested_quantity;
  if next_filled_quantity > current_order.quantity then raise exception using errcode = '22023', message = 'Execution quantity exceeds order quantity'; end if;
  next_average_fill_price := ((coalesce(current_order.average_fill_price, 0) * current_order.filled_quantity) + (requested_execution_price * requested_quantity)) / next_filled_quantity;

  insert into public.executions (account_id, owner_user_id, order_id, external_execution_id, instrument_id, symbol, side, quantity, execution_price, fees, taxes, net_amount, executed_at)
  values (requested_account_id, requested_owner_user_id, requested_order_id, upper(trim(requested_external_execution_id)), requested_instrument_id, requested_symbol, requested_side, requested_quantity, requested_execution_price, requested_fees, requested_taxes, requested_net_amount, requested_executed_at)
  returning * into inserted_execution;

  update public.orders set filled_quantity = next_filled_quantity,
    average_fill_price = next_average_fill_price,
    status = case when next_filled_quantity = quantity then 'filled' else 'partially_filled' end,
    completed_at = case when next_filled_quantity = quantity then requested_executed_at else completed_at end,
    updated_at = greatest(updated_at, requested_executed_at)
   where id = current_order.id;

  return jsonb_build_object('replayed', false, 'execution', to_jsonb(inserted_execution));
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode = '22023', message = 'Malformed broker execution payload';
when unique_violation then
  select * into existing_execution
    from public.executions
   where account_id = requested_account_id
     and lower(trim(external_execution_id)) = lower(trim(requested_external_execution_id));
  if found and existing_execution.order_id = requested_order_id
     and existing_execution.quantity = requested_quantity
     and existing_execution.execution_price = requested_execution_price
     and existing_execution.executed_at = requested_executed_at then
    return jsonb_build_object('replayed', true, 'execution', to_jsonb(existing_execution));
  end if;
  raise exception using errcode = '23505', message = 'Broker execution ID conflicts with existing execution';
end;
$$;

revoke all on function public.ingest_execution(jsonb) from public, anon, authenticated;
grant execute on function public.ingest_execution(jsonb) to service_role;