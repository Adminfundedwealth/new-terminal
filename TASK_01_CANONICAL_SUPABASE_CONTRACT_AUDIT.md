# TASK 01 — CANONICAL SUPABASE CONTRACT AUDIT

## Final status: PARTIAL

This task is not yet PASS because the two projects do not currently share one authoritative, verified Supabase contract for trading state.

The current evidence shows both projects point to the same Supabase host and project reference, but they still define competing trading-state schemas and application contracts. The repo does not contain one verified canonical database contract for trading accounts, orders, executions, positions, metrics, or risk state.

---

## 1. Before-state

Before this audit, the evidence in the two projects showed:

- New Terminal and Terminal OS both resolve to the same host: https://zxqwtqlbrlegwdodjhiq.supabase.co
- Both use the same project reference: zxqwtqlbrlegwdodjhiq
- The app and server code are configured for the same current Supabase project
- The checked-in database contracts are not aligned across the two projects
- The New Terminal contains a browser-facing schema and migration set
- Terminal OS contains a different database schema and different account/order/position naming conventions
- The application state is not yet proven to be derived from one authoritative database contract

This is consistent with a PARTIAL canonical-state task, not a PASS.

---

## 2. Current Supabase configuration for both projects

### 2.1 New Terminal

Files reviewed:

- [.env](.env)
- [supabase/config.toml](supabase/config.toml)
- [src/integrations/supabase/client.ts](src/integrations/supabase/client.ts)
- [src/lib/terminalApi.ts](src/lib/terminalApi.ts)

Current config:

- Supabase URL: https://zxqwtqlbrlegwdodjhiq.supabase.co
- Project reference: zxqwtqlbrlegwdodjhiq
- Publishable key: [redacted in repo history; not committed]
- Client pattern: browser client with a shared preview storage wrapper
- Runtime pattern: createClient from @supabase/supabase-js using VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY

The New Terminal uses browser Supabase access and RPC calls like:

- get_active_account_context
- evaluate_pre_trade_risk
- trading_accounts
- terminal_settings

### 2.2 Terminal OS

Files reviewed:

- [../TERMINAL-OS/.env.local](../TERMINAL-OS/.env.local)
- [../TERMINAL-OS/lib/supabase/client.ts](../TERMINAL-OS/lib/supabase/client.ts)
- [../TERMINAL-OS/lib/supabase/server.ts](../TERMINAL-OS/lib/supabase/server.ts)
- [../TERMINAL-OS/database/schema.sql](../TERMINAL-OS/database/schema.sql)

Current config:

- Supabase URL: https://zxqwtqlbrlegwdodjhiq.supabase.co
- Project reference: zxqwtqlbrlegwdodjhiq
- Publishable key: [redacted in repo history; not committed]
- Secret key: [redacted in repo history; not committed]
- Client pattern: browser client via NEXT_PUBLIC_TERMINAL_SUPABASE_URL and NEXT_PUBLIC_TERMINAL_SUPABASE_PUBLISHABLE_KEY
- Server pattern: createClient with TERMINAL_SUPABASE_URL and TERMINAL_SUPABASE_SECRET_KEY

Important: Terminal OS explicitly declares a dev-mode stub for server access when the secret is missing or placeholder-only, meaning the server path is not a hardened production contract yet.

### 2.3 Current project alignment

The two projects currently share the same host and project ID, which is the minimum requirement for same-project linkage. That part is aligned.

The remaining issue is not project identity; it is schema and state contract alignment.

---

## 3. Schema comparison

### 3.1 New Terminal schema

Files reviewed:

- [supabase/migrations/20260917000100_terminal_schema.sql](supabase/migrations/20260917000100_terminal_schema.sql)
- [supabase/migrations/20260921000100_canonical_account_context.sql](supabase/migrations/20260921000100_canonical_account_context.sql)
- [supabase/migrations/20260922000100_position_pnl_foundation.sql](supabase/migrations/20260922000100_position_pnl_foundation.sql)

Canonical tables in the New Terminal include:

