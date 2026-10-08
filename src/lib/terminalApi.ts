import { supabase, SUPABASE_CONFIGURED } from "@/integrations/supabase/client";
import type { AccountStatus } from "@/lib/accountLifecycle";
import type { RiskRequest } from "@/lib/riskEngine";
import type { Instrument } from "@/lib/localDatabase";
import type { OptionData } from "@/lib/mockData";
import { deserializeCanonicalOrder, type CanonicalOrderRow, type CanonicalOrder } from "@/lib/orderModel";
import { REALTIME_MOCK_TEST_ACCOUNT_ID } from "@/lib/realtimeMockTestScope";

const TERMINAL_OS_BASE = (import.meta.env.VITE_TERMINAL_OS_URL || "").replace(/\/$/, "");

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
  identity: { trader_id: string };
  account: Record<string, unknown> & { id: string; owner_user_id: string };
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
  error?: { code: string; message: string };
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

const PENDING_ORDER_COMMANDS_KEY = "fundedwealth.pending-order-commands.v1";

interface PendingOrderCommand {
  signature: string;
  client_order_id: string;
}

function normalizedOrderCommand(request: CreateOrderRequest, clientOrderId: string): TerminalOrderCommandRequest {
  const orderType = request.order_type === "STOP" ? "SL" : request.order_type === "STOP-LIMIT" ? "SL-M" : request.order_type;
  return {
    account_id: request.account_id,
    client_order_id: clientOrderId,
    symbol: request.symbol.trim().toUpperCase(),
    exchange: request.exchange.trim().toUpperCase(),
    ...(request.segment?.trim() ? { segment: request.segment.trim().toUpperCase() } : {}),
    side: request.side,
    quantity: request.quantity,
    order_type: orderType,
    ...(request.price == null ? {} : { price: request.price }),
    ...(request.trigger_price == null ? {} : { trigger_price: request.trigger_price }),
    ...(request.stop_loss == null ? {} : { stop_loss: request.stop_loss }),
    ...(request.take_profit == null ? {} : { take_profit: request.take_profit }),
    time_in_force: request.time_in_force ?? "DAY",
    ...(request.product == null ? {} : { product: request.product }),
    is_overnight: request.is_overnight ?? false,
  };
}

function orderCommandSignature(command: TerminalOrderCommandRequest): string {
  return JSON.stringify({
    account_id: command.account_id,
    symbol: command.symbol,
    exchange: command.exchange,
    segment: command.segment ?? "",
    side: command.side,
    quantity: command.quantity,
    order_type: command.order_type,
    price: command.price ?? null,
    trigger_price: command.trigger_price ?? null,
    stop_loss: command.stop_loss ?? null,
    take_profit: command.take_profit ?? null,
    time_in_force: command.time_in_force ?? "DAY",
    product: command.product ?? "",
    is_overnight: command.is_overnight ?? false,
  });
}

function readPendingOrderCommands(): PendingOrderCommand[] {
  try {
    const stored = globalThis.localStorage?.getItem(PENDING_ORDER_COMMANDS_KEY);
    const parsed: unknown = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is PendingOrderCommand =>
        typeof entry?.signature === "string" && typeof entry?.client_order_id === "string")
      : [];
  } catch {
    return [];
  }
}

function persistPendingOrderCommand(command: TerminalOrderCommandRequest): void {
  try {
    const signature = orderCommandSignature(command);
    const pending = readPendingOrderCommands().filter((entry) => entry.signature !== signature);
    pending.push({ signature, client_order_id: command.client_order_id });
    globalThis.localStorage?.setItem(PENDING_ORDER_COMMANDS_KEY, JSON.stringify(pending));
  } catch {
    // Durable idempotency remains authoritative at the gateway if browser storage is unavailable.
  }
}

function clearPendingOrderCommand(command: TerminalOrderCommandRequest): void {
  try {
    const signature = orderCommandSignature(command);
    const pending = readPendingOrderCommands().filter((entry) =>
      entry.signature !== signature || entry.client_order_id !== command.client_order_id);
    globalThis.localStorage?.setItem(PENDING_ORDER_COMMANDS_KEY, JSON.stringify(pending));
  } catch {
    // A stale local retry hint is harmless; the server still enforces the key.
  }
}

