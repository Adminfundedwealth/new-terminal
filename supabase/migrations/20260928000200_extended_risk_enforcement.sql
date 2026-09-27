-- Extend the existing serialized risk gate; no second evaluator is introduced.
alter function public.evaluate_pre_trade_risk(jsonb) rename to evaluate_pre_trade_risk_locked;
alter function public.evaluate_pre_trade_risk_locked(jsonb) rename to evaluate_pre_trade_risk_serialized_v1;

create or replace function public.evaluate_pre_trade_risk_locked(request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_account_id uuid := nullif(request->>'account_id', '')::uuid;
  account_row public.trading_accounts%rowtype;
  challenge_result jsonb;
  effective_rules jsonb;
  market_timezone text;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(requested_account_id::text, 0));
  select * into account_row from public.trading_accounts
  where id = requested_account_id and owner_user_id = auth.uid();
  if not found then raise exception 'account not found or not owned by current user' using errcode = '42501'; end if;

  begin
    challenge_result := public.evaluate_account_challenge(requested_account_id);
  exception when others then
    challenge_result := jsonb_build_object('outcome', 'CONFIGURATION_ERROR', 'reasons', jsonb_build_array('CHALLENGE_EVALUATION_FAILED'));
  end;
  if challenge_result->>'outcome' = 'CONFIGURATION_ERROR' then
    insert into public.risk_events(account_id, owner_user_id, event_type, severity, metric_name, breach_status, breach_reason, metadata)
    values (account_row.id, auth.uid(), 'challenge_configuration_error', 'critical', 'challenge_rules', 'open',
      'Challenge rules or phase progression are not configured', jsonb_build_object('challenge_result', challenge_result));
    return jsonb_build_object('decision', 'REJECT', 'reason_code', 'RULE_CONFIGURATION_MISSING',
      'reason', 'Challenge rules or phase progression are not configured', 'account_id', account_row.id,
      'rule_evaluated', 'challenge_configuration', 'current_value', challenge_result->'reasons',
      'configured_limit', null, 'risk_state', account_row.risk_state, 'timestamp', timezone('utc', now()));
  end if;

  select r.rules into effective_rules from public.account_rule_assignments assignment
  join public.rule_versions r on r.id = assignment.rule_version_id and r.status = 'active'
  where assignment.account_id = account_row.id and assignment.revoked_at is null
  order by assignment.assigned_at desc limit 1;
  if effective_rules is null then
    select r.rules into effective_rules from public.rule_versions r
    join public.trading_accounts a on a.rule_version_id = r.id
    where a.id = account_row.id and r.status = 'active';
  end if;
  market_timezone := coalesce(nullif(effective_rules->>'trading_hours_timezone', ''), nullif(effective_rules->'trading_hours'->0->>'timezone', ''), 'Asia/Kolkata');
  perform set_config('timezone', market_timezone, true);

  return public.evaluate_pre_trade_risk_unlocked(request);
end;
$$;

revoke all on function public.evaluate_pre_trade_risk_serialized_v1(jsonb) from public, anon, authenticated;
revoke all on function public.evaluate_pre_trade_risk_unlocked(jsonb) from public, anon, authenticated;
revoke all on function public.evaluate_pre_trade_risk_locked(jsonb) from public, anon;
grant execute on function public.evaluate_pre_trade_risk_locked(jsonb) to authenticated;

