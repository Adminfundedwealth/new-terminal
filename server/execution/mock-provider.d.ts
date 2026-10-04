import type { ExecutionCommand, ProviderExecutionAdapter, ProviderExecutionFill, ProviderExecutionResult } from "./types";
export interface MockExecutionProviderOptions {
    brokerId?: string;
    fillRatio?: number;
    rejectionReason?: string;
    submitOrder?: (command: ExecutionCommand) => Promise<any>;
    getOrderStatus?: (clientOrderId: string) => Promise<any>;
    afterSubmit?: (command: ExecutionCommand, result: ProviderExecutionResult) => Promise<void>;
}
export declare class MockSafeExecutionProvider implements ProviderExecutionAdapter {
    private readonly options;
    readonly providerName = "mock-safe";
    readonly mode: "MOCK_SAFE";
    private readonly statusMap;
    private readonly fillRatio;
    private readonly rejectionReason;
    constructor(options?: MockExecutionProviderOptions);
    submitOrder(command: ExecutionCommand): Promise<ProviderExecutionResult>;
    getOrderStatus(clientOrderId: string): Promise<ProviderExecutionResult | null>;
    createFill(command: ExecutionCommand, price: number, quantity?: number): ProviderExecutionFill;
    settleOrder(command: ExecutionCommand, price: number): Promise<ProviderExecutionResult>;
    rejectOrder(command: ExecutionCommand): Promise<ProviderExecutionResult>;
}
export declare function createMockExecutionProvider(options?: MockExecutionProviderOptions): MockSafeExecutionProvider;
export declare function createMockProvider(options?: MockExecutionProviderOptions): MockSafeExecutionProvider;
