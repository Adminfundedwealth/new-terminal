import type {
  ExecutionCommand,
  ProviderExecutionAdapter,
  ProviderExecutionFill,
  ProviderExecutionResult,
} from "./types";

export interface MockExecutionProviderOptions {
  brokerId?: string;
  fillRatio?: number;
  rejectionReason?: string;
  submitOrder?: (command: ExecutionCommand) => Promise<any>;
  getOrderStatus?: (clientOrderId: string) => Promise<any>;
  afterSubmit?: (command: ExecutionCommand, result: ProviderExecutionResult) => Promise<void>;
}

export class MockSafeExecutionProvider implements ProviderExecutionAdapter {
  readonly providerName = "mock-safe";
  readonly mode = "MOCK_SAFE" as const;

  private readonly statusMap = new Map<string, ProviderExecutionResult>();
  private readonly fillRatio: number;
  private readonly rejectionReason: string;

  constructor(private readonly options: MockExecutionProviderOptions = {}) {
    this.fillRatio = options.fillRatio ?? 0.6;
    this.rejectionReason = options.rejectionReason ?? "Mock-safe provider rejected the order for a deterministic paper test";

    if (typeof options.getOrderStatus === "function") {
      this.getOrderStatus = options.getOrderStatus.bind(this);
    }
  }

  async submitOrder(command: ExecutionCommand): Promise<ProviderExecutionResult> {
    if (this.options.submitOrder) {
      const result = await this.options.submitOrder(command);
      this.statusMap.set(command.client_order_id, result as ProviderExecutionResult);
      await this.options.afterSubmit?.(command, result as ProviderExecutionResult);
      return result as ProviderExecutionResult;
    }

    if (!command || !command.client_order_id || !command.account_id || !command.user_id) {
      return {
        ok: false,
        state: "REJECTED",
        broker_order_id: `mock-rejected-${Date.now()}`,
        client_order_id: command?.client_order_id ?? "unknown",
        message: "Mock provider requires a valid command payload.",
      };
    }

    if (command.quantity <= 0) {
      return {
        ok: false,
        state: "REJECTED",
        broker_order_id: `mock-rejected-${Date.now()}`,
        client_order_id: command.client_order_id,
        message: "Mock provider rejects non-positive quantity orders.",
      };
    }

    const brokerOrderId = `mock-${(this.options.brokerId ?? "safe").toLowerCase()}-${command.account_id.slice(-8)}-${Date.now()}`;
    const result: ProviderExecutionResult = {
      ok: true,
      state: "ACK",
      broker_order_id: brokerOrderId,
      client_order_id: command.client_order_id,
      message: "Mock-safe provider accepted the order in paper mode.",
      fills: [],
    };

    this.statusMap.set(command.client_order_id, result);
    await this.options.afterSubmit?.(command, result);
    return result;
  }

  async getOrderStatus(clientOrderId: string): Promise<ProviderExecutionResult | null> {
    return this.statusMap.get(clientOrderId) ?? null;
  }

  createFill(command: ExecutionCommand, price: number, quantity = command.quantity): ProviderExecutionFill {
    return {
      brokerExecutionId: `fill-${command.client_order_id}-${Date.now()}`,
      brokerOrderId: `mock-${(this.options.brokerId ?? "safe").toLowerCase()}-${command.account_id.slice(-8)}-${Date.now()}`,
      localOrderId: command.order_id,
      accountId: command.account_id,
      symbol: command.symbol,
      side: command.side,
      quantity,
      price,
      executedAt: new Date().toISOString(),
      fees: 0,
    };
  }

  async settleOrder(command: ExecutionCommand, price: number): Promise<ProviderExecutionResult> {
    const result = await this.submitOrder(command);
    if (!result.ok) {
      return result;
    }

    const fill = this.createFill(command, price, Math.max(1, Math.min(command.quantity, command.quantity)));
    const settled: ProviderExecutionResult = {
      ...result,
      state: this.fillRatio >= 1 ? "FILLED" : "PARTIALLY_FILLED",
      message: "Mock-safe provider executed the paper fill.",
      fills: [fill],
    };
    this.statusMap.set(command.client_order_id, settled);
    return settled;
  }

  async rejectOrder(command: ExecutionCommand): Promise<ProviderExecutionResult> {
    const result: ProviderExecutionResult = {
      ok: false,
      state: "REJECTED",
      broker_order_id: `mock-rejected-${command.client_order_id}`,
      client_order_id: command.client_order_id,
      message: this.rejectionReason,
      fills: [],
    };
    this.statusMap.set(command.client_order_id, result);
    return result;
  }
}

export function createMockExecutionProvider(options: MockExecutionProviderOptions = {}): MockSafeExecutionProvider {
  return new MockSafeExecutionProvider(options);
}

export function createMockProvider(options: MockExecutionProviderOptions = {}): MockSafeExecutionProvider {
  return createMockExecutionProvider(options);
}
