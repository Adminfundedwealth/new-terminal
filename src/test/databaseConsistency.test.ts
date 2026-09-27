import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");
const migrationFiles = readdirSync(migrationsDirectory).filter((file) => file.endsWith(".sql")).sort();
const migrationSql = migrationFiles.map((file) => readFileSync(resolve(migrationsDirectory, file), "utf8")).join("\n");

describe("canonical database consistency", () => {
  it("has unique, deterministically ordered migration versions", () => {
    const versions = migrationFiles.map((file) => file.split("_")[0]);
    expect(new Set(versions).size).toBe(versions.length);
    expect(versions).toEqual([...versions].sort());
  });

  it("defines one canonical trading-state table for each required entity", () => {
    for (const table of [
      "trading_accounts",
      "orders",
      "executions",
      "positions",
      "daily_performance",
      "risk_events",
      "account_metric_snapshots",
      "products",
      "account_phases",
      "rule_versions",
      "account_rule_assignments",
      "rule_audit_log",
    ]) {
      expect((migrationSql.match(new RegExp(`create table(?: if not exists)? public\\.${table}\\b`, "g")) ?? [])).toHaveLength(1);
    }
  });

  it("keeps ownership, account relationships, lifecycle, and customer read boundaries canonical", () => {
    expect(migrationSql).toContain("unique (id, owner_user_id)");
    expect(migrationSql).toContain("foreign key (account_id, owner_user_id) references public.trading_accounts(id, owner_user_id)");
    expect(migrationSql).toContain("create trigger trading_accounts_lifecycle_guard");
    expect(migrationSql).toContain("create trigger trading_accounts_owner_immutable");
    expect(migrationSql).toContain("create policy trading_accounts_customer_read");
    expect(migrationSql).toContain("create policy account_metric_snapshots_customer_read");
    expect(migrationSql).toContain("revoke insert, update, delete, truncate, references, trigger");
  });

  it("keeps RPCs authenticated and tied to the canonical account owner", () => {
    for (const rpc of [
      "get_active_account_context(uuid)",
      "evaluate_pre_trade_risk(jsonb)",
      "transition_trading_account(uuid, text, text)",
      "evaluate_account_challenge(uuid)",
    ]) {
      expect(migrationSql).toContain(`grant execute on function public.${rpc} to authenticated`);
      expect(migrationSql).toContain("auth.uid() is null");
    }
    expect(migrationSql).toContain("where id = requested_account_id and owner_user_id = auth.uid()");
  });

  it("keeps order identity, lifecycle, quantities, and relationships on the canonical orders table", () => {
    expect(migrationSql).toContain("add column if not exists client_order_id text");
    expect(migrationSql).toContain("orders_account_client_order_uidx");
    expect(migrationSql).toContain("orders_filled_quantity_check");
    expect(migrationSql).toContain("orders_status_check");
    expect(migrationSql).toContain("orders_parent_order_fk");
    expect(migrationSql).toContain("orders_replaces_order_fk");
    expect(migrationSql).not.toContain("create table public.trading_orders");
  });

  it("blocks direct customer order mutations while preserving read access", () => {
    expect(migrationSql).toContain("drop policy if exists orders_owner on public.orders");
    expect(migrationSql).toContain("create policy orders_customer_read");
  });

  it("defines the atomic authoritative order transition RPC and persistent audit", () => {
    expect(migrationSql).toContain("create or replace function public.transition_order_status(");
    expect(migrationSql).toContain("and account_id = requested_account_id");
    expect(migrationSql).toContain("and owner_user_id = auth.uid()");
    expect(migrationSql).toContain("for update;");
    expect(migrationSql).toContain("set_config('app.order_lifecycle_transition', 'allowed', true)");
    expect(migrationSql).toContain("insert into public.terminal_activity");
    expect(migrationSql).toContain("'order_lifecycle_transitioned'");
    expect(migrationSql).toContain("grant execute on function public.transition_order_status(uuid, uuid, text, text) to authenticated");
  });

  it("extends the existing rule and risk control plane without duplicating canonical tables", () => {
    expect(migrationSql).toContain("create or replace function public.manage_rule_configuration(request jsonb)");
    expect(migrationSql).toContain("grant execute on function public.manage_rule_configuration(jsonb) to service_role");
    expect(migrationSql).toContain("create table if not exists public.rule_audit_log");
    expect(migrationSql).toContain("create or replace function public.evaluate_pre_trade_risk(request jsonb)");
    expect(migrationSql).toContain("max_position_lots");
    expect(migrationSql).toContain("weekend_trading_allowed");
    expect(migrationSql).toContain("news_restrictions");
    expect(migrationSql).toContain("max_leverage");
    expect(migrationSql).toContain("consistency_max_daily_profit_percent");
    expect(migrationSql).toContain("maximum_trading_days");
    expect(migrationSql).toContain("create trigger executions_apply_canonical_position");
    expect(migrationSql).toContain("create trigger positions_refresh_canonical_account_metrics");
    expect(migrationSql).toContain("create or replace function public.expire_due_trading_accounts()");
    expect(migrationSql).not.toContain("create table public.risk_rules");
    expect(migrationSql).not.toContain("create table public.account_metrics");
  });

  it("includes the real fundedwealth plan and rule definitions in the canonical database", () => {
    expect(migrationSql).toContain("'FLASH'");
    expect(migrationSql).toContain("'INSTANT'");
    expect(migrationSql).toContain("'1-STEP'");
    expect(migrationSql).toContain("'2-STEP'");
    expect(migrationSql).toContain("'duration_hours'");
    expect(migrationSql).toContain("max_loss_per_trade_percent");
    expect(migrationSql).toContain("daily_drawdown_percent");
    expect(migrationSql).toContain("max_drawdown_percent");
    expect(migrationSql).toContain("profit_split_percent");
    expect(migrationSql).toContain("consistency_requirement_percent");
    expect(migrationSql).toContain("payout_threshold_percent");
    expect(migrationSql).toContain("max_risk_per_trade_percent");
    expect(migrationSql).toContain("min_trading_days");
  });
});