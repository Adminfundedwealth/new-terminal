import { describe, expect, it } from "vitest";
import { PositionPersistence, type CanonicalPositionRow, type PositionPersistedResult } from "@/lib/positionPersistence";

const accountId = "acc-22";
const ownerUserId = "user-22";
const secondOwner = "user-99";

const execution = (overrides: Record<string, unknown> = {}) => ({
  id: "exec-1",
  orderId: "order-1",
  accountId,
  ownerUserId,
  authUserId: ownerUserId,
  symbol: "NIFTY",
  side: "BUY",
  quantity: 5,
  executionPrice: 100,
  executedAt: "2026-09-24T09:00:00.000Z",
  externalExecutionId: "EXT-1",
  fees: 0,
  taxes: 0,
  netAmount: null,
  instrumentId: "instrument-1",
  ...overrides,
});

const positionRow = (overrides: Partial<CanonicalPositionRow> = {}): CanonicalPositionRow => ({
  id: "pos-1",
  account_id: accountId,
  owner_user_id: ownerUserId,
  instrument_id: "instrument-1",
  symbol: "NIFTY",
  exchange: "NSE",
  quantity: 5,
  side: "long",
  average_price: 100,
  last_price: 100,
  unrealized_pnl: 0,
  realized_pnl: 0,
  stop_loss: null,
  take_profit: null,
  position_status: "open",
  opened_at: "2026-09-24T09:00:00.000Z",
  closed_at: null,
  updated_at: "2026-09-24T09:00:00.000Z",
  ...overrides,
});

