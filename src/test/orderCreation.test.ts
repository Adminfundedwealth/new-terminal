import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260924000300_task12_order_creation.sql"),
  "utf8",
);
const normalizationMigration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260924000100_task9_order_normalization.sql"),
  "utf8",
);

describe("Task 12 authoritative order creation contract", () => {
  it("uses one authenticated server boundary and the canonical orders table", () => {
    expect(migration).toContain("create or replace function public.create_order(request jsonb)");
    expect(migration).toContain("if auth.uid() is null");
    expect(migration).toContain("where id = account_id_value and owner_user_id = auth.uid()");
    expect(migration).toContain("insert into public.orders");
    expect(migration).not.toContain("create table public.trading_orders");
    expect(migration).not.toContain("placeBrokerOrder");
    expect(migration).not.toContain("brokerAdapter");
  });

  it("runs validation before the mandatory Task 11 risk gate and persists only requested orders", () => {
    expect(migration.indexOf("INVALID_QUANTITY")).toBeLessThan(migration.indexOf("public.evaluate_pre_trade_risk"));
    expect(migration).toContain("if risk_result->>'decision' <> 'ALLOW'");
    expect(migration).toContain("time_in_force, status, created_at, updated_at");
    expect(migration).toContain("'requested', now_value, now_value");
    expect(migration).toContain("estimated_loss', case when price_value is null then null else quantity_value * price_value * 0.01 end");
    expect(migration).not.toContain("request->>'estimated_loss'");
  });

  it("derives identity and canonical ids, and makes retries deterministic", () => {
    expect(migration).toContain("order_id_value uuid := gen_random_uuid()");
    expect(migration).toContain("auth.uid(), client_order_id_value");
    expect(normalizationMigration).toContain("orders_account_client_order_uidx");
    expect(migration).toContain("'replayed', true");
    expect(migration).toContain("'PERSISTENCE_FAILURE'");
  });

  it("exposes the RPC only to authenticated callers", () => {
    expect(migration).toContain("revoke all on function public.create_order(jsonb) from public, anon");
    expect(migration).toContain("grant execute on function public.create_order(jsonb) to authenticated");
  });
});