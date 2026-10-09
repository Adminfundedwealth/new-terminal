import { fetchCashQuotes } from "@/lib/marketApi";
import type { Instrument } from "@/lib/localDatabase";
import type { TerminalMarketDataQuote } from "@/lib/terminalApi";

export interface CentralMarketQuoteTarget {
  key: string;
  instrument?: Instrument;
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

  const quoteGroupEntries = [...instrumentsBySegment.entries()];
  const quoteGroups = quoteGroupEntries.map(async ([segment, instruments]) => ({
    segment,
    quotes: await fetchCashQuotes(segment, [...instruments.keys()]),
  }));
  const quoteResults = await Promise.allSettled(quoteGroups);
  const quotesBySegment = new Map<string, Awaited<ReturnType<typeof fetchCashQuotes>>>();
  const failedSegments = new Map<string, string>();

  quoteResults.forEach((result, index) => {
    const segment = quoteGroupEntries[index][0];
    if (result.status === "fulfilled") quotesBySegment.set(segment, result.value.quotes);
    else failedSegments.set(segment, result.reason instanceof Error ? result.reason.message : "A central Dhan quote request failed.");
  });

  const quotes: Record<string, TerminalMarketDataQuote> = {};
  for (const target of targets) {
    const instrument = target.instrument;
    if (!instrument || instrument.provider !== "dhan") continue;
    const segmentError = failedSegments.get(instrument.exchangeSegment);
    if (segmentError) {
      errors.push(`Central Dhan quote request failed for ${instrument.tradingSymbol}: ${segmentError}`);
      continue;
    }
    const quote = quotesBySegment.get(instrument.exchangeSegment)?.[instrument.securityId];
    if (!quote) {
      errors.push(`Central Dhan returned no quote for ${instrument.tradingSymbol}.`);
      continue;
    }
    quotes[target.key] = {
      provider: "dhan",
      symbol: instrument.symbol,
      tradingSymbol: instrument.tradingSymbol,
      exchange: instrument.exchange ?? (instrument.exchangeSegment.startsWith("BSE") ? "BSE" : "NSE"),
      ltp: quote.ltp,
      open: quote.open,
      high: quote.high,
      low: quote.low,
      previousClose: quote.previousClose,
      change: quote.change,
      changePercent: quote.changePercent,
      volume: quote.volume,
      openInterest: quote.openInterest,
      timestamp: quote.timestamp ?? "",
    };
  }

  return { quotes, errors: [...new Set(errors)] };
}
