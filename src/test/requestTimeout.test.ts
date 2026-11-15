import { afterEach, describe, expect, it, vi } from "vitest";
import { RequestTimeoutError, withRequestTimeout } from "@/lib/requestTimeout";

describe("withRequestTimeout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("aborts and rejects a request that exceeds its deadline", async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    const request = vi.fn((signal: AbortSignal) => {
      requestSignal = signal;
      return new Promise<never>(() => undefined);
    });

    const pending = withRequestTimeout(25, request);
    const assertion = expect(pending).rejects.toBeInstanceOf(RequestTimeoutError);
    await vi.advanceTimersByTimeAsync(25);
    await assertion;

    expect(requestSignal?.aborted).toBe(true);
  });

  it("cancels the request when its owner aborts it", async () => {
    const owner = new AbortController();
    let requestSignal: AbortSignal | undefined;
    const pending = withRequestTimeout(1_000, (signal) => {
      requestSignal = signal;
      return new Promise<never>(() => undefined);
    }, owner.signal);

    owner.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(requestSignal?.aborted).toBe(true);
  });
});
