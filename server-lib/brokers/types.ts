export type MarketDataProviderId = "dhan" | "kite";

export interface MarketInstrument {
  provider: MarketDataProviderId;
  providerInstrumentId: string;
  symbol: string;
  tradingSymbol: string;
  exchange: string;
  exchangeSegment: string;
  instrumentType: string;
  lotSize?: number;
  tickSize?: number;
  expiryDate?: string;
  strikePrice?: number;
  optionType?: string;
}

export interface MarketQuote {
  provider: MarketDataProviderId;
  symbol: string;
  tradingSymbol: string;
  exchange: string;
  ltp: number;
  bid?: number | null;
  ask?: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  openInterest: number | null;
  timestamp: string;
}

export interface MarketCandle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  openInterest?: number;
}

export interface MarketOptionGreeks {
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
}

export interface MarketOptionLeg {
  ltp: number | null;
  bid: number | null;
  ask: number | null;
  volume: number | null;
  oi: number | null;
  change: number | null;
  change_percent: number | null;
  iv: number | null;
  oi_change: number | null;
  greeks: MarketOptionGreeks | null;
}

export interface MarketOptionChainStrike {
  underlying: string;
  expiry: string;
  strike: number;
  call: MarketOptionLeg | null;
  put: MarketOptionLeg | null;
  timestamp: string;
  strikePrice: number;
  ce: {
    ltp: number;
    oi: number;
    oiChange: number;
    volume: number;
    iv: number;
    delta: number;
    gamma: number;
    theta: number;
    vega: number;
    bidPrice: number;
    askPrice: number;
  };
  pe: MarketOptionChainStrike["ce"];
}

export interface MarketOptionChain {
  provider: MarketDataProviderId;
  underlying: string;
  expiry: string;
  expiries: string[];
  spot_price: number;
  spotPrice: number;
  chain: MarketOptionChainStrike[];
  total_call_oi: number;
  total_put_oi: number;
  totalCEOI: number;
  totalPEOI: number;
  greeks_available: boolean;
  greeksAvailable: boolean;
  depth_available: boolean;
  timestamp: string;
  source: "broker";
}

export interface MarketDataProvider {
  authenticate(): Promise<{ authenticated: true }>;
  searchInstruments(query: string): Promise<MarketInstrument[]>;
  getQuote(instrument: MarketInstrument): Promise<MarketQuote>;
  getHistoricalCandles(
    instrument: MarketInstrument,
    interval: string,
    fromDate: string,
    toDate: string
  ): Promise<MarketCandle[]>;
  getOptionChain(underlying: string, expiry?: string): Promise<MarketOptionChain>;
}

export type BrokerCredentialMap = Readonly<Record<string, string>>;
export type Fetcher = (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>;
