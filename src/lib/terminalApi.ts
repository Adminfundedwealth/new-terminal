import { supabase, SUPABASE_CONFIGURED } from "@/integrations/supabase/client";
import type { AccountStatus } from "@/lib/accountLifecycle";
import type { RiskRequest } from "@/lib/riskEngine";
import type { Instrument } from "@/lib/localDatabase";
import { deserializeCanonicalOrder, type CanonicalOrderRow, type CanonicalOrder } from "@/lib/orderModel";

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
  const response = await fetch(`${TERMINAL_OS_BASE}${path}`, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Terminal OS request failed (${response.status})`);
  }

  return response.json() as Promise<T>;
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
  const instrumentType = request.instrument?.instrumentType?.toUpperCase();
  const isKiteDerivative = request.product === "NRML" && request.instrument?.provider === "zerodha" &&
    ["OPTIDX", "OPTSTK", "FUTIDX", "FUTSTK"].includes(instrumentType ?? "");
  const { data, error } = await supabase.rpc(isKiteDerivative ? "create_simulated_kite_order" : "create_order", { request });
  if (error) throw new Error("Order creation request failed");
  const result = data as CreateOrderResponse;
  if (!result.ok) throw new Error(result.error?.message ?? "Order creation was rejected");
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
