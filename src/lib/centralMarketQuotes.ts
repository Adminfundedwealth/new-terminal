import type { Instrument } from "@/lib/localDatabase";
import { RequestTimeoutError } from "@/lib/requestTimeout";
import {
  requestTerminalMarketData,
  TerminalMarketDataError,
  toTerminalMarketDataInstrument,
  type TerminalMarketDataQuote,
} from "@/lib/terminalApi";

export interface CentralMarketQuoteTarget {
  key: string;
  instrument?: Instrument;
}

const RATE_LIMIT_RETRY_DELAY_MS = 1_500;
const MAX_CONCURRENT_BATCHES = 3;

function isRetryableBatchError(error: unknown): boolean {
  return error instanceof RequestTimeoutError ||
    error instanceof TypeError ||
    (error instanceof TerminalMarketDataError && (error.status === 429 || error.status >= 500));
}

function waitBeforeRetry(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Request aborted.", "AbortError"));
      return;
    }
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, RATE_LIMIT_RETRY_DELAY_MS);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal?.reason ?? new DOMException("Request aborted.", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Fetch quotes for a list of Dhan instruments in one batched call.
 * Targets without a resolved instrument are silently skipped (not counted as errors)
 * so a partially-loaded instrument catalog does not poison the whole watchlist.
 */
export async function fetchCentralMarketQuotes(targets: CentralMarketQuoteTarget[], signal?: AbortSignal): Promise<{
  quotes: Record<string, TerminalMarketDataQuote>;
  errors: string[];
}> {
  const errors: string[] = [];
  const resolved: Array<{ key: string; instrument: Instrument }> = [];

  for (const target of targets) {
    if (!target.instrument || target.instrument.provider !== "dhan") continue;
    resolved.push({ key: target.key, instrument: target.instrument });
  }

  if (resolved.length === 0) return { quotes: {}, errors };

  const quotes: Record<string, TerminalMarketDataQuote> = {};

  // Dhan quote requests must contain one exchange segment and at most 1000 instruments.
  const BATCH = 1000;
  const bySegment = new Map<string, typeof resolved>();
  for (const target of resolved) {
    const segment = target.instrument.exchangeSegment;
    const segmentTargets = bySegment.get(segment) ?? [];
    segmentTargets.push(target);
    bySegment.set(segment, segmentTargets);
  }

  const batches: Array<typeof resolved> = [];
  for (const segmentTargets of bySegment.values()) {
    for (let offset = 0; offset < segmentTargets.length; offset += BATCH) {
      batches.push(segmentTargets.slice(offset, offset + BATCH));
    }
  }

  let nextBatch = 0;
  const fetchBatch = async (batch: typeof resolved[number][]) => {
    const terminalInstruments = batch.map(({ instrument }) =>
      toTerminalMarketDataInstrument({
        ...instrument,
        exchange: instrument.exchange ?? (instrument.exchangeSegment.startsWith("BSE") ? "BSE" : "NSE"),
      }, "dhan")
    );

    let batchQuotes: TerminalMarketDataQuote[] | null = null;
    let failure: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        batchQuotes = await requestTerminalMarketData<TerminalMarketDataQuote[]>(
          null,
          "dhan",
          { operation: "getQuotes", instruments: terminalInstruments },
          "production",
          signal,
        );
        failure = undefined;
        break;
      } catch (error) {
        failure = error;
        if (attempt > 0 || !isRetryableBatchError(error)) break;
        await waitBeforeRetry(signal);
      }
    }

    if (!batchQuotes) {
      const message = failure instanceof Error ? failure.message : "A central Dhan quote request failed.";
      errors.push(`Central Dhan quote batch failed: ${message}`);
      return;
    }

    const bySymbol = new Map(batchQuotes.map((q) => [
      `${q.exchange}:${q.tradingSymbol}`.toUpperCase(),
      q,
    ]));
    const missingSymbols: string[] = [];

    for (const { key, instrument } of batch) {
      const exchange = (instrument.exchange ?? (instrument.exchangeSegment.startsWith("BSE") ? "BSE" : "NSE")).toUpperCase();
      const quote =
        bySymbol.get(`${exchange}:${instrument.tradingSymbol.toUpperCase()}`) ??
        bySymbol.get(`${exchange}:${instrument.symbol.toUpperCase()}`);
      if (quote && Number.isFinite(quote.ltp) && quote.ltp > 0) {
        quotes[key] = quote;
      } else {
        missingSymbols.push(instrument.tradingSymbol);
      }
    }
    if (missingSymbols.length > 0) {
      const sample = missingSymbols.slice(0, 3).join(", ");
      errors.push(`Central Dhan returned no quote for ${sample}${missingSymbols.length > 3 ? ` +${missingSymbols.length - 3} more` : ""}.`);
    }
  };

  const workers = Array.from(
    { length: Math.min(MAX_CONCURRENT_BATCHES, batches.length) },
    async () => {
      while (nextBatch < batches.length) {
        if (signal?.aborted) throw signal.reason ?? new DOMException("Request aborted.", "AbortError");
        const batch = batches[nextBatch++];
        await fetchBatch(batch);
      }
    },
  );
  await Promise.all(workers);

  return { quotes, errors: [...new Set(errors)] };
}
