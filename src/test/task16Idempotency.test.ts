import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260924000500_task16_idempotency.sql"), "utf8");

describe("Task 16 server-authoritative idempotency contract", () => {
  it("uses the canonical orders row, request fingerprint, ownership, and locking", () => {
    expect(migration).toContain("alter table public.orders");
    expect(migration).toContain("idempotency_fingerprint text");
    expect(migration).toContain("select * into existing_order from public.orders");
    expect(migration).toContain("for update;");
    expect(migration).toContain("IDEMPOTENCY_KEY_CONFLICT");
    expect(migration).toContain("where id = account_id_value and owner_user_id = auth.uid()");
    expect(migration).not.toContain("create table public.trading_orders");
  });

  it("serializes concurrent claims with the canonical unique key", () => {
    expect(migration).toContain("create unique index if not exists orders_account_client_order_uidx");
    expect(migration).toContain("when unique_violation then");
    expect(migration).toContain("'replayed', true");
    expect(migration).toContain("grant execute on function public.create_order(jsonb) to authenticated");
  });
});