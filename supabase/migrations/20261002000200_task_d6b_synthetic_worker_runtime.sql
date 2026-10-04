begin;

create table if not exists public.d6b_mock_provider_orders (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.trading_accounts(id),
  order_id uuid not null references public.orders(id),
  client_order_id text not null,
  provider_order_id text not null unique,
  provider_response jsonb not null,
  submission_count integer not null default 1 check (submission_count = 1),
  lookup_count integer not null default 0 check (lookup_count >= 0),
  crash_requested boolean not null default false,
  crash_consumed boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint d6b_mock_provider_account_client_uidx unique (account_id, client_order_id),
  constraint d6b_mock_provider_account_order_uidx unique (account_id, order_id)
);

alter table public.d6b_mock_provider_orders enable row level security;
revoke all on public.d6b_mock_provider_orders from public, anon, authenticated;
grant select, insert, update on public.d6b_mock_provider_orders to service_role;

create or replace function public.claim_d6b_synthetic_order_execution_outbox(
  worker_name text,
  account_id_value uuid,
  order_id_value uuid,
  lease_seconds integer default 15
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  account_owner uuid;
  claimed_row public.order_execution_outbox%rowtype;
  recovery_only_value boolean;
  now_value timestamptz := timezone('utc', now());
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'D6B_WORKER_REQUIRES_SERVICE_ROLE' using errcode = '42501';
  end if;
  if nullif(trim(worker_name), '') is null or lease_seconds < 1 or lease_seconds > 300 then
    raise exception 'INVALID_D6B_WORKER_LEASE' using errcode = '22023';
  end if;

  select owner_user_id into account_owner
  from public.trading_accounts
  where id = account_id_value
    and prop_firm = 'D6B_TEST'
    and external_account_id = 'D6B-SYNTHETIC-ACCOUNT';
  if not found then
    raise exception 'D6B_SYNTHETIC_ACCOUNT_REQUIRED' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.orders
    where id = order_id_value and account_id = account_id_value
      and owner_user_id = account_owner and client_order_id like 'D6B-SYNTH-%'
  ) then
    raise exception 'D6B_SYNTHETIC_ORDER_REQUIRED' using errcode = '42501';
  end if;

  with candidate as (
    select o.id
    from public.order_execution_outbox o
    join public.orders ord on ord.id = o.order_id and ord.account_id = o.account_id
    where o.order_id = order_id_value
      and o.account_id = account_id_value
      and o.client_order_id like 'D6B-SYNTH-%'
      and ((o.state = 'pending' and o.available_at <= now_value)
        or (o.state = 'processing' and (o.claimed_until is null or o.claimed_until <= now_value)))
    for update of o skip locked
  )
  update public.order_execution_outbox o
  set state = 'processing',
      claimed_by = worker_name,
      claimed_until = now_value + make_interval(secs => lease_seconds),
      attempt_count = coalesce(o.attempt_count, 0) + 1,
      updated_at = now_value
  from candidate c
  where o.id = c.id
  returning o.* into claimed_row;

  if not found then
    return jsonb_build_object('claimed', false, 'reason', 'no_scoped_synthetic_work');
  end if;
  select exists (
    select 1 from public.execution_submissions s
    where s.outbox_id = claimed_row.id
      and s.submission_state in ('started', 'acknowledged')
  ) into recovery_only_value;

  return jsonb_build_object(
    'claimed', true,
    'recovery_only', recovery_only_value,
    'outbox', to_jsonb(claimed_row) || jsonb_build_object(
      'payload', coalesce(claimed_row.payload, '{}'::jsonb) || jsonb_build_object(
        'id', claimed_row.id,
        'order_id', claimed_row.order_id,
        'account_id', claimed_row.account_id,
        'client_order_id', claimed_row.client_order_id,
        'user_id', account_owner,
        'provider', 'mock-safe'
      )
    ),
    'worker', worker_name
  );
end;
$$;

