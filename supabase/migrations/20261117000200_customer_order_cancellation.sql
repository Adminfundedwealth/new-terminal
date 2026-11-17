begin;

create or replace function public.order_status_transition_allowed(
  current_status text,
  next_status text
)
returns boolean
language sql
immutable
as $$
  select case current_status
    when 'requested' then next_status in ('pending', 'cancelled', 'rejected', 'failed')
    when 'pending' then next_status in ('open', 'partially_filled', 'filled', 'cancel_requested', 'cancelled', 'rejected', 'failed')
    when 'open' then next_status in ('partially_filled', 'filled', 'cancel_requested', 'cancelled', 'failed')
    when 'partially_filled' then next_status in ('filled', 'cancel_requested', 'cancelled', 'failed')
    when 'cancel_requested' then next_status in ('cancelled', 'failed')
    else false
  end
$$;

create or replace function public.cancel_simulated_order(
  requested_order_id uuid,
  requested_account_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  order_row public.orders%rowtype;
  outbox_row public.order_execution_outbox%rowtype;
  transition_at timestamptz := timezone('utc', now());
begin
  if auth.uid() is null then
    raise exception 'ORDER_NOT_AUTHORIZED' using errcode = '42501';
  end if;

  select o.* into outbox_row
  from public.order_execution_outbox o
  join public.orders ord on ord.id = o.order_id
  where o.order_id = requested_order_id
    and o.account_id = requested_account_id
    and ord.owner_user_id = auth.uid()
  for update of o;

  select * into order_row
  from public.orders
  where id = requested_order_id
    and account_id = requested_account_id
    and owner_user_id = auth.uid()
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'ORDER_NOT_FOUND', 'message', 'Order was not found for this account'));
  end if;

  if order_row.status = 'cancelled' then
    return jsonb_build_object('ok', true, 'replayed', true, 'order', to_jsonb(order_row));
  end if;
  if order_row.status not in ('requested', 'pending', 'open', 'partially_filled', 'cancel_requested') then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'ORDER_NOT_CANCELLABLE', 'message', 'Order can no longer be cancelled'));
  end if;

  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('app.order_transition_reason', 'Cancelled by customer', true);
  perform set_config('app.order_transition_source', 'cancel_simulated_order', true);

  update public.orders
  set status = 'cancelled',
      cancellation_reason = 'Cancelled by customer',
      cancel_requested_at = coalesce(cancel_requested_at, transition_at),
      cancelled_at = coalesce(cancelled_at, transition_at),
      completed_at = coalesce(completed_at, transition_at),
      updated_at = transition_at
  where id = order_row.id
  returning * into order_row;

  update public.order_execution_outbox
  set state = 'completed',
      claimed_by = null,
      claimed_until = null,
      completed_at = coalesce(completed_at, transition_at),
      updated_at = transition_at,
      last_error = null
  where order_id = order_row.id
    and state in ('pending', 'processing');

  return jsonb_build_object('ok', true, 'replayed', false, 'order', to_jsonb(order_row));
end;
$$;

revoke all on function public.cancel_simulated_order(uuid, uuid) from public, anon;
grant execute on function public.cancel_simulated_order(uuid, uuid) to authenticated;

commit;