- public.trading_accounts
- public.orders
- public.executions
- public.positions
- public.daily_performance
- public.risk_events
- public.account_metric_snapshots
- public.watchlists
- public.watchlist_items
- public.terminal_settings
- public.products
- public.account_phases
- public.rule_versions
- public.account_permissions

The New Terminal also defines a canonical account context RPC:

- get_active_account_context(requested_account_id uuid default null)
- evaluate_pre_trade_risk(request jsonb)

Important New Terminal contract features:

- owner_user_id is the ownership anchor
- account_id + owner_user_id are used in composite key relationships
- order and execution tables are keyed by owner_user_id and account_id
- a canonical account context function is designed to return the current active account and risk context

### 3.2 Terminal OS schema

File reviewed:

- [../TERMINAL-OS/database/schema.sql](../TERMINAL-OS/database/schema.sql)

Terminal OS schema includes:

- employees
- trading_accounts
- orders
- executions
- positions
- daily_performance
- risk_events
- account_metric_snapshots
- instruments
- watchlists
- watchlist_items
- journal_entries
- alerts

The Terminal OS schema is not identical to the New Terminal schema. It uses different field names and different ownership patterns, for example:

- trading_account_id instead of account_id in several tables
- provider_order_id instead of external_order_id
- provider_execution_id instead of external_execution_id
- order status strings differ from the New Terminal migration contract
- the account model is not fully aligned with the New Terminal contract

---

## 4. Contract conflicts found

### 4.1 Different account ownership models

New Terminal:

- trading_accounts includes owner_user_id
- foreign keys often use (account_id, owner_user_id)
- account ownership is enforced via auth.uid()

Terminal OS:

- trading_accounts includes owner_user_id, but the schema is a different contract and not aligned to the New Terminal schema
- there is no demonstrable single same authoritative account table contract between the two projects

### 4.2 Different order models

New Terminal order table design includes fields such as:

- account_id
- owner_user_id
- external_order_id
- instrument_id
- price
- average_fill_price
- submitted_at
- completed_at

Terminal OS order table design includes:

- trading_account_id
- provider_order_id
- queue-style order fields
- status values not identical to the New Terminal schema

These are not the same contract.

### 4.3 Different execution models

New Terminal execution table design includes:

- account_id
- owner_user_id
- order_id
- external_execution_id
- execution_price
- fees
- taxes
- net_amount

Terminal OS execution table uses:

- order_id
- trading_account_id
- fill_price
- execution_status
- provider_execution_id

This is a different representation of the same lifecycle concept.

### 4.4 Different position models

New Terminal positions use:

- account_id
- owner_user_id
- instrument_id
- symbol
- average_price
- unrealized_pnl
- realized_pnl
- position_status

Terminal OS positions use:

- trading_account_id
- average_price
- ltp
- status
- different conventions for open/close state

These are not the same canonical state definition.

### 4.5 Different metrics and risk-state patterns

New Terminal includes:

- daily_performance
- account_metric_snapshots
- risk_events
- account_permissions
- rule_versions
- products
- account_phases

Terminal OS includes its own daily_performance, risk_events, and account_metric_snapshots but does not share the same table naming and risk model.

### 4.6 Different auth/user mapping

New Terminal uses browser auth + Supabase auth with auth.uid() and the account owner model.

Terminal OS explicitly supports a dev-mode path and a browser client plus server client with a separate server secret. The auth model is not proven to bind to the same customer ownership contract or to the same signed account data model.

### 4.7 Duplicate trading-state representations remain

The two projects still maintain duplicate application-level trading state representations:

- New Terminal: public.* tables and RPC contracts
- Terminal OS: a separate schema.sql contract with its own trading tables

This is exactly the win condition that Task 1 is meant to eliminate.

---

## 5. Changes made

This audit did not rewrite the database or alter runtime code. The task objective is to establish the canonical contract, but the current evidence does not justify making a schema change without a single verified contract in place.

The only change made for this task is the audit file itself:

- [TASK_01_CANONICAL_SUPABASE_CONTRACT_AUDIT.md](TASK_01_CANONICAL_SUPABASE_CONTRACT_AUDIT.md)

