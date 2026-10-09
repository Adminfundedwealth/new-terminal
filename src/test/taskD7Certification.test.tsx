import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const supabaseAuth = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signOut: vi.fn(),
  listener: null as ((event: string, session: unknown) => void) | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: supabaseAuth.getSession,
      onAuthStateChange: supabaseAuth.onAuthStateChange,
      signOut: supabaseAuth.signOut,
    },
  },
  SUPABASE_CONFIGURED: true,
}));

vi.mock("@/components/DashboardLayout", async () => {
  const { Outlet } = await import("react-router-dom");
  const { useAuth } = await import("@/hooks/useAuth");
  return {
    default: function SyntheticTerminalShell() {
      const { signOut } = useAuth();
      return (
        <main data-testid="main-terminal-shell">
          <button type="button" onClick={() => void signOut()}>Sign out</button>
          <Outlet />
        </main>
      );
    },
  };
});

vi.mock("@/pages/RealtimeMockE2E", () => ({
  default: () => <div data-testid="synthetic-terminal-workspace">Synthetic terminal workspace</div>,
}));

vi.mock("@/pages/Login", () => ({
  default: () => <div data-testid="customer-login">Customer login</div>,
}));

import App from "@/App";

const syntheticSession = {
  access_token: "synthetic-customer-session-token",
  user: { id: "d7-synthetic-customer" },
};
const runSyntheticDatabaseCertification = process.env.RUN_D6B_SYNTHETIC_DB_CERTIFICATION === "true";

function getSyntheticDatabaseCredentials(): { supabaseUrl: string; serviceRoleKey: string } {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Synthetic database certification requires SUPABASE_URL and a server-only service-role key.");
  }
  return { supabaseUrl, serviceRoleKey };
}

