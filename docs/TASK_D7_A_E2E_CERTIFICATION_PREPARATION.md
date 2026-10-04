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
| 15 | D4 execution-worker integration point | Explicit skipped D7 assertion | **PENDING D4** |
| 16 | Fill ingestion | Execution completion is not asserted by D7-A | **PENDING D4/D5** |
| 17 | Position update | Execution completion is not asserted by D7-A | **PENDING D4/D5** |
| 18 | P&L/valuation update | Execution completion is not asserted by D7-A | **PENDING D4/D5** |
| 19 | Account metrics update | Execution completion is not asserted by D7-A | **PENDING D4/D5** |
| 20 | Cancel/modify flow | `instrumentExplorerWorkspace.test.tsx` position protection/close controls; `task42BrokerExecutionCertification.test.ts` mock-runtime order lifecycle | Runnable with mocks; final integration pending D4/D5 |
| 21 | Duplicate submission protection | `terminalOrderCommandClient.test.ts`, `databaseConsistency.test.ts` idempotency contract | Runnable, local/mock boundary |
| 22 | Reconnect/recovery behavior | `task38RealtimeReconnect.test.ts`, `terminalRealtimeClient.test.ts` | Runnable, fake transport |
| 23 | Customer/account isolation | `accountContext.test.tsx`, `task42BrokerExecutionCertification.test.ts` | Runnable, synthetic identities |
| 24 | Logout/session expiration | `taskD7Certification.test.tsx` | Runnable, synthetic session |

## Gates

The D7 test file contains two skipped tests so Vitest reports the unfinished gates instead of representing them as passes:

- **PENDING D4:** connect the certified order/outbox boundary to the finalized D4 worker and assert its authoritative handoff/recovery contract.
- **PENDING D5:** add only the downstream final-execution assertions after D5 is finalized. Fill, position, valuation, and account-metric results are not certified by this preparation task.

Existing worker, mock-provider, and broker-runtime tests remain unit/contract evidence only; they are not substituted for these pending D7 integration assertions.

## Commands

```powershell
npx vitest run src/test/taskD7Certification.test.tsx src/test/accountContext.test.tsx src/test/instrumentExplorerWorkspace.test.tsx src/test/terminalMarketDataApi.test.ts src/test/terminalRealtimeClient.test.ts src/test/task37RealtimeMarketData.test.ts src/test/task38RealtimeReconnect.test.ts src/test/websocketClient.test.ts src/test/terminalOrderCommandClient.test.ts src/test/riskEngine.test.ts src/test/databaseConsistency.test.ts src/test/task42BrokerExecutionCertification.test.ts --reporter=verbose
npm test
npm run build
```