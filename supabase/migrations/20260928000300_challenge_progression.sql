alter table public.trading_accounts
  add column if not exists challenge_completed_at timestamptz;

create or replace function public.evaluate_account_challenge(requested_account_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  account_row public.trading_accounts%rowtype;
  rule_row public.rule_versions%rowtype;
  next_phase public.account_phases%rowtype;
  current_phase public.account_phases%rowtype;
  next_rule public.rule_versions%rowtype;
  rules jsonb;
  current_equity numeric;
  starting_balance numeric;
  peak_equity numeric;
  daily_loss numeric;
  drawdown_base numeric;
  drawdown numeric;
  profit numeric;
  trading_days integer;
  maximum_trading_days integer;
  minimum_trading_days integer;
  consistency_limit numeric;
  best_day_profit numeric;
  consistency_percent numeric;
  reasons text[] := '{}';
  resulting_status text;
  boundary_epsilon numeric := 0.000000001;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  select * into account_row from public.trading_accounts
  where id = requested_account_id and owner_user_id = auth.uid() for update;
  if not found then raise exception 'account not found or not owned by current user' using errcode = '42501'; end if;

  if account_row.status = 'active' and account_row.expires_at is not null and account_row.expires_at <= timezone('utc', now()) then
    perform public.transition_trading_account(account_row.id, 'expired', 'Account expiry reached');
    insert into public.risk_events(account_id, owner_user_id, event_type, severity, metric_name, breach_status, breach_reason, metadata)
    values (account_row.id, auth.uid(), 'account_expired', 'warning', 'expires_at', 'resolved', 'Account expiry reached', jsonb_build_object('expires_at', account_row.expires_at));
    return jsonb_build_object('outcome', 'NOT_ELIGIBLE', 'lifecycle_action', 'TRANSITION_TO_EXPIRED', 'account_status', 'expired', 'reasons', jsonb_build_array('ACCOUNT_EXPIRED'));
  end if;

  select r.* into rule_row from public.account_rule_assignments assignment
  join public.rule_versions r on r.id = assignment.rule_version_id
  where assignment.account_id = account_row.id and assignment.revoked_at is null and r.status = 'active'
  order by assignment.assigned_at desc limit 1;
  if rule_row.id is null and account_row.rule_version_id is not null then
    select * into rule_row from public.rule_versions where id = account_row.rule_version_id and status = 'active';
  end if;
  if rule_row.id is null then raise exception 'no active challenge rule version is assigned' using errcode = 'P0001'; end if;

  rules := coalesce(rule_row.rules, '{}'::jsonb);
  select * into current_phase from public.account_phases where id = account_row.phase_id;
  if current_phase.phase_type = 'funded' then
    return jsonb_build_object('outcome', 'FUNDED', 'lifecycle_action', 'NONE', 'account_status', account_row.status,
      'phase_id', current_phase.id, 'profit', coalesce(account_row.equity, account_row.current_balance) - account_row.starting_balance,
      'reasons', jsonb_build_array('FUNDED_PHASE'));
  end if;
  starting_balance := coalesce(nullif(rules->>'starting_balance', '')::numeric, account_row.starting_balance);
  current_equity := coalesce(account_row.equity, account_row.current_balance);
  peak_equity := greatest(coalesce(account_row.peak_equity, starting_balance), current_equity);
  daily_loss := greatest(0,
    coalesce((select dp.opening_balance from public.daily_performance dp where dp.account_id = account_row.id and dp.owner_user_id = auth.uid() and dp.trading_date = current_date), starting_balance)
    - current_equity);
  trading_days := coalesce((select count(*)::integer from public.daily_performance dp where dp.account_id = account_row.id and dp.owner_user_id = auth.uid() and dp.trade_count > 0), 0);
  minimum_trading_days := coalesce(nullif(rules->>'minimum_trading_days', '')::integer, 0);
  maximum_trading_days := nullif(rules->>'maximum_trading_days', '')::integer;
  consistency_limit := nullif(rules->>'consistency_max_daily_profit_percent', '')::numeric;
  best_day_profit := coalesce((select max(dp.realized_pnl - dp.fees) from public.daily_performance dp where dp.account_id = account_row.id and dp.owner_user_id = auth.uid()), 0);
  drawdown_base := case when coalesce(rules->>'drawdown_model', 'static') = 'trailing' then peak_equity else starting_balance end;
  drawdown := greatest(0, drawdown_base - current_equity);
  profit := current_equity - starting_balance;
  consistency_percent := case when profit > 0 then best_day_profit / profit * 100 else 0 end;

  if account_row.status <> 'active' or account_row.risk_state in ('BREACHED', 'LOCKED') then
    return jsonb_build_object('outcome', 'NOT_ELIGIBLE', 'lifecycle_action', 'NONE', 'account_status', account_row.status,
      'profit', profit, 'drawdown', drawdown, 'daily_loss', daily_loss, 'trading_days', trading_days,
      'reasons', jsonb_build_array(format('Account status is %s', account_row.status)));
  end if;

  if starting_balance is null or starting_balance < 0
     or nullif(rules->>'profit_target', '')::numeric is null or nullif(rules->>'profit_target', '')::numeric < 0
     or nullif(rules->>'maximum_drawdown', '')::numeric is null or nullif(rules->>'maximum_drawdown', '')::numeric < 0
     or nullif(rules->>'daily_loss_limit', '')::numeric is null or nullif(rules->>'daily_loss_limit', '')::numeric < 0
     or minimum_trading_days < 0 or (maximum_trading_days is not null and maximum_trading_days < minimum_trading_days)
     or (consistency_limit is not null and (consistency_limit <= 0 or consistency_limit > 100)) then
    return jsonb_build_object('outcome', 'CONFIGURATION_ERROR', 'lifecycle_action', 'NONE', 'account_status', account_row.status,
      'profit', profit, 'drawdown', drawdown, 'daily_loss', daily_loss, 'trading_days', trading_days,
      'reasons', jsonb_build_array('Invalid challenge rule configuration'));
  end if;

  if daily_loss >= nullif(rules->>'daily_loss_limit', '')::numeric - boundary_epsilon then reasons := array_append(reasons, 'DAILY_LOSS_LIMIT_REACHED'); end if;
  if drawdown >= nullif(rules->>'maximum_drawdown', '')::numeric - boundary_epsilon then reasons := array_append(reasons, 'MAXIMUM_DRAWDOWN_REACHED'); end if;
  if maximum_trading_days is not null and trading_days >= maximum_trading_days
     and (profit < nullif(rules->>'profit_target', '')::numeric - boundary_epsilon
       or (consistency_limit is not null and consistency_percent > consistency_limit + boundary_epsilon)) then
    reasons := array_append(reasons, 'MAXIMUM_TRADING_DAYS_EXCEEDED');
  end if;

  if cardinality(reasons) > 0 then
    update public.trading_accounts set risk_state = 'BREACHED' where id = account_row.id;
    perform public.transition_trading_account(account_row.id, 'breached', array_to_string(reasons, ','));
    resulting_status := 'breached';
    insert into public.risk_events(account_id, owner_user_id, event_type, severity, metric_name, metric_value, limit_value, breach_status, breach_reason, metadata)
    values (account_row.id, auth.uid(), 'challenge_breach', 'critical', array_to_string(reasons, ','),
      greatest(daily_loss, drawdown), null, 'open', array_to_string(reasons, ','),
      jsonb_build_object('profit', profit, 'drawdown', drawdown, 'daily_loss', daily_loss, 'trading_days', trading_days));
    return jsonb_build_object('outcome', 'BREACH', 'lifecycle_action', 'TRANSITION_TO_BREACHED',
      'account_status', resulting_status, 'profit', profit, 'drawdown', drawdown, 'daily_loss', daily_loss,
      'trading_days', trading_days, 'reasons', to_jsonb(reasons));
  end if;

  if profit >= nullif(rules->>'profit_target', '')::numeric - boundary_epsilon and trading_days >= minimum_trading_days then
    if consistency_limit is not null and consistency_percent > consistency_limit + boundary_epsilon then
      reasons := array_append(reasons, 'CONSISTENCY_NOT_MET');
      return jsonb_build_object('outcome', 'IN_PROGRESS', 'lifecycle_action', 'NONE', 'account_status', account_row.status,
        'profit', profit, 'drawdown', drawdown, 'daily_loss', daily_loss, 'trading_days', trading_days,
        'consistency_percent', consistency_percent, 'reasons', to_jsonb(reasons));
    end if;

    select * into next_phase from public.account_phases
    where product_id = account_row.product_id and status = 'active'
      and sequence_no > coalesce((select sequence_no from public.account_phases where id = account_row.phase_id), -1)
    order by sequence_no limit 1;
    if next_phase.id is not null then
      select * into next_rule from public.rule_versions where product_id = account_row.product_id
        and phase_id = next_phase.id and status = 'active'
      order by effective_from desc nulls last, created_at desc limit 1;
      if next_rule.id is null then
        return jsonb_build_object('outcome', 'CONFIGURATION_ERROR', 'lifecycle_action', 'NONE', 'account_status', account_row.status,
          'reasons', jsonb_build_array('Next phase has no active rule version'));
      end if;
      update public.account_rule_assignments set revoked_at = timezone('utc', now())
      where account_id = account_row.id and revoked_at is null;
      insert into public.account_rule_assignments(account_id, rule_version_id, assigned_by)
      values (account_row.id, next_rule.id, auth.uid());
      update public.trading_accounts set phase_id = next_phase.id, rule_version_id = next_rule.id,
        challenge_completed_at = case when next_phase.phase_type = 'funded' then timezone('utc', now()) else challenge_completed_at end
      where id = account_row.id;
      insert into public.risk_events(account_id, owner_user_id, event_type, severity, metric_name, breach_status, breach_reason, metadata)
      values (account_row.id, auth.uid(), case when next_phase.phase_type = 'funded' then 'funded_transition' else 'challenge_pass' end,
        'info', 'phase_progression', 'resolved', 'Challenge conditions passed',
        jsonb_build_object('from_phase_id', account_row.phase_id, 'to_phase_id', next_phase.id, 'rule_version_id', next_rule.id));
      insert into public.terminal_activity(owner_user_id, account_id, event_type, metadata)
      values (account_row.owner_user_id, account_row.id, 'challenge_phase_advanced', jsonb_build_object('from_phase_id', account_row.phase_id, 'to_phase_id', next_phase.id, 'phase_type', next_phase.phase_type));
      return jsonb_build_object('outcome', 'PASS', 'lifecycle_action', case when next_phase.phase_type = 'funded' then 'TRANSITION_TO_FUNDED' else 'ADVANCE_PHASE' end,
        'account_status', account_row.status, 'phase_id', next_phase.id, 'rule_version_id', next_rule.id,
        'profit', profit, 'drawdown', drawdown, 'daily_loss', daily_loss, 'trading_days', trading_days,
        'reasons', jsonb_build_array('PROFIT_TARGET_REACHED', 'MINIMUM_TRADING_DAYS_REACHED'));
    end if;
    return jsonb_build_object('outcome', 'CONFIGURATION_ERROR', 'lifecycle_action', 'NONE', 'account_status', account_row.status,
      'profit', profit, 'drawdown', drawdown, 'daily_loss', daily_loss, 'trading_days', trading_days,
      'reasons', jsonb_build_array('NO_NEXT_CHALLENGE_OR_FUNDED_PHASE_CONFIGURED'));
  end if;

  if profit >= nullif(rules->>'profit_target', '')::numeric - boundary_epsilon then reasons := array_append(reasons, 'MINIMUM_TRADING_DAYS_NOT_REACHED');
  else reasons := array_append(reasons, 'PROFIT_TARGET_NOT_REACHED'); end if;
  return jsonb_build_object('outcome', 'IN_PROGRESS', 'lifecycle_action', 'NONE', 'account_status', account_row.status,
    'profit', profit, 'drawdown', drawdown, 'daily_loss', daily_loss, 'trading_days', trading_days, 'reasons', to_jsonb(reasons));
end;
$$;

revoke all on function public.evaluate_account_challenge(uuid) from public;
grant execute on function public.evaluate_account_challenge(uuid) to authenticated;

create or replace function public.expire_due_trading_accounts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  expired_account public.trading_accounts%rowtype;
  expired_count integer := 0;
begin
  for expired_account in
    select * from public.trading_accounts
    where status = 'active' and expires_at is not null and expires_at <= timezone('utc', now())
    for update skip locked
  loop
    perform set_config('app.account_lifecycle_transition', 'allowed', true);
    update public.trading_accounts set status = 'expired', is_active = false where id = expired_account.id;
    insert into public.risk_events(account_id, owner_user_id, event_type, severity, metric_name, breach_status, breach_reason, metadata)
    values (expired_account.id, expired_account.owner_user_id, 'account_expired', 'warning', 'expires_at', 'resolved',
      'Account expiry reached', jsonb_build_object('expires_at', expired_account.expires_at));
    insert into public.terminal_activity(owner_user_id, account_id, event_type, metadata)
    values (expired_account.owner_user_id, expired_account.id, 'account_lifecycle_transitioned',
      jsonb_build_object('from_status', expired_account.status, 'to_status', 'expired', 'reason', 'Account expiry reached'));
    expired_count := expired_count + 1;
  end loop;
  return expired_count;
end;
$$;

revoke all on function public.expire_due_trading_accounts() from public, anon, authenticated;
grant execute on function public.expire_due_trading_accounts() to service_role;

do $$
declare
  existing_job_id bigint;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    select jobid into existing_job_id from cron.job where jobname = 'expire-fundedwealth-accounts';
    if existing_job_id is not null then perform cron.unschedule(existing_job_id); end if;
    perform cron.schedule('expire-fundedwealth-accounts', '* * * * *', 'select public.expire_due_trading_accounts();');
  end if;
exception when undefined_table or insufficient_privilege or undefined_function then
  raise notice 'pg_cron unavailable; invoke expire_due_trading_accounts from the trusted scheduler';
end;
$$;