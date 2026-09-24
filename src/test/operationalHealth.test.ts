import { describe, expect, it } from "vitest";
import { aggregateOperationalHealth, classifyMarketFreshness } from "@/lib/operationalHealth";

describe("operational health", () => {
  it("aggregates subsystem health conservatively", () => {
    expect(aggregateOperationalHealth([])).toBe("UNKNOWN");
    expect(aggregateOperationalHealth([{ name: "db", status: "HEALTHY", checkedAt: "now" }])).toBe("HEALTHY");
    expect(aggregateOperationalHealth([
      { name: "db", status: "HEALTHY", checkedAt: "now" },
      { name: "ws", status: "UNKNOWN", checkedAt: "now" },
    ])).toBe("DEGRADED");
    expect(aggregateOperationalHealth([
      { name: "db", status: "FAILED", checkedAt: "now" },
      { name: "ws", status: "HEALTHY", checkedAt: "now" },
    ])).toBe("FAILED");
  });

  it("rejects invalid, future, and stale market timestamps", () => {
    expect(classifyMarketFreshness(null, 10_000)).toBe("INVALID");
    expect(classifyMarketFreshness(11_000, 10_000)).toBe("STALE");
    expect(classifyMarketFreshness(1_000, 20_000, 5_000)).toBe("STALE");
    expect(classifyMarketFreshness(19_000, 20_000, 5_000)).toBe("FRESH");
  });
});