create or replace function public.d6b_mock_provider_submit(
  command_payload jsonb,
  crash_after_acceptance boolean default false,
  reject_order boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  account_id_value uuid := nullif(command_payload->>'account_id', '')::uuid;
  order_id_value uuid := nullif(command_payload->>'order_id', '')::uuid;
  client_order_id_value text := nullif(trim(command_payload->>'client_order_id'), '');
  account_owner uuid;
  order_row public.orders%rowtype;
  existing_row public.d6b_mock_provider_orders%rowtype;
  provider_order_id_value text;
  fill_id_value text;
  response_value jsonb;
  now_value timestamptz := timezone('utc', now());
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'D6B_MOCK_PROVIDER_REQUIRES_SERVICE_ROLE' using errcode = '42501';
  end if;
  select owner_user_id into account_owner from public.trading_accounts
  where id = account_id_value and prop_firm = 'D6B_TEST'
    and external_account_id = 'D6B-SYNTHETIC-ACCOUNT';
  if not found then raise exception 'D6B_MOCK_ACCOUNT_REQUIRED' using errcode = '42501'; end if;

  select * into order_row from public.orders
  where id = order_id_value and account_id = account_id_value
    and owner_user_id = account_owner and client_order_id = client_order_id_value
    and client_order_id like 'D6B-SYNTH-%'
  for update;
  if not found then raise exception 'D6B_MOCK_ORDER_REQUIRED' using errcode = '42501'; end if;
  if nullif(trim(command_payload->>'symbol'), '') is distinct from order_row.symbol
     or lower(command_payload->>'side') is distinct from order_row.side
     or nullif(command_payload->>'quantity', '')::numeric is distinct from order_row.quantity then
    raise exception 'D6B_MOCK_COMMAND_MISMATCH' using errcode = '22023';
  end if;

  select * into existing_row from public.d6b_mock_provider_orders
  where account_id = account_id_value and client_order_id = client_order_id_value
  for update;
  if found then
    if existing_row.order_id <> order_id_value then
      raise exception 'D6B_MOCK_IDEMPOTENCY_CONFLICT' using errcode = '23505';
    end if;
    return existing_row.provider_response;
  end if;

  provider_order_id_value := 'd6b-mock-' || order_id_value::text;
  fill_id_value := 'D6B-' || upper(replace(client_order_id_value, '-', '_'));
  if coalesce(reject_order, false) then
    response_value := jsonb_build_object(
      'ok', false,
      'state', 'REJECTED',
      'broker_order_id', provider_order_id_value,
      'client_order_id', client_order_id_value,
      'message', 'D6B synthetic mock rejection',
      'fills', '[]'::jsonb
    );
  else
    response_value := jsonb_build_object(
      'ok', true,
      'state', 'FILLED',
      'broker_order_id', provider_order_id_value,
      'client_order_id', client_order_id_value,
      'fills', jsonb_build_array(jsonb_build_object(
      'brokerExecutionId', fill_id_value,
      'brokerOrderId', provider_order_id_value,
      'localOrderId', order_id_value,
      'accountId', account_id_value,
      'symbol', order_row.symbol,
      'side', upper(order_row.side),
      'quantity', order_row.quantity,
      'price', coalesce(order_row.price, 100),
      'executedAt', now_value,
      'fees', 0
      ))
    );
  end if;

  insert into public.d6b_mock_provider_orders (
    account_id, order_id, client_order_id, provider_order_id,
    provider_response, crash_requested, created_at, updated_at
  ) values (
    account_id_value, order_id_value, client_order_id_value, provider_order_id_value,
    response_value, coalesce(crash_after_acceptance, false), now_value, now_value
  )
  on conflict (account_id, client_order_id) do nothing
  returning * into existing_row;
  if not found then
    select * into existing_row
    from public.d6b_mock_provider_orders
    where account_id = account_id_value and client_order_id = client_order_id_value
    for update;
    if existing_row.order_id <> order_id_value then
      raise exception 'D6B_MOCK_IDEMPOTENCY_CONFLICT' using errcode = '23505';
    end if;
  end if;
  return existing_row.provider_response;
end;
$$;

create or replace function public.d6b_mock_provider_lookup(
  account_id_value uuid,
  client_order_id_value text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  response_value jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'D6B_MOCK_PROVIDER_REQUIRES_SERVICE_ROLE' using errcode = '42501';
  end if;
  update public.d6b_mock_provider_orders
  set lookup_count = lookup_count + 1,
      updated_at = timezone('utc', now())
  where account_id = account_id_value and client_order_id = client_order_id_value
  returning provider_response into response_value;
  return response_value;
end;
$$;

create or replace function public.d6b_mock_provider_consume_crash(
  outbox_id_value uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  consumed boolean := false;
  row_outbox public.order_execution_outbox%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'D6B_MOCK_PROVIDER_REQUIRES_SERVICE_ROLE' using errcode = '42501';
  end if;
  select * into row_outbox
  from public.order_execution_outbox
  where id = outbox_id_value
  for update;
  if not found then return false; end if;

  update public.d6b_mock_provider_orders
  set crash_consumed = true,
      updated_at = timezone('utc', now())
  where account_id = row_outbox.account_id and order_id = row_outbox.order_id
    and crash_requested is true and crash_consumed is false
  returning true into consumed;
  return coalesce(consumed, false);
end;
$$;

revoke all on function public.claim_d6b_synthetic_order_execution_outbox(text, uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.d6b_mock_provider_submit(jsonb, boolean, boolean) from public, anon, authenticated;
revoke all on function public.d6b_mock_provider_lookup(uuid, text) from public, anon, authenticated;
revoke all on function public.d6b_mock_provider_consume_crash(uuid) from public, anon, authenticated;
grant execute on function public.claim_d6b_synthetic_order_execution_outbox(text, uuid, uuid, integer) to service_role;
grant execute on function public.d6b_mock_provider_submit(jsonb, boolean, boolean) to service_role;
grant execute on function public.d6b_mock_provider_lookup(uuid, text) to service_role;
grant execute on function public.d6b_mock_provider_consume_crash(uuid) to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders') then
      alter publication supabase_realtime add table public.orders;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'positions') then
      alter publication supabase_realtime add table public.positions;
    end if;
  end if;
end;
$$;

commit;