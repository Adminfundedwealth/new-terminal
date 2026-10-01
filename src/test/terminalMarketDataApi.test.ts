import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession } },
  SUPABASE_CONFIGURED: true,
}));

import {
  fetchTerminalMarketDataStatus,
  requestTerminalMarketData,
  TerminalMarketDataError,
} from "@/lib/terminalApi";

const accessToken = "customer-session-jwt";
const accountId = "11111111-1111-4111-8111-111111111111";
let fetchMock: ReturnType<typeof vi.fn>;

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

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
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
      provider: "kite" as const,
      providerInstrumentId: "256265",
      symbol: "NIFTY 50",
      tradingSymbol: "NIFTY 50",
      exchange: "NSE",
      exchangeSegment: "INDICES",
      instrumentType: "INDEX",
    };
    await requestTerminalMarketData(accountId, "kite", { operation: "getQuote", instrument });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const serialized = JSON.stringify(JSON.parse(String(init.body)));
    expect(serialized).not.toContain(accessToken);
    expect(serialized).not.toContain("access_token");
    expect(serialized).not.toContain("api_secret");
    expect(serialized).not.toContain("credentials");
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

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(url, "http://main.test").searchParams.get("account_id")).toBe(accountId);
    expect(new URL(url, "http://main.test").searchParams.get("provider")).toBe("kite");
    expect(new Headers(init.headers).get("Authorization")).toBe(`Bearer ${accessToken}`);
    expect(status.is_connected).toBe(true);
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
  ] as const)("normalizes HTTP %i into a safe %s error", async (status, error, code) => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error }), { status }));

    const failure = await requestTerminalMarketData(accountId, "dhan", { operation: "authenticate" })
      .catch((reason: unknown) => reason);

    expect(failure).toBeInstanceOf(TerminalMarketDataError);
    expect(failure).toMatchObject({ code, status });
    expect((failure as Error).message).not.toContain("raw secret text");
  });
});
