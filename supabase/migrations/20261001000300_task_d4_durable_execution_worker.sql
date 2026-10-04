-- Task D4: provider-safe durable worker execution with atomic outbox claim,
-- submission markers, ack/fill persistence, and audit/recovery hooks.

begin;

alter table public.order_execution_outbox
  add column if not exists claimed_by text,
  add column if not exists claimed_until timestamptz,
  add column if not exists provider_name text,
  add column if not exists provider_order_id text,
  add column if not exists submitted_at timestamptz,
  add column if not exists acknowledged_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists last_error text;

create table if not exists public.execution_submissions (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid not null unique references public.order_execution_outbox(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  account_id uuid not null,
  client_order_id text not null,
  provider_name text not null default 'mock-safe',
  provider_request jsonb not null default '{}'::jsonb,
  provider_response jsonb,
  submission_state text not null default 'queued'
    check (submission_state in ('queued', 'started', 'acknowledged', 'filled', 'rejected', 'failed')),
  started_at timestamptz,
  acknowledged_at timestamptz,
  filled_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.execution_audit_log (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  account_id uuid not null,
  client_order_id text not null,
  event_type text not null,
  provider_name text not null default 'mock-safe',
  event_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create or replace function public.claim_next_order_execution_outbox(worker_name text, lease_seconds integer default 60)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_row public.order_execution_outbox%rowtype;
  lease_window interval := make_interval(secs => coalesce(lease_seconds, 60));
begin
  if worker_name is null or trim(worker_name) = '' then
    raise exception 'WORKER_NAME_REQUIRED' using errcode = '22023';
  end if;

  update public.order_execution_outbox o
  set state = 'processing',
      claimed_by = worker_name,
      claimed_until = timezone('utc', now()) + lease_window,
      attempt_count = coalesce(o.attempt_count, 0) + 1,
      updated_at = timezone('utc', now())
  from (
    select oe.id
    from public.order_execution_outbox oe
    where oe.state in ('pending', 'processing')
      and (oe.state <> 'processing' or oe.claimed_until is null or oe.claimed_until <= timezone('utc', now()))
    order by oe.available_at asc, oe.created_at asc
    limit 1
    for update skip locked
  ) candidate
  where o.id = candidate.id
  returning o.* into claimed_row;

  if not found then
    return jsonb_build_object('claimed', false, 'reason', 'no_pending_work');
  end if;

  return jsonb_build_object(
    'claimed', true,
    'outbox', to_jsonb(claimed_row),
    'worker', worker_name,
    'lease_until', claimed_row.claimed_until
  );
end;
$$;

grant execute on function public.claim_next_order_execution_outbox(text, integer) to service_role;

create or replace function public.mark_order_submission_started(
  outbox_id_value uuid,
  worker_name text,
  provider_name_value text,
  provider_request jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row_outbox public.order_execution_outbox%rowtype;
  row_submission public.execution_submissions%rowtype;
  started_at_value timestamptz := timezone('utc', now());
begin
  select * into row_outbox
  from public.order_execution_outbox
  where id = outbox_id_value
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'outbox_not_found');
  end if;

  insert into public.execution_submissions (
    outbox_id, order_id, account_id, client_order_id, provider_name, provider_request,
    submission_state, started_at, created_at, updated_at
  )
  values (
    row_outbox.id,
    row_outbox.order_id,
    row_outbox.account_id,
    row_outbox.client_order_id,
    coalesce(provider_name_value, 'mock-safe'),
    coalesce(provider_request, '{}'::jsonb),
    'started',
    started_at_value,
    started_at_value,
    started_at_value
  )
  on conflict (outbox_id) do update
    set provider_name = excluded.provider_name,
        provider_request = excluded.provider_request,
        submission_state = 'started',
        started_at = coalesce(public.execution_submissions.started_at, excluded.started_at),
        updated_at = started_at_value;

  update public.order_execution_outbox
  set state = 'processing',
      provider_name = coalesce(provider_name_value, provider_name),
      submitted_at = started_at_value,
      updated_at = started_at_value,
      claimed_by = coalesce(claimed_by, worker_name)
  where id = row_outbox.id;

  select * into row_submission
  from public.execution_submissions
  where outbox_id = outbox_id_value;

  return jsonb_build_object(
    'ok', true,
    'submission', to_jsonb(row_submission),
    'outbox_id', row_outbox.id,
    'order_id', row_outbox.order_id,
    'started_at', started_at_value
  );
end;
$$;

grant execute on function public.mark_order_submission_started(uuid, text, text, jsonb) to service_role;

create or replace function public.record_provider_ack(
  outbox_id_value uuid,
  provider_order_id_value text,
  provider_response jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row_outbox public.order_execution_outbox%rowtype;
  row_submission public.execution_submissions%rowtype;
  acked_at_value timestamptz := timezone('utc', now());
begin
  select * into row_outbox
  from public.order_execution_outbox
  where id = outbox_id_value
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'outbox_not_found');
  end if;

  update public.order_execution_outbox
  set state = 'completed',
      provider_order_id = coalesce(provider_order_id_value, provider_order_id),
      acknowledged_at = acked_at_value,
      completed_at = acked_at_value,
      updated_at = acked_at_value,
      last_error = null
  where id = row_outbox.id;

  update public.execution_submissions
  set submission_state = 'acknowledged',
      provider_response = coalesce(provider_response, provider_response),
      acknowledged_at = acked_at_value,
      updated_at = acked_at_value
  where outbox_id = row_outbox.id;

  insert into public.execution_audit_log (order_id, account_id, client_order_id, event_type, provider_name, event_payload)
  values (
    row_outbox.order_id,
    row_outbox.account_id,
    row_outbox.client_order_id,
    'provider_ack',
    coalesce(row_outbox.provider_name, 'mock-safe'),
    coalesce(provider_response, jsonb_build_object('provider_order_id', provider_order_id_value, 'state', 'ACK'))
  );

  select * into row_submission
  from public.execution_submissions
  where outbox_id = outbox_id_value;

  return jsonb_build_object(
    'ok', true,
    'submission', to_jsonb(row_submission),
    'provider_order_id', provider_order_id_value,
    'acknowledged_at', acked_at_value
  );
end;
$$;

grant execute on function public.record_provider_ack(uuid, text, jsonb) to service_role;

create or replace function public.record_execution_fill(
  outbox_id_value uuid,
  fill_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row_outbox public.order_execution_outbox%rowtype;
  row_submission public.execution_submissions%rowtype;
  fill_time timestamptz := timezone('utc', now());
begin
  select * into row_outbox
  from public.order_execution_outbox
  where id = outbox_id_value
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'outbox_not_found');
  end if;

  update public.order_execution_outbox
  set state = 'completed',
      completed_at = fill_time,
      acknowledged_at = coalesce(acknowledged_at, fill_time),
      updated_at = fill_time
  where id = row_outbox.id;

  update public.execution_submissions
  set submission_state = 'filled',
      provider_response = coalesce(provider_response, fill_payload),
      filled_at = fill_time,
      updated_at = fill_time
  where outbox_id = row_outbox.id;

  insert into public.execution_audit_log (order_id, account_id, client_order_id, event_type, provider_name, event_payload)
  values (
    row_outbox.order_id,
    row_outbox.account_id,
    row_outbox.client_order_id,
    'execution_fill',
    coalesce(row_outbox.provider_name, 'mock-safe'),
    coalesce(fill_payload, jsonb_build_object('type', 'fill'))
  );

  select * into row_submission
  from public.execution_submissions
  where outbox_id = outbox_id_value;

  return jsonb_build_object(
    'ok', true,
    'submission', to_jsonb(row_submission),
    'filled_at', fill_time,
    'fill_payload', coalesce(fill_payload, '{}'::jsonb)
  );
end;
$$;

grant execute on function public.record_execution_fill(uuid, jsonb) to service_role;

-- The canonical project may already have the D2 outbox but not the later
-- position/accounting columns. Additive columns keep existing customer rows intact.
alter table public.order_execution_outbox
  add column if not exists claimed_by text,
  add column if not exists claimed_until timestamptz,
  add column if not exists provider_name text,
  add column if not exists provider_order_id text,
  add column if not exists submitted_at timestamptz,
  add column if not exists acknowledged_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists last_error text;

alter table public.positions
  add column if not exists fees numeric(20, 8) not null default 0,
  add column if not exists total_pnl numeric(20, 8),
  add column if not exists valuation_status text not null default 'UNAVAILABLE',
  add column if not exists last_valued_at timestamptz;

create unique index if not exists positions_account_instrument_or_symbol_uidx
  on public.positions (account_id, coalesce(instrument_id, '00000000-0000-0000-0000-000000000000'::uuid), symbol);
create unique index if not exists executions_account_external_normalized_uidx
  on public.executions (account_id, lower(trim(external_execution_id)))
  where external_execution_id is not null and trim(external_execution_id) <> '';

alter table public.execution_audit_log add column if not exists event_key text;
create unique index if not exists execution_audit_log_event_key_uidx
  on public.execution_audit_log (order_id, event_type, event_key)
  where event_key is not null;

alter table public.order_execution_outbox enable row level security;
alter table public.execution_submissions enable row level security;
alter table public.execution_audit_log enable row level security;
revoke all on public.order_execution_outbox, public.execution_submissions, public.execution_audit_log from public, anon, authenticated;
grant select, insert, update on public.order_execution_outbox, public.execution_submissions, public.execution_audit_log to service_role;

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

  if not found then
    return jsonb_build_object('claimed', false, 'reason', 'no_pending_work');
  end if;

  select exists (
    select 1 from public.execution_submissions s
    where s.outbox_id = claimed_row.id and s.submission_state = 'started'
  ) into recovery_only_value;

  return jsonb_build_object(
    'claimed', true,
    'recovery_only', recovery_only_value,
    'outbox', to_jsonb(claimed_row),
    'worker', worker_name
  );
end;
$$;

create or replace function public.mark_order_submission_started(
  outbox_id_value uuid,
  worker_name text,
  provider_name_value text,
  provider_request jsonb
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
    raise exception 'D4_WORKER_REQUIRES_SERVICE_ROLE' using errcode = '42501';
  end if;
  if provider_name_value is distinct from 'mock-safe' then
    raise exception 'D4_PROVIDER_MUST_BE_MOCK_SAFE' using errcode = '42501';
  end if;

  select * into row_outbox from public.order_execution_outbox where id = outbox_id_value for update;
  if not found or row_outbox.state <> 'processing' or row_outbox.claimed_by is distinct from worker_name
     or row_outbox.claimed_until <= now_value then
    return jsonb_build_object('ok', false, 'should_dispatch', false, 'reason', 'claim_not_owned');
  end if;

  select * into row_submission from public.execution_submissions where outbox_id = outbox_id_value for update;
  if found then
    return jsonb_build_object(
      'ok', true,
      'should_dispatch', false,
      'recovery_only', true,
      'submission', to_jsonb(row_submission)
    );
  end if;

  insert into public.execution_submissions (
    outbox_id, order_id, account_id, client_order_id, provider_name,
    provider_request, submission_state, started_at, created_at, updated_at
  ) values (
    row_outbox.id, row_outbox.order_id, row_outbox.account_id,
    row_outbox.client_order_id, 'mock-safe', coalesce(provider_request, '{}'::jsonb),
    'started', now_value, now_value, now_value
  ) returning * into row_submission;

  update public.order_execution_outbox
  set provider_name = 'mock-safe', submitted_at = now_value, updated_at = now_value
  where id = outbox_id_value;

  insert into public.execution_audit_log (
    order_id, account_id, client_order_id, event_type, provider_name, event_key, event_payload
  ) values (
    row_outbox.order_id, row_outbox.account_id, row_outbox.client_order_id,
    'submission_started', 'mock-safe', row_outbox.id::text,
    jsonb_build_object('worker', worker_name, 'started_at', now_value)
  ) on conflict do nothing;

  return jsonb_build_object('ok', true, 'should_dispatch', true, 'submission', to_jsonb(row_submission));
end;
$$;

create or replace function public.get_order_execution_recovery(outbox_id_value uuid, worker_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row_outbox public.order_execution_outbox%rowtype;
  row_submission public.execution_submissions%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'D4_WORKER_REQUIRES_SERVICE_ROLE' using errcode = '42501';
  end if;
  select * into row_outbox from public.order_execution_outbox where id = outbox_id_value;
  select * into row_submission from public.execution_submissions where outbox_id = outbox_id_value;
  if not found or row_outbox.claimed_by is distinct from worker_name
     or row_submission.submission_state not in ('started', 'acknowledged') then
    return jsonb_build_object('ok', false, 'reason', 'recovery_not_available');
  end if;
  return jsonb_build_object(
    'ok', true,
    'lookup_only', true,
    'provider_name', row_submission.provider_name,
    'client_order_id', row_submission.client_order_id,
    'provider_order_id', row_outbox.provider_order_id,
    'submission_state', row_submission.submission_state,
    'provider_response', row_submission.provider_response
  );
end;
$$;

create or replace function public.record_provider_ack(
  outbox_id_value uuid,
  provider_order_id_value text,
  provider_response jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row_outbox public.order_execution_outbox%rowtype;
  row_submission public.execution_submissions%rowtype;
  row_order public.orders%rowtype;
  now_value timestamptz := timezone('utc', now());
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'D4_WORKER_REQUIRES_SERVICE_ROLE' using errcode = '42501';
  end if;
  if nullif(trim(provider_order_id_value), '') is null then
    raise exception 'PROVIDER_ORDER_ID_REQUIRED' using errcode = '22023';
  end if;

  select * into row_outbox from public.order_execution_outbox where id = outbox_id_value for update;
  if not found then raise exception 'OUTBOX_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into row_submission from public.execution_submissions where outbox_id = outbox_id_value for update;
  if not found or row_submission.provider_name <> 'mock-safe' then
    raise exception 'SUBMISSION_MARKER_REQUIRED' using errcode = 'P0001';
  end if;
  if row_submission.submission_state in ('acknowledged', 'filled') then
    if row_outbox.provider_order_id is distinct from provider_order_id_value then
      raise exception 'PROVIDER_ACK_CONFLICT' using errcode = '23505';
    end if;
    return jsonb_build_object('ok', true, 'replayed', true, 'provider_order_id', provider_order_id_value);
  end if;
  if row_submission.submission_state <> 'started' then
    raise exception 'INVALID_SUBMISSION_STATE' using errcode = 'P0001';
  end if;

  select * into row_order from public.orders
  where id = row_outbox.order_id and account_id = row_outbox.account_id for update;
  if not found then raise exception 'ORDER_ACCOUNT_MISMATCH' using errcode = '42501'; end if;

  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('app.order_lifecycle_transition', 'allowed', true);
  if row_order.status = 'requested' then
    update public.orders set status = 'pending', external_order_id = provider_order_id_value,
      submitted_at = coalesce(submitted_at, now_value), updated_at = now_value
    where id = row_order.id;
  else
    update public.orders set external_order_id = coalesce(external_order_id, provider_order_id_value),
      submitted_at = coalesce(submitted_at, now_value), updated_at = now_value
    where id = row_order.id;
  end if;

  update public.execution_submissions set submission_state = 'acknowledged',
    provider_response = coalesce(record_provider_ack.provider_response, execution_submissions.provider_response),
    acknowledged_at = now_value, updated_at = now_value
  where outbox_id = outbox_id_value;
  update public.order_execution_outbox set provider_order_id = provider_order_id_value,
    acknowledged_at = now_value, updated_at = now_value, last_error = null
  where id = outbox_id_value;
  insert into public.execution_audit_log (
    order_id, account_id, client_order_id, event_type, provider_name, event_key, event_payload
  ) values (
    row_outbox.order_id, row_outbox.account_id, row_outbox.client_order_id,
    'provider_ack', 'mock-safe', provider_order_id_value, coalesce(provider_response, '{}'::jsonb)
  ) on conflict do nothing;
  return jsonb_build_object('ok', true, 'replayed', false, 'provider_order_id', provider_order_id_value);
end;
$$;

create or replace function public.record_execution_fill(outbox_id_value uuid, fill_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row_outbox public.order_execution_outbox%rowtype;
  row_submission public.execution_submissions%rowtype;
  row_order public.orders%rowtype;
  row_account public.trading_accounts%rowtype;
  row_position public.positions%rowtype;
  prior_execution public.executions%rowtype;
  execution_row public.executions%rowtype;
  execution_id_value text;
  account_id_value uuid;
  order_id_value uuid;
  symbol_value text;
  side_value text;
  quantity_value numeric;
  price_value numeric;
  fees_value numeric := 0;
  taxes_value numeric := 0;
  executed_at_value timestamptz;
  incoming_position_side text;
  next_quantity numeric;
  next_average numeric;
  next_realized numeric;
  next_fees numeric;
  close_quantity numeric;
  remaining_quantity numeric;
  open_quantity numeric;
  realized_delta numeric := 0;
  next_side text;
  sign_value numeric;
  all_realized numeric;
  all_unrealized numeric;
  next_balance numeric;
  next_equity numeric;
  now_value timestamptz := timezone('utc', now());
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'D4_WORKER_REQUIRES_SERVICE_ROLE' using errcode = '42501';
  end if;
  select * into row_outbox from public.order_execution_outbox where id = outbox_id_value for update;
  if not found then raise exception 'OUTBOX_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into row_submission from public.execution_submissions where outbox_id = outbox_id_value for update;
  if not found or row_submission.provider_name <> 'mock-safe' then
    raise exception 'SUBMISSION_MARKER_REQUIRED' using errcode = 'P0001';
  end if;

  account_id_value := coalesce(nullif(fill_payload->>'accountId',''), nullif(fill_payload->>'account_id',''))::uuid;
  order_id_value := coalesce(nullif(fill_payload->>'localOrderId',''), nullif(fill_payload->>'order_id',''), row_outbox.order_id::text)::uuid;
  execution_id_value := upper(nullif(trim(coalesce(fill_payload->>'brokerExecutionId', fill_payload->>'external_execution_id')), ''));
  symbol_value := upper(nullif(trim(fill_payload->>'symbol'), ''));
  side_value := lower(nullif(trim(fill_payload->>'side'), ''));
  quantity_value := nullif(coalesce(fill_payload->>'quantity', fill_payload->>'filled_quantity'), '')::numeric;
  price_value := nullif(coalesce(fill_payload->>'price', fill_payload->>'execution_price'), '')::numeric;
  fees_value := coalesce(nullif(fill_payload->>'fees','')::numeric, 0);
  taxes_value := coalesce(nullif(fill_payload->>'taxes','')::numeric, 0);
  executed_at_value := coalesce(nullif(coalesce(fill_payload->>'executedAt', fill_payload->>'executed_at'), '')::timestamptz, now_value);

  if account_id_value is distinct from row_outbox.account_id or order_id_value is distinct from row_outbox.order_id then
    raise exception 'FILL_ACCOUNT_OR_ORDER_MISMATCH' using errcode = '42501';
  end if;
  if execution_id_value is null or symbol_value is null or side_value not in ('buy','sell')
     or quantity_value is null or quantity_value <= 0 or price_value is null or price_value <= 0
     or fees_value < 0 or taxes_value < 0 then
    raise exception 'INVALID_FILL_PAYLOAD' using errcode = '22023';
  end if;

  select * into row_order from public.orders
  where id = row_outbox.order_id and account_id = row_outbox.account_id for update;
  if not found then raise exception 'ORDER_ACCOUNT_MISMATCH' using errcode = '42501'; end if;
  select * into row_account from public.trading_accounts
  where id = row_order.account_id and owner_user_id = row_order.owner_user_id for update;
  if not found then raise exception 'ACCOUNT_OWNER_MISMATCH' using errcode = '42501'; end if;
  if upper(row_order.symbol) <> symbol_value or row_order.side <> side_value then
    raise exception 'FILL_INSTRUMENT_OR_SIDE_MISMATCH' using errcode = '22023';
  end if;

  select * into prior_execution from public.executions
  where account_id = row_order.account_id and lower(trim(external_execution_id)) = lower(execution_id_value);
  if found then
    if prior_execution.order_id <> row_order.id or prior_execution.owner_user_id <> row_order.owner_user_id
       or prior_execution.quantity <> quantity_value or prior_execution.execution_price <> price_value
       or prior_execution.executed_at <> executed_at_value then
      raise exception 'FILL_IDEMPOTENCY_CONFLICT' using errcode = '23505';
    end if;
    return jsonb_build_object('ok', true, 'replayed', true, 'execution', to_jsonb(prior_execution));
  end if;
  if row_submission.submission_state not in ('started', 'acknowledged') then
    raise exception 'SUBMISSION_MARKER_REQUIRED' using errcode = 'P0001';
  end if;
  if row_order.status in ('filled','cancelled','rejected','failed')
     or row_order.filled_quantity + quantity_value > row_order.quantity then
    raise exception 'ORDER_NOT_FILLABLE' using errcode = 'P0001';
  end if;

  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('app.order_lifecycle_transition', 'allowed', true);
  if row_order.status = 'requested' then
    update public.orders set status = 'pending', submitted_at = coalesce(submitted_at, now_value), updated_at = now_value
    where id = row_order.id;
  end if;

  insert into public.executions (
    account_id, owner_user_id, order_id, external_execution_id, instrument_id,
    symbol, side, quantity, execution_price, fees, taxes, executed_at
  ) values (
    row_order.account_id, row_order.owner_user_id, row_order.id, execution_id_value,
    row_order.instrument_id, symbol_value, side_value, quantity_value, price_value,
    fees_value, taxes_value, executed_at_value
  ) returning * into execution_row;

  next_quantity := row_order.filled_quantity + quantity_value;
  update public.orders set filled_quantity = next_quantity,
    average_fill_price = ((coalesce(average_fill_price, 0) * row_order.filled_quantity) + (price_value * quantity_value)) / next_quantity,
    status = case when next_quantity = quantity then 'filled' else 'partially_filled' end,
    completed_at = case when next_quantity = quantity then executed_at_value else completed_at end,
    updated_at = greatest(updated_at, executed_at_value)
  where id = row_order.id;

  incoming_position_side := case when side_value = 'buy' then 'long' else 'short' end;
  sign_value := case when incoming_position_side = 'long' then 1 else -1 end;
  if row_order.instrument_id is not null then
    select * into row_position from public.positions
    where account_id = row_order.account_id and instrument_id = row_order.instrument_id
    order by id limit 1 for update;
  else
    select * into row_position from public.positions
    where account_id = row_order.account_id and symbol = symbol_value and instrument_id is null
    order by id limit 1 for update;
  end if;

  if not found or row_position.position_status = 'closed' or row_position.quantity <= 0 then
    insert into public.positions (
      account_id, owner_user_id, instrument_id, symbol, exchange, quantity, side,
      average_price, last_price, unrealized_pnl, realized_pnl, fees, total_pnl,
      valuation_status, last_valued_at, position_status, opened_at, updated_at
    ) values (
      row_order.account_id, row_order.owner_user_id, row_order.instrument_id, symbol_value,
      row_order.exchange, quantity_value, incoming_position_side, price_value, price_value,
      0, 0, fees_value + taxes_value, -(fees_value + taxes_value), 'VALUED', executed_at_value,
      'open', executed_at_value, executed_at_value
    );
  elsif row_position.side = incoming_position_side then
    next_quantity := row_position.quantity + quantity_value;
    next_average := ((row_position.quantity * row_position.average_price) + (quantity_value * price_value)) / next_quantity;
    next_fees := row_position.fees + fees_value + taxes_value;
    update public.positions set quantity = next_quantity, average_price = next_average,
      last_price = price_value,
      unrealized_pnl = (price_value - next_average) * next_quantity * sign_value,
      fees = next_fees, total_pnl = realized_pnl + ((price_value - next_average) * next_quantity * sign_value) - next_fees,
      valuation_status = 'VALUED', last_valued_at = executed_at_value, updated_at = executed_at_value
    where id = row_position.id;
  else
    close_quantity := least(row_position.quantity, quantity_value);
    realized_delta := (price_value - row_position.average_price) * close_quantity
      * case when row_position.side = 'long' then 1 else -1 end;
    remaining_quantity := row_position.quantity - close_quantity;
    open_quantity := quantity_value - close_quantity;
    next_realized := row_position.realized_pnl + realized_delta;
    next_fees := row_position.fees + fees_value + taxes_value;
    if remaining_quantity > 0 then
      next_side := row_position.side; next_average := row_position.average_price; open_quantity := remaining_quantity;
    elsif open_quantity > 0 then
      next_side := incoming_position_side; next_average := price_value;
    else
      next_side := row_position.side; next_average := row_position.average_price;
    end if;
    update public.positions set quantity = open_quantity, side = next_side, average_price = next_average,
      last_price = price_value, realized_pnl = next_realized, fees = next_fees,
      unrealized_pnl = case when open_quantity = 0 then 0 else (price_value - next_average) * open_quantity * case when next_side = 'long' then 1 else -1 end end,
      total_pnl = next_realized + case when open_quantity = 0 then 0 else (price_value - next_average) * open_quantity * case when next_side = 'long' then 1 else -1 end end - next_fees,
      position_status = case when open_quantity = 0 then 'closed' else 'open' end,
      closed_at = case when open_quantity = 0 then executed_at_value else null end,
      valuation_status = 'VALUED', last_valued_at = executed_at_value, updated_at = executed_at_value
    where id = row_position.id;
  end if;

  select coalesce(sum(realized_pnl - fees),0), coalesce(sum(unrealized_pnl),0)
  into all_realized, all_unrealized from public.positions
  where account_id = row_order.account_id and owner_user_id = row_order.owner_user_id;
  next_balance := row_account.starting_balance + all_realized;
  next_equity := next_balance + all_unrealized;
  update public.trading_accounts set current_balance = next_balance,
    equity = next_equity,
    realized_pnl = all_realized, unrealized_pnl = all_unrealized,
    peak_equity = greatest(coalesce(peak_equity, starting_balance), next_equity)
  where id = row_order.account_id and owner_user_id = row_order.owner_user_id;
  insert into public.account_metric_snapshots (
    account_id, owner_user_id, balance, equity, margin, pnl, drawdown, daily_loss, snapshot_at
  ) values (
    row_order.account_id, row_order.owner_user_id, next_balance, next_equity,
    row_account.used_margin, all_realized + all_unrealized,
    greatest(0, row_account.starting_balance - next_equity),
    greatest(0, row_account.starting_balance - next_equity), now_value
  );

  update public.execution_submissions set submission_state = 'filled',
    provider_response = coalesce(public.execution_submissions.provider_response, fill_payload),
    filled_at = executed_at_value, updated_at = now_value
  where outbox_id = outbox_id_value;
  update public.order_execution_outbox set state = 'completed', completed_at = now_value,
    updated_at = now_value, last_error = null
  where id = outbox_id_value;
  insert into public.execution_audit_log (
    order_id, account_id, client_order_id, event_type, provider_name, event_key, event_payload
  ) values (
    row_order.id, row_order.account_id, row_outbox.client_order_id,
    'execution_fill', 'mock-safe', execution_id_value, to_jsonb(execution_row)
  ) on conflict do nothing;

  return jsonb_build_object('ok', true, 'replayed', false, 'execution', to_jsonb(execution_row));
end;
$$;

create or replace function public.mark_order_execution_rejected(outbox_id_value uuid, reason text, provider_response jsonb default '{}'::jsonb)
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
    raise exception 'D4_WORKER_REQUIRES_SERVICE_ROLE' using errcode = '42501';
  end if;
  select * into row_outbox from public.order_execution_outbox where id = outbox_id_value for update;
  if not found then raise exception 'OUTBOX_NOT_FOUND' using errcode = 'P0002'; end if;
  update public.execution_submissions set submission_state = 'rejected',
    provider_response = coalesce(mark_order_execution_rejected.provider_response, execution_submissions.provider_response), updated_at = now_value
  where outbox_id = outbox_id_value and submission_state in ('started','acknowledged');
  update public.order_execution_outbox set state = 'failed', last_error = left(reason, 1000),
    completed_at = now_value, updated_at = now_value where id = outbox_id_value;
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('app.order_lifecycle_transition', 'allowed', true);
  update public.orders set status = 'rejected', rejection_reason = left(reason, 1000), updated_at = now_value
  where id = row_outbox.order_id and account_id = row_outbox.account_id and status in ('requested','pending','open');
  insert into public.execution_audit_log (
    order_id, account_id, client_order_id, event_type, provider_name, event_key, event_payload
  ) values (row_outbox.order_id, row_outbox.account_id, row_outbox.client_order_id,
    'provider_rejected', 'mock-safe', row_outbox.id::text,
    jsonb_build_object('reason', left(reason, 1000), 'provider_response', provider_response))
  on conflict do nothing;
  return jsonb_build_object('ok', true, 'state', 'rejected');
end;
$$;

revoke all on function public.claim_next_order_execution_outbox(text, integer) from public, anon, authenticated;
revoke all on function public.mark_order_submission_started(uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.get_order_execution_recovery(uuid, text) from public, anon, authenticated;
revoke all on function public.record_provider_ack(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.record_execution_fill(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.mark_order_execution_rejected(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.claim_next_order_execution_outbox(text, integer) to service_role;
grant execute on function public.mark_order_submission_started(uuid, text, text, jsonb) to service_role;
grant execute on function public.get_order_execution_recovery(uuid, text) to service_role;
grant execute on function public.record_provider_ack(uuid, text, jsonb) to service_role;
grant execute on function public.record_execution_fill(uuid, jsonb) to service_role;
grant execute on function public.mark_order_execution_rejected(uuid, text, jsonb) to service_role;

commit;
