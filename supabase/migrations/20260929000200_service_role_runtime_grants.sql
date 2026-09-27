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

grant all on sequence public.trading_accounts_id_seq to service_role;
grant all on sequence public.orders_id_seq to service_role;
grant all on sequence public.executions_id_seq to service_role;
grant all on sequence public.positions_id_seq to service_role;
grant all on sequence public.daily_performance_id_seq to service_role;
grant all on sequence public.risk_events_id_seq to service_role;
grant all on sequence public.account_metric_snapshots_id_seq to service_role;
grant all on sequence public.products_id_seq to service_role;
grant all on sequence public.account_phases_id_seq to service_role;
grant all on sequence public.rule_versions_id_seq to service_role;
grant all on sequence public.account_rule_assignments_id_seq to service_role;
grant all on sequence public.account_permissions_id_seq to service_role;
grant all on sequence public.rule_audit_log_id_seq to service_role;
