# Task D7-A: E2E Certification Preparation

## Scope and safety

This is a controlled, local certification baseline, not final D7 certification. The new route/session test uses a synthetic customer session and stubs the Terminal shell and realtime test page. Existing market-data and realtime contract tests replace network, WebSocket, and provider-facing boundaries. No customer identity, broker credential, Dhan/Kite/Angel One connection, live order, or live-trading mode is used.

The fixed paper account allowed for realtime test mode is `REALTIME_MOCK_TEST_ACCOUNT_ID` in `src/lib/realtimeMockTestScope.ts`. Order and execution tests must continue to use mocked fetch, in-memory repositories, or mock-safe providers. Do not remove server-side ownership, D3 risk, or D2 persistence checks to get a green result.

## Certification coverage

| # | Check | Preparation coverage | Status |
|---|---|---|---|
| 1 | Customer authentication/session | `taskD7Certification.test.tsx` hydrates a synthetic Supabase session | Runnable |
| 2 | FundedWealth trading-account resolution | `accountContext.test.tsx` | Runnable |
| 3 | Account ownership/isolation | Account-context ownership denial and user/account cache-key tests | Runnable |
| 4 | Opening Main Terminal | D7-A test exercises the protected app route with a stubbed shell | Runnable, route guard only |
| 5 | Terminal OS authentication | `terminalMarketDataApi.test.ts`, `terminalOrderCommandClient.test.ts` | Runnable, mocked gateway |
| 6 | Live market-data gateway | `terminalMarketDataApi.test.ts` | Runnable, mocked gateway |
| 7 | Realtime ticket issuance | `terminalMarketDataApi.test.ts` | Runnable, synthetic paper scope |
| 8 | Railway WSS authentication | `terminalRealtimeClient.test.ts` | Runnable, fake WebSocket |
| 9 | Subscription lifecycle | `terminalRealtimeClient.test.ts`, `task38RealtimeReconnect.test.ts` | Runnable, fake transport |
| 10 | Synthetic market tick reception | `terminalRealtimeClient.test.ts`, `RealtimeMockE2E` fixed test scope | Runnable, synthetic only |
| 11 | Order-entry UI | `instrumentExplorerWorkspace.test.tsx` covers simulated ticket controls, lot sizing, and command payload | Runnable, component-level |
| 12 | Order-command submission | `terminalOrderCommandClient.test.ts` | Runnable, mocked fetch |
| 13 | D3 server-side risk validation | `riskEngine.test.ts`, `databaseConsistency.test.ts` canonical RPC contract | Runnable contract tests; no D7 live-DB order attempt |
| 14 | D2 order/outbox persistence | `databaseConsistency.test.ts`, D2 PostgreSQL verification | Runnable; no new live write |
| 15 | D4 execution-worker integration point | Opt-in read-only D6B check against the persisted mock order | Passed for the existing synthetic record |
| 16 | Fill ingestion | One persisted fill reconciles to the filled order quantity and average price | Passed for the existing synthetic record |
| 17 | Position update | The synthetic position quantity and average price reconcile to the fill | Passed for the existing synthetic record |
| 18 | P&L/valuation update | Position and account P&L/equity aggregates reconcile at the current zero mark | Passed for zero-P&L state only |
| 19 | Account metrics update | Account P&L aggregates match the account's synthetic positions | Passed for the existing synthetic record |
| 20 | Cancel/modify flow | `instrumentExplorerWorkspace.test.tsx` position protection/close controls; `task42BrokerExecutionCertification.test.ts` mock-runtime order lifecycle | Runnable with mocks; final integration pending D4/D5 |
| 21 | Duplicate submission protection | `terminalOrderCommandClient.test.ts`, `databaseConsistency.test.ts` idempotency contract | Runnable, local/mock boundary |
| 22 | Reconnect/recovery behavior | `task38RealtimeReconnect.test.ts`, `terminalRealtimeClient.test.ts` | Runnable, fake transport |
| 23 | Customer/account isolation | `accountContext.test.tsx`, `task42BrokerExecutionCertification.test.ts` | Runnable, synthetic identities |
| 24 | Logout/session expiration | `taskD7Certification.test.tsx` | Runnable, synthetic session |

## Gates

The D7 test file contains two database-backed checks that are skipped by default:

- **D4:** checks the existing D6B order's claimed/completed outbox row, provider acknowledgement, and persisted mock submission response.
- **D5:** checks the single persisted fill, its order totals, matching position, P&L/equity consistency, and audit events.

These database-backed checks are opt-in. They run only when `RUN_D6B_SYNTHETIC_DB_CERTIFICATION=true` and use `SUPABASE_URL` plus a server-only service-role key (`SUPABASE_SERVICE_ROLE_KEY` or the existing Railway `SUPABASE_SECRET_KEY`) from the test process environment (not Vite's client-exposed `VITE_*` namespace). When opted in, missing credentials, a missing synthetic order, or a database error fails the test; it is not converted into a pass. Run them only against the dedicated D6B synthetic test account and database.

**Live read-only result (2026-10-09):** D4 and D5 both passed against the pre-existing D6B synthetic mock order. The order has one persisted fill; the fill, position, order totals, account P&L aggregates, and audit events reconcile. The position and account P&L are zero at the recorded mark. This did not create or modify an order and does not certify nonzero mark-to-market changes, live duplicate/retry behavior, ambiguous-submission recovery, or worker restart recovery. Those remain separate release checks; the worker recovery behavior is covered only by the local mock-safe tests.

Example PowerShell opt-in:

```powershell
$env:RUN_D6B_SYNTHETIC_DB_CERTIFICATION = "true"
$env:SUPABASE_URL = "https://your-test-project.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "<test-project-service-role-key>"
npx vitest run src/test/taskD7Certification.test.tsx
```

## Commands

```powershell
npx vitest run src/test/taskD7Certification.test.tsx src/test/accountContext.test.tsx src/test/instrumentExplorerWorkspace.test.tsx src/test/terminalMarketDataApi.test.ts src/test/terminalRealtimeClient.test.ts src/test/task37RealtimeMarketData.test.ts src/test/task38RealtimeReconnect.test.ts src/test/websocketClient.test.ts src/test/terminalOrderCommandClient.test.ts src/test/riskEngine.test.ts src/test/databaseConsistency.test.ts src/test/task42BrokerExecutionCertification.test.ts --reporter=verbose
npm test
npm run build
```