No unrelated application code, no second Supabase project, and no alternate database were introduced.

---

## 6. Final canonical contract

The final canonical contract that should exist for Task 1 is the smallest safe contract required by the current app and roadmap:

- One Supabase project: zxqwtqlbrlegwdodjhiq
- One authoritative trading state for:
  - trading_accounts
  - orders
  - executions
  - positions
  - account_metric_snapshots
  - risk_events
  - account ownership / identity mapping
- Ownership enforced via auth.uid() and account owner checks
- No duplicate competing app-side or server-side trading schema
- One contract used by both the New Terminal and Terminal OS

The current repo does not yet contain that unified contract. The two schemas still conflict.

---

## 7. Security / RLS verification

### Verified points

- Both projects use Supabase auth and environment-configured keys
- New Terminal has account-scoped RPC logic and ownership checks in [src/lib/terminalApi.ts](src/lib/terminalApi.ts)
- The New Terminal migration file includes owner_user_id constraints and account ownership-based relationships
- Terminal OS server access is separate and uses a server secret in .env.local

### Not fully verified

The project does not yet prove this for the current state:

- one customer cannot access another customer’s trading account
- order/account/position access is rejected outside the correct account ownership boundary
- Terminal OS staff RLS and access are compatible with the same authoritative tables
- the same database contract is enforced by both applications

Because the contracts are misaligned, the current security posture is not proven to be a single canonical and safe model.

---

## 8. Tests

### Existing tests run

The New Terminal test command was run via the repository shell and did not complete cleanly within the allowable runtime window.

Evidence:

- Vitest started with the project and produced a test run banner, but did not finish with a pass/fail summary in the available terminal output.
- This means the test suite is not yet a valid proof point for the canonical database contract.

Terminal OS typecheck was also not proven in a clean terminal run with explicit final exit output. No final positive result was obtained for the database contract gate.

### Conclusion on tests

The project does not have an actual proven green test run for this canonical contract.

---

## 9. Runtime verification

The two apps were not proven to run a single canonical state flow end to end.

Evidence:

- The New Terminal was started locally but did not finish with a stable runtime proof of canonical account/order/execution/position state flow
- The Terminal OS server setup is separate and not proven to be reading the same trading tables under one unified contract
- No verified runtime proof exists that both apps read and write the same canonical database tables and functions

Therefore Task 1 cannot be marked PASS on runtime evidence.

---

## 10. Remaining blockers

The remaining blockers are specific and concrete:

1. Same project identity exists, but the current database schema is not unified.
2. New Terminal and Terminal OS each define separate trading-state contracts.
3. The account/order/execution/position schemas are not the same.
4. Ownership, account context, and RLS enforcement are not yet demonstrated as one single unified contract.
5. There is no verified single authoritative trading state used by both apps.
6. No runtime proof shows both apps read the same canonical account/order/execution/position data.
7. No test evidence proves the canonical contract for this task.

---

## 11. Final decision

### TASK 1: PARTIAL

### Evidence

- Both projects currently point to the same Supabase host and project reference.
- The New Terminal and Terminal OS do not share the same authoritative trading-state schema.
- The checked-in account/order/execution/position/risk contracts conflict.
- No single runtime-verified canonical database contract is proven.

### Changes

- Audit document created: [TASK_01_CANONICAL_SUPABASE_CONTRACT_AUDIT.md](TASK_01_CANONICAL_SUPABASE_CONTRACT_AUDIT.md)
- No code or migration rewrite was applied because the current contract is not yet safe to unify without a verified canonical schema.

### Tests

- Existing tests were not able to provide a clean canonical-contract pass for this task.

### Runtime

- No verified runtime proof exists showing both projects share one canonical trading state.

### Remaining

- Unify the two current database contracts into one authoritative schema
- Prove both apps use that same contract with live compatible queries
- Prove RLS and account ownership at runtime
- Prove a single canonical order/execution/position/metrics/risk model

This task stops here at PARTIAL, as required, and does not advance to Task 2.
