import { normalizeExecution, type CanonicalExecution, type ExecutionInput } from "./executionModel";

export interface BrokerExecutionEvent {
  brokerExecutionId: string;
  brokerOrderId: string;
  localOrderId: string;
  accountId: string;
  ownerUserId?: string;
  symbol: string;
  side: string;
  quantity: number;
  price: number;
  executedAt: string | Date;
  fees?: number;
  taxes?: number;
  netAmount?: number | null;
  instrumentId?: string | null;
}

export interface ExecutionIngestionContext {
  authUserId: string;
  source: "broker" | "internal";
}

export interface PersistedExecutionResult {
  execution: CanonicalExecution;
  replayed: boolean;
}

export interface ExecutionPersistence {
  persistExecution(input: ExecutionInput, context: ExecutionIngestionContext): Promise<PersistedExecutionResult>;
}

interface ExecutionRpcClient {
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
}

function requiredPayloadText(payload: Record<string, unknown>, keys: string[], name: string): string {
  const value = keys.map((key) => payload[key]).find((candidate) => typeof candidate === "string" && candidate.trim() !== "");
  if (typeof value !== "string") throw new Error(`${name} is required`);
  return value;
}

export function normalizeBrokerExecutionEvent(event: unknown, context: ExecutionIngestionContext): ExecutionInput {
  if (!event || typeof event !== "object") throw new Error("Malformed broker execution payload");
  if (!context.authUserId || (context.source !== "broker" && context.source !== "internal")) {
    throw new Error("Authenticated internal execution source is required");
  }
  const payload = event as Record<string, unknown>;
  const brokerExecutionId = requiredPayloadText(payload, ["brokerExecutionId", "execution_id", "trade_id", "fill_id"], "brokerExecutionId");
  requiredPayloadText(payload, ["brokerOrderId", "broker_order_id", "order_id"], "brokerOrderId");
  const localOrderId = requiredPayloadText(payload, ["localOrderId", "local_order_id", "order_id"], "localOrderId");
  const accountId = requiredPayloadText(payload, ["accountId", "account_id"], "accountId");
  const ownerUserId = payload.ownerUserId ?? payload.owner_user_id;
  if (ownerUserId != null && ownerUserId !== context.authUserId) throw new Error("Execution owner does not match authenticated source");

  const normalized = normalizeExecution({
    orderId: localOrderId,
    accountId,
    ownerUserId: typeof ownerUserId === "string" ? ownerUserId : context.authUserId,
    authUserId: context.authUserId,
    instrumentId: (payload.instrumentId ?? payload.instrument_id) as string | null | undefined,
    symbol: requiredPayloadText(payload, ["symbol", "tradingsymbol", "trading_symbol"], "symbol"),
    side: requiredPayloadText(payload, ["side", "transaction_type", "transactionType"], "side"),
    quantity: (payload.quantity ?? payload.filled_quantity ?? payload.filledQuantity) as number,
    executionPrice: (payload.price ?? payload.execution_price ?? payload.executionPrice ?? payload.fill_price) as number,
    executedAt: (payload.executedAt ?? payload.executed_at ?? payload.trade_time ?? payload.order_timestamp) as string | Date,
    externalExecutionId: brokerExecutionId,
    fees: (payload.fees ?? payload.fee) as number | undefined,
    taxes: payload.taxes as number | undefined,
    netAmount: (payload.netAmount ?? payload.net_amount) as number | null | undefined,
  });
  return { ...normalized, authUserId: context.authUserId };
}

export function createSupabaseExecutionPersistence(client: ExecutionRpcClient): ExecutionPersistence {
  return {
    async persistExecution(input, context) {
      const { data, error } = await client.rpc("ingest_execution", {
        request: {
          source: context.source,
          auth_user_id: context.authUserId,
          account_id: input.accountId,
          owner_user_id: input.ownerUserId,
          order_id: input.orderId,
          external_execution_id: input.externalExecutionId,
          instrument_id: input.instrumentId,
          symbol: input.symbol,
          side: input.side.toLowerCase(),
          quantity: input.quantity,
          execution_price: input.executionPrice,
          executed_at: input.executedAt,
          fees: input.fees ?? 0,
          taxes: input.taxes ?? 0,
          net_amount: input.netAmount,
        },
      });
      if (error) throw new Error(error.message);
      const result = data as { replayed?: boolean; execution?: {
        id: string;
        order_id: string;
        account_id: string;
        owner_user_id: string;
        instrument_id: string | null;
        symbol: string;
        side: string;
        quantity: number;
        execution_price: number;
        executed_at: string;
        external_execution_id: string | null;
        fees: number;
        taxes: number;
        net_amount: number | null;
      } } | null;
      if (!result?.execution) throw new Error("Execution ingestion returned no canonical execution");
      const row = result.execution;
      return {
        replayed: result.replayed === true,
        execution: normalizeExecution({
          id: row.id,
          orderId: row.order_id,
          accountId: row.account_id,
          ownerUserId: row.owner_user_id,
          authUserId: context.authUserId,
          instrumentId: row.instrument_id,
          symbol: row.symbol,
          side: row.side,
          quantity: row.quantity,
          executionPrice: row.execution_price,
          executedAt: row.executed_at,
          externalExecutionId: row.external_execution_id,
          fees: row.fees,
          taxes: row.taxes,
          netAmount: row.net_amount,
        }),
      };
    },
  };
}

export async function ingestBrokerExecution(
  event: unknown,
  context: ExecutionIngestionContext,
  persistence: ExecutionPersistence,
): Promise<PersistedExecutionResult> {
  const input = normalizeBrokerExecutionEvent(event, context);
  return persistence.persistExecution(input, context);
}