export function createClientOrderId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
  if (typeof cryptoApi?.getRandomValues !== "function") {
    throw new Error("Secure order ID generation is unavailable.");
  }

  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function prepareOrderCommand(request: CreateOrderRequest): TerminalOrderCommandRequest {
  const seed = normalizedOrderCommand(request, request.client_order_id?.trim() || "pending");
  const signature = orderCommandSignature(seed);
  const existing = readPendingOrderCommands().find((entry) => entry.signature === signature);
  const clientOrderId = existing?.client_order_id
    ?? request.client_order_id?.trim()
    ?? createClientOrderId();
  const command = normalizedOrderCommand(request, clientOrderId);
  persistPendingOrderCommand(command);
  return command;
}

/** Customer command boundary; the gateway derives provider routing server-side. */
export async function submitTerminalOrderCommand(request: TerminalOrderCommandRequest): Promise<CreateOrderResponse> {
  if (!TERMINAL_OS_BASE) throw new Error("Terminal OS is not configured.");
  const accessToken = await getCustomerAccessToken();

  let response: Response;
  try {
    response = await fetch(`${TERMINAL_OS_BASE}/api/terminal/orders`, {
      method: "POST",
      credentials: "omit",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(request),
    });
  } catch (error) {
    throw error instanceof Error ? error : new Error("Network response was lost after acceptance");
  }

  if (!response || typeof response.json !== "function") {
    throw new Error("Network response was lost after acceptance");
  }

  let payload: {
    data?: { order?: Record<string, unknown>; replayed?: boolean };
    error?: { message?: string };
  } = {};
  try {
    payload = await response.json() as typeof payload;
  } catch {
    if (!response.ok) {
      throw new Error(`Order command was rejected (${response.status}).`);
    }
    return { ok: true, replayed: false, order: undefined };
  }

  if (!response.ok) throw new Error(payload.error?.message ?? "Order command was rejected.");
  return { ok: true, replayed: payload.data?.replayed ?? false, order: payload.data?.order };
}
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
  meta: { total: number; page: number; page_size: number; has_more?: boolean };
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

