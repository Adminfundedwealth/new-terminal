-- Authoritative challenge/rules evaluation over the existing canonical tables.
-- This evaluates current database state and only uses the existing lifecycle RPC
-- for a breach. The canonical lifecycle has no pass/completed status.

create or replace function public.evaluate_account_challenge(requested_account_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  account_row public.trading_accounts%rowtype;
  rule_row public.rule_versions%rowtype;
  rules jsonb;
  current_equity numeric;
  starting_balance numeric;
  peak_equity numeric;
  daily_loss numeric;
  drawdown_base numeric;
  drawdown numeric;
  profit numeric;
  trading_days integer;
  minimum_trading_days integer := 0;
  reasons text[] := '{}';
  result jsonb;
  resulting_status text;
  boundary_epsilon numeric := 0.000000001;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select * into account_row
  from public.trading_accounts
  where id = requested_account_id and owner_user_id = auth.uid()
  for update;
  if not found then
    raise exception 'account not found or not owned by current user' using errcode = '42501';
  end if;

  select r.* into rule_row
  from public.account_rule_assignments assignment
  join public.rule_versions r on r.id = assignment.rule_version_id
  where assignment.account_id = account_row.id
    and assignment.revoked_at is null
    and r.status = 'active'
  order by assignment.assigned_at desc
  limit 1;
  if rule_row.id is null and account_row.rule_version_id is not null then
    select * into rule_row
    from public.rule_versions
    where id = account_row.rule_version_id and status = 'active';
  end if;
  if rule_row.id is null then
    raise exception 'no active challenge rule version is assigned' using errcode = 'P0001';
  end if;

  rules := coalesce(rule_row.rules, '{}'::jsonb);
  starting_balance := coalesce(nullif(rules->>'starting_balance', '')::numeric, account_row.starting_balance);
  current_equity := coalesce(account_row.equity, account_row.current_balance);
  peak_equity := coalesce(account_row.peak_equity, starting_balance);
  daily_loss := greatest(
    0,
    coalesce((select dp.opening_balance from public.daily_performance dp where dp.account_id = account_row.id and dp.owner_user_id = auth.uid() and dp.trading_date = current_date), starting_balance)
      - current_equity
      + coalesce((select dp.fees from public.daily_performance dp where dp.account_id = account_row.id and dp.owner_user_id = auth.uid() and dp.trading_date = current_date), 0)
  );
  trading_days := coalesce((select count(*)::integer from public.daily_performance dp where dp.account_id = account_row.id and dp.owner_user_id = auth.uid() and dp.trade_count > 0), 0);
  minimum_trading_days := coalesce(nullif(rules->>'minimum_trading_days', '')::integer, 0);
  drawdown_base := case when coalesce(rules->>'drawdown_model', 'static') = 'trailing' then peak_equity else starting_balance end;
  drawdown := greatest(0, drawdown_base - current_equity);
  profit := current_equity - starting_balance;

  if account_row.status <> 'active' or account_row.risk_state in ('BREACHED', 'LOCKED') then
    return jsonb_build_object(
      'outcome', 'NOT_ELIGIBLE', 'lifecycle_action', 'NONE', 'account_status', account_row.status,
      'profit', profit, 'drawdown', drawdown, 'daily_loss', daily_loss, 'trading_days', trading_days,
      'reasons', jsonb_build_array(format('Account status is %s', account_row.status))
    );
  end if;

  if starting_balance is null or starting_balance < 0
     or nullif(rules->>'profit_target', '')::numeric is null or nullif(rules->>'profit_target', '')::numeric < 0
     or nullif(rules->>'maximum_drawdown', '')::numeric is null or nullif(rules->>'maximum_drawdown', '')::numeric < 0
    or nullif(rules->>'daily_loss_limit', '')::numeric is null or nullif(rules->>'daily_loss_limit', '')::numeric < 0
    or minimum_trading_days < 0 then
    return jsonb_build_object(
      'outcome', 'CONFIGURATION_ERROR', 'lifecycle_action', 'NONE', 'account_status', account_row.status,
      'profit', profit, 'drawdown', drawdown, 'daily_loss', daily_loss, 'trading_days', trading_days,
      'reasons', jsonb_build_array('Invalid challenge rule configuration')
    );
  end if;

  if daily_loss >= nullif(rules->>'daily_loss_limit', '')::numeric - boundary_epsilon then reasons := array_append(reasons, 'DAILY_LOSS_LIMIT_REACHED'); end if;
  if drawdown >= nullif(rules->>'maximum_drawdown', '')::numeric - boundary_epsilon then reasons := array_append(reasons, 'MAXIMUM_DRAWDOWN_REACHED'); end if;

  if cardinality(reasons) > 0 then
    perform public.transition_trading_account(account_row.id, 'breached', array_to_string(reasons, ','));
    select status into resulting_status from public.trading_accounts where id = account_row.id;
    result := jsonb_build_object(
      'outcome', 'BREACH', 'lifecycle_action', 'TRANSITION_TO_BREACHED', 'account_status', resulting_status,
      'profit', profit, 'drawdown', drawdown, 'daily_loss', daily_loss, 'trading_days', trading_days,
      'reasons', to_jsonb(reasons)
    );
    return result;
  end if;

  if profit >= nullif(rules->>'profit_target', '')::numeric - boundary_epsilon and trading_days >= minimum_trading_days then
    reasons := array_append(reasons, 'PROFIT_TARGET_REACHED');
    if minimum_trading_days > 0 then reasons := array_append(reasons, 'MINIMUM_TRADING_DAYS_REACHED'); end if;
    return jsonb_build_object(
      'outcome', 'PASS', 'lifecycle_action', 'NONE', 'account_status', account_row.status,
      'profit', profit, 'drawdown', drawdown, 'daily_loss', daily_loss, 'trading_days', trading_days,
      'reasons', to_jsonb(reasons)
    );
  end if;

  if profit >= nullif(rules->>'profit_target', '')::numeric - boundary_epsilon then reasons := array_append(reasons, 'MINIMUM_TRADING_DAYS_NOT_REACHED'); else reasons := array_append(reasons, 'PROFIT_TARGET_NOT_REACHED'); end if;
  return jsonb_build_object(
    'outcome', 'IN_PROGRESS', 'lifecycle_action', 'NONE', 'account_status', account_row.status,
    'profit', profit, 'drawdown', drawdown, 'daily_loss', daily_loss, 'trading_days', trading_days,
    'reasons', to_jsonb(reasons)
  );
end;
$$;

revoke all on function public.evaluate_account_challenge(uuid) from public;
grant execute on function public.evaluate_account_challenge(uuid) to authenticated;