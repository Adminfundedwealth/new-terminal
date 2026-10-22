import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLiveOptionChain } from "@/hooks/useMarketData";

vi.mock("@/hooks/useAccountContext", () => ({
  useAccountContext: () => ({ activeAccountId: null, accounts: [], isLoading: false }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useLiveOptionChain", () => {
  it("does not request account market data when no account is selected", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useLiveOptionChain("NIFTY"), { wrapper });

    expect(result.current.isFetching).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
