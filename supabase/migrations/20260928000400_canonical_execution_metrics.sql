create or replace function public.apply_execution_to_position()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  position_row public.positions%rowtype;
  incoming_side text := case when new.side = 'buy' then 'long' else 'short' end;
  remaining_quantity numeric;
  close_quantity numeric;
  open_quantity numeric;
  realized_delta numeric := 0;
  next_side text;
  next_average numeric;
  next_realized numeric;
  next_fees numeric;
  charges numeric := coalesce(new.fees, 0) + coalesce(new.taxes, 0);
  exchange_value text;
  position_found boolean;
begin
  -- The safe simulated RPC already performs its own atomic position mutation.
  if upper(coalesce(new.external_execution_id, '')) like 'SIM-%' then return new; end if;

  if new.instrument_id is not null then
    select * into position_row from public.positions
    where account_id = new.account_id and instrument_id = new.instrument_id for update;
  else
    select * into position_row from public.positions
    where account_id = new.account_id and symbol = new.symbol and instrument_id is null for update;
  end if;
  position_found := found;

  if new.instrument_id is not null then select exchange into exchange_value from public.instruments where id = new.instrument_id; end if;
  if not position_found then
    insert into public.positions(account_id, owner_user_id, instrument_id, symbol, exchange, quantity, side, average_price,
      last_price, unrealized_pnl, realized_pnl, fees, total_pnl, valuation_status, last_valued_at, position_status, opened_at, updated_at)
    values (new.account_id, new.owner_user_id, new.instrument_id, new.symbol, exchange_value, new.quantity, incoming_side,
      new.execution_price, new.execution_price, 0, 0, charges, -charges, 'VALUED', new.executed_at, 'open', new.executed_at, new.executed_at)
    returning * into position_row;
  elsif position_row.position_status = 'closed' or position_row.quantity <= 0 then
    update public.positions set owner_user_id = new.owner_user_id, symbol = new.symbol, exchange = exchange_value,
      quantity = new.quantity, side = incoming_side, average_price = new.execution_price, last_price = new.execution_price,
      unrealized_pnl = 0, fees = fees + charges, total_pnl = realized_pnl - (fees + charges),
      valuation_status = 'VALUED', last_valued_at = new.executed_at, position_status = 'open',
      opened_at = new.executed_at, closed_at = null, updated_at = new.executed_at
    where id = position_row.id;
  elsif position_row.side = incoming_side then
    open_quantity := position_row.quantity + new.quantity;
    next_average := ((position_row.quantity * position_row.average_price) + (new.quantity * new.execution_price)) / open_quantity;
    update public.positions set quantity = open_quantity, average_price = next_average, last_price = new.execution_price,
      fees = fees + charges, unrealized_pnl = (new.execution_price - next_average) * open_quantity * case when incoming_side = 'long' then 1 else -1 end,
      total_pnl = realized_pnl + ((new.execution_price - next_average) * open_quantity * case when incoming_side = 'long' then 1 else -1 end) - (fees + charges),
      valuation_status = 'VALUED', last_valued_at = new.executed_at, updated_at = new.executed_at
    where id = position_row.id;
  else
    close_quantity := least(position_row.quantity, new.quantity);
    realized_delta := (new.execution_price - position_row.average_price) * close_quantity * case when position_row.side = 'long' then 1 else -1 end;
    remaining_quantity := position_row.quantity - close_quantity;
    open_quantity := new.quantity - close_quantity;
    next_realized := position_row.realized_pnl + realized_delta;
    next_fees := position_row.fees + charges;
    if remaining_quantity > 0 then
      next_side := position_row.side;
      next_average := position_row.average_price;
      open_quantity := remaining_quantity;
    elsif open_quantity > 0 then
      next_side := incoming_side;
      next_average := new.execution_price;
    else
      next_side := position_row.side;
      next_average := position_row.average_price;
    end if;
    update public.positions set quantity = open_quantity, side = next_side, average_price = next_average,
      last_price = new.execution_price, realized_pnl = next_realized, fees = next_fees,
      unrealized_pnl = case when open_quantity = 0 then 0 else (new.execution_price - next_average) * open_quantity * case when next_side = 'long' then 1 else -1 end end,
      total_pnl = next_realized + case when open_quantity = 0 then 0 else (new.execution_price - next_average) * open_quantity * case when next_side = 'long' then 1 else -1 end end - next_fees,
      position_status = case when open_quantity = 0 then 'closed' else 'open' end,
      closed_at = case when open_quantity = 0 then new.executed_at else null end,
      valuation_status = 'VALUED', last_valued_at = new.executed_at, updated_at = new.executed_at
    where id = position_row.id;
  end if;
  return new;
end;
$$;

drop trigger if exists executions_apply_canonical_position on public.executions;
create trigger executions_apply_canonical_position
after insert on public.executions
for each row execute function public.apply_execution_to_position();

create or replace function public.refresh_account_metrics_from_position()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_account_id uuid := coalesce(new.account_id, old.account_id);
  target_owner_id uuid := coalesce(new.owner_user_id, old.owner_user_id);
  account_row public.trading_accounts%rowtype;
  current_rule jsonb := '{}'::jsonb;
  total_realized numeric;
  total_unrealized numeric;
  total_fees numeric;
  total_notional numeric;
  used_margin_value numeric;
  open_count integer;
  next_balance numeric;
  next_equity numeric;
  next_peak numeric;
  opening_balance numeric;
  daily_realized numeric;
  position_realized_delta numeric;
  daily_fees numeric;
  daily_loss_value numeric;
  daily_trade_count integer;
  risk_event_type text;
  risk_limit numeric;
  risk_value numeric;
  current_drawdown numeric;
