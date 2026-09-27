-- Rule control-plane mutations over the existing canonical tables.
-- Terminal OS calls this with its server-only canonical service credential.

alter table public.account_phases
  add column if not exists phase_type text not null default 'challenge'
    check (phase_type in ('challenge', 'funded'));

alter table public.rule_versions add column if not exists created_by_email text;
create unique index if not exists rule_versions_product_wide_version_uidx
  on public.rule_versions(product_id, version) where phase_id is null;

create table if not exists public.rule_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_email text not null,
  action text not null,
  entity_type text not null check (entity_type in ('product', 'phase', 'rule_version', 'account_assignment')),
  entity_id uuid not null,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz not null default timezone('utc', now())
);
create index if not exists rule_audit_log_entity_time_idx on public.rule_audit_log(entity_type, entity_id, created_at desc);
alter table public.rule_audit_log enable row level security;
revoke all on public.rule_audit_log from public, anon, authenticated;
grant select, insert on public.rule_audit_log to service_role;

create or replace function public.manage_rule_configuration(request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  action_name text := request->>'action';
  product_row public.products%rowtype;
  phase_row public.account_phases%rowtype;
  rule_row public.rule_versions%rowtype;
  account_row public.trading_accounts%rowtype;
  requested_id uuid := nullif(request->>'id', '')::uuid;
  requested_product_id uuid := nullif(request->>'product_id', '')::uuid;
  requested_phase_id uuid := nullif(request->>'phase_id', '')::uuid;
  requested_account_id uuid := nullif(request->>'account_id', '')::uuid;
  actor_email text := lower(trim(request->>'actor_email'));
  before_state jsonb;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'rule management requires the trusted Terminal OS service role' using errcode = '42501';
  end if;
  if actor_email is null or actor_email = '' then raise exception 'audit actor is required' using errcode = '22023'; end if;

  if action_name = 'save_product' then
    if requested_id is null then
      insert into public.products(code, name, description, status)
      values (upper(trim(request->>'code')), trim(request->>'name'), nullif(trim(request->>'description'), ''), coalesce(request->>'status', 'active'))
      on conflict (code) do nothing returning * into product_row;
      if product_row.id is null then
        select * into product_row from public.products where code = upper(trim(request->>'code'));
        if product_row.name is distinct from trim(request->>'name')
           or product_row.description is distinct from nullif(trim(request->>'description'), '')
           or product_row.status is distinct from coalesce(request->>'status', 'active') then
          raise exception 'product code already exists with different configuration' using errcode = '23505';
        end if;
        return jsonb_build_object('product', to_jsonb(product_row), 'replayed', true);
      end if;
    else
      select to_jsonb(p) into before_state from public.products p where id = requested_id for update;
      update public.products
      set code = upper(trim(request->>'code')),
          name = trim(request->>'name'),
          description = nullif(trim(request->>'description'), ''),
          status = coalesce(request->>'status', status)
      where id = requested_id returning * into product_row;
    end if;
    if product_row.id is null then raise exception 'product not found' using errcode = 'P0002'; end if;
    insert into public.rule_audit_log(actor_email, action, entity_type, entity_id, before_state, after_state)
    values (actor_email, action_name, 'product', product_row.id, before_state, to_jsonb(product_row));
    return jsonb_build_object('product', to_jsonb(product_row));
  elsif action_name = 'save_phase' then
    if requested_id is null then
      insert into public.account_phases(product_id, code, name, sequence_no, phase_type, status)
      values (requested_product_id, upper(trim(request->>'code')), trim(request->>'name'), coalesce((request->>'sequence_no')::integer, 0), coalesce(request->>'phase_type', 'challenge'), coalesce(request->>'status', 'active'))
      on conflict (product_id, code) do nothing returning * into phase_row;
      if phase_row.id is null then
        select * into phase_row from public.account_phases where product_id = requested_product_id and code = upper(trim(request->>'code'));
        if phase_row.name is distinct from trim(request->>'name')
           or phase_row.sequence_no is distinct from coalesce((request->>'sequence_no')::integer, 0)
           or phase_row.phase_type is distinct from coalesce(request->>'phase_type', 'challenge')
           or phase_row.status is distinct from coalesce(request->>'status', 'active') then
          raise exception 'phase code already exists with different configuration' using errcode = '23505';
        end if;
        return jsonb_build_object('phase', to_jsonb(phase_row), 'replayed', true);
      end if;
    else
      select to_jsonb(p) into before_state from public.account_phases p where id = requested_id for update;
      update public.account_phases
      set product_id = requested_product_id,
          code = upper(trim(request->>'code')),
          name = trim(request->>'name'),
          sequence_no = coalesce((request->>'sequence_no')::integer, sequence_no),
          phase_type = coalesce(request->>'phase_type', phase_type),
          status = coalesce(request->>'status', status)
      where id = requested_id returning * into phase_row;
    end if;
    if phase_row.id is null then raise exception 'phase not found' using errcode = 'P0002'; end if;
    insert into public.rule_audit_log(actor_email, action, entity_type, entity_id, before_state, after_state)
    values (actor_email, action_name, 'phase', phase_row.id, before_state, to_jsonb(phase_row));
    return jsonb_build_object('phase', to_jsonb(phase_row));
  elsif action_name = 'create_rule_version' then
    if jsonb_typeof(request->'rules') <> 'object' then
      raise exception 'rules must be a JSON object' using errcode = '22023';
    end if;
    insert into public.rule_versions(product_id, phase_id, version, rules, status, created_by, created_by_email)
    values (requested_product_id, requested_phase_id, trim(request->>'version'), request->'rules', 'draft', null, actor_email)
    on conflict do nothing returning * into rule_row;
    if rule_row.id is null then
      select * into rule_row from public.rule_versions where product_id = requested_product_id
        and phase_id is not distinct from requested_phase_id and version = trim(request->>'version');
      if rule_row.status = 'draft' and rule_row.rules = request->'rules' then
        return jsonb_build_object('rule_version', to_jsonb(rule_row), 'replayed', true);
      end if;
      raise exception 'rule version already exists with different or immutable configuration' using errcode = '23505';
    end if;
    insert into public.rule_audit_log(actor_email, action, entity_type, entity_id, after_state)
    values (actor_email, action_name, 'rule_version', rule_row.id, to_jsonb(rule_row));
    return jsonb_build_object('rule_version', to_jsonb(rule_row));
  elsif action_name = 'publish_rule_version' then
    perform pg_advisory_xact_lock(hashtextextended(requested_id::text, 0));
    select to_jsonb(r) into before_state from public.rule_versions r where id = requested_id for update;
    if before_state->>'status' = 'active' then
      select * into rule_row from public.rule_versions where id = requested_id;
      return jsonb_build_object('rule_version', to_jsonb(rule_row), 'replayed', true);
    end if;
    update public.rule_versions
    set status = 'active', effective_from = coalesce(effective_from, timezone('utc', now())), effective_to = null
    where id = requested_id and status = 'draft'
    returning * into rule_row;
    if rule_row.id is null then raise exception 'only a draft rule version can be published' using errcode = 'P0001'; end if;
    insert into public.rule_audit_log(actor_email, action, entity_type, entity_id, before_state, after_state)
    values (actor_email, action_name, 'rule_version', rule_row.id, before_state, to_jsonb(rule_row));
    return jsonb_build_object('rule_version', to_jsonb(rule_row));
  elsif action_name = 'unpublish_rule_version' then
    perform pg_advisory_xact_lock(hashtextextended(requested_id::text, 0));
    select to_jsonb(r) into before_state from public.rule_versions r where id = requested_id for update;
    if before_state->>'status' = 'retired' then
      select * into rule_row from public.rule_versions where id = requested_id;
      return jsonb_build_object('rule_version', to_jsonb(rule_row), 'replayed', true);
    end if;
    if exists (select 1 from public.account_rule_assignments where rule_version_id = requested_id and revoked_at is null)
       or exists (select 1 from public.trading_accounts where rule_version_id = requested_id and status = 'active') then
      raise exception 'rule version is assigned to an active account; publish a successor and reassign first' using errcode = 'P0001';
    end if;
    update public.rule_versions set status = 'retired', effective_to = timezone('utc', now())
    where id = requested_id and status = 'active'
    returning * into rule_row;
    if rule_row.id is null then raise exception 'active rule version not found' using errcode = 'P0002'; end if;
    insert into public.rule_audit_log(actor_email, action, entity_type, entity_id, before_state, after_state)
    values (actor_email, action_name, 'rule_version', rule_row.id, before_state, to_jsonb(rule_row));
    return jsonb_build_object('rule_version', to_jsonb(rule_row));
  elsif action_name = 'apply_rule_version' then
    select * into account_row from public.trading_accounts where id = requested_account_id for update;
    if not found then raise exception 'account not found' using errcode = 'P0002'; end if;
    before_state := to_jsonb(account_row);
    select * into rule_row from public.rule_versions where id = requested_id and status = 'active' for share;
    if not found then raise exception 'rule version is not active' using errcode = 'P0001'; end if;
    if account_row.product_id is distinct from rule_row.product_id
       or (rule_row.phase_id is not null and account_row.phase_id is distinct from rule_row.phase_id) then
      raise exception 'rule version does not match account product and phase' using errcode = '23514';
    end if;
    if account_row.rule_version_id = rule_row.id and exists (
      select 1 from public.account_rule_assignments where account_id = account_row.id
        and rule_version_id = rule_row.id and revoked_at is null
    ) then
      return jsonb_build_object('account', to_jsonb(account_row), 'rule_version', to_jsonb(rule_row), 'replayed', true);
    end if;
    update public.account_rule_assignments set revoked_at = timezone('utc', now())
    where account_id = account_row.id and revoked_at is null;
    insert into public.account_rule_assignments(account_id, rule_version_id)
    values (account_row.id, rule_row.id);
    update public.trading_accounts
    set rule_version_id = rule_row.id,
        phase_id = coalesce(rule_row.phase_id, phase_id)
    where id = account_row.id
    returning * into account_row;
    insert into public.rule_audit_log(actor_email, action, entity_type, entity_id, before_state, after_state)
    values (actor_email, action_name, 'account_assignment', account_row.id, before_state,
      jsonb_build_object('account', to_jsonb(account_row), 'rule_version', to_jsonb(rule_row)));
    return jsonb_build_object('account', to_jsonb(account_row), 'rule_version', to_jsonb(rule_row));
  end if;

  raise exception 'unsupported rule-management action' using errcode = '22023';
end;
$$;

revoke all on function public.manage_rule_configuration(jsonb) from public, anon, authenticated;
grant execute on function public.manage_rule_configuration(jsonb) to service_role;