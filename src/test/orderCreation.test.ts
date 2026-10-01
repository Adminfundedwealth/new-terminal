import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTerminalOrder } from "@/lib/terminalApi";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession } },
  SUPABASE_CONFIGURED: true,
}));

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260924000300_task12_order_creation.sql"),
  "utf8",
);
const normalizationMigration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260924000100_task9_order_normalization.sql"),
  "utf8",
);
const simulatedDerivativeMigration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260927000100_simulated_kite_derivative_flow.sql"),
  "utf8",
);

describe("Task 12 authoritative order creation contract", () => {
  it("uses one authenticated server boundary and the canonical orders table", () => {
    expect(migration).toContain("create or replace function public.create_order(request jsonb)");
    expect(migration).toContain("if auth.uid() is null");
    expect(migration).toContain("where id = account_id_value and owner_user_id = auth.uid()");
    expect(migration).toContain("insert into public.orders");
    expect(migration).not.toContain("create table public.trading_orders");
    expect(migration).not.toContain("placeBrokerOrder");
    expect(migration).not.toContain("brokerAdapter");
  });

  it("runs validation before the mandatory Task 11 risk gate and persists only requested orders", () => {
    expect(migration.indexOf("INVALID_QUANTITY")).toBeLessThan(migration.indexOf("public.evaluate_pre_trade_risk"));
    expect(migration).toContain("if risk_result->>'decision' <> 'ALLOW'");
    expect(migration).toContain("time_in_force, status, created_at, updated_at");
    expect(migration).toContain("'requested', now_value, now_value");
    expect(migration).toContain("estimated_loss', case when price_value is null then null else quantity_value * price_value * 0.01 end");
    expect(migration).not.toContain("request->>'estimated_loss'");
  });

  it("derives identity and canonical ids, and makes retries deterministic", () => {
    expect(migration).toContain("order_id_value uuid := gen_random_uuid()");
    expect(migration).toContain("auth.uid(), client_order_id_value");
    expect(normalizationMigration).toContain("orders_account_client_order_uidx");
    expect(migration).toContain("'replayed', true");
    expect(migration).toContain("'PERSISTENCE_FAILURE'");
  });

  it("exposes the RPC only to authenticated callers", () => {
    expect(migration).toContain("revoke all on function public.create_order(jsonb) from public, anon");
    expect(migration).toContain("grant execute on function public.create_order(jsonb) to authenticated");
  });
});

describe("simulated Kite derivative order contract", () => {
  it("registers Kite contracts and executes only for an active simulated account", () => {
    expect(simulatedDerivativeMigration).toContain("create or replace function public.create_simulated_kite_order(request jsonb)");
    expect(simulatedDerivativeMigration).toContain("upper(coalesce(account_row.account_type, '')) <> 'SIMULATED'");
    expect(simulatedDerivativeMigration).toContain("lower(coalesce(instrument_value->>'provider', '')) <> 'zerodha'");
    expect(simulatedDerivativeMigration).toContain("insert into public.instruments");
    expect(simulatedDerivativeMigration).toContain("insert into public.executions");
    expect(simulatedDerivativeMigration).toContain("insert into public.positions");
    expect(simulatedDerivativeMigration).toContain("'SIM-' || order_id_value::text");
    expect(simulatedDerivativeMigration).not.toContain("placeBrokerOrder");
  });

  it("exposes owner-scoped Terminal OS reads only to authenticated callers", () => {
    expect(simulatedDerivativeMigration).toContain("where owner_user_id = auth.uid()");
    expect(simulatedDerivativeMigration).toContain("grant execute on function public.get_terminal_orders(uuid) to authenticated");
    expect(simulatedDerivativeMigration).toContain("grant execute on function public.get_terminal_executions(uuid) to authenticated");
    expect(simulatedDerivativeMigration).toContain("grant execute on function public.get_terminal_positions(uuid) to authenticated");
    expect(simulatedDerivativeMigration).toContain("revoke all on function public.create_simulated_kite_order(jsonb) from public, anon");
  });
});

describe("Kite derivative order routing", () => {
  const accessToken = "mock-customer-jwt";
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    getSession.mockResolvedValue({ data: { session: { access_token: accessToken } }, error: null });
    fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { ok: true, order: { id: "canonical-order" } } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("sends NRML Kite derivatives only to the simulated RPC", async () => {
    const request = {
      account_id: "sim-account",
      symbol: "NIFTY26SEP23150CE",
      exchange: "NSE",
      segment: "NSE_FNO",
      side: "BUY" as const,
      quantity: 65,
      order_type: "MARKET" as const,
      price: 119.25,
      product: "NRML" as const,
      instrument: {
        securityId: "18920450",
        providerInstrumentId: "18920450",
        symbol: "NIFTY",
        tradingSymbol: "NIFTY26SEP23150CE",
        displayName: "NIFTY 23,150 CE",
        exchange: "NSE",
        exchangeSegment: "NSE_FNO",
        instrumentType: "OPTIDX",
        lotSize: 65,
        tickSize: 0.05,
        expiryDate: "2026-09-29",
        strikePrice: 23150,
        optionType: "CE",
        provider: "zerodha",
      },
    };

    await createTerminalOrder(request);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(url, "https://main.test").pathname).toBe("/api/terminal/orders");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("Authorization")).toBe(`Bearer ${accessToken}`);
    expect(JSON.parse(String(init.body))).toEqual(request);
  });
});