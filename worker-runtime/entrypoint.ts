import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { hostname } from "node:os";
import { createClient } from "@supabase/supabase-js";
import {
  SupabaseExecutionRepository,
  createExecutionWorker,
  type ProviderExecutionAdapter,
} from "../server/execution";
import type { ProviderExecutionResult } from "../server/execution/types";
import { classifyExecutionError, StructuredLogger } from "../server/hardening";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY;
const syntheticAccountId = process.env.D6B_SYNTHETIC_ACCOUNT_ID;
const syntheticOrderId = process.env.D6B_SYNTHETIC_ORDER_ID;
const port = Number(process.env.PORT ?? 8080);
const crashAfterAck = process.env.D6B_CRASH_AFTER_ACK === "true";
const rejectSyntheticOrder = process.env.D6B_SYNTHETIC_PROVIDER_REJECT === "true";

if (!supabaseUrl || !supabaseKey || !syntheticAccountId || !syntheticOrderId) {
  throw new Error("D6B worker requires Supabase server credentials and an explicit synthetic account/order scope.");
}
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("D6B worker PORT must be a valid TCP port.");
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const logger = new StructuredLogger();
let pollRunning = false;
let lastPollCompletedAt: number | null = null;
let lastPollFailedAt: number | null = null;

function safeErrorCategory(error: unknown): string {
  return classifyExecutionError(error).category;
}

function sendJson(response: ServerResponse, status: number, body: Record<string, unknown>): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

async function checkDatabase(): Promise<boolean> {
  const { data: account, error: accountError } = await supabase
    .from("trading_accounts")
    .select("id, prop_firm, external_account_id")
    .eq("id", syntheticAccountId)
    .maybeSingle();
  if (accountError || account?.id !== syntheticAccountId
    || account?.prop_firm !== "D6B_TEST"
    || account?.external_account_id !== "D6B-SYNTHETIC-ACCOUNT") return false;
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, account_id, client_order_id")
    .eq("id", syntheticOrderId)
    .eq("account_id", syntheticAccountId)
    .maybeSingle();
  if (orderError || order?.id !== syntheticOrderId || !order.client_order_id.startsWith("D6B-SYNTH-")) return false;
  const { data: outbox, error: outboxError } = await supabase
    .from("order_execution_outbox")
    .select("id, order_id, account_id")
    .eq("order_id", syntheticOrderId)
    .eq("account_id", syntheticAccountId)
    .maybeSingle();
  return !outboxError && outbox?.order_id === syntheticOrderId && outbox?.account_id === syntheticAccountId;
}

async function healthHandler(_request: IncomingMessage, response: ServerResponse): Promise<void> {
  let databaseReady = false;
  try {
    databaseReady = await checkDatabase();
  } catch {
    databaseReady = false;
  }
  const loopFresh = lastPollCompletedAt !== null && Date.now() - lastPollCompletedAt < 15_000;
  const loopHealthy = loopFresh && (lastPollFailedAt === null || lastPollFailedAt < lastPollCompletedAt!);
  const status = !databaseReady ? "NOT_READY" : !loopHealthy ? "DEGRADED" : "READY";
  const httpStatus = status === "NOT_READY" ? 503 : status === "DEGRADED" ? 503 : 200;
  sendJson(response, httpStatus, {
    status,
    worker: "alive",
    database: databaseReady ? "connected" : "unavailable_or_scope_mismatch",
    claim_loop: loopHealthy ? "running" : "stale_or_failed",
    last_poll_at: lastPollCompletedAt ? new Date(lastPollCompletedAt).toISOString() : null,
    provider: "mock-safe",
    scope: "single D6B_TEST order",
  });
}

const httpServer = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/healthz") {
    void healthHandler(request, response);
    return;
  }
  sendJson(response, 404, { error: "not_found" });
});

httpServer.listen(port, "0.0.0.0", () => {
  logger.log("info", "d6b.worker.started", { worker_id: hostname(), port, provider: "mock-safe" });
});

const provider: ProviderExecutionAdapter = {
  providerName: "mock-safe",
  mode: "MOCK_SAFE",
  async submitOrder(command): Promise<ProviderExecutionResult> {
    if (command.account_id !== syntheticAccountId || command.order_id !== syntheticOrderId) {
      throw Object.assign(new Error("Synthetic execution scope mismatch."), { code: "D6B_SCOPE_MISMATCH" });
    }
    const { data, error } = await supabase.rpc("d6b_mock_provider_submit", {
      command_payload: command,
      crash_after_acceptance: crashAfterAck,
      reject_order: rejectSyntheticOrder,
    });
    if (error) throw Object.assign(new Error("Synthetic provider persistence failed."), { code: "DB_D6B_PROVIDER" });
    return data as ProviderExecutionResult;
  },
  async getOrderStatus(clientOrderId): Promise<ProviderExecutionResult | null> {
    const { data, error } = await supabase.rpc("d6b_mock_provider_lookup", {
      account_id_value: syntheticAccountId,
      client_order_id_value: clientOrderId,
    });
    if (error) throw Object.assign(new Error("Synthetic provider lookup failed."), { code: "DB_D6B_LOOKUP" });
    return data as ProviderExecutionResult | null;
  },
};

const repository = new SupabaseExecutionRepository(supabase, async (outboxId) => {
  if (!crashAfterAck) return;
  const { data, error } = await supabase.rpc("d6b_mock_provider_consume_crash", {
    outbox_id_value: outboxId,
  });
  if (error) throw Object.assign(new Error("Synthetic restart control failed."), { code: "DB_D6B_CRASH_HOOK" });
  if (data === true) {
    logger.log("warn", "d6b.worker.synthetic_crash_after_ack", {
      order_id: syntheticOrderId,
      account_hint: syntheticAccountId.slice(-4),
      stage: "ack_persisted_before_fill",
      provider: "mock-safe",
      recovery_decision: "railway_restart_requested",
    });
    process.exit(75);
  }
});

const worker = createExecutionWorker(repository, provider, {
  workerId: `d6b-${hostname()}`,
  maxAttempts: 3,
  providerTimeoutMs: 10_000,
  claimScope: { accountId: syntheticAccountId, orderId: syntheticOrderId },
  logger,
});

async function pollOnce(): Promise<void> {
  if (pollRunning) return;
  pollRunning = true;
  try {
    await worker.processNext();
    lastPollCompletedAt = Date.now();
  } catch (error) {
    lastPollFailedAt = Date.now();
    logger.log("error", "d6b.worker.poll_failed", {
      account_hint: syntheticAccountId.slice(-4),
      order_hint: syntheticOrderId.slice(-4),
      stage: "claim_or_process",
      provider: "mock-safe",
      error_category: safeErrorCategory(error),
    });
  } finally {
    pollRunning = false;
  }
}

void pollOnce();
const pollTimer = setInterval(() => void pollOnce(), 1_000);

function shutdown(): void {
  clearInterval(pollTimer);
  httpServer.close(() => process.exit(0));
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);