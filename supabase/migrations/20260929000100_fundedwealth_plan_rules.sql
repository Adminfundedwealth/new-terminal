-- Seed the real FundedWealth plan catalog and versioned rule payloads into the canonical schema.
-- These values come from the actual plan screens and are versioned as active rule versions.

do $$
declare
  flash_product_id uuid;
  instant_product_id uuid;
  step_one_product_id uuid;
  step_two_product_id uuid;
  flash_challenge_phase_id uuid;
  flash_funded_phase_id uuid;
  instant_challenge_phase_id uuid;
  instant_funded_phase_id uuid;
  step_one_challenge_phase_id uuid;
  step_one_funded_phase_id uuid;
  step_two_challenge_phase_id uuid;
  step_two_funded_phase_id uuid;
begin
  insert into public.products(code, name, description, status)
  values
    ('FLASH', 'Flash', 'Flash evaluation plan', 'active'),
    ('INSTANT', 'Instant', 'Instant challenge plan', 'active'),
    ('1-STEP', '1-Step Evaluation', '1-step challenge and funded plan', 'active'),
    ('2-STEP', '2-Step Evaluation', '2-step challenge and funded plan', 'active')
  on conflict (code) do update
    set name = excluded.name,
        description = excluded.description,
        status = excluded.status;

  select id into flash_product_id from public.products where code = 'FLASH';
  select id into instant_product_id from public.products where code = 'INSTANT';
  select id into step_one_product_id from public.products where code = '1-STEP';
  select id into step_two_product_id from public.products where code = '2-STEP';

  -- FLASH challenge + funded phases.
  select id into flash_challenge_phase_id from public.account_phases where product_id = flash_product_id and code = 'CHALLENGE';
  if flash_challenge_phase_id is null then
    insert into public.account_phases(product_id, code, name, sequence_no, phase_type, status)
    values (flash_product_id, 'CHALLENGE', 'Challenge', 0, 'challenge', 'active')
    returning id into flash_challenge_phase_id;
  end if;

  select id into flash_funded_phase_id from public.account_phases where product_id = flash_product_id and code = 'FUNDED';
  if flash_funded_phase_id is null then
    insert into public.account_phases(product_id, code, name, sequence_no, phase_type, status)
    values (flash_product_id, 'FUNDED', 'Funded', 1, 'funded', 'active')
    returning id into flash_funded_phase_id;
  end if;

  -- INSTANT challenge + funded phases.
  select id into instant_challenge_phase_id from public.account_phases where product_id = instant_product_id and code = 'CHALLENGE';
  if instant_challenge_phase_id is null then
    insert into public.account_phases(product_id, code, name, sequence_no, phase_type, status)
    values (instant_product_id, 'CHALLENGE', 'Challenge', 0, 'challenge', 'active')
    returning id into instant_challenge_phase_id;
  end if;

  select id into instant_funded_phase_id from public.account_phases where product_id = instant_product_id and code = 'FUNDED';
  if instant_funded_phase_id is null then
    insert into public.account_phases(product_id, code, name, sequence_no, phase_type, status)
    values (instant_product_id, 'FUNDED', 'Funded', 1, 'funded', 'active')
    returning id into instant_funded_phase_id;
  end if;

  -- 1-STEP challenge + funded phases.
  select id into step_one_challenge_phase_id from public.account_phases where product_id = step_one_product_id and code = 'CHALLENGE';
  if step_one_challenge_phase_id is null then
    insert into public.account_phases(product_id, code, name, sequence_no, phase_type, status)
    values (step_one_product_id, 'CHALLENGE', 'Challenge', 0, 'challenge', 'active')
    returning id into step_one_challenge_phase_id;
  end if;

  select id into step_one_funded_phase_id from public.account_phases where product_id = step_one_product_id and code = 'FUNDED';
  if step_one_funded_phase_id is null then
    insert into public.account_phases(product_id, code, name, sequence_no, phase_type, status)
    values (step_one_product_id, 'FUNDED', 'Funded', 1, 'funded', 'active')
    returning id into step_one_funded_phase_id;
  end if;

  -- 2-STEP challenge + funded phases.
  select id into step_two_challenge_phase_id from public.account_phases where product_id = step_two_product_id and code = 'CHALLENGE';
  if step_two_challenge_phase_id is null then
    insert into public.account_phases(product_id, code, name, sequence_no, phase_type, status)
    values (step_two_product_id, 'CHALLENGE', 'Challenge', 0, 'challenge', 'active')
    returning id into step_two_challenge_phase_id;
  end if;

  select id into step_two_funded_phase_id from public.account_phases where product_id = step_two_product_id and code = 'FUNDED';
  if step_two_funded_phase_id is null then
    insert into public.account_phases(product_id, code, name, sequence_no, phase_type, status)
    values (step_two_product_id, 'FUNDED', 'Funded', 1, 'funded', 'active')
    returning id into step_two_funded_phase_id;
  end if;

  insert into public.rule_versions(product_id, phase_id, version, rules, status, created_by_email)
  values
    (
      flash_product_id,
      flash_challenge_phase_id,
      'v1',
      jsonb_build_object(
        'plan_name', 'FLASH',
        'duration_hours', 24,
        'max_loss_per_trade_percent', 2,
        'max_drawdown_percent', 4,
        'profit_split_percent', 80,
        'consistency_requirement_percent', 15,
        'payout_threshold_percent', 3,
        'account_size', null,
        'price', null,
        'trading_days', null,
        'leverage_ratio', null,
        'evaluation_rules', null,
        'funded_rules', null
      ),
      'active',
      'system@fundedwealth.local'
    ),
    (
      flash_product_id,
      flash_funded_phase_id,
      'v1',
      jsonb_build_object(
        'plan_name', 'FLASH',
        'duration_hours', 24,
        'max_loss_per_trade_percent', 2,
        'max_drawdown_percent', 4,
        'profit_split_percent', 80,
        'consistency_requirement_percent', 15,
        'payout_threshold_percent', 3,
        'account_size', null,
        'price', null,
        'trading_days', null,
        'leverage_ratio', null,
        'evaluation_rules', null,
        'funded_rules', null
      ),
      'active',
      'system@fundedwealth.local'
    ),
    (
      instant_product_id,
      instant_challenge_phase_id,
      'v1',
      jsonb_build_object(
        'plan_name', 'INSTANT',
        'daily_drawdown_percent', 3,
        'max_drawdown_percent', 5,
        'profit_split_percent_min', 70,
        'profit_split_percent_max', 80,
        'trading_days', 7,
        'consistency_requirement_percent', 15,
        'leverage_ratio', 50,
        'profit_target_percent', null,
        'max_loss_per_trade_percent', null,
        'payout_threshold_percent', null,
        'evaluation_rules', null,
        'funded_rules', null
      ),
      'active',
      'system@fundedwealth.local'
    ),
    (
      instant_product_id,
      instant_funded_phase_id,
      'v1',
      jsonb_build_object(
        'plan_name', 'INSTANT',
        'daily_drawdown_percent', 3,
        'max_drawdown_percent', 5,
        'profit_split_percent_min', 70,
        'profit_split_percent_max', 80,
        'trading_days', 7,
        'consistency_requirement_percent', 15,
        'leverage_ratio', 50,
        'profit_target_percent', null,
        'max_loss_per_trade_percent', null,
        'payout_threshold_percent', null,
        'evaluation_rules', null,
        'funded_rules', null
      ),
      'active',
      'system@fundedwealth.local'
    ),
    (
      step_one_product_id,
      step_one_challenge_phase_id,
      'v1',
      jsonb_build_object(
        'plan_name', '1-STEP',
        'evaluation_rules', jsonb_build_object(
          'max_drawdown_percent', 6,
          'daily_drawdown_percent', 3,
          'profit_target_percent', 10,
          'max_risk_per_trade_percent', 1.5,
          'minimum_trading_days', 5,
          'min_trading_days', 5,
          'profit_split_percent_min', null,
          'profit_split_percent_max', null,
          'consistency_requirement_percent', null,
          'leverage_ratio', 30
        ),
        'funded_rules', jsonb_build_object(
          'max_drawdown_percent', 6,
          'daily_drawdown_percent', 3,
          'consistency_requirement_percent', 40,
          'minimum_trading_days', 3,
          'min_trading_days', 3,
          'profit_split_percent_min', 80,
          'profit_split_percent_max', 90,
          'leverage_ratio', 30,
          'profit_target_percent', null,
          'max_risk_per_trade_percent', 1.5,
          'payout_threshold_percent', null,
          'time_limit', null
        ),
        'duration_hours', null,
        'profit_split_percent', null,
        'consistency_requirement_percent', null,
        'payout_threshold_percent', null,
        'max_loss_per_trade_percent', null,
        'daily_drawdown_percent', null,
        'max_drawdown_percent', null,
        'trading_days', null,
        'leverage_ratio', 30,
        'max_risk_per_trade_percent', 1.5
      ),
      'active',
      'system@fundedwealth.local'
    ),
    (
      step_one_product_id,
      step_one_funded_phase_id,
      'v1',
      jsonb_build_object(
        'plan_name', '1-STEP',
        'evaluation_rules', jsonb_build_object(
          'max_drawdown_percent', 6,
          'daily_drawdown_percent', 3,
          'profit_target_percent', 10,
          'max_risk_per_trade_percent', 1.5,
          'minimum_trading_days', 5,
          'min_trading_days', 5,
          'profit_split_percent_min', null,
          'profit_split_percent_max', null,
          'consistency_requirement_percent', null,
          'leverage_ratio', 30
        ),
        'funded_rules', jsonb_build_object(
          'max_drawdown_percent', 6,
          'daily_drawdown_percent', 3,
          'consistency_requirement_percent', 40,
          'minimum_trading_days', 3,
          'min_trading_days', 3,
          'profit_split_percent_min', 80,
          'profit_split_percent_max', 90,
          'leverage_ratio', 30,
          'profit_target_percent', null,
          'max_risk_per_trade_percent', 1.5,
          'payout_threshold_percent', null,
          'time_limit', null
        ),
        'duration_hours', null,
        'profit_split_percent', null,
        'consistency_requirement_percent', null,
        'payout_threshold_percent', null,
        'max_loss_per_trade_percent', null,
        'daily_drawdown_percent', null,
        'max_drawdown_percent', null,
        'trading_days', null,
        'leverage_ratio', 30,
        'max_risk_per_trade_percent', 1.5
      ),
      'active',
      'system@fundedwealth.local'
    ),
    (
      step_two_product_id,
      step_two_challenge_phase_id,
      'v1',
      jsonb_build_object(
        'plan_name', '2-STEP',
        'evaluation_rules', jsonb_build_object(
          'max_drawdown_percent', 8,
          'daily_drawdown_percent', 3,
          'profit_target_percent', 8,
          'max_risk_per_trade_percent', 1.5,
          'minimum_trading_days', 5,
          'min_trading_days', 5,
          'consistency_requirement_percent', null,
          'profit_split_percent_min', null,
          'profit_split_percent_max', null,
          'leverage_ratio', 30,
          'time_limit', null
        ),
        'funded_rules', jsonb_build_object(
          'max_drawdown_percent', 6,
          'daily_drawdown_percent', 3,
          'consistency_requirement_percent', 40,
          'minimum_trading_days', 3,
          'min_trading_days', 3,
          'profit_split_percent_min', 80,
          'profit_split_percent_max', 90,
          'max_risk_per_trade_percent', 1.5,
          'leverage_ratio', 30,
          'time_limit', null,
          'profit_target_percent', null,
          'payout_threshold_percent', null
        ),
        'duration_hours', null,
        'profit_split_percent', null,
        'consistency_requirement_percent', 40,
        'payout_threshold_percent', null,
        'max_loss_per_trade_percent', null,
        'daily_drawdown_percent', null,
        'max_drawdown_percent', null,
        'trading_days', null,
        'leverage_ratio', 30,
        'max_risk_per_trade_percent', 1.5
      ),
      'active',
      'system@fundedwealth.local'
    ),
    (
      step_two_product_id,
      step_two_funded_phase_id,
      'v1',
      jsonb_build_object(
        'plan_name', '2-STEP',
        'evaluation_rules', jsonb_build_object(
          'max_drawdown_percent', 8,
          'daily_drawdown_percent', 3,
          'profit_target_percent', 8,
          'max_risk_per_trade_percent', 1.5,
          'minimum_trading_days', 5,
          'min_trading_days', 5,
          'consistency_requirement_percent', null,
          'profit_split_percent_min', null,
          'profit_split_percent_max', null,
          'leverage_ratio', 30,
          'time_limit', null
        ),
        'funded_rules', jsonb_build_object(
          'max_drawdown_percent', 6,
          'daily_drawdown_percent', 3,
          'consistency_requirement_percent', 40,
          'minimum_trading_days', 3,
          'min_trading_days', 3,
          'profit_split_percent_min', 80,
          'profit_split_percent_max', 90,
          'max_risk_per_trade_percent', 1.5,
          'leverage_ratio', 30,
          'time_limit', null,
          'profit_target_percent', null,
          'payout_threshold_percent', null
        ),
        'duration_hours', null,
        'profit_split_percent', null,
        'consistency_requirement_percent', 40,
        'payout_threshold_percent', null,
        'max_loss_per_trade_percent', null,
        'daily_drawdown_percent', null,
        'max_drawdown_percent', null,
        'trading_days', null,
        'leverage_ratio', 30,
        'max_risk_per_trade_percent', 1.5
      ),
      'active',
      'system@fundedwealth.local'
    )
  on conflict (product_id, phase_id, version) do update
    set rules = excluded.rules,
        status = excluded.status,
        created_by_email = excluded.created_by_email;
end;
$$;
