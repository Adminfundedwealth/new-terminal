import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationDirectory = resolve(process.cwd(), "supabase/migrations");
const approvedMigrationName = "20261117000300_simulated_orders_use_central_market_data.sql";
const approvedMigrationSha256 = "01cfc4c3d811716c72514702aa1e6ca67668315f98552cee7c682e89a770c62b";

describe("Supabase migration-chain contract", () => {
  it("uses unique migration versions", () => {
    const versions = readdirSync(migrationDirectory)
      .filter((name) => name.endsWith(".sql"))
      .map((name) => name.match(/^(\d{14})_/)?.[1]);

    expect(versions.every(Boolean)).toBe(true);
    expect(new Set(versions).size).toBe(versions.length);
    expect(Number(approvedMigrationName.match(/^(\d{14})_/)?.[1])).toBeGreaterThan(20261117000200);
  });

  it("pins the simulated execution migration content", () => {
    const migrationPath = resolve(migrationDirectory, approvedMigrationName);
    const migrationBytes = readFileSync(migrationPath);
    const sha256 = createHash("sha256").update(migrationBytes).digest("hex");

    expect(sha256).toBe(approvedMigrationSha256);
  });
});
