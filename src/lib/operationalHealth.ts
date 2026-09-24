export type OperationalHealthStatus = "HEALTHY" | "DEGRADED" | "FAILED" | "UNKNOWN";

export interface OperationalHealthCheck {
  name: string;
  status: OperationalHealthStatus;
  checkedAt: string;
  detail?: string;
}

export function aggregateOperationalHealth(checks: OperationalHealthCheck[]): OperationalHealthStatus {
  if (checks.length === 0) return "UNKNOWN";
  if (checks.some((check) => check.status === "FAILED")) return "FAILED";
  if (checks.some((check) => check.status === "DEGRADED" || check.status === "UNKNOWN")) return "DEGRADED";
  return "HEALTHY";
}

export function classifyMarketFreshness(timestamp: number | null | undefined, now = Date.now(), maxAgeMs = 15_000): "FRESH" | "STALE" | "INVALID" {
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp) || timestamp <= 0) return "INVALID";
  if (timestamp > now || now - timestamp > maxAgeMs) return "STALE";
  return "FRESH";
}
