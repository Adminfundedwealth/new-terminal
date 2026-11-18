import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationDirectory = resolve(process.cwd(), "supabase/migrations");
const approvedMigrationName = "20261117000300_simulated_orders_use_central_market_data.sql";

describe("Supabase migration-chain contract", () => {
  it("uses unique migration versions", () => {
    const versions = readdirSync(migrationDirectory)
      .filter((name) => name.endsWith(".sql"))
      .map((name) => name.match(/^(\d{14})_/)?.[1]);

    expect(versions.every(Boolean)).toBe(true);
    expect(new Set(versions).size).toBe(versions.length);
    expect(Number(approvedMigrationName.match(/^(\d{14})_/)?.[1])).toBeGreaterThan(20261117000200);
  });

  it("keeps simulated execution independent of broker bindings", () => {
    const migrationPath = resolve(migrationDirectory, approvedMigrationName);
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toContain("add column if not exists execution_mode text");
    expect(migration).toContain("if account_row.execution_mode <> 'simulated'");
    expect(migration).toContain("EXECUTION_MODE_UNSUPPORTED");
    expect(migration).toContain("old_provider_requirement");
    expect(migration).toContain("function_definition := replace");
  });
});
