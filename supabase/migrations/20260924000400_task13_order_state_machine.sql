-- Task 13: customer clients may read orders, but may not mutate lifecycle state directly.
-- Authorized server-side lifecycle paths remain responsible for transitions.

create or replace function public.order_status_transition_allowed(
  current_status text,
  next_status text
)
returns boolean
language sql
immutable
as $$
  select case current_status
    when 'requested' then next_status in ('pending', 'rejected', 'failed')
    when 'pending' then next_status in ('open', 'partially_filled', 'filled', 'cancel_requested', 'cancelled', 'rejected', 'failed')
    when 'open' then next_status in ('partially_filled', 'filled', 'cancel_requested', 'cancelled', 'failed')
    when 'partially_filled' then next_status in ('filled', 'cancel_requested', 'cancelled', 'failed')
    when 'cancel_requested' then next_status in ('cancelled', 'failed')
    else false
  end
$$;

create or replace function public.enforce_order_lifecycle_transition()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if current_setting('app.order_lifecycle_transition', true) <> 'allowed' then
      raise exception 'ORDER_STATUS_MUTATION_REQUIRES_RPC' using errcode = '42501';
    end if;
    if not public.order_status_transition_allowed(old.status, new.status) then
      raise exception 'INVALID_ORDER_TRANSITION' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists orders_lifecycle_guard on public.orders;
create trigger orders_lifecycle_guard
before update of status on public.orders
for each row execute function public.enforce_order_lifecycle_transition();

create or replace function public.transition_order_status(
  requested_order_id uuid,
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
  order_row public.orders%rowtype;
  updated_order public.orders%rowtype;
  transition_at timestamptz := timezone('utc', now());
begin
  if auth.uid() is null then
    raise exception 'ORDER_NOT_AUTHORIZED' using errcode = '42501';
  end if;

  if requested_status not in ('requested', 'pending', 'open', 'partially_filled', 'filled', 'cancel_requested', 'cancelled', 'rejected', 'failed') then
    raise exception 'INVALID_ORDER_STATE' using errcode = '22P02';
  end if;

  -- The row lock makes the database row, not a client snapshot, authoritative.
  select * into order_row
  from public.orders
  where id = requested_order_id
    and account_id = requested_account_id
    and owner_user_id = auth.uid()
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = '42501';
  end if;

  if order_row.status = requested_status then
    raise exception 'INVALID_ORDER_TRANSITION' using errcode = 'P0001';
  end if;
  if order_row.status in ('filled', 'cancelled', 'rejected', 'failed') then
    raise exception 'ORDER_ALREADY_TERMINAL' using errcode = 'P0001';
  end if;
  if not public.order_status_transition_allowed(order_row.status, requested_status) then
    raise exception 'INVALID_ORDER_TRANSITION' using errcode = 'P0001';
  end if;

  perform set_config('app.order_lifecycle_transition', 'allowed', true);
  update public.orders
  set status = requested_status,
      updated_at = transition_at,
      submitted_at = case when requested_status = 'pending' and submitted_at is null then transition_at else submitted_at end,
      cancel_requested_at = case when requested_status = 'cancel_requested' and cancel_requested_at is null then transition_at else cancel_requested_at end,
      cancelled_at = case when requested_status = 'cancelled' and cancelled_at is null then transition_at else cancelled_at end,
      completed_at = case when requested_status in ('filled', 'cancelled', 'rejected', 'failed') and completed_at is null then transition_at else completed_at end
  where id = order_row.id
  returning * into updated_order;

  insert into public.terminal_activity(owner_user_id, account_id, event_type, metadata, occurred_at)
  values (
    updated_order.owner_user_id,
    updated_order.account_id,
    'order_lifecycle_transitioned',
    jsonb_build_object(
      'order_id', updated_order.id,
      'from_status', order_row.status,
      'to_status', updated_order.status,
      'reason', transition_reason,
      'actor_user_id', auth.uid()
    ),
    transition_at
  );

  return jsonb_build_object('order', to_jsonb(updated_order), 'audit_event', 'order_lifecycle_transitioned');
end;
$$;

drop policy if exists orders_owner on public.orders;
drop policy if exists orders_customer_read on public.orders;

create policy orders_customer_read
  on public.orders
  for select
  to authenticated
  using (owner_user_id = auth.uid());

revoke all on function public.order_status_transition_allowed(text, text) from public;
revoke all on function public.enforce_order_lifecycle_transition() from public;
revoke all on function public.transition_order_status(uuid, uuid, text, text) from public, anon;
grant execute on function public.transition_order_status(uuid, uuid, text, text) to authenticated;