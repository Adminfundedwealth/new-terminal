-- Ensure the trusted server-side Terminal role can mutate the canonical runtime data.
-- This is required for the live Supabase project to run the server-authoritative
-- account, risk, and rule flows without falling back to browser-side authority.

grant usage on schema public to service_role;
grant create on schema public to service_role;

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant all on all functions in schema public to service_role;

grant all on table public.trading_accounts to service_role;
grant all on table public.orders to service_role;
grant all on table public.executions to service_role;
grant all on table public.positions to service_role;
grant all on table public.daily_performance to service_role;
grant all on table public.risk_events to service_role;
grant all on table public.account_metric_snapshots to service_role;
grant all on table public.products to service_role;
grant all on table public.account_phases to service_role;
grant all on table public.rule_versions to service_role;
grant all on table public.account_rule_assignments to service_role;
grant all on table public.account_permissions to service_role;
grant all on table public.rule_audit_log to service_role;
grant all on table public.terminal_activity to service_role;
grant all on table public.terminal_settings to service_role;