describe("Task 22 canonical position persistence", () => {
  it("creates a new LONG position", async () => {
    const persistence = new PositionPersistence();
    const result = await persistence.persistExecution(execution(), { accountId, ownerUserId, instrumentId: "instrument-1", exchange: "NSE" });

    expect(result.replayed).toBe(false);
    expect(result.position).toMatchObject({ account_id: accountId, owner_user_id: ownerUserId, symbol: "NIFTY", side: "long", quantity: 5, position_status: "open" });
  });

  it("creates a new SHORT position", async () => {
    const persistence = new PositionPersistence();
    const result = await persistence.persistExecution(execution({ id: "exec-short-1", side: "SELL", symbol: "BANKNIFTY", externalExecutionId: "EXT-SHORT-1", quantity: 4, executionPrice: 200, instrumentId: "instrument-short" }), { accountId, ownerUserId, instrumentId: "instrument-short", exchange: "NSE" });

    expect(result.position).toMatchObject({ symbol: "BANKNIFTY", side: "short", quantity: 4, average_price: 200, position_status: "open" });
  });

  it("updates an existing LONG position and persists weighted average", async () => {
    const persistence = new PositionPersistence();
    await persistence.persistExecution(execution({ id: "exec-long-1", externalExecutionId: "EXT-LONG-1", quantity: 5, executionPrice: 100 }));
    await persistence.persistExecution(execution({ id: "exec-long-2", externalExecutionId: "EXT-LONG-2", quantity: 3, executionPrice: 110 }));

    const row = persistence.getPosition(accountId, "NIFTY");
    expect(row).toMatchObject({ quantity: 8, side: "long", average_price: 103.75, position_status: "open" });
  });

  it("updates an existing SHORT position and keeps weighted average", async () => {
    const persistence = new PositionPersistence();
    await persistence.persistExecution(execution({ id: "exec-short-1", externalExecutionId: "EXT-SHORT-1", symbol: "INFY", side: "SELL", quantity: 10, executionPrice: 150, instrumentId: "instrument-infy" }));
    await persistence.persistExecution(execution({ id: "exec-short-2", externalExecutionId: "EXT-SHORT-2", symbol: "INFY", side: "SELL", quantity: 6, executionPrice: 160, instrumentId: "instrument-infy" }));

    const row = persistence.getPosition(accountId, "INFY");
    expect(row).toMatchObject({ symbol: "INFY", side: "short", quantity: 16, average_price: 153.75, position_status: "open" });
  });

  it("partially closes a LONG position", async () => {
    const persistence = new PositionPersistence();
    await persistence.persistExecution(execution({ id: "exec-long-open", externalExecutionId: "EXT-LONG-OPEN", quantity: 10, executionPrice: 100 }));
    await persistence.persistExecution(execution({ id: "exec-long-partial-close", externalExecutionId: "EXT-LONG-CLOSE", quantity: 4, executionPrice: 110, side: "SELL", instrumentId: "instrument-1" }));

    const row = persistence.getPosition(accountId, "NIFTY");
    expect(row).toMatchObject({ quantity: 6, side: "long", average_price: 100, position_status: "open" });
  });

  it("fully closes a LONG position and marks it closed", async () => {
    const persistence = new PositionPersistence();
    await persistence.persistExecution(execution({ id: "exec-open-long", externalExecutionId: "EXT-OPEN-LONG", quantity: 8, executionPrice: 100 }));
    await persistence.persistExecution(execution({ id: "exec-close-long", externalExecutionId: "EXT-CLOSE-LONG", quantity: 8, executionPrice: 110, side: "SELL", instrumentId: "instrument-1" }));

    const row = persistence.getPosition(accountId, "NIFTY");
    expect(row).toMatchObject({ quantity: 0, side: "long", position_status: "closed" });
  });

  it("partially closes a SHORT position", async () => {
    const persistence = new PositionPersistence();
    await persistence.persistExecution(execution({ id: "exec-short-open", externalExecutionId: "EXT-SHORT-OPEN", symbol: "TCS", side: "SELL", quantity: 12, executionPrice: 300, instrumentId: "instrument-tcs" }));
    await persistence.persistExecution(execution({ id: "exec-short-partial-buy", externalExecutionId: "EXT-SHORT-BUY", symbol: "TCS", side: "BUY", quantity: 5, executionPrice: 290, instrumentId: "instrument-tcs" }));

    const row = persistence.getPosition(accountId, "TCS");
    expect(row).toMatchObject({ quantity: 7, side: "short", average_price: 300, position_status: "open" });
  });

  it("fully closes a SHORT position and marks it closed", async () => {
    const persistence = new PositionPersistence();
    await persistence.persistExecution(execution({ id: "exec-open-short", externalExecutionId: "EXT-OPEN-SHORT", symbol: "RELIANCE", side: "SELL", quantity: 6, executionPrice: 2500, instrumentId: "instrument-reliance" }));
    await persistence.persistExecution(execution({ id: "exec-close-short", externalExecutionId: "EXT-CLOSE-SHORT", symbol: "RELIANCE", side: "BUY", quantity: 6, executionPrice: 2600, instrumentId: "instrument-reliance" }));

    const row = persistence.getPosition(accountId, "RELIANCE");
    expect(row).toMatchObject({ quantity: 0, side: "short", position_status: "closed" });
  });

  it("reverses LONG to SHORT and SHORT to LONG with the correct new side", async () => {
    const persistence = new PositionPersistence();
    await persistence.persistExecution(execution({ id: "exec-long-reverse-open", externalExecutionId: "EXT-LONG-REV-OPEN", quantity: 5, executionPrice: 100 }));
    await persistence.persistExecution(execution({ id: "exec-long-reverse-close", externalExecutionId: "EXT-LONG-REV-CLOSE", quantity: 7, executionPrice: 105, side: "SELL", instrumentId: "instrument-1" }));

    const longReverse = persistence.getPosition(accountId, "NIFTY");
    expect(longReverse).toMatchObject({ quantity: 2, side: "short", average_price: 105, position_status: "open" });

    const shortPersistence = new PositionPersistence();
    await shortPersistence.persistExecution(execution({ id: "exec-short-reverse-open", externalExecutionId: "EXT-SHORT-REV-OPEN", symbol: "NIFTY", side: "SELL", quantity: 5, executionPrice: 100, instrumentId: "instrument-1" }));
    await shortPersistence.persistExecution(execution({ id: "exec-short-reverse-close", externalExecutionId: "EXT-SHORT-REV-CLOSE", symbol: "NIFTY", side: "BUY", quantity: 7, executionPrice: 95, instrumentId: "instrument-1" }));

    const shortReverse = shortPersistence.getPosition(accountId, "NIFTY");
    expect(shortReverse).toMatchObject({ quantity: 2, side: "long", average_price: 95, position_status: "open" });
  });

  it("rejects duplicate execution events and repeated ingestion", async () => {
    const persistence = new PositionPersistence();
    const first = await persistence.persistExecution(execution());
    const second = await persistence.persistExecution(execution());

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(persistence.getPositions()).toHaveLength(1);
  });

  it("rejects unauthorized account ownership and forged rows", async () => {
    const persistence = new PositionPersistence();
    await expect(persistence.persistExecution(execution({ ownerUserId: secondOwner }), { accountId, ownerUserId, instrumentId: "instrument-1", exchange: "NSE" })).rejects.toThrow(/owner|account/i);

    const row = positionRow({ account_id: accountId, owner_user_id: secondOwner });
    await expect(persistence.upsertRow(row, { accountId, ownerUserId })).rejects.toThrow(/owner/i);
  });

  it("rejects invalid position data", async () => {
    const persistence = new PositionPersistence();
    await expect(persistence.upsertRow(positionRow({ quantity: -2, side: "middle" as never }), { accountId, ownerUserId })).rejects.toThrow(/quantity|side/i);
  });

  it("serializes concurrent updates for the same account + instrument", async () => {
    const persistence = new PositionPersistence();
    const queue = [
      execution({ id: "c1", externalExecutionId: "C-1", quantity: 3, executionPrice: 100, instrumentId: "instrument-serial" }),
      execution({ id: "c2", externalExecutionId: "C-2", quantity: 2, executionPrice: 110, instrumentId: "instrument-serial" }),
      execution({ id: "c3", externalExecutionId: "C-3", quantity: 1, executionPrice: 120, instrumentId: "instrument-serial" }),
    ];

    await Promise.all(queue.map((item) => persistence.persistExecution(item, { accountId, ownerUserId, instrumentId: "instrument-serial", exchange: "NSE" })));
    const row = persistence.getPosition(accountId, "NIFTY");
    expect(row?.quantity).toBe(6);
  });

  it("rehydrates the same authoritative state after persistence and reload", async () => {
    const persistence = new PositionPersistence();
    await persistence.persistExecution(execution({ id: "persist-open", externalExecutionId: "EXT-PERSIST-OPEN", quantity: 7, executionPrice: 100 }));
    await persistence.persistExecution(execution({ id: "persist-close", externalExecutionId: "EXT-PERSIST-CLOSE", quantity: 3, executionPrice: 105, side: "SELL", instrumentId: "instrument-1" }));

    const reloaded = new PositionPersistence(persistence.exportRows());
    expect(reloaded.getPosition(accountId, "NIFTY")).toMatchObject({ quantity: 4, side: "long", average_price: 100, position_status: "open" });
  });
});
