# D6-A Production Hardening

## Scope and status

D6-A adds independent hardening primitives and regression infrastructure. D6-B now connects worker-side error classification, bounded provider calls, submission markers, provider lookup recovery, bounded safe retry decisions, structured telemetry, and the D4 PostgreSQL RPC contract. D2 account-scoped command idempotency and D3 owner-scoped RLS remain authoritative and unchanged. No live broker adapter is enabled, and all new provider tests use the mock-safe adapter.

The checked-in repository does not include a deployed execution-worker entrypoint: the Docker image starts the market-data proxy, while the production frontend is hosted on Hostinger. `SupabaseExecutionRepository` therefore accepts an injected service-role client, but this workspace does not demonstrate a running worker deployment. The in-memory repository tests simulate worker recreation but are not PostgreSQL crash/restart certification.

## Implemented controls

- Error classification distinguishes timeout, network, authentication, rate limit, validation, conflict, database, and unknown outcomes. Ambiguous provider outcomes require reconciliation instead of blind resubmission.
- Restart recovery is modeled as an explicit decision function: unexpired claims wait; expired pre-submit work may retry within budget; started submits require provider lookup; unavailable or exhausted cases go to manual review.
- Fill deduplication and command idempotency have narrow adapter contracts. The included in-memory implementations exist only for deterministic tests; production implementations must enforce database uniqueness and persist the deduplication key plus state effects atomically.
- Authorization requires a verified principal and resolves account ownership server-side. Rate-limit keys include subject, account, and action; the in-memory fixed-window store is bounded and fails closed when full. Multi-process deployments require a shared atomic store.
- Structured logs are JSON and redact credential-like fields. Readiness probes have per-dependency timeouts; metric hooks report outcome counts and execution duration without binding the app to a vendor.
- `npm run healthcheck` is a deployment gate that performs a bounded HTTP GET to `D6_HEALTHCHECK_URL`; it does not create or implement a readiness endpoint.
- The additive D6-B migration adds service-role-only retry-authorization and terminal-failure RPCs. Apply and validate it only through the approved database migration process.

## Recovery procedure

1. Pause execution workers and retain the outbox, submission, provider response, and audit records. Do not reset or delete `processing` rows to force a retry.
2. For an expired claim with a submission marker, query the provider using the persisted client order identity through the certified adapter. If found, reconcile the provider order and fills idempotently. If lookup is unavailable or inconclusive, route to manual review.
3. Retry only after a definitive not-found result and while below the configured attempt limit. Preserve the same account-scoped client order identity.
4. Confirm database backups and point-in-time recovery are healthy before any repair. Any state correction must use a reviewed, transactionally safe migration or repair procedure; never lower RLS, risk gates, or service-role grants to restore throughput.

## Rollback and deployment checks

- Roll back the application artifact while keeping D2/D3 database controls intact. Do not roll back canonical schema or relax policies as an application rollback shortcut.
- Deploy the hardening interfaces in report-only/test environments before enabling an execution worker. Require database readiness and queue claim checks in deployment health gates; provider health must use a non-mutating status operation only.
- Validate the deployment with the focused `executionHardening.test.ts` and durable-worker suites, full Vitest suite, production build, and PostgreSQL concurrency tests. Production activation additionally requires an actual worker runtime, shared-store rate limiting, deployed readiness probes, transactional restart/reconciliation certification, and D4/D5 sign-off.

## Explicitly pending

- PostgreSQL: execute the additive migration and D4/D6 SQL assertions in a local or staging PostgreSQL environment; run concurrent account-scoped idempotency tests and a database-backed worker restart test. This workspace has no Supabase CLI or Docker runtime.
- Runtime: add and deploy a dedicated execution-worker process that constructs the repository with a server-only service-role client and uses only the mock provider in synthetic verification. No such process is configured in the checked-in Docker deployment.
- Security/operations: enforce bounded rate limiting on the actual order ingress, deploy authenticated readiness probes for database/worker/provider/realtime/queue state, and verify cross-account behavior against PostgreSQL.
- Production: no migration or deployment was performed as part of local test work. Production verification still requires the deployed worker/runtime, synthetic admin scope, external monitoring, backup/restore drill, and production-equivalent load results.