create or replace function public.evaluate_pre_trade_risk(request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  account_row public.trading_accounts%rowtype;
  rule_row public.rule_versions%rowtype;
  rules jsonb;
  instrument_row public.instruments%rowtype;
  result jsonb;
  requested_quantity numeric := nullif(request->>'quantity', '')::numeric;
  requested_price numeric := coalesce(nullif(request->>'requested_price', '')::numeric, nullif(request->>'price', '')::numeric);
  current_equity numeric;
  projected_notional numeric;
  aggregate_quantity numeric;
  aggregate_lots numeric;
  daily_loss_value numeric;
  reason_code text;
  reason_text text;
  rule_name text;
  current_value numeric;
  configured_limit numeric;
  event_id uuid;
  news_window jsonb;
  now_local timestamp;
  market_timezone text;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  select * into account_row from public.trading_accounts
  where id = nullif(request->>'account_id', '')::uuid and owner_user_id = auth.uid();
  if not found then raise exception 'account not found or not owned by current user' using errcode = '42501'; end if;

  select r.* into rule_row
  from public.account_rule_assignments assignment
  join public.rule_versions r on r.id = assignment.rule_version_id
  where assignment.account_id = account_row.id and assignment.revoked_at is null and r.status = 'active'
  order by assignment.assigned_at desc limit 1;
  if rule_row.id is null and account_row.rule_version_id is not null then
    select * into rule_row from public.rule_versions where id = account_row.rule_version_id and status = 'active';
  end if;
  rules := coalesce(rule_row.rules, '{}'::jsonb);

  market_timezone := coalesce(nullif(rules->>'trading_hours_timezone', ''), nullif(rules->'trading_hours'->0->>'timezone', ''), 'Asia/Kolkata');
  perform set_config('timezone', market_timezone, true);
  result := public.evaluate_pre_trade_risk_locked(request);
  if result->>'decision' <> 'ALLOW' then
    update public.risk_events
    set event_type = case result->>'reason_code'
          when 'RISK_PER_TRADE_EXCEEDED' then 'max_risk_breach'
          when 'QUANTITY_EXCEEDED' then 'position_limit_breach'
          when 'MAX_OPEN_POSITIONS_EXCEEDED' then 'position_limit_breach'
          when 'MAX_DAILY_TRADES_EXCEEDED' then 'trade_limit_rejection'
          when 'DAILY_LOSS_EXCEEDED' then 'daily_loss_breach'
          when 'DRAWDOWN_EXCEEDED' then 'max_drawdown_breach'
          when 'TRADING_SESSION_CLOSED' then 'trading_hours_rejection'
          when 'INSTRUMENT_NOT_ALLOWED' then 'restricted_instrument_rejection'
          else event_type end
    where id = (select id from public.risk_events where account_id = account_row.id
      and owner_user_id = auth.uid() and event_type = 'order_rejected' and metadata->'request' = request
      order by occurred_at desc limit 1);
    return result;
  end if;

  select * into account_row from public.trading_accounts where id = account_row.id and owner_user_id = auth.uid();
  select r.* into rule_row from public.account_rule_assignments assignment
  join public.rule_versions r on r.id = assignment.rule_version_id and r.status = 'active'
  where assignment.account_id = account_row.id and assignment.revoked_at is null
  order by assignment.assigned_at desc limit 1;
  if rule_row.id is null and account_row.rule_version_id is not null then
    select * into rule_row from public.rule_versions where id = account_row.rule_version_id and status = 'active';
  end if;
  rules := coalesce(rule_row.rules, '{}'::jsonb);
  market_timezone := coalesce(nullif(rules->>'trading_hours_timezone', ''), nullif(rules->'trading_hours'->0->>'timezone', ''), 'Asia/Kolkata');
  perform set_config('timezone', market_timezone, true);

  select * into instrument_row from public.instruments
  where is_active and upper(exchange) = upper(coalesce(request->>'exchange', ''))
    and (upper(symbol) = upper(coalesce(request->>'symbol', '')) or upper(trading_symbol) = upper(coalesce(request->>'symbol', '')))
  order by id limit 1;

  current_equity := coalesce(account_row.equity, account_row.current_balance);
  daily_loss_value := greatest(0,
    coalesce((select dp.opening_balance from public.daily_performance dp where dp.account_id = account_row.id
      and dp.owner_user_id = auth.uid() and dp.trading_date = current_date), account_row.starting_balance)
    - current_equity);
  select coalesce(sum(p.quantity), 0) into aggregate_quantity
  from public.positions p
  where p.account_id = account_row.id and p.owner_user_id = auth.uid() and p.position_status = 'open'
    and upper(p.symbol) = upper(coalesce(request->>'symbol', ''));

  if rules ? 'daily_loss_limit' and daily_loss_value >= (rules->>'daily_loss_limit')::numeric then
    reason_code := 'DAILY_LOSS_EXCEEDED'; reason_text := 'Daily loss limit reached';
    rule_name := 'daily_loss_limit'; current_value := daily_loss_value; configured_limit := (rules->>'daily_loss_limit')::numeric;
  elsif rules ? 'max_position_quantity' and aggregate_quantity + requested_quantity > (rules->>'max_position_quantity')::numeric then
    reason_code := 'QUANTITY_EXCEEDED'; reason_text := 'Resulting position exceeds the configured quantity limit';
    rule_name := 'max_position_quantity'; current_value := aggregate_quantity + requested_quantity; configured_limit := (rules->>'max_position_quantity')::numeric;
  elsif rules ? 'max_position_lots' and (instrument_row.lot_size is null or instrument_row.lot_size <= 0) then
    reason_code := 'RULE_CONFIGURATION_MISSING'; reason_text := 'Instrument lot size is unavailable for the configured lot limit';
    rule_name := 'instrument_lot_size';
  elsif rules ? 'max_position_lots' then
    aggregate_lots := (aggregate_quantity + requested_quantity) / instrument_row.lot_size;
    if aggregate_lots > (rules->>'max_position_lots')::numeric then
      reason_code := 'MAX_LOTS_EXCEEDED'; reason_text := 'Resulting position exceeds the configured lot limit';
      rule_name := 'max_position_lots'; current_value := aggregate_lots; configured_limit := (rules->>'max_position_lots')::numeric;
    end if;
  end if;

  if reason_code is null and rules ? 'max_leverage' then
    select coalesce(sum(abs(p.quantity) * coalesce(p.last_price, p.average_price)), 0) into projected_notional
    from public.positions p where p.account_id = account_row.id and p.owner_user_id = auth.uid() and p.position_status = 'open';
    projected_notional := projected_notional + coalesce(requested_price, 0) * requested_quantity;
    if current_equity <= 0 or projected_notional / current_equity > (rules->>'max_leverage')::numeric then
      reason_code := 'LEVERAGE_EXCEEDED'; reason_text := 'Projected account leverage exceeds the configured maximum';
      rule_name := 'max_leverage'; current_value := case when current_equity > 0 then projected_notional / current_equity else null end;
      configured_limit := (rules->>'max_leverage')::numeric;
    end if;
  end if;

  if reason_code is null and rules ? 'weekend_trading_allowed' and not coalesce((rules->>'weekend_trading_allowed')::boolean, false) then
    now_local := timezone(market_timezone, timezone('utc', now()));
    if extract(isodow from now_local) in (6, 7) then
      reason_code := 'WEEKEND_RESTRICTED'; reason_text := 'Weekend trading is not allowed';
      rule_name := 'weekend_trading_allowed'; current_value := extract(isodow from now_local); configured_limit := 5;
    end if;
  end if;

  if reason_code is null and jsonb_typeof(rules->'news_restrictions') = 'array' then
    for news_window in select value from jsonb_array_elements(rules->'news_restrictions') loop
      if nullif(news_window->>'start_at', '') is not null and nullif(news_window->>'end_at', '') is not null
         and timezone('utc', now()) between (news_window->>'start_at')::timestamptz and (news_window->>'end_at')::timestamptz then
        reason_code := 'NEWS_RESTRICTED'; reason_text := 'Trading is restricted during a configured news window';
        rule_name := 'news_restrictions'; exit;
      end if;
    end loop;
  end if;

  if reason_code is null then return result; end if;

  if reason_code in ('DAILY_LOSS_EXCEEDED', 'DRAWDOWN_EXCEEDED') and account_row.status = 'active' then
    update public.trading_accounts set risk_state = 'BREACHED' where id = account_row.id;
    perform public.transition_trading_account(account_row.id, 'breached', reason_text);
  end if;

  update public.risk_events
  set event_type = case reason_code
        when 'RISK_PER_TRADE_EXCEEDED' then 'max_risk_breach'
        when 'MAX_LOTS_EXCEEDED' then 'max_lot_breach'
        when 'QUANTITY_EXCEEDED' then 'position_limit_breach'
        when 'MAX_OPEN_POSITIONS_EXCEEDED' then 'position_limit_breach'
        when 'TRADING_SESSION_CLOSED' then 'trading_hours_rejection'
        when 'INSTRUMENT_NOT_ALLOWED' then 'restricted_instrument_rejection'
        when 'WEEKEND_RESTRICTED' then 'weekend_rejection'
        when 'NEWS_RESTRICTED' then 'news_rejection'
        when 'LEVERAGE_EXCEEDED' then 'leverage_breach'
        else 'order_rejected' end,
      severity = 'warning', metric_name = rule_name,
      metric_value = current_value, limit_value = configured_limit, breach_status = 'open',
      breach_reason = reason_text,
      metadata = jsonb_build_object('request', request, 'decision', jsonb_build_object(
        'decision', 'REJECT', 'reason_code', reason_code, 'reason', reason_text,
        'account_id', account_row.id, 'rule_evaluated', rule_name,
        'current_value', current_value, 'configured_limit', configured_limit
      ))
  where id = (
    select id from public.risk_events
    where account_id = account_row.id and owner_user_id = auth.uid() and event_type = 'order_allowed'
      and metadata->'request' = request
    order by occurred_at desc limit 1
  ) returning id into event_id;

  result := jsonb_build_object(
    'decision', 'REJECT', 'reason_code', reason_code, 'reason', reason_text,
    'account_id', account_row.id, 'rule_evaluated', rule_name,
    'current_value', current_value, 'configured_limit', configured_limit,
    'risk_state', case when reason_code in ('DAILY_LOSS_EXCEEDED', 'DRAWDOWN_EXCEEDED') then 'BREACHED' else account_row.risk_state end,
    'timestamp', timezone('utc', now())
  );
  if event_id is null then
    insert into public.risk_events(account_id, owner_user_id, event_type, severity, metric_name, metric_value, limit_value, breach_status, breach_reason, metadata)
    values (account_row.id, auth.uid(), 'order_rejected', 'warning', rule_name, current_value, configured_limit, 'open', reason_text, jsonb_build_object('request', request, 'decision', result));
  end if;
  return result;
end;
$$;

revoke all on function public.evaluate_pre_trade_risk(jsonb) from public;
grant execute on function public.evaluate_pre_trade_risk(jsonb) to authenticated;