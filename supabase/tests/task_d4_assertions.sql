begin;

do $$
declare
  synthetic_account_id uuid := 'd4000000-0000-4000-8000-000000000002';
  claim_outbox_id uuid := 'd4000000-0000-4000-8000-000000000007';
  recovery_outbox_id uuid := 'd4000000-0000-4000-8000-000000000006';
  fill_outbox_id uuid := 'd4000000-0000-4000-8000-000000000008';
  fill_order_id uuid := 'd4000000-0000-4000-8000-000000000005';
  worker_name text;
  claim_result jsonb;
  marker_result jsonb;
  recovery_result jsonb;
  ack_result jsonb;
  fill_result jsonb;
  duplicate_fill_result jsonb;
  fill_event jsonb;
  event_time timestamptz := '2026-10-02 09:15:00+00';
  execution_count integer;
  position_count integer;
begin
  if current_database() <> 'postgres' then
    raise exception 'D4 tests must run against the canonical postgres database';
  end if;
  perform set_config('request.jwt.claim.role', 'service_role', true);

  select claimed_by into worker_name from public.order_execution_outbox where id = claim_outbox_id;
  if worker_name is null then raise exception 'CONCURRENT_CLAIM_DID_NOT_PERSIST'; end if;

  marker_result := public.mark_order_submission_started(
    claim_outbox_id, worker_name, 'mock-safe', jsonb_build_object('provider', 'mock-safe', 'dispatch', 'synthetic')
  );
  if marker_result->>'should_dispatch' <> 'true' then raise exception 'FIRST_SUBMISSION_MARKER_DID_NOT_ALLOW_DISPATCH'; end if;
  if not exists (select 1 from public.execution_submissions where outbox_id = claim_outbox_id and submission_state = 'started' and provider_response is null) then
    raise exception 'SUBMISSION_MARKER_NOT_DURABLE_BEFORE_ACK';
  end if;
  marker_result := public.mark_order_submission_started(
    claim_outbox_id, worker_name, 'mock-safe', jsonb_build_object('provider', 'mock-safe', 'dispatch', 'duplicate')
  );
  if marker_result->>'should_dispatch' <> 'false' or marker_result->>'recovery_only' <> 'true' then
    raise exception 'DUPLICATE_DELIVERY_WAS_NOT_FAIL_CLOSED';
  end if;
  claim_result := public.claim_next_order_execution_outbox('d4-duplicate-worker', 60);
  if claim_result->>'claimed' <> 'false' then raise exception 'SECOND_WORKER_CLAIMED_DURING_ACTIVE_LEASE'; end if;

  update public.order_execution_outbox
  set state = 'pending', claimed_by = null, claimed_until = null,
      attempt_count = 0, available_at = timezone('utc', now())
  where id = recovery_outbox_id;
  update public.order_execution_outbox set available_at = timezone('utc', now()) where id = recovery_outbox_id;
  claim_result := public.claim_next_order_execution_outbox('d4-timeout-worker', 60);
  if claim_result->>'claimed' <> 'true' then raise exception 'TIMEOUT_FIXTURE_NOT_CLAIMED'; end if;
  marker_result := public.mark_order_submission_started(
    recovery_outbox_id, 'd4-timeout-worker', 'mock-safe', jsonb_build_object('provider', 'mock-safe')
  );
  if marker_result->>'should_dispatch' <> 'true' then raise exception 'TIMEOUT_SUBMISSION_MARKER_FAILED'; end if;
  update public.order_execution_outbox set claimed_until = timezone('utc', now()) - interval '1 second' where id = recovery_outbox_id;
  claim_result := public.claim_next_order_execution_outbox('d4-recovery-worker', 60);
  if claim_result->>'claimed' <> 'true' or claim_result->>'recovery_only' <> 'true' then
    raise exception 'RESTART_DID_NOT_ENTER_LOOKUP_ONLY_RECOVERY';
  end if;
  recovery_result := public.get_order_execution_recovery(recovery_outbox_id, 'd4-recovery-worker');
  if recovery_result->>'lookup_only' <> 'true' or recovery_result->>'provider_name' <> 'mock-safe' then
    raise exception 'RECOVERY_LOOKUP_WAS_NOT_FAIL_CLOSED';
  end if;
  marker_result := public.mark_order_submission_started(
    recovery_outbox_id, 'd4-recovery-worker', 'mock-safe', jsonb_build_object('provider', 'mock-safe')
  );
  if marker_result->>'should_dispatch' <> 'false' then raise exception 'AMBIGUOUS_SUBMISSION_WAS_RESUBMITTED'; end if;

  begin
    perform public.record_execution_fill(recovery_outbox_id, jsonb_build_object(
      'account_id', 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      'localOrderId', 'd4000000-0000-4000-8000-000000000003',
      'brokerExecutionId', 'D4-ISOLATION-FILL', 'symbol', 'D4SYNTHB', 'side', 'BUY',
      'quantity', 1, 'price', 100, 'executedAt', event_time
    ));
    raise exception 'ACCOUNT_ISOLATION_DID_NOT_REJECT_FORGED_ACCOUNT';
  exception when insufficient_privilege then
    null;
  end;
  if exists (select 1 from public.executions where order_id='d4000000-0000-4000-8000-000000000004') then
    raise exception 'ISOLATION_REJECTION_PERSISTED_A_FILL';
  end if;

  update public.order_execution_outbox set available_at = timezone('utc', now()) where id = fill_outbox_id;
  claim_result := public.claim_next_order_execution_outbox('d4-fill-worker', 60);
  if claim_result->>'claimed' <> 'true' then raise exception 'FILL_FIXTURE_NOT_CLAIMED'; end if;
  marker_result := public.mark_order_submission_started(
    fill_outbox_id, 'd4-fill-worker', 'mock-safe', jsonb_build_object('provider', 'mock-safe')
  );
  if marker_result->>'should_dispatch' <> 'true' then raise exception 'FILL_SUBMISSION_MARKER_FAILED'; end if;
  ack_result := public.record_provider_ack(
    fill_outbox_id, 'mock-d4-order-0001', jsonb_build_object('provider', 'mock-safe', 'status', 'ACK')
  );
  if ack_result->>'ok' <> 'true' or ack_result->>'replayed' <> 'false' then raise exception 'MOCK_ACK_NOT_RECORDED'; end if;
  if not exists (select 1 from public.execution_submissions where outbox_id=fill_outbox_id and submission_state='acknowledged' and provider_response->>'status'='ACK') then
    raise exception 'ACK_NOT_PERSISTED';
  end if;

  fill_event := jsonb_build_object(
    'account_id', synthetic_account_id,
    'localOrderId', fill_order_id,
    'brokerExecutionId', 'D4-SYNTH-FILL-001',
    'symbol', 'D4SYNTHC',
    'side', 'BUY',
    'quantity', 1,
    'price', 100,
    'executedAt', event_time
  );
  fill_result := public.record_execution_fill(fill_outbox_id, fill_event);
  duplicate_fill_result := public.record_execution_fill(fill_outbox_id, fill_event);
  if fill_result->>'replayed' <> 'false' or duplicate_fill_result->>'replayed' <> 'true' then
    raise exception 'FILL_IDEMPOTENCY_FAILED';
  end if;

  select count(*) into execution_count from public.executions where order_id=fill_order_id and external_execution_id='D4-SYNTH-FILL-001';
  select count(*) into position_count from public.positions where account_id=synthetic_account_id and symbol='D4SYNTHC' and quantity=1 and position_status='open';
  if execution_count <> 1 or position_count <> 1 then raise exception 'FILL_DUPLICATED_POSITION_OR_EXECUTION'; end if;
  if not exists (select 1 from public.execution_submissions where outbox_id=fill_outbox_id and submission_state='filled') then
    raise exception 'FILL_STATE_NOT_PERSISTED';
  end if;
  if not exists (select 1 from public.execution_audit_log where order_id=fill_order_id and event_type='provider_ack')
     or not exists (select 1 from public.execution_audit_log where order_id=fill_order_id and event_type='execution_fill') then
    raise exception 'EXECUTION_AUDIT_NOT_PERSISTED';
  end if;
  if not exists (select 1 from public.account_metric_snapshots where account_id=synthetic_account_id) then
    raise exception 'ACCOUNT_METRICS_NOT_UPDATED';
  end if;
end;
$$;

rollback;