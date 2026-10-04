import type { AccountStatus } from "@/lib/accountLifecycle";
import type { RiskRequest } from "@/lib/riskEngine";
import type { Instrument } from "@/lib/localDatabase";
import type { OptionData } from "@/lib/mockData";
import { type CanonicalOrder } from "@/lib/orderModel";
declare const TERMINAL_OS_BASE: any;
export interface TerminalAccount {
    id: string;
    account_code: string | null;
    trader_id: string;
    broker_provider: string | null;
    balance: number;
    status: AccountStatus;
    available_margin?: number;
    used_margin?: number;
}
export interface AccountContext {
    identity: {
        trader_id: string;
    };
    account: Record<string, unknown> & {
        id: string;
        owner_user_id: string;
    };
    product: Record<string, unknown>;
    phase: Record<string, unknown>;
    rules: Record<string, unknown>;
    permissions: Record<string, boolean>;
    risk_state: {
        status?: "ACTIVE" | "WARNING" | "LOCKED" | "BREACHED";
        daily_loss?: number;
        drawdown_amount?: number;
        profit_target?: number | null;
        profit_current?: number;
        latest_snapshot: Record<string, unknown> | null;
        open_events: number;
    };
}
export interface PreTradeRiskRequest {
    account_id: string;
    symbol: string;
    segment?: string;
    side: "BUY" | "SELL";
    quantity: number;
    order_type: string;
    requested_price?: number;
    estimated_loss?: number;
    is_overnight?: boolean;
}
export interface PreTradeRiskDecision {
    decision: "ALLOW" | "REJECT";
    reason_code: string | null;
    reason: string;
    account_id: string;
    rule_evaluated: string | null;
    current_value: number | string | null;
    configured_limit: number | string | boolean | null;
    timestamp: string;
}
export interface CreateOrderRequest {
    account_id: string;
    client_order_id?: string;
    symbol: string;
    exchange: string;
    segment?: string;
    side: "BUY" | "SELL";
    quantity: number;
    order_type: "MARKET" | "LIMIT" | "SL" | "SL-M" | "STOP" | "STOP-LIMIT";
    price?: number;
    trigger_price?: number;
    stop_loss?: number;
    take_profit?: number;
    time_in_force?: "DAY" | "IOC" | "GTC";
    product?: "CNC" | "MIS" | "NRML";
    is_overnight?: boolean;
    instrument?: Instrument;
}
export interface CreateOrderResponse {
    ok: boolean;
    replayed?: boolean;
    order?: Record<string, unknown>;
    risk?: PreTradeRiskDecision;
    error?: {
        code: string;
        message: string;
    };
}
interface AccountsResponse {
    data: TerminalAccount[];
    meta: {
        total: number;
        page: number;
        page_size: number;
        has_more?: boolean;
    };
}
export type TerminalOrderCommandRequest = Omit<CreateOrderRequest, "account_id" | "client_order_id" | "instrument"> & {
    account_id: string;
    client_order_id: string;
};
/** Customer command boundary; the gateway derives provider routing server-side. */
export declare function submitTerminalOrderCommand(request: TerminalOrderCommandRequest): Promise<CreateOrderResponse>;
export interface TerminalHealthCheck {
    name: string;
    status: string;
    response_time_ms: number | null;
    last_success_at: string | null;
    last_error: string | null;
    checked_at: string;
}
interface SystemHealthResponse {
    data: TerminalHealthCheck[];
    checked_at: string;
}
export interface TerminalDashboardSummary {
    total_accounts: number;
    active_accounts: number;
    orders_today: number;
    executions_today: number;
    open_positions: number;
    total_exposure: number;
    risk_events_today: number;
}
interface PaginatedResponse<T> {
    data: T[];
    meta: {
        total: number;
        page: number;
        page_size: number;
        has_more?: boolean;
    };
}
export interface TerminalPosition {
    id: string;
    trading_account_id: string;
    account_id?: string;
    instrument_id?: string | null;
    symbol: string;
    exchange?: string | null;
    side?: "LONG" | "SHORT" | "BUY" | "SELL" | "long" | "short" | "buy" | "sell" | null;
    qty?: number;
    quantity?: number;
    avg_price?: number;
    average_price?: number;
    averageEntryPrice?: number;
    current_price?: number | null;
    currentPrice?: number | null;
    last_price?: number | null;
    lastPrice?: number | null;
    realized_pnl?: number | null;
    unrealized_pnl?: number | null;
    stop_loss?: number | null;
    take_profit?: number | null;
    tick_size?: number | null;
    stopLoss?: number | null;
    takeProfit?: number | null;
    stop_loss_removed?: boolean;
    take_profit_removed?: boolean;
    is_open?: boolean | null;
    isOpen?: boolean | null;
    position_status?: "open" | "closed" | string | null;
    opened_at?: string | null;
    closed_at?: string | null;
    updated_at?: string | null;
    updatedAt?: string | null;
    created_at?: string | null;
}
export type TerminalOrder = CanonicalOrder;
export interface TerminalExecution {
    id: string;
    trading_account_id: string;
    order_id: string;
    position_id: string | null;
    symbol: string;
    qty: number;
    price: number;
    executed_at: string;
}
export interface TerminalRiskSummary {
    accounts_at_risk: number;
    breached: number | null;
    critical: number;
    warning: number;
    recent_events: unknown[];
}
export interface TerminalPerformanceRow {
    id: string;
    trading_account_id: string;
    date: string;
    opening_balance: number;
    closing_balance: number;
    daily_pnl: number;
    total_trades: number;
    winning_trades: number;
    losing_trades: number;
}
export interface TerminalWatchlist {
    id: string;
    trader_id: string;
    name: string;
    items: unknown;
    is_default: boolean;
}
export type TerminalMarketDataProvider = "dhan" | "kite";
export interface TerminalMarketDataInstrument {
    provider: TerminalMarketDataProvider;
    providerInstrumentId: string;
    symbol: string;
    tradingSymbol: string;
    exchange: string;
    exchangeSegment: string;
    instrumentType: string;
    lotSize?: number;
    tickSize?: number;
    expiryDate?: string;
    strikePrice?: number;
    optionType?: string;
}
export interface TerminalMarketDataQuote {
    provider: TerminalMarketDataProvider;
    symbol: string;
    tradingSymbol: string;
    exchange: string;
    ltp: number;
    open: number | null;
    high: number | null;
    low: number | null;
    previousClose: number | null;
    change: number | null;
    changePercent: number | null;
    volume: number | null;
    openInterest: number | null;
    timestamp: string;
}
export interface TerminalMarketDataCandle {
    timestamp: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    openInterest?: number;
}
export interface TerminalMarketDataOptionChain {
    provider: TerminalMarketDataProvider;
    underlying: string;
    expiry: string;
    expiries: string[];
    spotPrice: number;
    chain: Array<{
        strikePrice: number;
        ce: OptionData["ce"];
        pe: OptionData["pe"];
    }>;
    totalCEOI: number;
    totalPEOI: number;
    greeksAvailable: boolean;
    oiChangeAvailable?: boolean;
    afterHours?: boolean;
    cachedAt?: string | number | null;
}
export declare function resolveTerminalMarketDataProvider(value: string | null | undefined): TerminalMarketDataProvider | null;
export declare function toTerminalMarketDataInstrument(instrument: {
    providerInstrumentId?: string;
    securityId: string;
    symbol: string;
    tradingSymbol: string;
    exchange: string;
    exchangeSegment: string;
    instrumentType: string;
    lotSize?: number;
    tickSize?: number;
    expiryDate?: string;
    strikePrice?: number;
    optionType?: string;
}, provider: TerminalMarketDataProvider): TerminalMarketDataInstrument;
export type TerminalMarketDataOperation = {
    operation: "authenticate";
} | {
    operation: "searchInstruments";
    query: string;
} | {
    operation: "getQuote";
    instrument: TerminalMarketDataInstrument;
} | {
    operation: "getOptionChain";
    underlying: string;
    expiry?: string;
} | {
    operation: "getHistoricalCandles";
    instrument: TerminalMarketDataInstrument;
    interval: string;
    fromDate: string;
    toDate: string;
};
export interface TerminalMarketDataStatus {
    account_id: string;
    provider: TerminalMarketDataProvider;
    configured: boolean;
    is_connected: boolean;
    last_tested_at: string | null;
    last_test_result: string | null;
}
export declare function requestTerminalRealtimeTicket(accountId: string, provider: TerminalMarketDataProvider, environment?: "production" | "paper" | "sandbox"): Promise<{
    ticket: string;
    expires_at: string;
}>;
export type TerminalMarketDataErrorCode = "UNAUTHENTICATED" | "ACCOUNT_FORBIDDEN" | "ACCOUNT_INACTIVE" | "INVALID_PROVIDER_ACCOUNT" | "MISSING_CREDENTIALS" | "CREDENTIAL_STORAGE_ERROR" | "INVALID_CREDENTIALS" | "RATE_LIMITED" | "PROVIDER_UNAVAILABLE" | "PROVIDER_ERROR" | "INVALID_REQUEST";
export declare class TerminalMarketDataError extends Error {
    readonly code: TerminalMarketDataErrorCode;
    readonly status: number;
    constructor(code: TerminalMarketDataErrorCode, status: number);
}
export declare function requestTerminalMarketData<T>(accountId: string, provider: TerminalMarketDataProvider, operation: TerminalMarketDataOperation, environment?: "production" | "paper" | "sandbox"): Promise<T>;
export declare function fetchTerminalMarketDataStatus(accountId: string, provider: TerminalMarketDataProvider, environment?: "production" | "paper" | "sandbox"): Promise<TerminalMarketDataStatus>;
export interface TerminalRealtimeQuoteEvent {
    account_id: string;
    provider: TerminalMarketDataProvider;
    environment: "production" | "paper" | "sandbox";
    symbol: string;
    quote: TerminalMarketDataQuote;
}
export type TerminalRealtimeStatus = "connecting" | "connected" | "reconnecting" | "error" | "disconnected";
export declare function subscribeToTerminalMarketDataStream(accountId: string, provider: TerminalMarketDataProvider, symbols: string[], onQuote: (event: TerminalRealtimeQuoteEvent) => void, onStatus?: (status: TerminalRealtimeStatus) => void, environment?: "production" | "paper" | "sandbox"): () => void;
export declare function reconnectTerminalMarketDataStreams(): void;
export declare function fetchTerminalAccounts(): Promise<AccountsResponse>;
export interface RuleVersionRecord {
    id: string;
    product_id: string;
    phase_id: string | null;
    version: string;
    status: string;
    rules: Record<string, unknown>;
    created_at: string;
    created_by_email?: string | null;
}
export declare function fetchAccountContext(accountId?: string): Promise<AccountContext>;
export declare function fetchCanonicalPlans(): Promise<{
    data: Array<{
        id: string;
        code: string;
        name: string;
        description: string | null;
        status: string;
    }>;
}>;
export declare function fetchCanonicalRuleVersions(productId?: string): Promise<{
    data: RuleVersionRecord[];
}>;
export declare function saveRuleConfiguration(action: string, payload: Record<string, unknown>): Promise<Record<string, unknown>>;
export declare function transitionTradingAccount(accountId: string, status: AccountStatus, reason?: string): Promise<AccountContext["account"]>;
export declare function evaluatePreTradeRisk(request: PreTradeRiskRequest): Promise<PreTradeRiskDecision>;
export declare function createServerPreTradeRiskGate(): (request: RiskRequest) => Promise<{
    risk_state: "ACTIVE";
    decision: "ALLOW" | "REJECT";
    reason_code: string | null;
    reason: string;
    account_id: string;
    rule_evaluated: string | null;
    current_value: number | string | null;
    configured_limit: number | string | boolean | null;
    timestamp: string;
}>;
export declare function createTerminalOrder(request: CreateOrderRequest): Promise<CreateOrderResponse>;
export declare function setActiveAccount(accountId: string): Promise<void>;
export declare function subscribeToAccountContext(onChange: () => void): () => any;
export declare function fetchTerminalSystemHealth(): Promise<SystemHealthResponse>;
export declare function fetchTerminalPositions(accountId?: string): Promise<PaginatedResponse<TerminalPosition>>;
export type PositionProtectionField = "stop_loss" | "take_profit";
export declare function modifyTerminalPositionProtection(positionId: string, field: PositionProtectionField, price: number): Promise<TerminalPosition>;
export declare function fetchTerminalDashboard(accountId?: string): Promise<{
    data: {
        summary: TerminalDashboardSummary;
    };
}>;
export declare function fetchTerminalOrders(accountId?: string): Promise<PaginatedResponse<CanonicalOrder>>;
export declare function subscribeToTerminalOrders(accountId: string, onChange: () => void): () => any;
export declare function subscribeToTerminalPositions(accountId: string, onChange: () => void): () => any;
export declare function fetchTerminalExecutions(accountId?: string): Promise<PaginatedResponse<TerminalExecution>>;
export declare function fetchTerminalRisk(accountId?: string): Promise<{
    data: TerminalRiskSummary;
}>;
export declare function fetchTerminalPerformance(accountId?: string): Promise<PaginatedResponse<TerminalPerformanceRow>>;
export declare function fetchTerminalWatchlists(): Promise<PaginatedResponse<TerminalWatchlist>>;
export { TERMINAL_OS_BASE };
