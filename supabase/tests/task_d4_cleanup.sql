begin;

delete from public.order_execution_outbox
where id in (
  'd4000000-0000-4000-8000-000000000006',
  'd4000000-0000-4000-8000-000000000007',
  'd4000000-0000-4000-8000-000000000008'
);
delete from public.execution_audit_log
where order_id in (
  'd4000000-0000-4000-8000-000000000003',
  'd4000000-0000-4000-8000-000000000004',
  'd4000000-0000-4000-8000-000000000005'
);
delete from public.execution_submissions
where order_id in (
  'd4000000-0000-4000-8000-000000000003',
  'd4000000-0000-4000-8000-000000000004',
  'd4000000-0000-4000-8000-000000000005'
);
delete from public.executions
where order_id in (
  'd4000000-0000-4000-8000-000000000003',
  'd4000000-0000-4000-8000-000000000004',
  'd4000000-0000-4000-8000-000000000005'
);
delete from public.positions where account_id='d4000000-0000-4000-8000-000000000002';
delete from public.account_metric_snapshots where account_id='d4000000-0000-4000-8000-000000000002';
delete from public.terminal_activity where account_id='d4000000-0000-4000-8000-000000000002';
delete from public.trading_accounts where id='d4000000-0000-4000-8000-000000000002';
delete from auth.users where id='d4000000-0000-4000-8000-000000000001';

commit;