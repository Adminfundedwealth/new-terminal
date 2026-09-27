create or replace function public.modify_position_protection(
  requested_position_id uuid,
  requested_field text,
  requested_price numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  position_row public.positions%rowtype;
  account_row public.trading_accounts%rowtype;
  tick_size_value numeric;
  trading_permission boolean;
  opposite_price numeric;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if requested_field not in ('stop_loss', 'take_profit') then
    raise exception 'unsupported position protection field' using errcode = '22023';
  end if;
  if requested_price is null or requested_price <= 0 or requested_price::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'protection price must be finite and greater than zero' using errcode = '22023';
  end if;

  select * into position_row
  from public.positions
  where id = requested_position_id and owner_user_id = auth.uid()
  for update;
  if not found then
    raise exception 'position not found or not owned by current user' using errcode = '42501';
  end if;
  if position_row.position_status <> 'open' or position_row.quantity <= 0 then
    raise exception 'closed positions cannot be modified' using errcode = 'P0001';
  end if;
  if position_row.last_price is null or position_row.last_price <= 0 then
    raise exception 'current market price is unavailable for this position' using errcode = 'P0001';
  end if;

  select * into account_row
  from public.trading_accounts
  where id = position_row.account_id and owner_user_id = auth.uid()
  for share;
  if not found or account_row.status <> 'active' or account_row.is_active is not true then
    raise exception 'trading account is not active' using errcode = '42501';
  end if;
  if account_row.risk_state in ('LOCKED', 'BREACHED') then
    raise exception 'account risk state does not allow protection changes' using errcode = 'P0001';
  end if;

  select enabled into trading_permission
  from public.account_permissions
  where account_id = position_row.account_id and permission_key in ('trade', 'trading')
  order by case when permission_key = 'trade' then 0 else 1 end
  limit 1;
  if trading_permission is null then
    raise exception 'trading permission is not configured' using errcode = 'P0001';
  end if;
  if not trading_permission then
    raise exception 'trading permission is disabled' using errcode = '42501';
  end if;

  select tick_size into tick_size_value
  from public.instruments
  where id = position_row.instrument_id and is_active;
  if tick_size_value is null or tick_size_value <= 0 then
    raise exception 'instrument tick size is unavailable' using errcode = 'P0001';
  end if;
  if abs(requested_price / tick_size_value - round(requested_price / tick_size_value)) > 0.00000001 then
    raise exception 'price does not match the instrument tick size' using errcode = '22023';
  end if;

  if requested_field = 'stop_loss' then
    if (position_row.side = 'long' and requested_price >= least(position_row.average_price, position_row.last_price))
      or (position_row.side = 'short' and requested_price <= greatest(position_row.average_price, position_row.last_price)) then
      raise exception 'stop loss must remain beyond entry and current market price' using errcode = '22023';
    end if;
    opposite_price := position_row.take_profit;
    if opposite_price is not null and ((position_row.side = 'long' and requested_price >= opposite_price) or (position_row.side = 'short' and requested_price <= opposite_price)) then
      raise exception 'stop loss cannot cross the existing take-profit level' using errcode = '22023';
    end if;
    update public.positions
       set stop_loss = requested_price, updated_at = timezone('utc', now())
     where id = position_row.id
     returning * into position_row;
  else
    if (position_row.side = 'long' and requested_price <= greatest(position_row.average_price, position_row.last_price))
      or (position_row.side = 'short' and requested_price >= least(position_row.average_price, position_row.last_price)) then
      raise exception 'take profit must remain beyond entry and current market price' using errcode = '22023';
    end if;
    opposite_price := position_row.stop_loss;
    if opposite_price is not null and ((position_row.side = 'long' and requested_price <= opposite_price) or (position_row.side = 'short' and requested_price >= opposite_price)) then
      raise exception 'take profit cannot cross the existing stop-loss level' using errcode = '22023';
    end if;
    update public.positions
       set take_profit = requested_price, updated_at = timezone('utc', now())
     where id = position_row.id
     returning * into position_row;
  end if;

  insert into public.terminal_activity(owner_user_id, account_id, event_type, metadata)
  values (
    auth.uid(),
    position_row.account_id,
    'position_protection_modified',
    jsonb_build_object('position_id', position_row.id, 'symbol', position_row.symbol, 'field', requested_field, 'price', requested_price)
  );

  return to_jsonb(position_row);
end;
$$;

revoke all on function public.modify_position_protection(uuid, text, numeric) from public, anon;
grant execute on function public.modify_position_protection(uuid, text, numeric) to authenticated;