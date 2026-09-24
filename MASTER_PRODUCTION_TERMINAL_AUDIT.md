# CRITICAL FINDINGS

Audit scope: read-only review of `C:\Users\jitro\option-hub\india-s-best-option-hub` (Customer Terminal) and `C:\Users\jitro\TERMINAL-OS` (Terminal OS). `C:\Users\jitro\Terminal` was reference-only and was not used as production evidence. No application files, database objects, credentials, environment values, migrations, deployments, or broker orders were changed.

1. Customer Terminal Supabase: URL host `zxqwtqlbrlegwdodjhiq.supabase.co`; project ref `zxqwtqlbrlegwdodjhiq`; STATUS: **NOT VERIFIED** for remote connectivity/schema, but local URL and CLI linkage agree.
2. Terminal OS Supabase: URL host `zxqwtqlbrlegwdodjhiq.supabase.co`; project ref inferred from local URL; STATUS: **NOT VERIFIED** for remote connectivity/schema.
3. Are BOTH using the SAME NEW SUPABASE PROJECT? **YES, based on local configuration evidence.**
4. If NO: not applicable; no local project-ref difference was found.
5. Are BOTH using the SAME trading tables? **PARTIAL / NOT VERIFIED.** Both refer to `trading_accounts`, `positions`, `executions`, risk and provider objects in code, but Customer migrations declare `orders` while Terminal OS services query `trading_orders`; Terminal OS checked-in SQL declares neither `trading_orders` nor `account_metrics`.
6. Are BOTH using the SAME trader/account identity model? **NO / PARTIAL.** Customer migrations use `owner_user_id`; Terminal OS uses employee/staff and trader/account concepts while its legacy schema also uses `owner_user_id`.
7. Are BOTH using the SAME order/execution/position state? **NOT VERIFIED.** Customer migration uses `orders`, `position_status`, and `account_id`; Terminal OS current services use `trading_orders`, `is_open`, and account-centric joins.
8. Are there duplicate databases/tables? **NOT VERIFIED remotely; conflicting checked-in contracts: YES.** One Supabase project is configured locally, but both repositories contain competing schema definitions and migration paths.
9. Which project currently appears to contain production trading data? **NOT VERIFIED.** No remote read-only database inventory was performed.
10. Which backend currently owns trading logic? Customer has browser/local engines and a proxy; Terminal OS has the stronger server-side operations/API layer. No single verified shared execution backend was found.

## Executive conclusion

The Supabase project identity is locally consistent, but the shared production data contract is not certified. Customer migrations define a browser-facing terminal schema with owner RLS and `orders`; Terminal OS server services expect a newer canonical contract with `trading_orders`, `account_metrics`, and staff operations. Terminal OS also contains a legacy `database/schema.sql` conflicting with those service expectations. This is a critical cutover blocker, not a reason to change either project during this audit.

## Evidence inventory

### Supabase

