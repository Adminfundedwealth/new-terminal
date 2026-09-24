import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260923000400_task7_rls_security.sql"),
  "utf8",
);
const lifecycleMigration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260923000100_account_lifecycle.sql"),
  "utf8",
);
const ownershipMigration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260923000200_immutable_account_ownership.sql"),
  "utf8",
);

const customerTables = [
  "trading_accounts",
  "orders",
  "executions",
  "positions",
  "daily_performance",
  "risk_events",
  "account_metric_snapshots",
];

describe("canonical customer RLS contract", () => {
  it("uses authenticated owner-scoped read policies for every canonical table", () => {
    for (const table of customerTables) {
      expect(migration).toMatch(new RegExp(`create policy [^\\n]+ on public\\.${table}`));
      expect(migration).toMatch(new RegExp(`on public\\.${table}[\\s\\S]*?for select to authenticated`));
      expect(migration).toMatch(new RegExp(`public\\.${table}[\\s\\S]*?owner_user_id = auth\\.uid\\(\\)`));
    }
  });

  it("removes customer mutation privileges from canonical state", () => {
    expect(migration).toContain("revoke insert, update, delete, truncate, references, trigger");
    expect(migration).toContain("from anon, authenticated");
    expect(migration).toContain("revoke select, insert, update, delete, truncate, references, trigger");
    expect(migration).toMatch(/from anon;/);
    for (const table of customerTables) expect(migration).toContain(`public.${table}`);
    expect(migration).not.toMatch(/create policy [^\n]+ for all to authenticated/);
  });

  it("models user A/B isolation and rejects forged child account ids", () => {
    expect(migration).toContain("using (owner_user_id = auth.uid())");
    for (const table of customerTables.slice(1)) {
      expect(migration).toMatch(
        new RegExp(`public\\.${table}[\\s\\S]*?owner_user_id = auth\\.uid\\(\\)[\\s\\S]*?exists \\(\\s*select 1 from public\\.trading_accounts`),
      );
      expect(migration).toMatch(
        new RegExp(`public\\.${table}[\\s\\S]*?a\\.id = ${table}\\.account_id and a\\.owner_user_id = auth\\.uid\\(\\)`),
      );
    }
  });

  it("keeps authoritative account fields read-only to customers", () => {
    expect(migration).toContain("public.trading_accounts");
    expect(migration).toContain("public.account_metric_snapshots");
    expect(migration).toContain("from anon, authenticated");
    expect(lifecycleMigration).toContain("Status changes are accepted only through transition_trading_account()");
    expect(ownershipMigration).toContain("before update of owner_user_id");
  });

  it("keeps ownership immutable and lifecycle changes RPC-only", () => {
    expect(ownershipMigration).toContain("trading account ownership cannot be changed");
    expect(lifecycleMigration).toContain("create policy trading_accounts_owner_read");
    expect(lifecycleMigration).toContain("grant execute on function public.transition_trading_account");
    expect(lifecycleMigration).toContain("account not found or not owned by current user");
  });

  it("does not expose internal helper functions to PUBLIC", () => {
    for (const functionName of [
      "validate_account_rule_assignment",
      "log_account_control_change",
      "enforce_account_lifecycle",
      "prevent_trading_account_owner_change",
      "validate_terminal_active_account",
      "set_account_context_updated_at",
    ]) expect(migration).toContain(`revoke all on function public.${functionName}()`);
  });

  it("requires authentication for the customer RPCs and rejects forged ownership", () => {
    for (const functionName of [
      "get_active_account_context",
      "evaluate_pre_trade_risk",
      "transition_trading_account",
      "evaluate_account_challenge",
    ]) expect(migration).toContain(`revoke all on function public.${functionName}`);
    expect(lifecycleMigration).toContain("if auth.uid() is null then");
  });
});