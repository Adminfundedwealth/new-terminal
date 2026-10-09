import assert from "node:assert/strict";
import test from "node:test";
import { formatDhanChartDateTime } from "./dhan-chart-date-time.mjs";

test("uses Dhan-compatible seconds for date-only and minute-precision input", () => {
  assert.equal(formatDhanChartDateTime("2026-10-08", "09:15:00"), "2026-10-08 09:15:00");
  assert.equal(formatDhanChartDateTime("2026-10-08 09:15", "09:15:00"), "2026-10-08 09:15:00");
});

test("preserves valid second-precision input", () => {
  assert.equal(formatDhanChartDateTime("2026-10-08 09:15:30", "09:15:00"), "2026-10-08 09:15:30");
});

test("rejects malformed or impossible date-time input", () => {
  assert.throws(() => formatDhanChartDateTime("2026-02-30", "09:15:00"), /valid calendar date/);
  assert.throws(() => formatDhanChartDateTime("2026-10-08 25:15", "09:15:00"), /valid calendar date/);
});
