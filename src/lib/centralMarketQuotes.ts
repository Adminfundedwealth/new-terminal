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

const RATE_LIMIT_RETRY_DELAY_MS = 1_000;

function isRateLimitError(error: unknown): boolean {
  return error instanceof TerminalMarketDataError
    ? error.status === 429
    : error instanceof Error && /\b429\b/.test(error.message);
}

export async function fetchCentralMarketQuotes(targets: CentralMarketQuoteTarget[]): Promise<{
  quotes: Record<string, TerminalMarketDataQuote>;
  errors: string[];
}> {
  const instrumentsBySegment = new Map<string, Map<string, Instrument>>();
  const errors: string[] = [];

  for (const target of targets) {
    const instrument = target.instrument;
    if (!instrument || instrument.provider !== "dhan") {
      errors.push(`Central Dhan instrument data is unavailable for ${target.key}.`);
      continue;
    }
    const segmentInstruments = instrumentsBySegment.get(instrument.exchangeSegment) ?? new Map<string, Instrument>();
    segmentInstruments.set(instrument.securityId, instrument);
    instrumentsBySegment.set(instrument.exchangeSegment, segmentInstruments);
  }

  const quotes: Record<string, TerminalMarketDataQuote> = {};
  for (const [segment, instruments] of instrumentsBySegment) {
    const entries = [...instruments.values()];
    for (let offset = 0; offset < entries.length; offset += 10) {
      const batch = entries.slice(offset, offset + 10);
      const terminalInstruments = batch.map((instrument) =>
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
        for (const instrument of batch) {
          errors.push(`Central Dhan quote request failed for ${instrument.tradingSymbol}: ${message}`);
        }
        continue;
      }

      const quotesByInstrument = new Map(
        batchQuotes.map((quote) => [`${quote.exchange}:${quote.tradingSymbol}`, quote]),
      );
      for (const instrument of batch) {
        const exchange = instrument.exchange ?? (instrument.exchangeSegment.startsWith("BSE") ? "BSE" : "NSE");
        const quote = quotesByInstrument.get(`${exchange}:${instrument.tradingSymbol}`);
        const matchingTargets = targets.filter((target) =>
          target.instrument?.securityId === instrument.securityId &&
          target.instrument.exchangeSegment === segment
        );
        for (const target of matchingTargets) {
          if (!quote) {
            errors.push(`Central Dhan returned no quote for ${instrument.tradingSymbol}.`);
          } else {
            quotes[target.key] = quote;
          }
        }
      }
    }
  }

  return { quotes, errors: [...new Set(errors)] };
}
