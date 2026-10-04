import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
    supabase: { auth: { getSession } },
    SUPABASE_CONFIGURED: true,
}));
import { fetchTerminalMarketDataStatus, requestTerminalMarketData, requestTerminalRealtimeTicket, subscribeToTerminalMarketDataStream, TerminalMarketDataError, } from "@/lib/terminalApi";
import { REALTIME_MOCK_TEST_ACCOUNT_ID } from "@/lib/realtimeMockTestScope";
const accessToken = "customer-session-jwt";
const accountId = "11111111-1111-4111-8111-111111111111";
let fetchMock;
beforeEach(() => {
    getSession.mockResolvedValue({ data: { session: { access_token: accessToken } }, error: null });
    fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { authenticated: true } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});
describe("Main Terminal market-data contract", () => {
    it("sends Supabase identity proof with explicit account and provider context", async () => {
        await requestTerminalMarketData(accountId, "dhan", { operation: "authenticate" });
        const [url, init] = fetchMock.mock.calls[0];
        const headers = new Headers(init.headers);
        expect(new URL(url, "http://main.test").pathname).toBe("/api/terminal/market-data");
        expect(headers.get("Authorization")).toBe(`Bearer ${accessToken}`);
        expect(init.credentials).toBe("omit");
        expect(JSON.parse(String(init.body))).toEqual({
            account_id: accountId,
            provider: "dhan",
            environment: "production",
            operation: "authenticate",
        });
    });
    it("never puts the customer token or broker credentials in the request body", async () => {
        const instrument = {
            provider: "kite",
            providerInstrumentId: "256265",
            symbol: "NIFTY 50",
            tradingSymbol: "NIFTY 50",
            exchange: "NSE",
            exchangeSegment: "INDICES",
            instrumentType: "INDEX",
        };
        await requestTerminalMarketData(accountId, "kite", { operation: "getQuote", instrument });
        const [, init] = fetchMock.mock.calls[0];
        const serialized = JSON.stringify(JSON.parse(String(init.body)));
        expect(serialized).not.toContain(accessToken);
        expect(serialized).not.toContain("access_token");
        expect(serialized).not.toContain("api_secret");
        expect(serialized).not.toContain("credentials");
    });
    it("opens the account/provider realtime stream with JWT auth and parses normalized quote events", async () => {
        const quoteEvent = {
            account_id: accountId,
            provider: "dhan",
            environment: "production",
            symbol: "NIFTY",
            quote: { provider: "dhan", symbol: "NIFTY", tradingSymbol: "NIFTY 50", exchange: "NSE", ltp: 25000, open: 24900, high: 25100, low: 24800, previousClose: 24950, change: 50, changePercent: 0.2, volume: 10, openInterest: null, timestamp: "2026-10-01T09:15:00.000Z" },
        };
        fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({
            start(controller) {
                controller.enqueue(new TextEncoder().encode(`event: quote\ndata: ${JSON.stringify(quoteEvent)}\n\n`));
            },
        }), { status: 200, headers: { "Content-Type": "text/event-stream" } }));
        const quoteReceived = new Promise((resolve) => {
            const unsubscribe = subscribeToTerminalMarketDataStream(accountId, "dhan", ["NIFTY"], (event) => {
                unsubscribe();
                resolve(event);
            });
        });
        const quote = await quoteReceived;
        const [url, init] = fetchMock.mock.calls[0];
        const parsedUrl = new URL(url, "https://main.test");
        expect(parsedUrl.pathname).toBe("/api/terminal/market-data/stream");
        expect(parsedUrl.searchParams.get("account_id")).toBe(accountId);
        expect(parsedUrl.searchParams.get("provider")).toBe("dhan");
        expect(parsedUrl.searchParams.get("symbols")).toBe("NIFTY");
        expect(parsedUrl.searchParams.has("access_token")).toBe(false);
        expect(new Headers(init.headers).get("Authorization")).toBe(`Bearer ${accessToken}`);
        expect(quote).toEqual(quoteEvent);
    });
    it("requests provider status with the same customer/account/provider authorization context", async () => {
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: {
                account_id: accountId,
                provider: "kite",
                configured: true,
                is_connected: true,
                last_tested_at: null,
                last_test_result: null,
            } }), { status: 200 }));
        const status = await fetchTerminalMarketDataStatus(accountId, "kite");
        const [url, init] = fetchMock.mock.calls[0];
        expect(new URL(url, "http://main.test").searchParams.get("account_id")).toBe(accountId);
        expect(new URL(url, "http://main.test").searchParams.get("provider")).toBe("kite");
        expect(new Headers(init.headers).get("Authorization")).toBe(`Bearer ${accessToken}`);
        expect(status.is_connected).toBe(true);
    });
    it("requests a short-lived realtime ticket without sending credentials in the body", async () => {
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: {
                ticket: "signed-scope-only-ticket",
                expires_at: "2026-10-01T10:01:30.000Z",
            } }), { status: 200 }));
        const ticket = await requestTerminalRealtimeTicket(accountId, "dhan", "paper");
        const [url, init] = fetchMock.mock.calls[0];
        const headers = new Headers(init.headers);
        expect(new URL(url, "http://main.test").pathname).toBe("/api/terminal/realtime-ticket");
        expect(headers.get("Authorization")).toBe(`Bearer ${accessToken}`);
        expect(init.credentials).toBe("omit");
        expect(JSON.parse(String(init.body))).toEqual({ account_id: accountId, provider: "dhan", environment: "paper" });
        expect(JSON.stringify(init.body)).not.toContain(accessToken);
        expect(ticket.ticket).toBe("signed-scope-only-ticket");
    });
    it("opts into test mode only for the fixed synthetic paper scope", async () => {
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: {
                ticket: "mock-scope-ticket",
                expires_at: "2026-10-01T10:01:30.000Z",
            } }), { status: 200 }));
        await requestTerminalRealtimeTicket(REALTIME_MOCK_TEST_ACCOUNT_ID, "dhan", "paper");
        const [, init] = fetchMock.mock.calls[0];
        expect(JSON.parse(String(init.body))).toEqual({
            account_id: REALTIME_MOCK_TEST_ACCOUNT_ID,
            provider: "dhan",
            environment: "paper",
            test_mode: true,
        });
        expect(JSON.stringify(init.body)).not.toContain(accessToken);
    });
    it("fails before network access when the customer session is missing", async () => {
        getSession.mockResolvedValueOnce({ data: { session: null }, error: null });
        await expect(requestTerminalMarketData(accountId, "dhan", { operation: "authenticate" }))
            .rejects.toThrow("Authentication required");
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it.each([
        [401, { code: "INVALID_CREDENTIALS" }, "INVALID_CREDENTIALS"],
        [403, { code: "ACCOUNT_INACTIVE" }, "ACCOUNT_FORBIDDEN"],
        [424, { code: "MISSING_CREDENTIALS" }, "MISSING_CREDENTIALS"],
        [429, { code: "RATE_LIMITED" }, "RATE_LIMITED"],
        [502, { code: "UPSTREAM_ERROR", message: "raw secret text" }, "PROVIDER_UNAVAILABLE"],
    ])("normalizes HTTP %i into a safe %s error", async (status, error, code) => {
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error }), { status }));
        const failure = await requestTerminalMarketData(accountId, "dhan", { operation: "authenticate" })
            .catch((reason) => reason);
        expect(failure).toBeInstanceOf(TerminalMarketDataError);
        expect(failure).toMatchObject({ code, status });
        expect(failure.message).not.toContain("raw secret text");
    });
});
