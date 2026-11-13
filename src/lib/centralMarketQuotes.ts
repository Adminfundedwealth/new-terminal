import type { Instrument } from "@/lib/localDatabase";
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

function isRateLimitError(error: unknown): boolean {
  return error instanceof TerminalMarketDataError
    ? error.status === 429
    : error instanceof Error && /\b429\b/.test(error.message);
}

/**
 * Fetch quotes for a list of Dhan instruments in one batched call.
 * Targets without a resolved instrument are silently skipped (not counted as errors)
 * so a partially-loaded instrument catalog does not poison the whole watchlist.
 */
export async function fetchCentralMarketQuotes(targets: CentralMarketQuoteTarget[]): Promise<{
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

  // Terminal OS merges these into a single Dhan /marketfeed/quote call (up to 1000).
  const BATCH = 250;
  for (let offset = 0; offset < resolved.length; offset += BATCH) {
    const batch = resolved.slice(offset, offset + BATCH);
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
        );
        failure = undefined;
        break;
      } catch (error) {
        failure = error;
        if (attempt > 0 || !isRateLimitError(error)) break;
        await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_RETRY_DELAY_MS));
      }
    }

    if (!batchQuotes) {
      const message = failure instanceof Error ? failure.message : "A central Dhan quote request failed.";
      errors.push(`Central Dhan quote batch failed: ${message}`);
      continue;
    }

    // Match quotes back to targets by exchange:tradingSymbol
    const bySymbol = new Map(batchQuotes.map((q) => [
      `${q.exchange}:${q.tradingSymbol}`.toUpperCase(),
      q,
    ]));

    for (const { key, instrument } of batch) {
      const exchange = (instrument.exchange ?? (instrument.exchangeSegment.startsWith("BSE") ? "BSE" : "NSE")).toUpperCase();
      const quote =
        bySymbol.get(`${exchange}:${instrument.tradingSymbol.toUpperCase()}`) ??
        bySymbol.get(`${exchange}:${instrument.symbol.toUpperCase()}`);
      if (quote) {
        quotes[key] = quote;
      }
      // Don't push an error per symbol — a missing quote at market close is normal
    }
  }

  return { quotes, errors: [...new Set(errors)] };
}
