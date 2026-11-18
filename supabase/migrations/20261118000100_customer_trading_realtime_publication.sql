begin;

do $$
declare
  table_name text;
  required_tables text[] := array[
    'orders',
    'executions',
    'positions',
    'trading_accounts',
    'account_metric_snapshots',
    'daily_performance',
    'risk_events',
    'account_ledger_entries'
  ];
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise exception 'supabase_realtime publication is required for customer trading updates';
  end if;

  foreach table_name in array required_tables loop
    if to_regclass(format('public.%I', table_name)) is null then
      raise exception 'Required customer trading table public.% is missing', table_name;
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end;
$$;

commit;
