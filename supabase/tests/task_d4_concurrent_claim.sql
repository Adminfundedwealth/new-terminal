with database_guard as materialized (
  select current_database() = 'postgres' as is_canonical_database
),
worker_role as materialized (
  select set_config('request.jwt.claim.role', 'service_role', true)
  from database_guard
  where is_canonical_database
)
select public.claim_next_order_execution_outbox(
  'd4-worker-' || pg_backend_pid()::text,
  3600
) as claim_result
from worker_role;