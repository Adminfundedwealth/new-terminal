import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const supabaseAuth = vi.hoisted(() => ({
    getSession: vi.fn(),
    onAuthStateChange: vi.fn(),
    signOut: vi.fn(),
    listener: null,
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
            return (_jsxs("main", { "data-testid": "main-terminal-shell", children: [_jsx("button", { type: "button", onClick: () => void signOut(), children: "Sign out" }), _jsx(Outlet, {})] }));
        },
    };
});
vi.mock("@/pages/RealtimeMockE2E", () => ({
    default: () => _jsx("div", { "data-testid": "synthetic-terminal-workspace", children: "Synthetic terminal workspace" }),
}));
vi.mock("@/pages/Login", () => ({
    default: () => _jsx("div", { "data-testid": "customer-login", children: "Customer login" }),
}));
import App from "@/App";
const syntheticSession = {
    access_token: "synthetic-customer-session-token",
    user: { id: "d7-synthetic-customer" },
};
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
        render(_jsx(App, {}));
        expect(await screen.findByTestId("main-terminal-shell")).toBeInTheDocument();
        expect(await screen.findByTestId("synthetic-terminal-workspace")).toBeInTheDocument();
        expect(supabaseAuth.getSession).toHaveBeenCalledTimes(1);
    });
    it("redirects an unauthenticated customer away from the protected Terminal route", async () => {
        supabaseAuth.getSession.mockResolvedValueOnce({ data: { session: null }, error: null });
        render(_jsx(App, {}));
        expect(await screen.findByTestId("customer-login")).toBeInTheDocument();
        expect(screen.queryByTestId("main-terminal-shell")).not.toBeInTheDocument();
    });
    it("returns to login and expires the Terminal session on sign-out or auth-session loss", async () => {
        const { unmount } = render(_jsx(App, {}));
        expect(await screen.findByTestId("main-terminal-shell")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
        expect(await screen.findByTestId("customer-login")).toBeInTheDocument();
        expect(supabaseAuth.signOut).toHaveBeenCalledTimes(1);
        unmount();
        window.history.replaceState({}, "", "/__realtime-e2e");
        supabaseAuth.getSession.mockResolvedValueOnce({ data: { session: syntheticSession }, error: null });
        render(_jsx(App, {}));
        expect(await screen.findByTestId("main-terminal-shell")).toBeInTheDocument();
        act(() => supabaseAuth.listener?.("SIGNED_OUT", null));
        await waitFor(() => expect(screen.getByTestId("customer-login")).toBeInTheDocument());
        expect(screen.queryByTestId("main-terminal-shell")).not.toBeInTheDocument();
    });
    it.skip("PENDING D4: validates final execution-worker handoff and persisted execution outcome");
    it.skip("PENDING D5: validates downstream execution completion and recovery assertions");
});
