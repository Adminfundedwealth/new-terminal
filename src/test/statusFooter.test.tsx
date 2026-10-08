import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/terminalApi", () => ({
  fetchTerminalSystemHealth: vi.fn(),
}));

import { fetchTerminalSystemHealth } from "@/lib/terminalApi";
import { StatusFooter } from "@/components/StatusFooter";

function renderStatusFooter() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <StatusFooter />
    </QueryClientProvider>,
  );
}

describe("StatusFooter", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not report healthy when market-data providers are unknown", async () => {
    vi.mocked(fetchTerminalSystemHealth).mockResolvedValue({
      data: [
        { name: "database", status: "HEALTHY", response_time_ms: 20, last_success_at: null, last_error: null, checked_at: "2026-10-08T00:00:00Z" },
        { name: "market_data_providers", status: "UNKNOWN", response_time_ms: null, last_success_at: null, last_error: "Provider health storage is unavailable", checked_at: "2026-10-08T00:00:00Z" },
      ],
      checked_at: "2026-10-08T00:00:00Z",
    });

    renderStatusFooter();

    expect(await screen.findByText("DEGRADED")).toBeInTheDocument();
  });

  it("reports healthy only when every health check is healthy", async () => {
    vi.mocked(fetchTerminalSystemHealth).mockResolvedValue({
      data: [
        { name: "database", status: "HEALTHY", response_time_ms: 20, last_success_at: null, last_error: null, checked_at: "2026-10-08T00:00:00Z" },
        { name: "terminal_api", status: "HEALTHY", response_time_ms: null, last_success_at: null, last_error: null, checked_at: "2026-10-08T00:00:00Z" },
      ],
      checked_at: "2026-10-08T00:00:00Z",
    });

    renderStatusFooter();

    expect(await screen.findByText("HEALTHY")).toBeInTheDocument();
  });
});