describe("Task D7-A controlled Main Terminal certification", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/__realtime-e2e");
    supabaseAuth.listener = null;
    supabaseAuth.getSession.mockResolvedValue({ data: { session: syntheticSession }, error: null });
    supabaseAuth.onAuthStateChange.mockImplementation((listener) => {
      supabaseAuth.listener = listener;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    supabaseAuth.signOut.mockImplementation(async () => {
      supabaseAuth.listener?.("SIGNED_OUT", null);
      return { error: null };
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("opens the protected Terminal route only after synthetic customer session hydration", async () => {
    render(<App />);

    expect(await screen.findByTestId("main-terminal-shell")).toBeInTheDocument();
    expect(await screen.findByTestId("synthetic-terminal-workspace")).toBeInTheDocument();
    expect(supabaseAuth.getSession).toHaveBeenCalledTimes(1);
  });

  it("redirects an unauthenticated customer away from the protected Terminal route", async () => {
    supabaseAuth.getSession.mockResolvedValueOnce({ data: { session: null }, error: null });
    render(<App />);

    expect(await screen.findByTestId("customer-login")).toBeInTheDocument();
    expect(screen.queryByTestId("main-terminal-shell")).not.toBeInTheDocument();
  });

  it("returns to login and expires the Terminal session on sign-out or auth-session loss", async () => {
    const { unmount } = render(<App />);
    expect(await screen.findByTestId("main-terminal-shell")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByTestId("customer-login")).toBeInTheDocument();
    expect(supabaseAuth.signOut).toHaveBeenCalledTimes(1);

    unmount();
    window.history.replaceState({}, "", "/__realtime-e2e");
    supabaseAuth.getSession.mockResolvedValueOnce({ data: { session: syntheticSession }, error: null });
    render(<App />);
    expect(await screen.findByTestId("main-terminal-shell")).toBeInTheDocument();
    act(() => supabaseAuth.listener?.("SIGNED_OUT", null));

    await waitFor(() => expect(screen.getByTestId("customer-login")).toBeInTheDocument());
    expect(screen.queryByTestId("main-terminal-shell")).not.toBeInTheDocument();
  });

  it.skipIf(!runSyntheticDatabaseCertification)("D4: validates execution-worker handoff and persisted mock acknowledgement", async () => {
    const { supabaseUrl, serviceRoleKey } = getSyntheticDatabaseCredentials();

    const { createClient } = await import("@supabase/supabase-js");
    const testClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const syntheticAccountId = "d6b00000-0000-4000-8000-000000000002";

    const { data: order, error: orderError } = await testClient
      .from("orders")
      .select("id, symbol, side, quantity, filled_quantity, average_fill_price, status")
      .eq("account_id", syntheticAccountId)
      .like("client_order_id", "D6B-SYNTH-%")
      .limit(1)
      .maybeSingle();

    expect(orderError).toBeNull();
    if (!order) throw new Error("D4 certification requires a persisted D6BSYNTH order.");

    const syntheticOrderId = order.id;

    const { data: outbox, error: outboxError } = await testClient
      .from("order_execution_outbox")
      .select("id, provider_order_id, claimed_by, submitted_at, acknowledged_at, state, completed_at")
      .eq("order_id", syntheticOrderId)
      .maybeSingle();

    expect(outboxError).toBeNull();
    expect(outbox).toBeTruthy();
    expect(outbox?.provider_order_id).toBeTruthy();
    expect(outbox?.claimed_by).toBeTruthy();
    expect(outbox?.submitted_at).toBeTruthy();
    expect(outbox?.acknowledged_at).toBeTruthy();
    expect(outbox?.state).toBe("completed");
    expect(outbox?.completed_at).toBeTruthy();

    const { data: submission, error: submissionError } = await testClient
      .from("execution_submissions")
      .select("id, provider_response, submission_state")
      .eq("order_id", syntheticOrderId)
      .maybeSingle();

    expect(submissionError).toBeNull();
    expect(submission).toBeTruthy();
    expect(submission?.provider_response).toBeTruthy();
    expect(["acknowledged", "filled"]).toContain(submission?.submission_state);
  }, 10000);

  it.skipIf(!runSyntheticDatabaseCertification)("D5: validates mock fill, position/P&L consistency, and audit trail", async () => {
    const { supabaseUrl, serviceRoleKey } = getSyntheticDatabaseCredentials();

    const { createClient } = await import("@supabase/supabase-js");
    const testClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const syntheticAccountId = "d6b00000-0000-4000-8000-000000000002";

    const { data: order, error: orderError } = await testClient
      .from("orders")
      .select("id, symbol, side, quantity, filled_quantity, average_fill_price, status")
      .eq("account_id", syntheticAccountId)
      .like("client_order_id", "D6B-SYNTH-%")
      .limit(1)
      .maybeSingle();

    expect(orderError).toBeNull();
    if (!order) throw new Error("D5 certification requires a persisted D6BSYNTH order.");

    const syntheticOrderId = order.id;

    const { data: executions, error: executionsError } = await testClient
      .from("executions")
      .select("id, quantity, execution_price, executed_at")
      .eq("order_id", syntheticOrderId);

    expect(executionsError).toBeNull();
    expect(executions).toBeTruthy();
    expect(executions).toHaveLength(1);

    const fills = executions ?? [];
    const filledQuantity = fills.reduce((total, fill) => total + Number(fill.quantity), 0);
    const weightedAveragePrice = fills.reduce(
      (total, fill) => total + Number(fill.quantity) * Number(fill.execution_price),
      0,
    ) / filledQuantity;
    expect(filledQuantity).toBe(Number(order.quantity));
    expect(Number(order.filled_quantity)).toBe(filledQuantity);
    expect(order.status).toBe("filled");
    expect(Number(order.average_fill_price)).toBeCloseTo(weightedAveragePrice, 6);
    for (const fill of fills) {
      expect(Number(fill.quantity)).toBeGreaterThan(0);
      expect(Number(fill.execution_price)).toBeGreaterThan(0);
      expect(fill.executed_at).toBeTruthy();
    }

    const { data: account, error: accountError } = await testClient
      .from("trading_accounts")
      .select("id, current_balance, equity, realized_pnl, unrealized_pnl")
      .eq("id", syntheticAccountId)
      .maybeSingle();

    expect(accountError).toBeNull();
    expect(account).toBeTruthy();
    expect(account?.id).toBe(syntheticAccountId);

    const { data: position, error: positionError } = await testClient
      .from("positions")
      .select("id, account_id, symbol, quantity, average_price, unrealized_pnl, realized_pnl, total_pnl, position_status")
      .eq("account_id", syntheticAccountId)
      .eq("symbol", order.symbol);

    expect(positionError).toBeNull();
    expect(position).toHaveLength(1);
    const openPosition = position?.[0];
    expect(openPosition?.account_id).toBe(syntheticAccountId);
    expect(openPosition?.quantity).toBe(Number(order.side === "buy" ? filledQuantity : -filledQuantity));
    expect(Number(openPosition?.average_price)).toBeCloseTo(weightedAveragePrice, 6);
    expect(openPosition?.position_status).toBe("open");
    expect(Number(openPosition?.total_pnl)).toBeCloseTo(
      Number(openPosition?.realized_pnl) + Number(openPosition?.unrealized_pnl),
      6,
    );

    const { data: auditEvents, error: auditError } = await testClient
      .from("execution_audit_log")
      .select("event_type")
      .eq("account_id", syntheticAccountId)
      .eq("order_id", syntheticOrderId);
    expect(auditError).toBeNull();
    const eventTypes = new Set(auditEvents?.map((event) => event.event_type));
    for (const eventType of ["submission_started", "provider_ack", "execution_fill", "execution_accepted"]) {
      expect(eventTypes.has(eventType)).toBe(true);
    }

    const { data: accountPositions, error: accountPositionsError } = await testClient
      .from("positions")
      .select("realized_pnl, unrealized_pnl")
      .eq("account_id", syntheticAccountId);
    expect(accountPositionsError).toBeNull();
    const positionsRealizedPnl = (accountPositions ?? []).reduce(
      (total, item) => total + Number(item.realized_pnl ?? 0),
      0,
    );
    const positionsUnrealizedPnl = (accountPositions ?? []).reduce(
      (total, item) => total + Number(item.unrealized_pnl ?? 0),
      0,
    );
    expect(Number(account?.realized_pnl)).toBeCloseTo(positionsRealizedPnl, 6);
    expect(Number(account?.unrealized_pnl)).toBeCloseTo(positionsUnrealizedPnl, 6);
    expect(Number(account?.equity)).toBeCloseTo(Number(account?.current_balance) + positionsUnrealizedPnl, 6);
  }, 10000);
});