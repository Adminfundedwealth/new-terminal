export type LogLevel = "debug" | "info" | "warn" | "error";

export interface StructuredLogEntry {
  timestamp: string;
  level: LogLevel;
  event: string;
  fields: Record<string, unknown>;
}

const sensitiveKey = /(authorization|access.?token|refresh.?token|secret|password|credential|api.?key|provider.?request|raw.?payload)/i;

function redactText(value: string): string {
  return value
    .replace(/\b(Bearer|token)\s+[A-Za-z0-9._~+\/-]+=*/gi, "$1 [REDACTED]")
    .replace(/\b((?:access|refresh|api)[_-]?(?:token|key)|token|secret|password|credential)\s*[:=]\s*["']?[^\s,"']+/gi, "$1=[REDACTED]")
    .slice(0, 2_000);
}

function redact(value: unknown, key = ""): unknown {
  if (sensitiveKey.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, redact(child, childKey)]));
  }
  if (typeof value === "string") return redactText(value);
  return value;
}

export class StructuredLogger {
  constructor(private readonly write: (serializedEntry: string) => void = (entry) => console.info(entry)) {}

  log(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      event,
      fields: redact(fields) as Record<string, unknown>,
    };
    this.write(JSON.stringify(entry));
  }
}

export interface HealthProbe {
  name: string;
  check: () => Promise<void>;
  timeoutMs?: number;
}

export interface HealthCheckResult {
  status: "ok" | "degraded";
  checks: Array<{ name: string; status: "ok" | "failed" | "timeout" }>;
}

export async function checkReadiness(probes: readonly HealthProbe[]): Promise<HealthCheckResult> {
  const checks = await Promise.all(probes.map(async (probe) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        probe.check(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("probe timeout")), probe.timeoutMs ?? 1_000);
        }),
      ]);
      return { name: probe.name, status: "ok" as const };
    } catch (error) {
      return { name: probe.name, status: error instanceof Error && error.message === "probe timeout" ? "timeout" as const : "failed" as const };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }));

  return { status: checks.every((check) => check.status === "ok") ? "ok" : "degraded", checks };
}

export interface ExecutionMetrics {
  increment(name: string, labels?: Record<string, string>): void;
  observe(name: string, value: number, labels?: Record<string, string>): void;
}

export function recordExecutionOutcome(
  metrics: ExecutionMetrics,
  outcome: string,
  durationMs: number,
  errorCategory?: string,
): void {
  metrics.increment("execution_outcomes_total", { outcome, error_category: errorCategory ?? "none" });
  if (Number.isFinite(durationMs) && durationMs >= 0) metrics.observe("execution_duration_ms", durationMs, { outcome });
}