- Customer client: `src/integrations/supabase/client.ts`, using `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
- Customer API: `src/lib/terminalApi.ts`, referencing `trading_accounts`, `terminal_settings`, `account_permissions`, `rule_versions`, `get_active_account_context`, and `evaluate_pre_trade_risk`.
- Customer migrations: `supabase/migrations/20260917000100_terminal_schema.sql`, `20260921000100_canonical_account_context.sql`, and `20260922000100_position_pnl_foundation.sql`.
- Customer linkage: `supabase/config.toml` and local linked-project metadata identify `zxqwtqlbrlegwdodjhiq`.
- Terminal OS clients: `lib/supabase/client.ts`, `lib/supabase/server.ts`, `lib/supabase/middleware-client.ts`, and `lib/supabase/route-handler-client.ts`.
- Terminal OS auth: `lib/auth/session.ts` and `middleware.ts`.
- Terminal OS SQL: `database/schema.sql`, `database/broker_credentials_migration.sql`, and `database/broker_encryption_rpc.sql`.

### Safe executable validation

- Customer `npm test -- --run`: **16 test files passed, 122 tests passed**. The suite emitted a Kite instrument-master-unavailable warning in one broker-router test but did not fail.
- Customer `npm run build`: **passed**, with a Vite dynamic/static import chunk warning for `zerodhaAdapter.ts`.
- Customer `npm run lint`: **passed with warnings**, including `any` and Fast Refresh warnings.
- Terminal OS `npm run type-check`: **passed**.
- Terminal OS `npm run build`: **passed**, with three explicit `no-explicit-any` warnings in employee/settings API routes.
- Terminal OS: no configured test script and no repository test/spec files were found in the audited tree.

## Supabase comparison

| Object | Customer Terminal | Terminal OS | Result |
|---|---|---|---|
| URL/project | `zxqwtqlbrlegwdodjhiq.supabase.co` | `zxqwtqlbrlegwdodjhiq.supabase.co` | SAME locally |
| Auth client | Browser Supabase JS | Browser + SSR + server service client | PARTIAL |
| Trading accounts | `trading_accounts` | `trading_accounts` | Same name, contract NOT VERIFIED |
| Orders | `orders` in Customer migration | `trading_orders` in services; legacy SQL has `orders` | DIFFERENT |
| Executions | `executions`, `account_id`, owner fields | `executions`, account/order joins | PARTIAL/UNKNOWN |
| Positions | `account_id`, `position_status` | `trading_account_id`, `is_open`/`status` | DIFFERENT |
| Metrics | `account_metric_snapshots` | `account_metrics` plus snapshots | DIFFERENT |
| Watchlists | `watchlists`, `watchlist_items` | Same names in services | Same names, contract unknown |
| Instruments | `instruments` | `instruments` | Same name, schema unknown |
| Staff | No confirmed staff table | `employees`; newer notes mention `staff_members` | DIFFERENT/UNKNOWN |
| Broker credentials | No Storage; provider tables | encrypted `broker_credentials` migration/RPC | Terminal OS checked-in only |
| RPCs | account-context and pre-trade risk | broker encryption/decryption | DIFFERENT sets |
| RLS | explicit owner/authenticated policies | RLS enabled in legacy SQL, no policies in that file | DIFFERENT/UNKNOWN |
| Storage buckets | no calls found | no calls found | none found |

## Database and schema contract

Customer migrations declare `trading_accounts`, `instruments`, `orders`, `executions`, `positions`, `daily_performance`, `risk_events`, `account_metric_snapshots`, `watchlists`, `watchlist_items`, `journal_entries`, `alerts`, `terminal_settings`, `terminal_activity`, `provider_config`, `provider_health`, and account-rule objects.

Terminal OS checked-in SQL declares `employees`, `trading_accounts`, `orders`, `executions`, `positions`, `daily_performance`, `risk_events`, `account_metric_snapshots`, `instruments`, `watchlists`, `watchlist_items`, `journal_entries`, `alerts`, `terminal_settings`, `terminal_activity`, `provider_config`, and `provider_health`; a separate migration declares `broker_credentials`. Current services additionally query `trading_orders` and `account_metrics`.

| Contract | Customer | Terminal OS | Result |
|---|---|---|---|
| Account owner | `owner_user_id` | legacy `owner_user_id`; current trader/account concepts | PARTIAL |
| Account FK | `account_id` | legacy `trading_account_id` | DIFFERENT |
| Order table | `orders` | service `trading_orders`; legacy SQL `orders` | DIFFERENT |
| Position state | `position_status` | current `is_open`; legacy `status` | DIFFERENT |
| Metrics | `account_metric_snapshots` | `account_metrics` and snapshots | DIFFERENT |
| Staff | not confirmed | `employees`; newer `staff_members` reference | DIFFERENT/UNKNOWN |
| RLS | owner policies | legacy enables RLS without explicit policies | DIFFERENT |

Important domain distinction: Terminal OS explicitly documents `orders` as payment/checkout and `trading_orders` as trading in `server/services/orders.ts`. Customer migration currently uses `orders` for its trading schema.

Remote columns, nullability, defaults, live constraints, indexes, triggers, policies, data contents, and deployed migration history are **NOT VERIFIED** because the audit did not query the remote database. No cross-account live test was attempted.

## Auth and authorization

| Capability | Status | Evidence and risk |
|---|---|---|
| Customer auth/session | PARTIAL | `src/hooks/useAuth.tsx`; live session/RLS not tested |
| Customer account ownership | PARTIAL | owner policies and account-context RPC exist; no live denial test |
| Staff auth | PARTIAL | `TERMINAL-OS/lib/auth/session.ts` queries `employees` after auth; `DEV_MODE` bypass exists |
| Terminal RBAC | PARTIAL | `TERMINAL-OS/lib/rbac/permissions.ts` and `withAuth` route wrappers |
| Server authorization | PARTIAL | permission gates exist; object-level live isolation unverified |
| Service-role exposure | NOT VERIFIED | server-only code exists; deployed bundle/config not tested |

## Customer terminal matrix

| Feature | UI | Data/backend evidence | Runtime evidence | Status |
|---|---|---|---|---|
| Login/logout/session | Yes | Supabase auth hook | build/tests only | PARTIAL |
| Dashboard/account switching | Yes | terminal API/account context RPC | no live data test | PARTIAL |
| Balance/equity/P&L/challenge | Yes/local widgets | migrations and local engines | canonical live source unknown | PARTIAL |
| Watchlist/search/instruments | Yes | market API and tables | tests, no live provider certification | PARTIAL |
| Stocks/indices/futures/options | Yes | broker adapters/proxy | no entitlement certification | PARTIAL |
| Option chain/OI/charts | Yes | Kite/router/OI/chart code | Kite master warning | PARTIAL |
| WebSocket/reconnect/stale data | Yes | `useWebSocket.ts`, `websocketClient.ts` | 5 lifecycle tests pass | PARTIAL |
| Orders/preview/executions | Yes | execution/broker paths | no certified lifecycle | NOT VERIFIED |
| Positions/P&L | Yes | local store and Supabase contracts | browser-local state exists; canonical state unknown | PARTIAL |
| SL/TP/partial close/break-even | Code/UI evidence | local engines | no E2E lifecycle | NOT VERIFIED |
| Errors/loading/shortcuts | Yes | React components/hooks | build/tests only | PARTIAL |

Browser-local position storage/export/import appears in `src/pages/PositionTracker.tsx`; this is not canonical production position state.

## Backend, market data, broker, trading, risk, P&L, reconciliation

| Area | Status | Evidence / missing production proof |
|---|---|---|
| Shared backend | PARTIAL | Terminal OS server services/routes exist; shared customer execution path not verified |
| Kite | PARTIAL/UNVERIFIED | adapter/router/tests exist; instrument master warning; no credentialed read-only certification |
| Dhan/other brokers | NOT VERIFIED | definitions/adapters exist where present; runtime entitlement unknown |
| Instrument master and provider health | PARTIAL | diagnostic/cache/provider-health code exists; freshness/load not proven |
| Order creation/submission | NOT VERIFIED | functions/adapters exist; no safe deterministic full lifecycle |
| Idempotency/duplicate/unknown order | NOT VERIFIED | no broker reconciliation tests |
| Executions/partial fills | PARTIAL | local engine and OS services exist; no broker event/restart proof |
| Position/P&L/drawdown | PARTIAL | customer tests pass; canonical cross-project flow unknown |
| Risk rules | PARTIAL | risk engine has 15 passing tests and DB RPC; deployed enforcement unverified |
| Reconciliation/recovery | MISSING/NOT VERIFIED | no bidirectional broker/internal reconciliation or restart proof |
| SL/TP/fees/calendar | PARTIAL | some code/UI evidence; no transaction/broker certification |

## Terminal OS assessment

Terminal OS is **PARTIALLY OPERATIONAL by code shape**, not production-ready. It has pages and APIs for dashboard, accounts, orders, executions, positions, risk, instruments, providers, watchlists, employees, audit, activity, settings, and system health. RBAC wrappers and audit logging are present. It is not a verified full control plane because the checked-in schema conflicts with current services, mutations/reconciliation are not end-to-end tested, and no test suite is configured.

| Capability | Status |
|---|---|
| Staff login/session | PARTIAL |
| RBAC and permission-wrapped API | PARTIAL |
| Trader/account/order/execution/position/risk views | PARTIAL |
| Broker credential encryption/provider controls | PARTIAL |
| Audit/activity logs | PARTIAL |
| Account suspension/activation/manual controls | NOT VERIFIED |
| Reconciliation/recovery | MISSING/NOT VERIFIED |
| Production readiness | NOT VERIFIED |

## Security, infrastructure, observability, and testing

| Area | Status | Evidence / gap |
|---|---|---|
| Secret split and server-only admin client | PARTIAL | Terminal OS `server-only` client; deployment verification absent |
| Browser storage/session exposure | PARTIAL | Customer auth persistence and local position state; threat model absent |
| DEV_MODE/debug bypass | FAIL as production gate | Terminal OS development bypass exists; production enforcement not demonstrated |
| CSP/security headers/CORS/CSRF | PARTIAL | header code exists; attack tests absent |
| Rate limiting | NOT VERIFIED | no certified implementation evidence |
| Audit logging | PARTIAL | activity/audit services exist; completeness/immutability unknown |
| Hosting/cache/CDN/WAF | NOT VERIFIED | local build only |
| Monitoring/logs/alerts/backups/DR | NOT VERIFIED | health code/UI exists; operations evidence absent |
| CI/CD/staging/production | NOT VERIFIED | no certification performed |
| Testing | PARTIAL customer, MISSING OS | 122 customer tests; no OS suite; no E2E/load/security/reconciliation certification |

## Full 49-point roadmap matrix

| # | Item | Customer Terminal | Terminal OS |
|---:|---|---|---|
| 1 | Infrastructure | NOT VERIFIED | NOT VERIFIED |
| 2 | Authentication | PARTIAL | PARTIAL |
| 3 | Account engine | PARTIAL | PARTIAL |
| 4 | Challenge/rules engine | PARTIAL | PARTIAL |
| 5 | Instrument master | PARTIAL | PARTIAL |
| 6 | Market data | PARTIAL | NOT VERIFIED |
| 7 | WebSocket | PARTIAL | NOT VERIFIED |
| 8 | Charts | PARTIAL | NOT APPLICABLE |
| 9 | Option chain | PARTIAL | NOT VERIFIED |
| 10 | Watchlists | PARTIAL | PARTIAL |
| 11 | Trading UI | PARTIAL | NOT APPLICABLE |
| 12 | Pre-trade risk | PARTIAL | NOT VERIFIED |
| 13 | OMS | NOT VERIFIED | PARTIAL |
| 14 | Execution engine | PARTIAL | PARTIAL |
| 15 | Broker abstraction | PARTIAL | PARTIAL |
| 16 | Position engine | PARTIAL | PARTIAL |
| 17 | P&L | PARTIAL | PARTIAL |
| 18 | Drawdown | PARTIAL | NOT VERIFIED |
| 19 | Risk events | PARTIAL | PARTIAL |
| 20 | Reconciliation | NOT VERIFIED | NOT VERIFIED |
| 21 | Recovery | NOT VERIFIED | NOT VERIFIED |
| 22 | SL/TP | NOT VERIFIED | NOT VERIFIED |
| 23 | Fees | NOT VERIFIED | NOT VERIFIED |
| 24 | Trading calendar | PARTIAL | NOT VERIFIED |
| 25 | Customer UX | PARTIAL | NOT APPLICABLE |
| 26 | Terminal OS | NOT APPLICABLE | PARTIAL |
| 27 | Staff operations | NOT APPLICABLE | PARTIAL |
| 28 | Audit | PARTIAL | PARTIAL |
| 29 | Credential management | PARTIAL | PARTIAL |
| 30 | OAuth | NOT VERIFIED | NOT VERIFIED |
| 31 | Cache | PARTIAL | NOT VERIFIED |
| 32 | WebSocket scaling | NOT VERIFIED | NOT VERIFIED |
| 33 | API security | PARTIAL | PARTIAL |
| 34 | Database | PARTIAL | FAIL/NOT VERIFIED |
| 35 | Event architecture | PARTIAL | PARTIAL |
| 36 | Notifications | PARTIAL | PARTIAL |
| 37 | Configuration | PARTIAL | PARTIAL |
| 38 | Observability | PARTIAL | PARTIAL |
| 39 | Alerts | PARTIAL | PARTIAL |
| 40 | Security | PARTIAL | PARTIAL |
| 41 | Backup/DR | NOT VERIFIED | NOT VERIFIED |
| 42 | Testing | PARTIAL | MISSING |
| 43 | Paper trading | NOT VERIFIED | NOT VERIFIED |
| 44 | Broker certification | NOT VERIFIED | NOT VERIFIED |
| 45 | Market-data licensing | NOT VERIFIED | NOT VERIFIED |
| 46 | Regulatory/compliance | NOT VERIFIED | NOT VERIFIED |
| 47 | Production deployment | NOT VERIFIED | NOT VERIFIED |
| 48 | CI/CD | NOT VERIFIED | NOT VERIFIED |
| 49 | Production readiness gates | FAIL | FAIL |

## Objective counts

| Status | Count |
|---|---:|
| PASS | 0 |
| PARTIAL | 46 |
| FAIL | 3 |
| MISSING | 2 |
| NOT VERIFIED | 66 |
| NOT APPLICABLE | 5 |

These are matrix classifications, not a subjective overall score. The machine-readable count and evidence summary are in `MASTER_PRODUCTION_TERMINAL_AUDIT.json`.

## Duplicate/conflicting objects and exact blockers

- `orders` versus `trading_orders`
- `account_id` versus `trading_account_id`
- `position_status` versus `is_open`/`status`
- `account_metric_snapshots` versus `account_metrics`
- `employees` versus `staff_members`
- Customer owner RLS policies versus Terminal OS legacy RLS without explicit policies
- Browser/local customer position state versus server-owned canonical state not proven
- Terminal OS current service queries versus its checked-in legacy SQL

## Recommended implementation order after the audit

1. Freeze and document one canonical Supabase schema and identity model.
2. Run an approved read-only remote schema/RLS/migration inventory.
3. Select the single server-owned trading/OMS/execution path.
4. Add deterministic paper/test-adapter lifecycle, idempotency, reconciliation, restart, and account-isolation tests.
5. Certify broker and market-data providers with safe read-only tests and health/alert behavior.
6. Add Terminal OS unit/integration/security/E2E coverage and prohibit `DEV_MODE` in production.
7. Establish deployment, secrets, backups/DR, observability, incident response, and explicit readiness gates.

Do not migrate, merge, cut over, deploy, or change credentials based solely on this audit.
