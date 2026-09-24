# Supabase Cross-Project Report

## Critical finding

Both local projects point to the same concrete Supabase project:

- Customer URL host: `zxqwtqlbrlegwdodjhiq.supabase.co`
- Terminal OS URL host: `zxqwtqlbrlegwdodjhiq.supabase.co`
- Project ref: `zxqwtqlbrlegwdodjhiq`
- Result: **YES locally; remote schema and project freshness NOT VERIFIED**

No secret values, keys, tokens, passwords, or credentials were printed. No production data or Supabase objects were changed.

## Configuration comparison

| Item | Customer Terminal | Terminal OS | Result |
|---|---|---|---|
| Public URL | `VITE_SUPABASE_URL` | `NEXT_PUBLIC_TERMINAL_SUPABASE_URL` | Different names, same local host |
| Public key | `VITE_SUPABASE_PUBLISHABLE_KEY` | `NEXT_PUBLIC_TERMINAL_SUPABASE_PUBLISHABLE_KEY` | Different names |
| Server URL | `SUPABASE_URL` documented | `TERMINAL_SUPABASE_URL` | Different names |
| Server credential | `SUPABASE_SECRET_KEY` documented | `TERMINAL_SUPABASE_SECRET_KEY` | Different names |
| Browser client | `src/integrations/supabase/client.ts` | `lib/supabase/client.ts` | Different wrappers |
| Server/admin client | No verified server-only client | `lib/supabase/server.ts` | Terminal OS only |
| CLI linkage | `supabase/config.toml` and local linked ref | No CLI linkage file found | Customer explicit |
| Auth session | Browser Supabase auth listener/storage | SSR cookie refresh plus `employees` lookup | Different flows |
| Storage | No storage calls found | No storage calls found | No bucket usage found |

## Schema and object comparison

Customer migrations:

- `trading_accounts`, `instruments`, `orders`, `executions`, `positions`
- `daily_performance`, `risk_events`, `account_metric_snapshots`
- `watchlists`, `watchlist_items`, `journal_entries`, `alerts`
- `terminal_settings`, `terminal_activity`, `provider_config`, `provider_health`
- `products`, `account_phases`, `rule_versions`, `account_rule_assignments`, `account_permissions`
- RPCs `get_active_account_context` and `evaluate_pre_trade_risk`

Terminal OS checked-in SQL and services:

- Legacy SQL declares `employees`, `trading_accounts`, `orders`, `executions`, `positions`, `daily_performance`, `risk_events`, `account_metric_snapshots`, `instruments`, `watchlists`, `watchlist_items`, `journal_entries`, `alerts`, `terminal_settings`, `terminal_activity`, `provider_config`, and `provider_health`.
- A separate migration declares `broker_credentials` and encryption RPCs.
- Current services query `trading_orders`, `account_metrics`, `account_metric_snapshots`, `risk_events`, provider tables, and `employees`.
- Current service documentation explicitly treats `orders` as payment/checkout and `trading_orders` as trading orders.

### Conflicts requiring deliberate resolution after the audit

- Customer migration uses `orders` for trading; Terminal OS service code uses `trading_orders` for trading.
- Customer uses `account_id` and `position_status`; Terminal OS legacy SQL uses `trading_account_id` and `status`, while current services/UI use `is_open`.
- Customer defines `account_metric_snapshots`; Terminal OS current services additionally query `account_metrics`.
- Terminal OS uses `employees` in auth/SQL while newer contract notes refer to `staff_members`.
- Customer defines account-context/risk RPCs; Terminal OS defines broker encryption RPCs. These are different RPC sets.
- Customer migrations include explicit owner policies; Terminal OS legacy SQL enables RLS but contains no explicit policies in the checked-in file, so server-role assumptions require live verification.

## Evidence paths

- Customer client: `src/integrations/supabase/client.ts`
- Customer API: `src/lib/terminalApi.ts`
- Customer migrations: `supabase/migrations/20260917000100_terminal_schema.sql`, `20260921000100_canonical_account_context.sql`, `20260922000100_position_pnl_foundation.sql`
- Customer linkage: `supabase/config.toml`
- Terminal OS clients: `lib/supabase/client.ts`, `lib/supabase/server.ts`, `lib/supabase/middleware-client.ts`, `lib/supabase/route-handler-client.ts`
- Terminal OS auth: `lib/auth/session.ts`, `middleware.ts`
- Terminal OS SQL: `database/schema.sql`, `database/broker_credentials_migration.sql`, `database/broker_encryption_rpc.sql`
- Terminal OS trading services: `server/services/orders.ts`, `executions.ts`, `positions.ts`, `risk.ts`, `accounts.ts`

## Verification boundary

The audit did not query the remote database, list live tables, inspect deployed policies, run cross-account reads, apply migrations, create/drop objects, mutate rows, deploy, or place broker orders. The next controlled action should be a separately approved, read-only remote schema/RLS inventory. Do not merge or migrate automatically based on this report.
