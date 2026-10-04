import type {
  MarketCandle,
  MarketDataProviderId,
  MarketInstrument,
  MarketOptionChain,
  MarketOptionChainStrike,
  MarketOptionLeg,
  MarketQuote,
} from "./types.js";

export function normalizeMarketInstrument(instrument: MarketInstrument) {
  return {
    ...instrument,
    display_name: instrument.tradingSymbol || instrument.symbol,
    segment: instrument.exchangeSegment,
    instrument_token: instrument.providerInstrumentId,
  };
}

export function normalizeMarketQuote(quote: MarketQuote) {
  return {
    ...quote,
    bid: quote.bid ?? null,
    ask: quote.ask ?? null,
    change_percent: quote.changePercent,
  };
}

export function normalizeMarketCandle(candle: MarketCandle) {
  return {
    timestamp: candle.timestamp,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
  };
}

function legacyLeg(leg: MarketOptionLeg | null) {
  return {
    ltp: leg?.ltp ?? 0,
    oi: leg?.oi ?? 0,
    oiChange: leg?.oi_change ?? 0,
    volume: leg?.volume ?? 0,
    iv: leg?.iv ?? 0,
    delta: leg?.greeks?.delta ?? 0,
    gamma: leg?.greeks?.gamma ?? 0,
    theta: leg?.greeks?.theta ?? 0,
    vega: leg?.greeks?.vega ?? 0,
    bidPrice: leg?.bid ?? 0,
    askPrice: leg?.ask ?? 0,
  };
}

export function normalizeMarketOptionChain(input: {
  provider: MarketDataProviderId;
  underlying: string;
  expiry: string;
  expiries: string[];
  spotPrice: number;
  rows: Array<{ strike: number; call: MarketOptionLeg | null; put: MarketOptionLeg | null }>;
  timestamp?: string;
}): MarketOptionChain {
  const timestamp = input.timestamp ?? new Date().toISOString();
  const chain: MarketOptionChainStrike[] = input.rows
    .filter((row) => Number.isFinite(row.strike))
    .sort((left, right) => left.strike - right.strike)
    .map((row) => ({
      underlying: input.underlying,
      expiry: input.expiry,
      strike: row.strike,
      call: row.call,
      put: row.put,
      timestamp,
      strikePrice: row.strike,
      ce: legacyLeg(row.call),
      pe: legacyLeg(row.put),
    }));
  const totalCallOi = chain.reduce((total, row) => total + (row.call?.oi ?? 0), 0);
  const totalPutOi = chain.reduce((total, row) => total + (row.put?.oi ?? 0), 0);
  const greeksAvailable = chain.some((row) => row.call?.greeks !== null && row.call?.greeks !== undefined || row.put?.greeks !== null && row.put?.greeks !== undefined);
  const depthAvailable = chain.some((row) => (row.call?.bid ?? 0) > 0 || (row.call?.ask ?? 0) > 0 || (row.put?.bid ?? 0) > 0 || (row.put?.ask ?? 0) > 0);
  return {
    provider: input.provider,
    underlying: input.underlying,
    expiry: input.expiry,
    expiries: input.expiries,
    spot_price: input.spotPrice,
    spotPrice: input.spotPrice,
    chain,
    total_call_oi: totalCallOi,
    total_put_oi: totalPutOi,
    totalCEOI: totalCallOi,
    totalPEOI: totalPutOi,
    greeks_available: greeksAvailable,
    greeksAvailable,
    depth_available: depthAvailable,
    timestamp,
    source: "broker",
  };
}
