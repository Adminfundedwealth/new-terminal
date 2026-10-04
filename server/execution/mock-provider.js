export class MockSafeExecutionProvider {
    constructor(options = {}) {
        Object.defineProperty(this, "options", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: options
        });
        Object.defineProperty(this, "providerName", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: "mock-safe"
        });
        Object.defineProperty(this, "mode", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: "MOCK_SAFE"
        });
        Object.defineProperty(this, "statusMap", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new Map()
        });
        Object.defineProperty(this, "fillRatio", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "rejectionReason", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        this.fillRatio = options.fillRatio ?? 0.6;
        this.rejectionReason = options.rejectionReason ?? "Mock-safe provider rejected the order for a deterministic paper test";
        if (typeof options.getOrderStatus === "function") {
            this.getOrderStatus = options.getOrderStatus.bind(this);
        }
    }
    async submitOrder(command) {
        if (this.options.submitOrder) {
            const result = await this.options.submitOrder(command);
            this.statusMap.set(command.client_order_id, result);
            await this.options.afterSubmit?.(command, result);
            return result;
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
        const result = {
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
    async getOrderStatus(clientOrderId) {
        return this.statusMap.get(clientOrderId) ?? null;
    }
    createFill(command, price, quantity = command.quantity) {
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
    async settleOrder(command, price) {
        const result = await this.submitOrder(command);
        if (!result.ok) {
            return result;
        }
        const fill = this.createFill(command, price, Math.max(1, Math.min(command.quantity, command.quantity)));
        const settled = {
            ...result,
            state: this.fillRatio >= 1 ? "FILLED" : "PARTIALLY_FILLED",
            message: "Mock-safe provider executed the paper fill.",
            fills: [fill],
        };
        this.statusMap.set(command.client_order_id, settled);
        return settled;
    }
    async rejectOrder(command) {
        const result = {
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
export function createMockExecutionProvider(options = {}) {
    return new MockSafeExecutionProvider(options);
}
export function createMockProvider(options = {}) {
    return createMockExecutionProvider(options);
}
