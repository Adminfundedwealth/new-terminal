export const DEFAULT_REQUEST_TIMEOUT_MS = 2_500;

export class RequestTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs} ms.`);
    this.name = "RequestTimeoutError";
  }
}

export function withRequestTimeout<T>(
  timeoutMs: number,
  request: (signal: AbortSignal) => Promise<T>,
  parentSignal?: AbortSignal,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.reject(new RangeError("Request timeout must be a positive number."));
  }
  if (parentSignal?.aborted) {
    return Promise.reject(parentSignal.reason ?? new DOMException("Request aborted.", "AbortError"));
  }

  const controller = new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let removeAbortListener: () => void = () => {};

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new RequestTimeoutError(timeoutMs));
      controller.abort();
    }, timeoutMs);
  });
  const abortPromise = new Promise<never>((_, reject) => {
    if (!parentSignal) return;
    const onAbort = () => {
      reject(parentSignal.reason ?? new DOMException("Request aborted.", "AbortError"));
      controller.abort(parentSignal.reason);
    };
    parentSignal.addEventListener("abort", onAbort, { once: true });
    removeAbortListener = () => parentSignal.removeEventListener("abort", onAbort);
  });
  const requestPromise = Promise.resolve().then(() => request(controller.signal));

  return Promise.race([requestPromise, timeoutPromise, abortPromise]).finally(() => {
    clearTimeout(timeoutHandle);
    removeAbortListener();
  });
}
