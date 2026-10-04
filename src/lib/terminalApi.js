import { supabase, SUPABASE_CONFIGURED } from "@/integrations/supabase/client";
import { deserializeCanonicalOrder } from "@/lib/orderModel";
import { REALTIME_MOCK_TEST_ACCOUNT_ID } from "@/lib/realtimeMockTestScope";
const TERMINAL_OS_BASE = (import.meta.env.VITE_TERMINAL_OS_URL || "").replace(/\/$/, "");
const PENDING_ORDER_COMMANDS_KEY = "fundedwealth.pending-order-commands.v1";
function normalizedOrderCommand(request, clientOrderId) {
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
function orderCommandSignature(command) {
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
function readPendingOrderCommands() {
    try {
        const stored = globalThis.localStorage?.getItem(PENDING_ORDER_COMMANDS_KEY);
        const parsed = stored ? JSON.parse(stored) : [];
        return Array.isArray(parsed)
            ? parsed.filter((entry) => typeof entry?.signature === "string" && typeof entry?.client_order_id === "string")
            : [];
    }
    catch {
        return [];
    }
}
function persistPendingOrderCommand(command) {
    try {
        const signature = orderCommandSignature(command);
        const pending = readPendingOrderCommands().filter((entry) => entry.signature !== signature);
        pending.push({ signature, client_order_id: command.client_order_id });
        globalThis.localStorage?.setItem(PENDING_ORDER_COMMANDS_KEY, JSON.stringify(pending));
    }
    catch {
        // Durable idempotency remains authoritative at the gateway if browser storage is unavailable.
    }
}
function clearPendingOrderCommand(command) {
    try {
        const signature = orderCommandSignature(command);
        const pending = readPendingOrderCommands().filter((entry) => entry.signature !== signature || entry.client_order_id !== command.client_order_id);
        globalThis.localStorage?.setItem(PENDING_ORDER_COMMANDS_KEY, JSON.stringify(pending));
    }
    catch {
        // A stale local retry hint is harmless; the server still enforces the key.
    }
}
function prepareOrderCommand(request) {
    const seed = normalizedOrderCommand(request, request.client_order_id?.trim() || "pending");
    const signature = orderCommandSignature(seed);
    const existing = readPendingOrderCommands().find((entry) => entry.signature === signature);
    const clientOrderId = existing?.client_order_id
        ?? request.client_order_id?.trim()
        ?? globalThis.crypto.randomUUID();
    const command = normalizedOrderCommand(request, clientOrderId);
    persistPendingOrderCommand(command);
    return command;
}
/** Customer command boundary; the gateway derives provider routing server-side. */
export async function submitTerminalOrderCommand(request) {
    if (!TERMINAL_OS_BASE)
        throw new Error("Terminal OS is not configured.");
    const accessToken = await getCustomerAccessToken();
    let response;
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
    }
    catch (error) {
        throw error instanceof Error ? error : new Error("Network response was lost after acceptance");
    }
    if (!response || typeof response.json !== "function") {
        throw new Error("Network response was lost after acceptance");
    }
    let payload = {};
    try {
        payload = await response.json();
    }
    catch {
        if (!response.ok) {
            throw new Error(`Order command was rejected (${response.status}).`);
        }
        return { ok: true, replayed: false, order: undefined };
    }
    if (!response.ok)
        throw new Error(payload.error?.message ?? "Order command was rejected.");
    return { ok: true, replayed: payload.data?.replayed ?? false, order: payload.data?.order };
}
async function fetchTerminalJson(path) {
    const response = await fetch(`${TERMINAL_OS_BASE}${path}`, {
        credentials: "include",
        headers: { Accept: "application/json" },
    });
    if (!response.ok) {
        throw new Error(`Terminal OS request failed (${response.status})`);
    }
    return response.json();
}
export function resolveTerminalMarketDataProvider(value) {
    const provider = value?.trim().toLowerCase();
    if (provider === "dhan")
        return "dhan";
    if (provider === "kite" || provider === "zerodha")
        return "kite";
    return null;
}
export function toTerminalMarketDataInstrument(instrument, provider) {
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
        expiryDate: instrument.expiryDate,
        strikePrice: instrument.strikePrice,
        optionType: instrument.optionType,
    };
}
export async function requestTerminalRealtimeTicket(accountId, provider, environment = "production") {
    if (!accountId)
        throw new Error("A trading account is required for realtime data.");
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
    if (!response.ok)
        throw new Error("Realtime authentication is unavailable.");
    const payload = await response.json();
    if (!payload.data?.ticket || !payload.data.expires_at)
        throw new Error("Realtime authentication response is invalid.");
    return { ticket: payload.data.ticket, expires_at: payload.data.expires_at };
}
const MARKET_DATA_ERROR_MESSAGES = {
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
    constructor(code, status) {
        super(MARKET_DATA_ERROR_MESSAGES[code]);
        Object.defineProperty(this, "code", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: code
        });
        Object.defineProperty(this, "status", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: status
        });
        this.name = "TerminalMarketDataError";
    }
}
function normalizeMarketDataError(status, code) {
    if (status === 401)
        return new TerminalMarketDataError(code === "INVALID_CREDENTIALS" ? "INVALID_CREDENTIALS" : "UNAUTHENTICATED", status);
    if (status === 403 || status === 404 || code === "ACCOUNT_NOT_FOUND")
        return new TerminalMarketDataError("ACCOUNT_FORBIDDEN", status);
    if (code === "ACCOUNT_INACTIVE")
        return new TerminalMarketDataError("ACCOUNT_INACTIVE", status);
    if (status === 409 || code === "INVALID_PROVIDER_ACCOUNT")
        return new TerminalMarketDataError("INVALID_PROVIDER_ACCOUNT", status);
    if (status === 424 || code === "MISSING_CREDENTIALS")
        return new TerminalMarketDataError("MISSING_CREDENTIALS", status);
    if (code === "CREDENTIAL_STORAGE_ERROR")
        return new TerminalMarketDataError("CREDENTIAL_STORAGE_ERROR", status);
    if (status === 429 || code === "RATE_LIMITED")
        return new TerminalMarketDataError("RATE_LIMITED", status);
    if (code === "INVALID_REQUEST" || code === "INVALID_INSTRUMENT" || status === 400)
        return new TerminalMarketDataError("INVALID_REQUEST", status);
    if (status >= 500 || code === "UPSTREAM_ERROR" || code === "PROVIDER_UNAVAILABLE")
        return new TerminalMarketDataError("PROVIDER_UNAVAILABLE", status);
    return new TerminalMarketDataError("PROVIDER_ERROR", status);
}
async function getCustomerAccessToken() {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error || !session?.access_token) {
        throw new Error("Authentication required to request account market data.");
    }
    return session.access_token;
}
async function readMarketDataResponse(response) {
    let payload;
    try {
        payload = await response.json();
    }
    catch {
        if (!response.ok)
            throw normalizeMarketDataError(response.status);
        throw new TerminalMarketDataError("PROVIDER_ERROR", response.status);
    }
    if (!response.ok) {
        throw normalizeMarketDataError(response.status, payload.error?.code);
    }
    return payload.data;
}
export async function requestTerminalMarketData(accountId, provider, operation, environment = "production") {
    if (!accountId)
        throw new Error("A trading account is required for market data.");
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
    return readMarketDataResponse(response);
}
export async function fetchTerminalMarketDataStatus(accountId, provider, environment = "production") {
    if (!accountId)
        throw new Error("A trading account is required for market-data status.");
    const accessToken = await getCustomerAccessToken();
    const query = new URLSearchParams({ account_id: accountId, provider, environment });
    const response = await fetch(`${TERMINAL_OS_BASE}/api/terminal/market-data?${query}`, {
        credentials: "omit",
        headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
    });
    return readMarketDataResponse(response);
}
const terminalRealtimePools = new Map();
function notifyRealtimeStatus(pool, status) {
    for (const subscriber of pool.subscribers)
        subscriber.onStatus?.(status);
}
function parseSseFrame(frame) {
    let event = "message";
    const data = [];
    for (const line of frame.split(/\r?\n/)) {
        if (line.startsWith("event:"))
            event = line.slice(6).trim();
        else if (line.startsWith("data:"))
            data.push(line.slice(5).trimStart());
    }
    return data.length ? { event, data: data.join("\n") } : null;
}
async function readRealtimeStream(pool, generation, signal) {
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
        await readMarketDataResponse(response);
        throw new TerminalMarketDataError("PROVIDER_UNAVAILABLE", response.status);
    }
    notifyRealtimeStatus(pool, "connected");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
        while (!signal.aborted && generation === pool.generation) {
            const { value, done } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            let boundary = buffer.search(/\r?\n\r?\n/);
            while (boundary >= 0) {
                const frame = buffer.slice(0, boundary);
                const delimiter = buffer.slice(boundary).match(/^\r?\n\r?\n/)?.[0] ?? "\n\n";
                buffer = buffer.slice(boundary + delimiter.length);
                const message = parseSseFrame(frame);
                if (message?.event === "quote") {
                    try {
                        const event = JSON.parse(message.data);
                        for (const subscriber of pool.subscribers) {
                            if (subscriber.symbols.has(event.symbol))
                                subscriber.onQuote(event);
                        }
                    }
                    catch {
                        // Ignore malformed stream messages.
                    }
                }
                else if (message?.event === "error") {
                    notifyRealtimeStatus(pool, "reconnecting");
                }
                boundary = buffer.search(/\r?\n\r?\n/);
            }
        }
    }
    finally {
        await reader.cancel().catch(() => undefined);
    }
}
function startRealtimePool(pool) {
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
                if (!controller.signal.aborted)
                    throw new Error("Realtime stream ended");
            }
            catch {
                if (controller.signal.aborted || generation !== pool.generation)
                    break;
                notifyRealtimeStatus(pool, "reconnecting");
            }
            if (controller.signal.aborted || generation !== pool.generation)
                break;
            await new Promise((resolve) => {
                const timer = setTimeout(resolve, delay);
                controller.signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
            });
            delay = Math.min(delay * 2, 30000);
        }
    })();
}
export function subscribeToTerminalMarketDataStream(accountId, provider, symbols, onQuote, onStatus, environment = "production") {
    const normalizedSymbols = [...new Set(symbols.map((symbol) => symbol.trim()).filter(Boolean))];
    if (!accountId || normalizedSymbols.length === 0)
        return () => undefined;
    const key = `${accountId}:${provider}:${environment}`;
    let pool = terminalRealtimePools.get(key);
    if (!pool) {
        pool = { accountId, provider, environment, symbols: new Set(), subscribers: new Set(), controller: null, generation: 0 };
        terminalRealtimePools.set(key, pool);
    }
    const subscriber = { symbols: new Set(normalizedSymbols), onQuote, onStatus };
    const previousSymbolCount = pool.symbols.size;
    normalizedSymbols.forEach((symbol) => pool?.symbols.add(symbol));
    pool.subscribers.add(subscriber);
    if (pool.symbols.size !== previousSymbolCount || !pool.controller)
        startRealtimePool(pool);
    return () => {
        const current = terminalRealtimePools.get(key);
        if (!current)
            return;
        current.subscribers.delete(subscriber);
        const stillNeeded = new Set([...current.subscribers].flatMap((item) => [...item.symbols]));
        const changed = stillNeeded.size !== current.symbols.size || [...current.symbols].some((symbol) => !stillNeeded.has(symbol));
        current.symbols = stillNeeded;
        if (current.subscribers.size === 0) {
            current.controller?.abort();
            current.generation++;
            terminalRealtimePools.delete(key);
            onStatus?.("disconnected");
        }
        else if (changed) {
            startRealtimePool(current);
        }
    };
}
export function reconnectTerminalMarketDataStreams() {
    for (const pool of terminalRealtimePools.values())
        startRealtimePool(pool);
}
export async function fetchTerminalAccounts() {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user)
        throw new Error("Authentication required to load trading accounts");
    const { data, error } = await supabase
        .from("trading_accounts")
        .select("id, account_code, broker_provider, current_balance, status, available_margin, used_margin")
        .eq("owner_user_id", user.id)
        .order("created_at", { ascending: true });
    if (error)
        throw new Error(`Trading accounts request failed: ${error.message}`);
    const accounts = (data ?? []).map((account) => ({
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
export async function fetchAccountContext(accountId) {
    const { data, error } = await supabase.rpc("get_active_account_context", {
        requested_account_id: accountId || null,
    });
    if (error)
        throw new Error(`Account context request failed: ${error.message}`);
    return data;
}
export async function fetchCanonicalPlans() {
    const { data, error } = await supabase.from("products").select("id, code, name, description, status").order("name", { ascending: true });
    if (error)
        throw new Error(`Plan catalog request failed: ${error.message}`);
    return { data: (data ?? []) };
}
export async function fetchCanonicalRuleVersions(productId) {
    const query = supabase.from("rule_versions").select("id, product_id, phase_id, version, status, rules, created_at, created_by_email");
    const filtered = productId ? query.eq("product_id", productId) : query;
    const { data, error } = await filtered.order("created_at", { ascending: false });
    if (error)
        throw new Error(`Rule version request failed: ${error.message}`);
    return { data: (data ?? []) };
}
export async function saveRuleConfiguration(action, payload) {
    const { data, error } = await supabase.rpc("manage_rule_configuration", {
        request: { action, ...payload, actor_email: payload.actor_email ?? "system@fundedwealth.local" },
    });
    if (error)
        throw new Error(`Rule configuration update failed: ${error.message}`);
    return data;
}
export async function transitionTradingAccount(accountId, status, reason) {
    const { data, error } = await supabase.rpc("transition_trading_account", {
        requested_account_id: accountId,
        requested_status: status,
        transition_reason: reason ?? null,
    });
    if (error)
        throw new Error(`Account transition failed: ${error.message}`);
    return data.account;
}
export async function evaluatePreTradeRisk(request) {
    const { data, error } = await supabase.rpc("evaluate_pre_trade_risk", { request });
    if (error)
        throw new Error(`Risk evaluation failed: ${error.message}`);
    return data;
}
export function createServerPreTradeRiskGate() {
    return async (request) => {
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
            risk_state: "ACTIVE",
        };
    };
}
export async function createTerminalOrder(request) {
    if (!request.account_id)
        throw new Error("A trading account is required to place an order.");
    const command = prepareOrderCommand(request);
    const result = await submitTerminalOrderCommand(command);
    clearPendingOrderCommand(command);
    return result;
}
export async function setActiveAccount(accountId) {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user)
        throw new Error("Authentication required to select an account");
    const { error } = await supabase.from("terminal_settings").upsert({
        owner_user_id: user.id,
        active_account_id: accountId,
    });
    if (error)
        throw new Error(`Active account update failed: ${error.message}`);
}
function createRealtimeChannel(baseName) {
    return `${baseName}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
export function subscribeToAccountContext(onChange) {
    if (!SUPABASE_CONFIGURED)
        return () => undefined;
    const channel = supabase
        .channel(createRealtimeChannel("canonical-account-context"))
        .on("postgres_changes", { event: "*", schema: "public", table: "trading_accounts" }, onChange)
        .on("postgres_changes", { event: "*", schema: "public", table: "account_permissions" }, onChange)
        .on("postgres_changes", { event: "*", schema: "public", table: "rule_versions" }, onChange)
        .on("postgres_changes", { event: "*", schema: "public", table: "risk_events" }, onChange)
        .subscribe();
    return () => { void supabase.removeChannel(channel); };
}
export async function fetchTerminalSystemHealth() {
    return fetchTerminalJson("/api/terminal/system-health");
}
function accountQuery(accountId) {
    return accountId ? `&account_id=${encodeURIComponent(accountId)}` : "";
}
export function fetchTerminalPositions(accountId) {
    return (async () => {
        const { data, error } = await supabase.rpc("get_terminal_positions", { requested_account_id: accountId ?? null });
        if (error)
            throw new Error(`Positions request failed: ${error.message}`);
        const positions = (data ?? []).map((row) => ({
            ...row,
            trading_account_id: row.account_id,
            qty: Number(row.quantity ?? 0),
            avg_price: Number(row.average_price ?? 0),
            current_price: row.last_price == null ? null : Number(row.last_price),
            is_open: row.position_status === "open",
        }));
        return { data: positions, meta: { total: positions.length, page: 1, page_size: positions.length, has_more: false } };
    })();
}
export async function modifyTerminalPositionProtection(positionId, field, price) {
    if (!Number.isFinite(price) || price <= 0)
        throw new Error("Protection price must be greater than zero.");
    const { data, error } = await supabase.rpc("modify_position_protection", {
        requested_position_id: positionId,
        requested_field: field,
        requested_price: price,
    });
    if (error)
        throw new Error(error.message || "Position protection update failed.");
    return data;
}
export function fetchTerminalDashboard(accountId) {
    return fetchTerminalJson(`/api/terminal/dashboard${accountId ? `?account_id=${encodeURIComponent(accountId)}` : ""}`);
}
export function fetchTerminalOrders(accountId) {
    return (async () => {
        const { data, error } = await supabase.rpc("get_terminal_orders", { requested_account_id: accountId ?? null });
        if (error)
            throw new Error(`Orders request failed: ${error.message}`);
        const orders = (data ?? []).map((row) => deserializeCanonicalOrder(row));
        return { data: orders, meta: { total: orders.length, page: 1, page_size: orders.length, has_more: false } };
    })();
}
export function subscribeToTerminalOrders(accountId, onChange) {
    if (!SUPABASE_CONFIGURED)
        return () => undefined;
    const channel = supabase
        .channel(createRealtimeChannel(`customer-orders-${accountId}`))
        .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `account_id=eq.${accountId}` }, onChange)
        .subscribe();
    return () => { void supabase.removeChannel(channel); };
}
export function subscribeToTerminalPositions(accountId, onChange) {
    if (!SUPABASE_CONFIGURED)
        return () => undefined;
    const channel = supabase
        .channel(createRealtimeChannel(`customer-positions-${accountId}`))
        .on("postgres_changes", { event: "*", schema: "public", table: "positions", filter: `account_id=eq.${accountId}` }, onChange)
        .subscribe();
    return () => { void supabase.removeChannel(channel); };
}
export function fetchTerminalExecutions(accountId) {
    return (async () => {
        const { data, error } = await supabase.rpc("get_terminal_executions", { requested_account_id: accountId ?? null });
        if (error)
            throw new Error(`Executions request failed: ${error.message}`);
        const executions = (data ?? []);
        return { data: executions, meta: { total: executions.length, page: 1, page_size: executions.length, has_more: false } };
    })();
}
export function fetchTerminalRisk(accountId) {
    return fetchTerminalJson(`/api/terminal/risk${accountId ? `?account_id=${encodeURIComponent(accountId)}` : ""}`);
}
export function fetchTerminalPerformance(accountId) {
    return fetchTerminalJson(`/api/terminal/performance?page_size=100${accountQuery(accountId)}`);
}
export function fetchTerminalWatchlists() {
    return fetchTerminalJson("/api/terminal/watchlists?page_size=100");
}
export { TERMINAL_OS_BASE };
