import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { InMemoryFillDeduplicator, decideRestartRecovery, classifyExecutionError, withExecutionTimeout, checkReadiness, recordExecutionOutcome, StructuredLogger, } from "../../server/hardening";
import { accountRateLimitKey, authorizeAccountAccess, InMemoryCommandIdempotencyStore, InMemoryRateLimitStore, } from "../../server/hardening/security";
describe("D6 independent production hardening", () => {
    it("preserves D2 account-scoped uniqueness and service-role-only outbox access", () => {
        const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261001000200_task_d2_durable_order_lifecycle.sql"), "utf8");
        expect(migration).toContain("unique (account_id, client_order_id)");
        expect(migration).toContain("revoke all on public.order_execution_outbox from public, anon, authenticated");
        expect(migration).toContain("grant select, insert, update on public.order_execution_outbox to service_role");
    });
    it("recovers only expired claims and reconciles uncertain submissions before retry", () => {
        expect(decideRestartRecovery({ claimExpired: false, submissionStarted: false, attempts: 0, maxAttempts: 3, providerLookup: "not_checked" })).toBe("wait");
        expect(decideRestartRecovery({ claimExpired: true, submissionStarted: true, attempts: 1, maxAttempts: 3, providerLookup: "found" })).toBe("reconcile");
        expect(decideRestartRecovery({ claimExpired: true, submissionStarted: true, attempts: 1, maxAttempts: 3, providerLookup: "unavailable" })).toBe("manual_review");
        expect(decideRestartRecovery({ claimExpired: true, submissionStarted: true, attempts: 1, maxAttempts: 3, providerLookup: "not_found" })).toBe("retry");
        expect(decideRestartRecovery({ claimExpired: true, submissionStarted: false, attempts: 3, maxAttempts: 3, providerLookup: "not_checked" })).toBe("manual_review");
    });
    it("classifies a submit timeout as ambiguous and does not recommend blind retry", async () => {
        await expect(withExecutionTimeout(new Promise(() => undefined), 5, "Provider submit"))
            .rejects.toMatchObject({ category: "timeout", requiresReconciliation: true });
        expect(classifyExecutionError({ code: "ETIMEDOUT" })).toMatchObject({ category: "timeout", retryable: false, requiresReconciliation: true });
        expect(classifyExecutionError({ status: 429 })).toMatchObject({ category: "rate_limit", retryable: true });
        expect(classifyExecutionError({ status: 401 })).toMatchObject({ category: "authentication", retryable: false });
    });
    it("serializes duplicate commands by account and rejects key reuse with a different fingerprint", async () => {
        const store = new InMemoryCommandIdempotencyStore();
        const operation = vi.fn(async () => ({ commandId: "command-1" }));
        const [first, concurrentReplay] = await Promise.all([
            store.executeOnce("acct-a", "client-1", "hash-1", operation),
            store.executeOnce("acct-a", "client-1", "hash-1", operation),
        ]);
        expect([first.status, concurrentReplay.status].sort()).toEqual(["created", "replayed"]);
        expect(operation).toHaveBeenCalledTimes(1);
        expect(await store.executeOnce("acct-a", "client-1", "hash-2", operation)).toEqual({ status: "conflict" });
        expect((await store.executeOnce("acct-b", "client-1", "hash-1", operation)).status).toBe("created");
    });
    it("deduplicates fills within an account without leaking identity across accounts", async () => {
        const fills = new InMemoryFillDeduplicator();
        expect(await fills.applyFillOnce("acct-a", "fill-1", { quantity: 1 })).toBe("applied");
        expect(await fills.applyFillOnce("acct-a", "fill-1", { quantity: 1 })).toBe("duplicate");
        expect(await fills.applyFillOnce("acct-b", "fill-1", { quantity: 1 })).toBe("applied");
    });
    it("fails account authorization closed and partitions rate limits by authenticated dimensions", async () => {
        const ownerOf = async (accountId) => accountId === "acct-a" ? "user-a" : "user-b";
        expect(await authorizeAccountAccess(null, "acct-a", ownerOf)).toEqual({ allowed: false, reason: "unauthenticated" });
        expect(await authorizeAccountAccess({ subject: "user-a" }, "acct-b", ownerOf)).toEqual({ allowed: false, reason: "account_forbidden" });
        expect(await authorizeAccountAccess({ subject: "user-a" }, "acct-a", ownerOf)).toEqual({ allowed: true });
        const store = new InMemoryRateLimitStore(2);
        const accountA = accountRateLimitKey("user-a", "acct-a", "order-create");
        const accountB = accountRateLimitKey("user-a", "acct-b", "order-create");
        expect((await store.consume(accountA, 1, 1000, 1000)).allowed).toBe(true);
        expect((await store.consume(accountA, 1, 1000, 1001)).allowed).toBe(false);
        expect((await store.consume(accountB, 1, 1000, 1001)).allowed).toBe(true);
        expect((await store.consume("new-key", 1, 1000, 1001)).allowed).toBe(false);
    });
    it("redacts secrets, exposes bounded readiness checks, and emits monitoring metrics", async () => {
        const output = [];
        new StructuredLogger((line) => output.push(line)).log("info", "execution.started", {
            account_id: "acct-a",
            authorization: "Bearer secret-token",
            nested: { api_key: "private" },
            message: "Provider failed with token=embedded-token",
        });
        expect(output[0]).not.toContain("secret-token");
        expect(output[0]).not.toContain("private");
        expect(output[0]).not.toContain("embedded-token");
        expect(output[0]).toContain("acct-a");
        const readiness = await checkReadiness([
            { name: "database", check: async () => undefined },
            { name: "queue", timeoutMs: 5, check: () => new Promise(() => undefined) },
        ]);
        expect(readiness).toEqual({ status: "degraded", checks: [{ name: "database", status: "ok" }, { name: "queue", status: "timeout" }] });
        const metrics = {
            calls: [],
            increment(name) { this.calls.push(name); },
            observe(name) { this.calls.push(name); },
        };
        recordExecutionOutcome(metrics, "accepted", 12, "none");
        expect(metrics.calls).toEqual(["execution_outcomes_total", "execution_duration_ms"]);
    });
});
describe("D6 hardening load regression", () => {
    it("bounds rate-limit state and enforces concurrent command replay protection", async () => {
        const rateLimits = new InMemoryRateLimitStore(1000);
        const requests = await Promise.all(Array.from({ length: 2000 }, (_, index) => rateLimits.consume(`principal-${index % 100}`, 10, 60000, 10000)));
        expect(requests.filter((request) => request.allowed)).toHaveLength(1000);
        const idempotency = new InMemoryCommandIdempotencyStore();
        let executions = 0;
        const contenders = await Promise.all(Array.from({ length: 100 }, () => idempotency.executeOnce("acct-load", "shared-command", "canonical-hash", async () => ({ execution: ++executions }))));
        expect(executions).toBe(1);
        expect(contenders.filter((result) => result.status === "created")).toHaveLength(1);
        expect(contenders.filter((result) => result.status === "replayed")).toHaveLength(99);
    });
});
