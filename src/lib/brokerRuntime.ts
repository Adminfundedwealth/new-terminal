import type { BrokerId } from "./brokerAdapter";

export interface BrokerCredentialsBundle {
  apiKey?: string;
  apiSecret?: string;
  accessToken?: string;
  clientId?: string;
  clientSecret?: string;
  password?: string;
  totpSecret?: string;
  jwtToken?: string;
}

export interface BrokerAccountMapping {
  id: string;
  accountId: string;
  ownerUserId: string;
  brokerProvider: BrokerId;
  brokerAccountRef: string;
  enabled: boolean;
  active: boolean;
}

export interface BrokerRuntimeAccount {
  id: string;
  ownerUserId: string;
  status: "ACTIVE" | "LOCKED" | "BREACHED" | string;
  isActive: boolean;
  brokerProvider: BrokerId;
  brokerAccountRef: string;
}

export interface BrokerOrderRequest {
  accountId: string;
  authUserId: string;
  brokerId: BrokerId;
  symbol: string;
  exchange: string;
  side: "BUY" | "SELL";
  quantity: number;
  orderType: string;
  price?: number;
  stopLoss?: number;
  takeProfit?: number;
  clientOrderId?: string;
}

export interface BrokerExecution {
  brokerExecutionId: string;
  brokerOrderId: string;
  localOrderId: string;
  accountId: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
  executedAt: string;
  fees?: number;
}

export interface BrokerOrderStatus {
  status: "ACK" | "OPEN" | "PARTIALLY_FILLED" | "FILLED" | "REJECTED" | "CANCELLED" | "UNKNOWN";
  brokerOrderId: string;
  clientOrderId?: string;
  message?: string;
  fills: BrokerExecution[];
}

export interface BrokerRuntime {
  getBrokerCredentials(): Promise<Record<string, string>>;
  getBrokerAccount(accountId: string, authUserId: string): Promise<BrokerRuntimeAccount | null>;
  validateBrokerSession(brokerProvider: BrokerId, brokerAccountRef: string, authUserId: string): Promise<boolean>;
  placeBrokerOrder(request: BrokerOrderRequest): Promise<{ ok: boolean; state: "ACK" | "REJECTED" | "PENDING" | "UNKNOWN"; brokerOrderId: string; clientOrderId?: string; message?: string; fills?: BrokerExecution[]; }>;
  getBrokerOrderStatus(brokerOrderId: string, accountId: string, authUserId: string): Promise<BrokerOrderStatus | null>;
  getBrokerPositions(accountId: string, authUserId: string): Promise<Array<{ symbol: string; quantity: number; averagePrice: number; currentPrice: number }>>;
  normalizeBrokerExecution(fill: BrokerExecution): BrokerExecution;
}

export function createMockBrokerRuntime(config: {
  brokerAccountRef?: string;
  calls?: Array<Record<string, unknown>>;
  orderAcks?: Record<string, { ok: boolean; state: "ACK" | "REJECTED" | "PENDING" | "UNKNOWN"; brokerOrderId: string; message?: string; }>; 
  orderStatusMap?: Record<string, BrokerOrderStatus>;
} = {}): BrokerRuntime & { calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = config.calls ?? [];
  const statusMap: Record<string, BrokerOrderStatus> = { ...config.orderStatusMap };

  const runtime: BrokerRuntime & { calls: Array<Record<string, unknown>> } = {
    calls,
    async getBrokerCredentials() {
      const env = typeof process !== "undefined" ? process.env : {};
      return {
        apiKey: env.DHAN_API_KEY ?? "mock-dhan-api-key",
        accessToken: env.DHAN_ACCESS_TOKEN ?? "mock-dhan-access-token",
      };
    },
    async getBrokerAccount(accountId: string, authUserId: string) {
      if (!accountId || !authUserId) return null;
      return {
        id: accountId,
        ownerUserId: authUserId,
        status: "ACTIVE",
        isActive: true,
        brokerProvider: "dhan",
        brokerAccountRef: config.brokerAccountRef ?? "dhan-acct-1",
      };
    },
    async validateBrokerSession(brokerProvider: BrokerId, brokerAccountRef: string, authUserId: string) {
      return brokerProvider === "dhan" && !!brokerAccountRef && !!authUserId;
    },
    async placeBrokerOrder(request) {
      const payload = { ...request, placedAt: new Date().toISOString() };
      calls.push(payload);

      const existingAck = config.orderAcks?.[request.clientOrderId ?? request.symbol];
      const brokerOrderId = existingAck?.brokerOrderId ?? `broker-${request.accountId}-${Date.now()}`;
      const orderStatus: BrokerOrderStatus = statusMap[brokerOrderId] ?? {
        status: "ACK",
        brokerOrderId,
        clientOrderId: request.clientOrderId,
        message: "Mock broker accepted the order",
        fills: [],
      };

      if (existingAck) {
        return {
          ok: existingAck.ok,
          state: existingAck.state,
          brokerOrderId: existingAck.brokerOrderId,
          clientOrderId: request.clientOrderId,
          message: existingAck.message ?? "mock broker response",
          fills: orderStatus.fills,
        };
      }

      const ack = { ok: true, state: "ACK" as const, brokerOrderId, clientOrderId: request.clientOrderId, message: "Mock broker accepted the order", fills: orderStatus.fills };
      statusMap[brokerOrderId] = orderStatus;
      return ack;
    },
    async getBrokerOrderStatus(brokerOrderId: string, _accountId: string, _authUserId: string) {
      if (!brokerOrderId) return null;
      const status = statusMap[brokerOrderId];
      if (status) return status;
      return {
        status: "UNKNOWN",
        brokerOrderId,
        fills: [],
      };
    },
    async getBrokerPositions() {
      return [{ symbol: "NIFTY", quantity: 0, averagePrice: 0, currentPrice: 0 }];
    },
    normalizeBrokerExecution(fill) {
      return {
        ...fill,
        quantity: Math.max(0, Number(fill.quantity) || 0),
        price: Number(fill.price) || 0,
        executedAt: fill.executedAt || new Date().toISOString(),
        fees: Number(fill.fees ?? 0),
      };
    },
  };

  return runtime;
}
