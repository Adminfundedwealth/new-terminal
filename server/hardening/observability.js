const sensitiveKey = /(authorization|access.?token|refresh.?token|secret|password|credential|api.?key|provider.?request|raw.?payload)/i;
function redactText(value) {
    return value
        .replace(/\b(Bearer|token)\s+[A-Za-z0-9._~+\/-]+=*/gi, "$1 [REDACTED]")
        .replace(/\b((?:access|refresh|api)[_-]?(?:token|key)|token|secret|password|credential)\s*[:=]\s*["']?[^\s,"']+/gi, "$1=[REDACTED]")
        .slice(0, 2000);
}
function redact(value, key = "") {
    if (sensitiveKey.test(key))
        return "[REDACTED]";
    if (Array.isArray(value))
        return value.map((item) => redact(item));
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, redact(child, childKey)]));
    }
    if (typeof value === "string")
        return redactText(value);
    return value;
}
export class StructuredLogger {
    constructor(write = (entry) => console.info(entry)) {
        Object.defineProperty(this, "write", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: write
        });
    }
    log(level, event, fields = {}) {
        const entry = {
            timestamp: new Date().toISOString(),
            level,
            event,
            fields: redact(fields),
        };
        this.write(JSON.stringify(entry));
    }
}
export async function checkReadiness(probes) {
    const checks = await Promise.all(probes.map(async (probe) => {
        let timer;
        try {
            await Promise.race([
                probe.check(),
                new Promise((_, reject) => {
                    timer = setTimeout(() => reject(new Error("probe timeout")), probe.timeoutMs ?? 1000);
                }),
            ]);
            return { name: probe.name, status: "ok" };
        }
        catch (error) {
            return { name: probe.name, status: error instanceof Error && error.message === "probe timeout" ? "timeout" : "failed" };
        }
        finally {
            if (timer)
                clearTimeout(timer);
        }
    }));
    return { status: checks.every((check) => check.status === "ok") ? "ok" : "degraded", checks };
}
export function recordExecutionOutcome(metrics, outcome, durationMs, errorCategory) {
    metrics.increment("execution_outcomes_total", { outcome, error_category: errorCategory ?? "none" });
    if (Number.isFinite(durationMs) && durationMs >= 0)
        metrics.observe("execution_duration_ms", durationMs, { outcome });
}
