# Task 14: Broker Response Handling

## Boundary

The authoritative handler is `src/lib/brokerResponseHandler.ts`. It normalizes adapter/runtime responses into one internal contract:

- `outcome`: `accepted`, `rejected`, `pending`, `transport_error`, `timeout`, `malformed`, or `unknown`
- `brokerOrderId`
- `brokerStatus`
- `brokerCode`
- `brokerMessage`
- `timestamp`
- `clientOrderId`

Canonical order status changes go through `src/lib/orderStateMachine.ts`. Accepted and pending responses transition a requested order to `pending`; accepted responses require a broker order id. Rejections transition to `rejected` and preserve the normalized broker message. Transport, timeout, and unknown outcomes remain non-rejected and use the existing `pending` state because the current Task 13 model has no separate unknown state.

## Security and ownership

The handler requires the authenticated account and user context, validates the expected internal order and client order identifiers, and delegates transition authorization to Task 13. It is a server-side library boundary; the frontend has no API for submitting broker responses or mutating canonical order fields. No broker callback/webhook verification mechanism is currently present in this repository, so production callback security remains a later platform task.

## Adapter and fill boundary

The Dhan runtime and the generic broker adapter contract were inspected. Angel One, Zerodha, Upstox, FivePaisa, Fyers, and AliceBlue adapters expose normalized read contracts, while live order placement remains disabled or unverified. This task does not add fill records or positions. Existing `ExecutionService.syncBrokerOrder` remains the pre-existing fill/position path and must be replaced or formalized under Task 20 before execution data is treated as authoritative.

## Verification

- Focused Task 14 and execution tests: passed, 12 tests.
- Task 9-13 regression: passed, 7 files and 53 tests.
- Production build: passed.
- TypeScript: passed with no diagnostics.
- Full customer suite: passed, 27 files and 207 tests.
- Lint: passed with 0 errors and existing warnings only.
- Local runtime: Vite returned HTTP 200 and rendered the root mount.
- No live broker order was submitted and no remote migration was applied.
