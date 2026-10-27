do $$
declare
  instant_product_id uuid;
  funded_phase_id uuid;
  legacy_rule public.rule_versions%rowtype;
  canonical_rule public.rule_versions%rowtype;
  canonical_rules jsonb;
  before_state jsonb;
begin
  select id into instant_product_id
  from public.products
  where code = 'INSTANT';

  select id into funded_phase_id
  from public.account_phases
  where product_id = instant_product_id
    and code = 'FUNDED';

  if instant_product_id is null or funded_phase_id is null then
    return;
  end if;

  select * into legacy_rule
  from public.rule_versions
  where product_id = instant_product_id
    and phase_id = funded_phase_id
    and version = 'v1'
    and status = 'active'
  for update;

  if legacy_rule.id is null
     or legacy_rule.rules->>'plan_name' is distinct from 'INSTANT'
     or legacy_rule.rules->>'max_drawdown_percent' is distinct from '5'
     or legacy_rule.rules->>'daily_drawdown_percent' is distinct from '3'
     or legacy_rule.rules->>'trading_days' is distinct from '7'
     or legacy_rule.rules->'profit_target_percent' is distinct from 'null'::jsonb
     or legacy_rule.rules->'funded_rules' is distinct from 'null'::jsonb then
    return;
  end if;

  canonical_rules := legacy_rule.rules || jsonb_build_object(
    'funded_rules',
    jsonb_build_object(
      'max_drawdown_percent', 5,
      'daily_drawdown_percent', 3,
      'profit_target_percent', 0,
      'max_risk_per_trade_percent', 1,
      'minimum_trading_days', 7
    )
  );

  select * into canonical_rule
  from public.rule_versions
  where product_id = instant_product_id
    and phase_id = funded_phase_id
    and version = 'v2'
  for update;

  if canonical_rule.id is not null then
    if canonical_rule.rules is distinct from canonical_rules then
      raise exception 'Instant funded v2 rule version exists with conflicting configuration';
    end if;

    if canonical_rule.status = 'draft' then
      before_state := to_jsonb(canonical_rule);
      update public.rule_versions
      set status = 'active',
          effective_from = coalesce(effective_from, timezone('utc', now())),
          effective_to = null
      where id = canonical_rule.id
      returning * into canonical_rule;
      insert into public.rule_audit_log(actor_email, action, entity_type, entity_id, before_state, after_state)
      values ('account-linker@fundedwealth.com', 'publish_rule_version', 'rule_version', canonical_rule.id, before_state, to_jsonb(canonical_rule));
    elsif canonical_rule.status <> 'active' then
      raise exception 'Instant funded v2 rule version is not publishable';
    end if;
    return;
  end if;

  insert into public.rule_versions(product_id, phase_id, version, rules, status, created_by, created_by_email)
  values (
    instant_product_id,
    funded_phase_id,
    'v2',
    canonical_rules,
    'draft',
    null,
    'account-linker@fundedwealth.com'
  )
  returning * into canonical_rule;

  insert into public.rule_audit_log(actor_email, action, entity_type, entity_id, after_state)
  values ('account-linker@fundedwealth.com', 'create_rule_version', 'rule_version', canonical_rule.id, to_jsonb(canonical_rule));

  before_state := to_jsonb(canonical_rule);
  update public.rule_versions
  set status = 'active',
      effective_from = coalesce(effective_from, timezone('utc', now())),
      effective_to = null
  where id = canonical_rule.id
  returning * into canonical_rule;

  insert into public.rule_audit_log(actor_email, action, entity_type, entity_id, before_state, after_state)
  values ('account-linker@fundedwealth.com', 'publish_rule_version', 'rule_version', canonical_rule.id, before_state, to_jsonb(canonical_rule));
end;
$$;
