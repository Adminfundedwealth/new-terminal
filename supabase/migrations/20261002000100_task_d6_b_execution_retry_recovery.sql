begin;

alter table public.execution_submissions
  add column if not exists retry_count integer not null default 0 check (retry_count >= 0),
  add column if not exists last_lookup_not_found_at timestamptz;

create or replace function public.claim_next_order_execution_outbox(worker_name text, lease_seconds integer default 60)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_row public.order_execution_outbox%rowtype;
  recovery_only_value boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'D4_WORKER_REQUIRES_SERVICE_ROLE' using errcode = '42501';
  end if;
  if nullif(trim(worker_name), '') is null or lease_seconds < 1 or lease_seconds > 3600 then
    raise exception 'INVALID_WORKER_LEASE' using errcode = '22023';
  end if;

  with candidate as (
    select o.id
    from public.order_execution_outbox o
    where (o.state = 'pending' and o.available_at <= timezone('utc', now()))
       or (o.state = 'processing' and (o.claimed_until is null or o.claimed_until <= timezone('utc', now())))
    order by o.available_at, o.created_at
    limit 1
    for update skip locked
  )
  update public.order_execution_outbox o
  set state = 'processing',
      claimed_by = worker_name,
      claimed_until = timezone('utc', now()) + make_interval(secs => lease_seconds),
      attempt_count = o.attempt_count + 1,
      updated_at = timezone('utc', now())
  from candidate c
  where o.id = c.id
  returning o.* into claimed_row;

  if not found then return jsonb_build_object('claimed', false, 'reason', 'no_pending_work'); end if;
  select exists (
    select 1 from public.execution_submissions s
    where s.outbox_id = claimed_row.id and s.submission_state in ('started', 'acknowledged')
  ) into recovery_only_value;
  return jsonb_build_object(
    'claimed', true,
    'recovery_only', recovery_only_value,
    'outbox', to_jsonb(claimed_row),
    'worker', worker_name
  );
end;
$$;

create or replace function public.authorize_order_execution_retry(
  outbox_id_value uuid,
  worker_name text,
  max_attempts integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row_outbox public.order_execution_outbox%rowtype;
  row_submission public.execution_submissions%rowtype;
  now_value timestamptz := timezone('utc', now());
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'D6_RETRY_REQUIRES_SERVICE_ROLE' using errcode = '42501';
  end if;
  if nullif(trim(worker_name), '') is null or max_attempts < 1 or max_attempts > 10 then
    raise exception 'INVALID_RETRY_POLICY' using errcode = '22023';
  end if;

  select * into row_outbox
  from public.order_execution_outbox
  where id = outbox_id_value
  for update;
  if not found or row_outbox.state <> 'processing'
     or row_outbox.claimed_by is distinct from worker_name
     or row_outbox.claimed_until <= now_value then
    return jsonb_build_object('ok', false, 'should_dispatch', false, 'reason', 'claim_not_owned');
  end if;

  select * into row_submission
  from public.execution_submissions
  where outbox_id = outbox_id_value
  for update;
  if not found or row_submission.provider_name <> 'mock-safe'
     or row_submission.submission_state <> 'started' then
    return jsonb_build_object('ok', false, 'should_dispatch', false, 'reason', 'submission_not_recoverable');
  end if;
  if row_submission.retry_count + 1 >= max_attempts then
    return jsonb_build_object('ok', false, 'should_dispatch', false, 'reason', 'retry_budget_exhausted');
  end if;

  update public.execution_submissions
  set retry_count = retry_count + 1,
      last_lookup_not_found_at = now_value,
      started_at = now_value,
      updated_at = now_value
  where outbox_id = outbox_id_value;
  update public.order_execution_outbox
  set submitted_at = now_value,
      claimed_until = now_value + interval '60 seconds',
      updated_at = now_value
  where id = outbox_id_value;
  insert into public.execution_audit_log (
    order_id, account_id, client_order_id, event_type, provider_name, event_key, event_payload
  ) values (
    row_outbox.order_id, row_outbox.account_id, row_outbox.client_order_id,
    'safe_retry_authorized', 'mock-safe', row_outbox.id::text || ':' || (row_submission.retry_count + 1)::text,
    jsonb_build_object('retry_count', row_submission.retry_count + 1, 'lookup', 'not_found')
  ) on conflict do nothing;

  return jsonb_build_object(
    'ok', true,
    'should_dispatch', true,
    'retry_count', row_submission.retry_count + 1
  );
end;
$$;

create or replace function public.mark_order_execution_failed(
  outbox_id_value uuid,
  worker_name text,
  reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row_outbox public.order_execution_outbox%rowtype;
  now_value timestamptz := timezone('utc', now());
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'D6_FAILURE_REQUIRES_SERVICE_ROLE' using errcode = '42501';
  end if;
  select * into row_outbox
  from public.order_execution_outbox
  where id = outbox_id_value
  for update;
  if not found then raise exception 'OUTBOX_NOT_FOUND' using errcode = 'P0002'; end if;
  if row_outbox.claimed_by is distinct from worker_name or row_outbox.state <> 'processing' then
    raise exception 'D6_WORKER_CLAIM_NOT_OWNED' using errcode = '42501';
  end if;

  update public.execution_submissions
  set submission_state = 'failed', updated_at = now_value
  where outbox_id = outbox_id_value and submission_state = 'started';
  update public.order_execution_outbox
  set state = 'failed', last_error = 'Synthetic execution failed after a definitive outcome.',
      completed_at = now_value, updated_at = now_value
  where id = outbox_id_value;

  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('app.order_lifecycle_transition', 'allowed', true);
  update public.orders
  set status = 'failed', updated_at = now_value
  where id = row_outbox.order_id and account_id = row_outbox.account_id
    and status in ('requested', 'pending', 'open', 'partially_filled');
  insert into public.execution_audit_log (
    order_id, account_id, client_order_id, event_type, provider_name, event_key, event_payload
  ) values (
    row_outbox.order_id, row_outbox.account_id, row_outbox.client_order_id,
    'execution_failed', coalesce(row_outbox.provider_name, 'mock-safe'), row_outbox.id::text,
    jsonb_build_object('reason', 'Synthetic execution failed after a definitive outcome.')
  ) on conflict do nothing;

  return jsonb_build_object('ok', true, 'state', 'failed');
end;
$$;

revoke all on function public.authorize_order_execution_retry(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.mark_order_execution_failed(uuid, text, text) from public, anon, authenticated;
grant execute on function public.authorize_order_execution_retry(uuid, text, integer) to service_role;
grant execute on function public.mark_order_execution_failed(uuid, text, text) to service_role;

commit;