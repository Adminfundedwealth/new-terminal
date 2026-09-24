-- Authoritative trading-account lifecycle.
-- Status changes are accepted only through transition_trading_account().

create or replace function public.account_status_transition_allowed(current_status text, next_status text)
returns boolean
language sql
immutable
as $$
  select case current_status
    when 'inactive' then next_status in ('active', 'closed')
    when 'active' then next_status in ('suspended', 'breached', 'expired', 'closed')
    when 'suspended' then next_status in ('active', 'closed')
    when 'breached' then next_status = 'closed'
    when 'expired' then next_status = 'closed'
    when 'closed' then false
    else false
  end
$$;

create or replace function public.enforce_account_lifecycle()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if current_setting('app.account_lifecycle_transition', true) <> 'allowed' then
      raise exception 'account status changes must use transition_trading_account' using errcode = '42501';
    end if;

    if not public.account_status_transition_allowed(old.status, new.status) then
      raise exception 'invalid account status transition: % -> %', old.status, new.status using errcode = 'P0001';
    end if;
  end if;

  if new.status = 'active' and not new.is_active then
    raise exception 'active accounts must have is_active=true' using errcode = '23514';
  elsif new.status <> 'active' and new.is_active then
    raise exception 'non-active accounts must have is_active=false' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists trading_accounts_lifecycle_guard on public.trading_accounts;
create trigger trading_accounts_lifecycle_guard
before insert or update of status, is_active on public.trading_accounts
for each row execute function public.enforce_account_lifecycle();

create or replace function public.transition_trading_account(
  requested_account_id uuid,
  requested_status text,
  transition_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  account_row public.trading_accounts%rowtype;
  updated_account public.trading_accounts%rowtype;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if requested_status not in ('active', 'inactive', 'suspended', 'expired', 'breached', 'closed') then
    raise exception 'unsupported account status: %', requested_status using errcode = '22P02';
  end if;

  -- FOR UPDATE serializes competing transitions and makes the current state authoritative.
  select * into account_row
  from public.trading_accounts
  where id = requested_account_id and owner_user_id = auth.uid()
  for update;

  if not found then
    raise exception 'account not found or not owned by current user' using errcode = '42501';
  end if;

  if account_row.status = requested_status then
    raise exception 'account is already in status %', requested_status using errcode = 'P0001';
  end if;

  if not public.account_status_transition_allowed(account_row.status, requested_status) then
    raise exception 'invalid account status transition: % -> %', account_row.status, requested_status using errcode = 'P0001';
  end if;

  perform set_config('app.account_lifecycle_transition', 'allowed', true);
  update public.trading_accounts
  set status = requested_status,
      is_active = requested_status = 'active'
  where id = account_row.id
  returning * into updated_account;

  insert into public.terminal_activity(owner_user_id, account_id, event_type, metadata)
  values (
    updated_account.owner_user_id,
    updated_account.id,
    'account_lifecycle_transitioned',
    jsonb_build_object(
      'from_status', account_row.status,
      'to_status', updated_account.status,
      'reason', transition_reason
    )
  );

  return jsonb_build_object('account', to_jsonb(updated_account));
end;
$$;

revoke all on function public.account_status_transition_allowed(text, text) from public;
revoke all on function public.transition_trading_account(uuid, text, text) from public;
grant execute on function public.transition_trading_account(uuid, text, text) to authenticated;

-- Account rows are readable by their owner, but lifecycle mutation is backend/RPC-only.
drop policy if exists trading_accounts_owner on public.trading_accounts;
create policy trading_accounts_owner_read on public.trading_accounts
for select to authenticated using (owner_user_id = auth.uid());