async function fetchTerminalJson<T>(path: string): Promise<T> {
  const accessToken = await getCustomerAccessToken();
  const response = await fetch(`${TERMINAL_OS_BASE}${path}`, {
    credentials: "omit",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Terminal OS request failed (${response.status})`);
  }

  return response.json() as Promise<T>;
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
  series?: string;
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

export function resolveTerminalMarketDataProvider(value: string | null | undefined): TerminalMarketDataProvider | null {
  const provider = value?.trim().toLowerCase();
  if (provider === "dhan") return "dhan";
  if (provider === "kite" || provider === "zerodha") return "kite";
  return null;
}

export function toTerminalMarketDataInstrument(
  instrument: {
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
  },
  provider: TerminalMarketDataProvider,
): TerminalMarketDataInstrument {
  return {
    provider,
    providerInstrumentId: instrument.providerInstrumentId || instrument.securityId,
    symbol: instrument.symbol,
    tradingSymbol: instrument.tradingSymbol,
    exchange: instrument.exchange,
    exchangeSegment: instrument.exchangeSegment,
    instrumentType: instrument.instrumentType,
    lotSize: instrument.lotSize,
    tickSize: instrument.tickSize,
    series: instrument.series,
    expiryDate: instrument.expiryDate,
    strikePrice: instrument.strikePrice,
    optionType: instrument.optionType,
  };
}

export function toLocalMarketDataInstrument(instrument: TerminalMarketDataInstrument): Instrument {
  return {
    securityId: instrument.providerInstrumentId,
    providerInstrumentId: instrument.providerInstrumentId,
    provider: instrument.provider,
    symbol: instrument.symbol,
    tradingSymbol: instrument.tradingSymbol,
    exchange: instrument.exchange,
    exchangeSegment: instrument.exchangeSegment,
    instrumentType: instrument.instrumentType,
    lotSize: instrument.lotSize ?? 1,
    series: instrument.series,
    expiryDate: instrument.expiryDate,
    strikePrice: instrument.strikePrice,
    optionType: instrument.optionType,
  };
}

export type TerminalMarketDataOperation =
  | { operation: "authenticate" }
  | { operation: "searchInstruments"; query: string }
  | { operation: "getQuote"; instrument: TerminalMarketDataInstrument }
  | { operation: "getOptionChain"; underlying: string; expiry?: string }
  | {
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

export async function requestTerminalRealtimeTicket(
  accountId: string,
  provider: TerminalMarketDataProvider,
  environment: "production" | "paper" | "sandbox" = "production",
): Promise<{ ticket: string; expires_at: string }> {
  if (!accountId) throw new Error("A trading account is required for realtime data.");
  const accessToken = await getCustomerAccessToken();
  const response = await fetch(`${TERMINAL_OS_BASE}/api/terminal/realtime-ticket`, {
    method: "POST",
    credentials: "omit",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      account_id: accountId,
      provider,
      environment,
      ...(accountId === REALTIME_MOCK_TEST_ACCOUNT_ID && provider === "dhan" && environment === "paper" ? { test_mode: true } : {}),
    }),
  });
  if (!response.ok) throw new Error("Realtime authentication is unavailable.");
  const payload = await response.json() as { data?: { ticket?: string; expires_at?: string } };
  if (!payload.data?.ticket || !payload.data.expires_at) throw new Error("Realtime authentication response is invalid.");
  return { ticket: payload.data.ticket, expires_at: payload.data.expires_at };
}

export type TerminalMarketDataErrorCode =
  | "UNAUTHENTICATED"
  | "ACCOUNT_FORBIDDEN"
  | "ACCOUNT_INACTIVE"
  | "INVALID_PROVIDER_ACCOUNT"
  | "MISSING_CREDENTIALS"
  | "CREDENTIAL_STORAGE_ERROR"
  | "INVALID_CREDENTIALS"
  | "RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_ERROR"
  | "INVALID_REQUEST";

const MARKET_DATA_ERROR_MESSAGES: Record<TerminalMarketDataErrorCode, string> = {
  UNAUTHENTICATED: "Sign in again to request market data.",
  ACCOUNT_FORBIDDEN: "This trading account is not available for market data.",
  ACCOUNT_INACTIVE: "This trading account is inactive.",
  INVALID_PROVIDER_ACCOUNT: "The selected provider is not configured for this account.",
  MISSING_CREDENTIALS: "Broker credentials are not configured for this account.",
  CREDENTIAL_STORAGE_ERROR: "Broker credentials could not be loaded securely.",
  INVALID_CREDENTIALS: "Broker authentication failed.",
  RATE_LIMITED: "The broker is rate limiting market-data requests. Try again shortly.",
  PROVIDER_UNAVAILABLE: "The broker market-data service is temporarily unavailable.",
  PROVIDER_ERROR: "The market-data request could not be completed.",
  INVALID_REQUEST: "The market-data request is invalid.",
};

export class TerminalMarketDataError extends Error {
  constructor(
    readonly code: TerminalMarketDataErrorCode,
    readonly status: number,
  ) {
    super(MARKET_DATA_ERROR_MESSAGES[code]);
    this.name = "TerminalMarketDataError";
  }
}

function normalizeMarketDataError(status: number, code?: string): TerminalMarketDataError {
  if (status === 401) return new TerminalMarketDataError(code === "INVALID_CREDENTIALS" ? "INVALID_CREDENTIALS" : "UNAUTHENTICATED", status);
  if (status === 403 || status === 404 || code === "ACCOUNT_NOT_FOUND") return new TerminalMarketDataError("ACCOUNT_FORBIDDEN", status);
  if (code === "ACCOUNT_INACTIVE") return new TerminalMarketDataError("ACCOUNT_INACTIVE", status);
  if (status === 409 || code === "INVALID_PROVIDER_ACCOUNT") return new TerminalMarketDataError("INVALID_PROVIDER_ACCOUNT", status);
  if (status === 424 || code === "MISSING_CREDENTIALS") return new TerminalMarketDataError("MISSING_CREDENTIALS", status);
  if (code === "CREDENTIAL_STORAGE_ERROR") return new TerminalMarketDataError("CREDENTIAL_STORAGE_ERROR", status);
  if (status === 429 || code === "RATE_LIMITED") return new TerminalMarketDataError("RATE_LIMITED", status);
  if (code === "INVALID_REQUEST" || code === "INVALID_INSTRUMENT" || status === 400) return new TerminalMarketDataError("INVALID_REQUEST", status);
  if (status >= 500 || code === "UPSTREAM_ERROR" || code === "PROVIDER_UNAVAILABLE") return new TerminalMarketDataError("PROVIDER_UNAVAILABLE", status);
  return new TerminalMarketDataError("PROVIDER_ERROR", status);
}

async function getCustomerAccessToken(): Promise<string> {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session?.access_token) {
    throw new Error("Authentication required to request account market data.");
  }
  return session.access_token;
}

async function readMarketDataResponse<T>(response: Response): Promise<T> {
  let payload: { data?: T; error?: { code?: string } };
  try {
    payload = await response.json() as { data?: T; error?: { code?: string } };
  } catch {
    if (!response.ok) throw normalizeMarketDataError(response.status);
    throw new TerminalMarketDataError("PROVIDER_ERROR", response.status);
  }
  if (!response.ok) {
    throw normalizeMarketDataError(response.status, payload.error?.code);
  }
  return payload.data as T;
}

export async function requestTerminalMarketData<T>(
  accountId: string,
  provider: TerminalMarketDataProvider,
  operation: TerminalMarketDataOperation,
  environment: "production" | "paper" | "sandbox" = "production",
): Promise<T> {
  if (!accountId) throw new Error("A trading account is required for market data.");
  const accessToken = await getCustomerAccessToken();
  const response = await fetch(`${TERMINAL_OS_BASE}/api/terminal/market-data`, {
    method: "POST",
    credentials: "omit",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ account_id: accountId, provider, environment, ...operation }),
  });
  return readMarketDataResponse<T>(response);
}

export async function fetchTerminalMarketDataStatus(
  accountId: string,
  provider: TerminalMarketDataProvider,
  environment: "production" | "paper" | "sandbox" = "production",
): Promise<TerminalMarketDataStatus> {
  if (!accountId) throw new Error("A trading account is required for market-data status.");
  const accessToken = await getCustomerAccessToken();
  const query = new URLSearchParams({ account_id: accountId, provider, environment });
  const response = await fetch(`${TERMINAL_OS_BASE}/api/terminal/market-data?${query}`, {
    credentials: "omit",
    headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
  });
  return readMarketDataResponse<TerminalMarketDataStatus>(response);
}

export interface TerminalRealtimeQuoteEvent {
  account_id: string;
  provider: TerminalMarketDataProvider;
  environment: "production" | "paper" | "sandbox";
  symbol: string;
  quote: TerminalMarketDataQuote;
}

export type TerminalRealtimeStatus = "connecting" | "connected" | "reconnecting" | "error" | "disconnected";

interface TerminalRealtimeSubscriber {
  symbols: Set<string>;
  onQuote: (event: TerminalRealtimeQuoteEvent) => void;
  onStatus?: (status: TerminalRealtimeStatus) => void;
}

interface TerminalRealtimePool {
  accountId: string;
  provider: TerminalMarketDataProvider;
  environment: "production" | "paper" | "sandbox";
  symbols: Set<string>;
  subscribers: Set<TerminalRealtimeSubscriber>;
  controller: AbortController | null;
  generation: number;
}

const terminalRealtimePools = new Map<string, TerminalRealtimePool>();

function notifyRealtimeStatus(pool: TerminalRealtimePool, status: TerminalRealtimeStatus): void {
  for (const subscriber of pool.subscribers) subscriber.onStatus?.(status);
}

function parseSseFrame(frame: string): { event: string; data: string } | null {
  let event = "message";
  const data: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  return data.length ? { event, data: data.join("\n") } : null;
}

async function readRealtimeStream(pool: TerminalRealtimePool, generation: number, signal: AbortSignal): Promise<void> {
  const accessToken = await getCustomerAccessToken();
  const query = new URLSearchParams({
    account_id: pool.accountId,
    provider: pool.provider,
    environment: pool.environment,
    symbols: [...pool.symbols].sort().join(","),
  });
  const response = await fetch(`${TERMINAL_OS_BASE}/api/terminal/market-data/stream?${query}`, {
    credentials: "omit",
    headers: { Accept: "text/event-stream", Authorization: `Bearer ${accessToken}` },
    signal,
  });
  if (!response.ok || !response.body) {
    await readMarketDataResponse<unknown>(response);
    throw new TerminalMarketDataError("PROVIDER_UNAVAILABLE", response.status);
  }

  notifyRealtimeStatus(pool, "connected");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (!signal.aborted && generation === pool.generation) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.search(/\r?\n\r?\n/);
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary);
        const delimiter = buffer.slice(boundary).match(/^\r?\n\r?\n/)?.[0] ?? "\n\n";
        buffer = buffer.slice(boundary + delimiter.length);
        const message = parseSseFrame(frame);
        if (message?.event === "quote") {
          try {
            const event = JSON.parse(message.data) as TerminalRealtimeQuoteEvent;
            for (const subscriber of pool.subscribers) {
              if (subscriber.symbols.has(event.symbol)) subscriber.onQuote(event);
            }
          } catch {
            // Ignore malformed stream messages.
          }
        } else if (message?.event === "error") {
          notifyRealtimeStatus(pool, "reconnecting");
        }
        boundary = buffer.search(/\r?\n\r?\n/);
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function startRealtimePool(pool: TerminalRealtimePool): void {
  pool.controller?.abort();
  const controller = new AbortController();
  pool.controller = controller;
  const generation = ++pool.generation;
  void (async () => {
    let delay = 1000;
    while (!controller.signal.aborted && generation === pool.generation && pool.subscribers.size > 0) {
      notifyRealtimeStatus(pool, delay === 1000 ? "connecting" : "reconnecting");
      try {
        await readRealtimeStream(pool, generation, controller.signal);
        if (!controller.signal.aborted) throw new Error("Realtime stream ended");
      } catch {
        if (controller.signal.aborted || generation !== pool.generation) break;
        notifyRealtimeStatus(pool, "reconnecting");
      }
      if (controller.signal.aborted || generation !== pool.generation) break;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, delay);
        controller.signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
      });
      delay = Math.min(delay * 2, 30000);
    }
  })();
}

export function subscribeToTerminalMarketDataStream(
  accountId: string,
  provider: TerminalMarketDataProvider,
  symbols: string[],
  onQuote: (event: TerminalRealtimeQuoteEvent) => void,
  onStatus?: (status: TerminalRealtimeStatus) => void,
  environment: "production" | "paper" | "sandbox" = "production",
): () => void {
  const normalizedSymbols = [...new Set(symbols.map((symbol) => symbol.trim()).filter(Boolean))];
  if (!accountId || normalizedSymbols.length === 0) return () => undefined;
  const key = `${accountId}:${provider}:${environment}`;
  let pool = terminalRealtimePools.get(key);
  if (!pool) {
    pool = { accountId, provider, environment, symbols: new Set(), subscribers: new Set(), controller: null, generation: 0 };
    terminalRealtimePools.set(key, pool);
  }
  const subscriber: TerminalRealtimeSubscriber = { symbols: new Set(normalizedSymbols), onQuote, onStatus };
  const previousSymbolCount = pool.symbols.size;
  normalizedSymbols.forEach((symbol) => pool?.symbols.add(symbol));
  pool.subscribers.add(subscriber);
  if (pool.symbols.size !== previousSymbolCount || !pool.controller) startRealtimePool(pool);

  return () => {
    const current = terminalRealtimePools.get(key);
    if (!current) return;
    current.subscribers.delete(subscriber);
    const stillNeeded = new Set([...current.subscribers].flatMap((item) => [...item.symbols]));
    const changed = stillNeeded.size !== current.symbols.size || [...current.symbols].some((symbol) => !stillNeeded.has(symbol));
    current.symbols = stillNeeded;
    if (current.subscribers.size === 0) {
      current.controller?.abort();
      current.generation++;
      terminalRealtimePools.delete(key);
      onStatus?.("disconnected");
    } else if (changed) {
      startRealtimePool(current);
    }
  };
}

export function reconnectTerminalMarketDataStreams(): void {
  for (const pool of terminalRealtimePools.values()) startRealtimePool(pool);
}

export async function fetchTerminalAccounts(): Promise<AccountsResponse> {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error("Authentication required to load trading accounts");

  const { data, error } = await supabase
    .from("trading_accounts")
    .select("id, account_code, broker_provider, current_balance, status, available_margin, used_margin")
    .eq("owner_user_id", user.id)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Trading accounts request failed: ${error.message}`);

  const accounts: TerminalAccount[] = (data ?? []).map((account) => ({
    id: account.id,
    account_code: account.account_code,
    trader_id: user.id,
    broker_provider: account.broker_provider,
    balance: Number(account.current_balance ?? 0),
    status: account.status,
    available_margin: account.available_margin == null ? undefined : Number(account.available_margin),
    used_margin: account.used_margin == null ? undefined : Number(account.used_margin),
  }));
  return { data: accounts, meta: { total: accounts.length, page: 1, page_size: accounts.length, has_more: false } };
}

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

export async function fetchAccountContext(accountId?: string): Promise<AccountContext> {
  const { data, error } = await supabase.rpc("get_active_account_context", {
    requested_account_id: accountId || null,
  });
  if (error) throw new Error(`Account context request failed: ${error.message}`);
  return data as AccountContext;
}

export async function fetchCanonicalPlans(): Promise<{ data: Array<{ id: string; code: string; name: string; description: string | null; status: string }> }> {
  const { data, error } = await supabase.from("products").select("id, code, name, description, status").order("name", { ascending: true });
  if (error) throw new Error(`Plan catalog request failed: ${error.message}`);
  return { data: (data ?? []) as Array<{ id: string; code: string; name: string; description: string | null; status: string }> };
}

export async function fetchCanonicalRuleVersions(productId?: string): Promise<{ data: RuleVersionRecord[] }> {
  const query = supabase.from("rule_versions").select("id, product_id, phase_id, version, status, rules, created_at, created_by_email");
  const filtered = productId ? query.eq("product_id", productId) : query;
  const { data, error } = await filtered.order("created_at", { ascending: false });
  if (error) throw new Error(`Rule version request failed: ${error.message}`);
  return { data: (data ?? []) as RuleVersionRecord[] };
}

export async function saveRuleConfiguration(action: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc("manage_rule_configuration", {
    request: { action, ...payload, actor_email: payload.actor_email ?? "system@fundedwealth.local" },
  });
  if (error) throw new Error(`Rule configuration update failed: ${error.message}`);
  return data as Record<string, unknown>;
}

export async function transitionTradingAccount(accountId: string, status: AccountStatus, reason?: string): Promise<AccountContext["account"]> {
  const { data, error } = await supabase.rpc("transition_trading_account", {
    requested_account_id: accountId,
    requested_status: status,
    transition_reason: reason ?? null,
  });
  if (error) throw new Error(`Account transition failed: ${error.message}`);
  return (data as { account: AccountContext["account"] }).account;
}

export async function evaluatePreTradeRisk(request: PreTradeRiskRequest): Promise<PreTradeRiskDecision> {
  const { data, error } = await supabase.rpc("evaluate_pre_trade_risk", { request });
  if (error) throw new Error(`Risk evaluation failed: ${error.message}`);
  return data as PreTradeRiskDecision;
}

export function createServerPreTradeRiskGate() {
  return async (request: RiskRequest) => {
    const decision = await evaluatePreTradeRisk({
      account_id: request.account_id,
      symbol: request.symbol,
      segment: request.segment,
      side: request.side,
      quantity: request.quantity,
      order_type: request.order_type,
      requested_price: request.requested_price ?? undefined,
      estimated_loss: request.estimated_loss ?? undefined,
      is_overnight: request.is_overnight,
    });
    return {
      ...decision,
      risk_state: "ACTIVE" as const,
    };
  };
}

export async function createTerminalOrder(request: CreateOrderRequest): Promise<CreateOrderResponse> {
  if (!request.account_id) throw new Error("A trading account is required to place an order.");
  const command = prepareOrderCommand(request);
  const result = await submitTerminalOrderCommand(command);
  clearPendingOrderCommand(command);
  return result;
}

export async function setActiveAccount(accountId: string): Promise<void> {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error("Authentication required to select an account");
  const { error } = await supabase.from("terminal_settings").upsert({
    owner_user_id: user.id,
    active_account_id: accountId,
  });
  if (error) throw new Error(`Active account update failed: ${error.message}`);
}

function createRealtimeChannel(baseName: string) {
  return `${baseName}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function subscribeToAccountContext(onChange: () => void) {
  if (!SUPABASE_CONFIGURED) return () => undefined;

  const channel = supabase
    .channel(createRealtimeChannel("canonical-account-context"))
    .on("postgres_changes", { event: "*", schema: "public", table: "trading_accounts" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "account_permissions" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "rule_versions" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "risk_events" }, onChange)
    .subscribe();
  return () => { void supabase.removeChannel(channel); };
}

export async function fetchTerminalSystemHealth(): Promise<SystemHealthResponse> {
  return fetchTerminalJson<SystemHealthResponse>("/api/terminal/system-health");
}

function accountQuery(accountId?: string): string {
  return accountId ? `&account_id=${encodeURIComponent(accountId)}` : "";
}

export function fetchTerminalPositions(accountId?: string) {
  return (async (): Promise<PaginatedResponse<TerminalPosition>> => {
    const { data, error } = await supabase.rpc("get_terminal_positions", { requested_account_id: accountId ?? null });
    if (error) throw new Error(`Positions request failed: ${error.message}`);
    const positions = (data ?? []).map((row) => ({
      ...row,
      trading_account_id: row.account_id,
      qty: Number(row.quantity ?? 0),
      avg_price: Number(row.average_price ?? 0),
      current_price: row.last_price == null ? null : Number(row.last_price),
      is_open: row.position_status === "open",
    })) as TerminalPosition[];
    return { data: positions, meta: { total: positions.length, page: 1, page_size: positions.length, has_more: false } };
  })();
}

export type PositionProtectionField = "stop_loss" | "take_profit";

export async function modifyTerminalPositionProtection(
  positionId: string,
  field: PositionProtectionField,
  price: number,
): Promise<TerminalPosition> {
  if (!Number.isFinite(price) || price <= 0) throw new Error("Protection price must be greater than zero.");
  const { data, error } = await supabase.rpc("modify_position_protection", {
    requested_position_id: positionId,
    requested_field: field,
    requested_price: price,
  });
  if (error) throw new Error(error.message || "Position protection update failed.");
  return data as TerminalPosition;
}

export function fetchTerminalDashboard(accountId?: string) {
  return fetchTerminalJson<{ data: { summary: TerminalDashboardSummary } }>(`/api/terminal/dashboard${accountId ? `?account_id=${encodeURIComponent(accountId)}` : ""}`);
}

export function fetchTerminalOrders(accountId?: string) {
  return (async (): Promise<PaginatedResponse<TerminalOrder>> => {
    const { data, error } = await supabase.rpc("get_terminal_orders", { requested_account_id: accountId ?? null });
    if (error) throw new Error(`Orders request failed: ${error.message}`);
    const orders = (data ?? []).map((row) => deserializeCanonicalOrder(row as CanonicalOrderRow));
    return { data: orders, meta: { total: orders.length, page: 1, page_size: orders.length, has_more: false } };
  })();
}

export function subscribeToTerminalOrders(accountId: string, onChange: () => void) {
  if (!SUPABASE_CONFIGURED) return () => undefined;

  const channel = supabase
    .channel(createRealtimeChannel(`customer-orders-${accountId}`))
    .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `account_id=eq.${accountId}` }, onChange)
    .subscribe();
  return () => { void supabase.removeChannel(channel); };
}

export function subscribeToTerminalPositions(accountId: string, onChange: () => void) {
  if (!SUPABASE_CONFIGURED) return () => undefined;

  const channel = supabase
    .channel(createRealtimeChannel(`customer-positions-${accountId}`))
    .on("postgres_changes", { event: "*", schema: "public", table: "positions", filter: `account_id=eq.${accountId}` }, onChange)
    .subscribe();
  return () => { void supabase.removeChannel(channel); };
}

export function fetchTerminalExecutions(accountId?: string) {
  return (async (): Promise<PaginatedResponse<TerminalExecution>> => {
    const { data, error } = await supabase.rpc("get_terminal_executions", { requested_account_id: accountId ?? null });
    if (error) throw new Error(`Executions request failed: ${error.message}`);
    const executions = (data ?? []) as TerminalExecution[];
    return { data: executions, meta: { total: executions.length, page: 1, page_size: executions.length, has_more: false } };
  })();
}

export function fetchTerminalRisk(accountId?: string) {
  return fetchTerminalJson<{ data: TerminalRiskSummary }>(`/api/terminal/risk${accountId ? `?account_id=${encodeURIComponent(accountId)}` : ""}`);
}

export function fetchTerminalPerformance(accountId?: string) {
  return fetchTerminalJson<PaginatedResponse<TerminalPerformanceRow>>(`/api/terminal/performance?page_size=100${accountQuery(accountId)}`);
}

export function fetchTerminalWatchlists() {
  return fetchTerminalJson<PaginatedResponse<TerminalWatchlist>>("/api/terminal/watchlists?page_size=100");
}

export { TERMINAL_OS_BASE };
