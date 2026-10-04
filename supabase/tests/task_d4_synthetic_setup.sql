begin;

do $$
declare
  synthetic_user_id uuid := 'd4000000-0000-4000-8000-000000000001';
  synthetic_account_id uuid := 'd4000000-0000-4000-8000-000000000002';
  claim_order_id uuid := 'd4000000-0000-4000-8000-000000000003';
  recovery_order_id uuid := 'd4000000-0000-4000-8000-000000000004';
  fill_order_id uuid := 'd4000000-0000-4000-8000-000000000005';
begin
  if current_database() <> 'postgres' then
    raise exception 'D4 tests must run against the canonical postgres database';
  end if;
  if exists (select 1 from auth.users where id = synthetic_user_id)
     or exists (select 1 from public.trading_accounts where id = synthetic_account_id)
     or exists (select 1 from public.orders where id in (claim_order_id, recovery_order_id, fill_order_id))
     or exists (select 1 from public.order_execution_outbox where id in (
       'd4000000-0000-4000-8000-000000000006',
       'd4000000-0000-4000-8000-000000000007',
       'd4000000-0000-4000-8000-000000000008'
     )) then
    raise exception 'D4 synthetic fixture identifiers already exist';
  end if;

  insert into auth.users (id, aud, role, email, email_confirmed_at)
  values (synthetic_user_id, 'authenticated', 'authenticated', 'd4-worker-test@example.invalid', timezone('utc', now()));

  insert into public.trading_accounts (
    id, owner_user_id, external_account_id, prop_firm,
    starting_balance, current_balance, equity
  ) values (
    synthetic_account_id, synthetic_user_id, 'D4-SYNTHETIC-ACCOUNT', 'D4_TEST',
    100000, 100000, 100000
  );

  insert into public.orders (
    id, account_id, owner_user_id, client_order_id, symbol, side,
    order_type, quantity, price, status
  ) values
    (claim_order_id, synthetic_account_id, synthetic_user_id, 'D4-SYNTH-CLAIM', 'D4SYNTHA', 'buy', 'LIMIT', 1, 100, 'requested'),
    (recovery_order_id, synthetic_account_id, synthetic_user_id, 'D4-SYNTH-RECOVERY', 'D4SYNTHB', 'buy', 'LIMIT', 1, 100, 'requested'),
    (fill_order_id, synthetic_account_id, synthetic_user_id, 'D4-SYNTH-FILL', 'D4SYNTHC', 'buy', 'LIMIT', 1, 100, 'requested');

  insert into public.order_execution_outbox (
    id, order_id, account_id, client_order_id, payload, state, available_at
  ) values
    ('d4000000-0000-4000-8000-000000000006', claim_order_id, synthetic_account_id, 'D4-SYNTH-CLAIM',
     jsonb_build_object('account_id', synthetic_account_id, 'client_order_id', 'D4-SYNTH-CLAIM', 'symbol', 'D4SYNTHA', 'side', 'BUY', 'quantity', 1, 'order_type', 'LIMIT', 'price', 100), 'pending', timezone('utc', now())),
    ('d4000000-0000-4000-8000-000000000007', recovery_order_id, synthetic_account_id, 'D4-SYNTH-RECOVERY',
     jsonb_build_object('account_id', synthetic_account_id, 'client_order_id', 'D4-SYNTH-RECOVERY', 'symbol', 'D4SYNTHB', 'side', 'BUY', 'quantity', 1, 'order_type', 'LIMIT', 'price', 100), 'pending', timezone('utc', now()) + interval '1 day'),
    ('d4000000-0000-4000-8000-000000000008', fill_order_id, synthetic_account_id, 'D4-SYNTH-FILL',
     jsonb_build_object('account_id', synthetic_account_id, 'client_order_id', 'D4-SYNTH-FILL', 'symbol', 'D4SYNTHC', 'side', 'BUY', 'quantity', 1, 'order_type', 'LIMIT', 'price', 100), 'pending', timezone('utc', now()) + interval '1 day');
end;
$$;

commit;