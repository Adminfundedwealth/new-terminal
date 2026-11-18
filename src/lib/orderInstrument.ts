export interface StockOrderInstrument {
  symbol: string;
  tradingSymbol: string;
  exchange: string;
  exchangeSegment: string;
}

export interface StockOrderInstrumentRow<T extends StockOrderInstrument = StockOrderInstrument> {
  symbol: string;
  chartSymbol?: string;
  instrument?: T;
}

function canonicalSegment(segment: string): string {
  const normalized = segment.trim().toUpperCase();
  if (normalized === "NSE" || normalized === "NSE-CM" || normalized === "NSE:E") return "NSE_EQ";
  if (normalized === "BSE" || normalized === "BSE-CM" || normalized === "BSE:E") return "BSE_EQ";
  if (normalized === "NFO") return "NSE_FNO";
  if (normalized === "BFO") return "BSE_FNO";
  if (normalized === "NSE:D") return "NSE_FNO";
  if (normalized === "BSE:D") return "BSE_FNO";
  return normalized;
}

export function resolveStockOrderInstrument<T extends StockOrderInstrument>(
  chartSymbol: string | null | undefined,
  rows: readonly StockOrderInstrumentRow<T>[],
  instruments: readonly T[],
): T | undefined {
  const requested = chartSymbol?.trim().toUpperCase();
  if (!requested) return undefined;

  const selectedRow = rows.find((row) =>
    (row.chartSymbol ?? row.symbol).trim().toUpperCase() === requested,
  );
  if (selectedRow?.instrument && instruments.includes(selectedRow.instrument)) {
    return selectedRow.instrument;
  }

  const separator = requested.indexOf(":");
  const requestedSegment = separator < 0 ? undefined : canonicalSegment(requested.slice(0, separator));
  const requestedSymbol = (separator < 0 ? requested : requested.slice(separator + 1)).trim();
  if (!requestedSymbol) return undefined;

  const matches = instruments.filter((instrument) =>
    (instrument.symbol.trim().toUpperCase() === requestedSymbol
      || instrument.tradingSymbol.trim().toUpperCase() === requestedSymbol)
    && (!requestedSegment || canonicalSegment(instrument.exchangeSegment) === requestedSegment),
  );
  if (matches.length === 1) return matches[0];
  if (requestedSegment || matches.length === 0) return undefined;

  const nseMatches = matches.filter((instrument) =>
    instrument.exchange.toUpperCase() === "NSE" || canonicalSegment(instrument.exchangeSegment) === "NSE_EQ",
  );
  if (nseMatches.length === 1) return nseMatches[0];

  const bseMatches = matches.filter((instrument) =>
    instrument.exchange.toUpperCase() === "BSE" || canonicalSegment(instrument.exchangeSegment) === "BSE_EQ",
  );
  return bseMatches.length === 1 ? bseMatches[0] : undefined;
}

export function canonicalOrderSegment(segment: string): string {
  return canonicalSegment(segment);
}
