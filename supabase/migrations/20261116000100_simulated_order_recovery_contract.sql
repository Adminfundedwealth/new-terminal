begin;

do $$
declare
  function_definition text;
  old_aliases text := $old$
  if order_type_value = 'STOP' then order_type_value := 'SL'; end if;
  if order_type_value = 'STOP-LIMIT' then order_type_value := 'SL-M'; end if;
$old$;
  new_aliases text := $new$
  if order_type_value = 'STOP' then order_type_value := 'SL-M'; end if;
  if order_type_value = 'STOP-LIMIT' then order_type_value := 'SL'; end if;
$new$;
  old_price_rule text := $old$
  if order_type_value in ('LIMIT', 'SL-M') and price_value is null then
$old$;
  new_price_rule text := $new$
  if order_type_value in ('LIMIT', 'SL') and price_value is null then
$new$;
begin
  select pg_get_functiondef('public.create_order_command(jsonb)'::regprocedure)
  into function_definition;

  if position(old_aliases in function_definition) > 0 then
    function_definition := replace(function_definition, old_aliases, new_aliases);
  elsif position(new_aliases in function_definition) = 0 then
    raise exception 'create_order_command order aliases differ from the expected contract';
  end if;

  if position(old_price_rule in function_definition) > 0 then
    function_definition := replace(function_definition, old_price_rule, new_price_rule);
  elsif position(new_price_rule in function_definition) = 0 then
    raise exception 'create_order_command stop order price rule differs from the expected contract';
  end if;

  execute function_definition;
end;
$$;

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
    'provider_response', row_submission.provider_response,
    'provider_request', row_submission.provider_request
  );
end;
$$;

revoke all on function public.claim_next_order_execution_outbox(text, integer) from public, anon, authenticated;
revoke all on function public.get_order_execution_recovery(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_next_order_execution_outbox(text, integer) to service_role;
grant execute on function public.get_order_execution_recovery(uuid, text) to service_role;

commit;
