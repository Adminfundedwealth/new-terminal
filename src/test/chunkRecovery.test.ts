import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearChunkRecoveryAttempt,
  installChunkLoadRecovery,
} from "@/lib/chunkRecovery";

describe("chunk load recovery", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("reloads once for a stale chunk and lets the error surface after that", () => {
    const reload = vi.fn();
    const removeListener = installChunkLoadRecovery(window, window.sessionStorage, reload);
    const firstError = new Event("vite:preloadError", { cancelable: true });
    const secondError = new Event("vite:preloadError", { cancelable: true });

    window.dispatchEvent(firstError);
    window.dispatchEvent(secondError);
    removeListener();

    expect(firstError.defaultPrevented).toBe(true);
    expect(secondError.defaultPrevented).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("allows recovery again after a route module loads successfully", () => {
    const reload = vi.fn();
    const removeListener = installChunkLoadRecovery(window, window.sessionStorage, reload);

    window.dispatchEvent(new Event("vite:preloadError", { cancelable: true }));
    clearChunkRecoveryAttempt(window.sessionStorage);
    window.dispatchEvent(new Event("vite:preloadError", { cancelable: true }));
    removeListener();

    expect(reload).toHaveBeenCalledTimes(2);
  });
});