begin
  select * into account_row from public.trading_accounts where id = target_account_id and owner_user_id = target_owner_id for update;
  if not found then return coalesce(new, old); end if;

  select r.rules into current_rule from public.account_rule_assignments assignment
  join public.rule_versions r on r.id = assignment.rule_version_id and r.status = 'active'
  where assignment.account_id = target_account_id and assignment.revoked_at is null
  order by assignment.assigned_at desc limit 1;
  if current_rule is null and account_row.rule_version_id is not null then
    select rules into current_rule from public.rule_versions where id = account_row.rule_version_id and status = 'active';
  end if;
  current_rule := coalesce(current_rule, '{}'::jsonb);

  select coalesce(sum(realized_pnl - fees), 0), coalesce(sum(unrealized_pnl), 0), coalesce(sum(fees), 0),
    coalesce(sum(case when position_status = 'open' then quantity * coalesce(last_price, average_price) else 0 end), 0),
    count(*) filter (where position_status = 'open')::integer
  into total_realized, total_unrealized, total_fees, total_notional, open_count
  from public.positions where account_id = target_account_id and owner_user_id = target_owner_id;

  next_balance := account_row.starting_balance + total_realized;
  next_equity := next_balance + total_unrealized;
  next_peak := greatest(coalesce(account_row.peak_equity, account_row.starting_balance), next_equity);
  current_drawdown := greatest(0, case when current_rule->>'drawdown_model' = 'trailing' then next_peak else account_row.starting_balance end - next_equity);
  used_margin_value := case when nullif(current_rule->>'max_leverage', '')::numeric > 0
    then total_notional / (current_rule->>'max_leverage')::numeric else account_row.used_margin end;
  update public.trading_accounts set current_balance = next_balance, equity = next_equity,
    realized_pnl = total_realized, unrealized_pnl = total_unrealized, peak_equity = next_peak,
    used_margin = used_margin_value,
    available_margin = case when nullif(current_rule->>'max_leverage', '')::numeric > 0 then next_balance - used_margin_value else available_margin end
  where id = target_account_id;

  opening_balance := coalesce((select dp.opening_balance from public.daily_performance dp where dp.account_id = target_account_id and dp.trading_date = (timezone('utc', now()))::date), coalesce(account_row.equity, account_row.current_balance));
  select coalesce(sum(e.fees + e.taxes), 0), count(*)::integer
  into daily_fees, daily_trade_count from public.executions e
  where e.account_id = target_account_id and (e.executed_at at time zone 'UTC')::date = (timezone('utc', now()))::date;
  position_realized_delta := coalesce(new.realized_pnl, 0) - coalesce(old.realized_pnl, 0);
  daily_realized := position_realized_delta;
  daily_loss_value := greatest(0, opening_balance - next_equity);

  insert into public.daily_performance(account_id, owner_user_id, trading_date, realized_pnl, fees, trade_count, opening_balance, closing_balance)
  values (target_account_id, target_owner_id, (timezone('utc', now()))::date, daily_realized, daily_fees, daily_trade_count, opening_balance, next_balance)
  on conflict (account_id, trading_date) do update set realized_pnl = daily_performance.realized_pnl + excluded.realized_pnl,
    fees = excluded.fees, trade_count = excluded.trade_count, closing_balance = excluded.closing_balance;

  insert into public.account_metric_snapshots(account_id, owner_user_id, balance, equity, margin, pnl, drawdown, daily_loss, snapshot_at)
  values (target_account_id, target_owner_id, next_balance, next_equity, used_margin_value, next_equity - opening_balance,
    greatest(0, case when coalesce(current_rule->>'drawdown_model', 'static') = 'trailing' then next_peak else account_row.starting_balance end - next_equity),
    daily_loss_value, timezone('utc', now()));

  if current_rule ? 'daily_loss_limit' and daily_loss_value >= (current_rule->>'daily_loss_limit')::numeric
     and account_row.risk_state not in ('BREACHED', 'LOCKED') then
    risk_event_type := 'daily_loss_breach'; risk_limit := (current_rule->>'daily_loss_limit')::numeric; risk_value := daily_loss_value;
  elsif current_rule ? 'maximum_drawdown' and current_drawdown >= (current_rule->>'maximum_drawdown')::numeric
     and account_row.risk_state not in ('BREACHED', 'LOCKED') then
    risk_event_type := 'max_drawdown_breach'; risk_limit := (current_rule->>'maximum_drawdown')::numeric; risk_value := current_drawdown;
  end if;

  if risk_event_type is not null then
    update public.trading_accounts set risk_state = 'BREACHED' where id = target_account_id;
    insert into public.risk_events(account_id, owner_user_id, event_type, severity, metric_name, metric_value, limit_value, breach_status, breach_reason, metadata)
    values (target_account_id, target_owner_id, risk_event_type, 'critical', risk_event_type, risk_value, risk_limit, 'open', risk_event_type,
      jsonb_build_object('equity', next_equity, 'balance', next_balance, 'drawdown', current_drawdown, 'daily_loss', daily_loss_value));
    if account_row.status = 'active' then
      perform set_config('app.account_lifecycle_transition', 'allowed', true);
      update public.trading_accounts set status = 'breached', is_active = false where id = target_account_id;
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists positions_refresh_canonical_account_metrics on public.positions;
create trigger positions_refresh_canonical_account_metrics
after insert or update or delete on public.positions
for each row execute function public.refresh_account_metrics_from_position();