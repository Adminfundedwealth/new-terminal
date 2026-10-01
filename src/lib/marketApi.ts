import type { OptionData, ExpiryDate, IndexData } from "./mockData";
import { ZerodhaAdapter } from "./zerodhaAdapter";
import { InstrumentMaster, normalizeInstrumentMaster } from "./instrumentMaster";
import { normalizeQuote, toLegacyQuote } from "./quoteService";
import { classifyInstrument, isProductionInstrument } from "./instrumentClassification";
import type { NormalizedQuote } from "./brokerAdapter";
import type { TerminalMarketDataInstrument, TerminalMarketDataQuote } from "./terminalApi";

// Local proxy base URL — override via VITE_PROXY_URL if deploying proxy elsewhere
const PROXY_BASE = import.meta.env.VITE_PROXY_URL || "";

export interface IndianNewsArticle {
  headline: string;
  summary: string;
  source: string;
  publishedAt: string | null;
  url: string;
  image: string | null;
  related: string | null;
  category: string;
}

// The proxy owns broker credentials; browser requests never carry them.
async function fetchDhanProxy(endpoint: string, params?: Record<string, string>): Promise<any> {
  const qp = new URLSearchParams({ endpoint, ...params });
  const url = `${PROXY_BASE}/api/dhan-proxy?${qp.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Dhan proxy error ${res.status}: ${errText}`);
  }
  return res.json();
}

// NSE proxy for indices & market status
async function fetchNSEProxy(endpoint: string, symbol?: string): Promise<any> {
  const params = new URLSearchParams({ endpoint });
  if (symbol) params.set("symbol", symbol);
  const url = `${PROXY_BASE}/api/nse-proxy?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`NSE proxy error ${res.status}: ${errText}`);
  }
  return res.json();
}

export async function fetchIndianMarketNews(): Promise<{ provider: string; articles: IndianNewsArticle[]; fetchedAt: string }> {
  const res = await fetch(`${PROXY_BASE}/api/indian-news`);
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Indian news proxy error ${res.status}: ${errText}`);
  }
  return res.json();
}

export function normalizeInstrumentMasterResponse(raw: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== "object") return [];

  const response = raw as { instruments?: unknown; data?: { instruments?: unknown } };
  if (Array.isArray(response.instruments)) return response.instruments;
  if (response.data && Array.isArray(response.data.instruments)) return response.data.instruments;
  return [];
}

// ── Parse Dhan Option Chain Response ──

interface DhanOptionChainData {
  data: {
    oc: Record<string, {
      ce?: DhanOptionLeg;
      pe?: DhanOptionLeg;
    }>;
    iv_oc?: Record<string, {
      ce_iv?: number;
      pe_iv?: number;
    }>;
    gk_oc?: Record<string, {
      ce_delta?: number; ce_gamma?: number; ce_theta?: number; ce_vega?: number;
      pe_delta?: number; pe_gamma?: number; pe_theta?: number; pe_vega?: number;
    }>;
    last_price?: number;
    oi_data?: Record<string, {
      ce_oi?: number; pe_oi?: number;
      ce_oi_chg?: number; pe_oi_chg?: number;
    }>;
  };
  status: string;
}

interface DhanOptionLeg {
  ltp?: number;
  last_price?: number;
  close?: number;
  volume?: number;
  oi?: number;
  oi_chg?: number;
  previous_oi?: number;
  iv?: number;
  implied_volatility?: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  bid_price?: number;
  ask_price?: number;
  best_bid_price?: number;
  best_ask_price?: number;
  top_bid_price?: number;
  top_ask_price?: number;
  greeks?: {
    delta?: number;
    gamma?: number;
    theta?: number;
    vega?: number;
  };
}

export function parseDhanOptionChain(raw: DhanOptionChainData): {
  chain: OptionData[];
  spotPrice: number;
  totalCEOI: number;
  totalPEOI: number;
} {
  const oc = raw?.data?.oc || {};
  const spotPrice = raw?.data?.last_price || 0;

  let totalCEOI = 0;
  let totalPEOI = 0;

  const chain: OptionData[] = Object.keys(oc)
    .map(strikeStr => {
      const strike = parseFloat(strikeStr);
      const legData = oc[strikeStr];

      const ceOI = legData.ce?.oi || 0;
      const peOI = legData.pe?.oi || 0;
      totalCEOI += ceOI;
      totalPEOI += peOI;

      // Support both Dhan API v1 (flat fields) and v2 (nested greeks object)
      const ceGreeks = legData.ce?.greeks || {};
      const peGreeks = legData.pe?.greeks || {};

      return {
        strikePrice: strike,
        ce: {
          ltp: legData.ce?.last_price || legData.ce?.ltp || 0,
          oi: ceOI,
          oiChange: legData.ce?.oi_chg || (ceOI - (legData.ce?.previous_oi || ceOI)),
          volume: legData.ce?.volume || 0,
          iv: legData.ce?.implied_volatility || legData.ce?.iv || 0,
          delta: ceGreeks.delta || legData.ce?.delta || 0,
          gamma: ceGreeks.gamma || legData.ce?.gamma || 0,
          theta: ceGreeks.theta || legData.ce?.theta || 0,
          vega: ceGreeks.vega || legData.ce?.vega || 0,
          bidPrice: legData.ce?.top_bid_price || legData.ce?.best_bid_price || legData.ce?.bid_price || 0,
          askPrice: legData.ce?.top_ask_price || legData.ce?.best_ask_price || legData.ce?.ask_price || 0,
        },
        pe: {
          ltp: legData.pe?.last_price || legData.pe?.ltp || 0,
          oi: peOI,
          oiChange: legData.pe?.oi_chg || (peOI - (legData.pe?.previous_oi || peOI)),
          volume: legData.pe?.volume || 0,
          iv: legData.pe?.implied_volatility || legData.pe?.iv || 0,
          delta: peGreeks.delta || legData.pe?.delta || 0,
          gamma: peGreeks.gamma || legData.pe?.gamma || 0,
          theta: peGreeks.theta || legData.pe?.theta || 0,
          vega: peGreeks.vega || legData.pe?.vega || 0,
          bidPrice: legData.pe?.top_bid_price || legData.pe?.best_bid_price || legData.pe?.bid_price || 0,
          askPrice: legData.pe?.top_ask_price || legData.pe?.best_ask_price || legData.pe?.ask_price || 0,
        },
      };
    })
    .sort((a, b) => a.strikePrice - b.strikePrice);

  return { chain, spotPrice, totalCEOI, totalPEOI };
}

// ── Parse NSE Indices Response (kept for Dashboard) ──

export function parseNSEIndices(raw: any): IndexData[] {
  const indices = ["NIFTY 50", "NIFTY BANK", "NIFTY FINANCIAL SERVICES", "NIFTY MIDCAP 50"];
  const symbolMap: Record<string, string> = {
    "NIFTY 50": "NIFTY",
    "NIFTY BANK": "BANKNIFTY",
    "NIFTY FINANCIAL SERVICES": "FINNIFTY",
    "NIFTY MIDCAP 50": "MIDCPNIFTY",
  };

  if (!raw?.data) return [];

  return raw.data
    .filter((d: any) => indices.includes(d.index))
    .map((d: any) => ({
      name: d.index,
      symbol: symbolMap[d.index] || d.index,
      ltp: d.last,
      change: d.variation || 0,
      changePercent: d.percentChange || 0,
      high: d.high || d.last,
      low: d.low || d.last,
      open: d.open || d.last,
      prevClose: d.previousClose || d.last,
    }));
}

// NSE parse for backward compat
interface NSEOptionChainResponse {
  records: {
    expiryDates: string[];
    strikePrices: number[];
    data: Array<{
      strikePrice: number;
      expiryDate: string;
      CE?: any;
      PE?: any;
    }>;
  };
  filtered: {
    CE: { totOI: number; totVol: number };
    PE: { totOI: number; totVol: number };
  };
}

export function parseNSEOptionChain(raw: NSEOptionChainResponse, selectedExpiry?: string) {
  // Guard against malformed/empty response
  if (!raw?.records?.expiryDates || !raw?.records?.data) {
    return { chain: [], spotPrice: 0, expiries: [], totalCEOI: 0, totalPEOI: 0 };
  }

  const expiries: ExpiryDate[] = raw.records.expiryDates.map((exp) => {
    const d = new Date(exp);
    const now = new Date();
    const days = Math.max(0, Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
    return { label: exp, value: exp, daysToExpiry: days };
  });

  const expiryFilter = selectedExpiry || raw.records.expiryDates[0];
  const filteredData = raw.records.data.filter((d) => d.expiryDate === expiryFilter);

  let spotPrice = 0;
  const chain: OptionData[] = filteredData.map((item) => {
    if (item.CE?.underlyingValue) spotPrice = item.CE.underlyingValue;
    if (item.PE?.underlyingValue) spotPrice = item.PE.underlyingValue;
    const defaultLeg = { ltp: 0, oi: 0, oiChange: 0, volume: 0, iv: 0, delta: 0, gamma: 0, theta: 0, vega: 0, bidPrice: 0, askPrice: 0 };
    return {
      strikePrice: item.strikePrice,
      ce: item.CE ? {
        ltp: item.CE.lastPrice, oi: item.CE.openInterest, oiChange: item.CE.changeinOpenInterest,
        volume: item.CE.totalTradedVolume, iv: item.CE.impliedVolatility,
        delta: 0, gamma: 0, theta: 0, vega: 0,
        bidPrice: item.CE.bidprice, askPrice: item.CE.askPrice,
      } : defaultLeg,
      pe: item.PE ? {
        ltp: item.PE.lastPrice, oi: item.PE.openInterest, oiChange: item.PE.changeinOpenInterest,
        volume: item.PE.totalTradedVolume, iv: item.PE.impliedVolatility,
        delta: 0, gamma: 0, theta: 0, vega: 0,
        bidPrice: item.PE.bidprice, askPrice: item.PE.askPrice,
      } : defaultLeg,
    };
  });

  return { chain, spotPrice, expiries, totalCEOI: raw.filtered?.CE?.totOI || 0, totalPEOI: raw.filtered?.PE?.totOI || 0 };
}

// ── Exported fetch functions ──

// Live option-chain data is Kite-only; unavailable Kite sessions must not be masked by another provider.
export async function fetchLiveOptionChain(symbol: string, expiry?: string) {
  const kiteStatus = await fetch(`${PROXY_BASE}/api/kite/status`, { credentials: "include" });
  if (!kiteStatus.ok || !(await kiteStatus.json()).authenticated) {
    throw new Error("Kite OAuth authentication is required for live option-chain data.");
  }

  const { ZerodhaAdapter } = await import("./zerodhaAdapter");
  const result = await new ZerodhaAdapter().getOptionChain(symbol, expiry);
  if (!result.data) throw new Error(result.message || "Kite option-chain data is unavailable.");
  return {
    chain: result.data.chain,
    spotPrice: result.data.spotPrice,
    expiries: result.data.expiries.map((value) => ({ label: value, value, daysToExpiry: 0 })),
    totalCEOI: result.data.totalCEOI || 0,
    totalPEOI: result.data.totalPEOI || 0,
    source: "zerodha" as const,
    afterHours: result.data.afterHours || false,
    cachedAt: result.data.cachedAt || null,
    greeksAvailable: result.data.greeksAvailable,
    oiChangeAvailable: result.data.oiChangeAvailable,
  };
}

export async function fetchDhanQuote(symbol: string) {
  const raw = await fetchDhanProxy("ltp", { symbol: symbol.toUpperCase() });
  const security = raw?.data?.IDX_I?.[0] || raw?.data?.NSE_EQ?.[0] || raw?.data?.[symbol.toUpperCase()]?.[0];
  if (!security?.last_price && !security?.ltp) throw new Error(`Dhan quote unavailable for ${symbol}`);
  const ltp = Number(security.last_price ?? security.ltp);
  const previousClose = Number(security.previous_close ?? security.close ?? ltp);
  return {
    symbol: symbol.toUpperCase(),
    ltp,
    change: ltp - previousClose,
    changePercent: previousClose ? ((ltp - previousClose) / previousClose) * 100 : 0,
    timestamp: new Date().toISOString(),
  };
}

export function normalizeDhanQuotePayload(raw: unknown, symbol: string, master: import("./instrumentMaster").InstrumentMaster, now = Date.now()) {
  const instrument = master.getByExchangeSymbol("NSE", symbol) || master.getByExchangeSymbol("NSE", `${symbol} 50`);
  const result = normalizeQuote({ provider: "dhan", payload: raw, providerInstrumentId: instrument?.providerInstrumentId, exchange: instrument?.exchange, symbol: instrument?.tradingSymbol, now }, master);
  return { ...result, quote: result.quote ? toLegacyQuote(result.quote) : undefined };
}

export function normalizeTerminalMarketQuote(
  quote: TerminalMarketDataQuote,
  instrument: TerminalMarketDataInstrument,
  canonicalInstrumentId?: string,
  now = Date.now(),
): NormalizedQuote {
  const timestamp = Number.isFinite(Date.parse(quote.timestamp))
    ? new Date(quote.timestamp).toISOString()
    : new Date(now).toISOString();
  const change = quote.change ?? (quote.previousClose === null ? 0 : quote.ltp - quote.previousClose);
  const changePercent = quote.changePercent ?? (quote.previousClose ? (change / quote.previousClose) * 100 : 0);
  return {
    instrumentId: canonicalInstrumentId,
    providerInstrumentId: instrument.providerInstrumentId,
    exchange: quote.exchange,
    symbol: quote.tradingSymbol || quote.symbol,
    provider: quote.provider === "kite" ? "zerodha" : "dhan",
    ltp: quote.ltp,
    lastTradedPrice: quote.ltp,
    previousClose: quote.previousClose ?? undefined,
    open: quote.open ?? undefined,
    high: quote.high ?? undefined,
    low: quote.low ?? undefined,
    volume: quote.volume ?? undefined,
    openInterest: quote.openInterest ?? undefined,
    change,
    changePercent,
    timestamp,
  };
}

// Dhan expiry list
export async function fetchExpiryList(symbol: string): Promise<ExpiryDate[]> {
  try {
    const raw = await fetchDhanProxy("expiry-list", { symbol: symbol.toUpperCase() });
    if (raw?.data) {
      return raw.data.map((dateStr: string) => {
        const d = new Date(dateStr);
        const days = Math.max(0, Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
        return {
          label: d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
          value: dateStr,
          daysToExpiry: days,
        };
      });
    }
  } catch (e) {
    console.warn("Dhan expiry list fetch failed:", e);
  }
  return [];
}

// NSE Indices (Dhan doesn't provide broad index overview the same way)
export async function fetchLiveIndices() {
  const raw = await fetchNSEProxy("indices");
  return parseNSEIndices(raw);
}

export async function fetchMarketStatus() {
  return fetchNSEProxy("market-status");
}

export async function fetchFnOStocks() {
  return fetchNSEProxy("equity-derivatives");
}

// ── All Indices (for VIX, sector performance) ──

const SECTOR_INDEX_MAP: Record<string, string> = {
  "NIFTY IT": "IT",
  "NIFTY BANK": "Banking",
  "NIFTY AUTO": "Auto",
  "NIFTY PHARMA": "Pharma",
  "NIFTY METAL": "Metal",
  "NIFTY ENERGY": "Energy",
  "NIFTY FMCG": "FMCG",
  "NIFTY REALTY": "Realty",
  "NIFTY MEDIA": "Media",
  "NIFTY PSU BANK": "PSU Bank",
  "NIFTY FIN SERVICE": "Fin Svc",
  "NIFTY INFRA": "Infra",
  "NIFTY HEALTHCARE INDEX": "Health",
  "NIFTY CONSUMER DURABLES": "Consumer",
};

export async function fetchAllIndices() {
  const raw = await fetchNSEProxy("indices");
  if (!raw?.data) return null;

  // Extract VIX
  const vixEntry = raw.data.find((d: any) => d.index === "INDIA VIX");
  const vix = vixEntry ? {
    value: vixEntry.last,
    change: vixEntry.variation || 0,
    changePercent: vixEntry.percentChange || 0,
    high: vixEntry.high || vixEntry.last,
    low: vixEntry.low || vixEntry.last,
  } : null;

  // Extract sector indices
  const sectors = raw.data
    .filter((d: any) => SECTOR_INDEX_MAP[d.index])
    .map((d: any) => ({
      name: SECTOR_INDEX_MAP[d.index],
      fullName: d.index,
      change: d.percentChange || 0,
      ltp: d.last || 0,
      open: d.open || d.last,
      high: d.high || d.last,
      low: d.low || d.last,
    }));

  // Advance/Decline from NIFTY 50
  const nifty50 = raw.data.find((d: any) => d.index === "NIFTY 50");
  const advances = nifty50?.advances || 0;
  const declines = nifty50?.declines || 0;
  const unchanged = nifty50?.unchanged || 0;

  return { vix, sectors, advances, declines, unchanged };
}

// ── F&O Stocks List (Top Movers + Most Active) ──

export interface FnOStockData {
  symbol: string;
  ltp: number;
  change: number;
  changePercent: number;
  open: number;
  high: number;
  low: number;
  previousClose: number;
  volume: number;
  // OI fields from NSE equity-derivatives endpoint
  totalTradedVolume?: number;
  openInterest?: number;
  oiChange?: number;
  sector?: string;
}

export function normalizeKiteFnOStockQuotes(
  instruments: import("./localDatabase").Instrument[],
  quotes: NormalizedQuote[],
): FnOStockData[] {
  const quotesByToken = new Map(quotes.map((quote) => [quote.providerInstrumentId ?? quote.instrumentId ?? "", quote]));
  const futuresSymbols = new Set(instruments
    .filter((instrument) => isProductionInstrument(instrument) && classifyInstrument(instrument) === "futures")
    .map((instrument) => instrument.symbol.toUpperCase()));

  return instruments.flatMap((instrument) => {
    if (classifyInstrument(instrument) !== "stocks" || ![instrument.symbol, instrument.tradingSymbol].some((symbol) => futuresSymbols.has(symbol.toUpperCase()))) return [];
    const quote = quotesByToken.get(instrument.providerInstrumentId) ?? quotesByToken.get(instrument.securityId);
    if (!quote || quote.ltp <= 0) return [];
    return [{
      symbol: instrument.tradingSymbol,
      ltp: quote.ltp,
      change: quote.change,
      changePercent: quote.changePercent,
      open: quote.open ?? quote.ltp,
      high: quote.high ?? quote.ltp,
      low: quote.low ?? quote.ltp,
      previousClose: quote.previousClose ?? quote.ltp - quote.change,
      volume: quote.volume ?? 0,
      totalTradedVolume: quote.volume ?? 0,
      openInterest: 0,
      oiChange: 0,
      sector: "",
    }];
  });
}

let quoteInstrumentMasterPromise: Promise<InstrumentMaster | undefined> | undefined;

async function getQuoteInstrumentMaster(): Promise<InstrumentMaster | undefined> {
  if (!quoteInstrumentMasterPromise) {
    quoteInstrumentMasterPromise = fetchInstrumentMaster()
      .then(({ instruments }) => {
        const master = new InstrumentMaster();
        master.addAll(instruments);
        return master;
      })
      .catch((error) => {
        quoteInstrumentMasterPromise = undefined;
        console.warn("Canonical quote instrument master unavailable:", error);
        return undefined;
      });
  }
  return quoteInstrumentMasterPromise;
}

async function canonicalizeFnOStocks(stocks: FnOStockData[], provider: string): Promise<FnOStockData[]> {
  const master = await Promise.race([
    getQuoteInstrumentMaster(),
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 3000)),
  ]);
  if (!master) return stocks;

  return stocks.flatMap((stock) => {
    const instrument = master.getByExchangeSymbol("NSE", stock.symbol)
      ?? master.values().find((candidate) => candidate.exchange === "NSE" && candidate.symbol.toUpperCase() === stock.symbol.toUpperCase());
    if (!instrument) return [];
    const result = normalizeQuote({
      provider,
      payload: {
        ltp: stock.ltp,
        previousClose: stock.previousClose,
        open: stock.open,
        high: stock.high,
        low: stock.low,
        volume: stock.volume,
        timestamp: new Date().toISOString(),
      },
      instrumentId: instrument.securityId,
      providerInstrumentId: instrument.providerInstrumentId,
      exchange: instrument.exchange,
      symbol: instrument.symbol,
    }, master);
    const quote = result.quote ? toLegacyQuote(result.quote) : undefined;
    if (!quote) return [];
    return [{
      ...stock,
      symbol: stock.symbol,
      ltp: quote.ltp,
      change: quote.change,
      changePercent: quote.changePercent,
      open: quote.open ?? stock.open,
      high: quote.high ?? stock.high,
      low: quote.low ?? stock.low,
      previousClose: quote.previousClose ?? stock.previousClose,
      volume: quote.volume ?? stock.volume,
    }];
  });
}

export async function fetchLiveFnOStocks(): Promise<FnOStockData[]> {
  try {
    const kiteStatus = await fetch(`${PROXY_BASE}/api/kite/status`, { credentials: "include" });
    if (kiteStatus.ok && (await kiteStatus.json()).authenticated) {
      const adapter = new ZerodhaAdapter();
      const instrumentResult = await adapter.getInstruments();
      if (!instrumentResult.data) throw new Error(instrumentResult.message || "Kite instrument master unavailable.");

      const futuresSymbols = new Set(instrumentResult.data
        .filter((instrument) => isProductionInstrument(instrument) && classifyInstrument(instrument) === "futures")
        .map((instrument) => instrument.symbol.toUpperCase()));
      const eligibleEquities = instrumentResult.data.filter((instrument) =>
        classifyInstrument(instrument) === "stocks" && [instrument.symbol, instrument.tradingSymbol].some((symbol) => futuresSymbols.has(symbol.toUpperCase()))
      );
      const quoteResult = await adapter.getQuotes(eligibleEquities.map((instrument) => instrument.tradingSymbol));
      const kiteStocks = normalizeKiteFnOStockQuotes(instrumentResult.data, quoteResult.data ?? []);
      if (kiteStocks.length > 0) return kiteStocks;
      throw new Error("Kite returned no quotes for F&O equity instruments.");
    }
  } catch (error) {
    console.warn("Kite F&O equity quotes unavailable, trying public sources:", error);
  }

  // Try NSE first (has OI data)
  try {
    const raw = await fetchNSEProxy("equity-derivatives");
    if (raw?.data?.length > 0) {
      const stocks = raw.data
        .filter((d: any) => d.symbol && d.symbol !== "NIFTY 50" && d.lastPrice)
        .map((d: any) => ({
          symbol: d.symbol,
          ltp: d.lastPrice || 0,
          change: d.change || 0,
          changePercent: d.pChange || 0,
          open: d.open || d.lastPrice,
          high: d.dayHigh || d.lastPrice,
          low: d.dayLow || d.lastPrice,
          previousClose: d.previousClose || d.lastPrice,
          volume: d.totalTradedVolume || 0,
          totalTradedVolume: d.totalTradedVolume || 0,
          openInterest: d.openInterest || 0,
          oiChange: d.changeinOpenInterest || 0,
          sector: d.meta?.industry || "",
        }));
      return canonicalizeFnOStocks(stocks, "nse");
    }
  } catch (e) {
    console.warn("NSE F&O stocks fetch failed, trying TradingView:", e);
  }

  // Fallback to TradingView Scanner (no OI but great LTP/volume data)
  try {
    const tvData = await fetchTradingViewStocks();
    if (tvData.length > 0) return canonicalizeFnOStocks(tvData, "tradingview");
  } catch (e) {
    console.warn("TradingView stocks fetch also failed:", e);
  }

  return [];
}

// ── TradingView Scanner API ──

export async function fetchTradingViewStocks(): Promise<FnOStockData[]> {
  const url = `${PROXY_BASE}/api/tv-scan?type=stocks`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TV scan error: ${res.status}`);
  const data = await res.json();
  
  return (data.stocks || []).map((s: any) => ({
    symbol: s.symbol || "",
    ltp: s.ltp || 0,
    change: s.changeAbs || 0,
    changePercent: s.changePercent || 0,
    open: s.open || 0,
    high: s.high || 0,
    low: s.low || 0,
    previousClose: (s.ltp || 0) - (s.changeAbs || 0),
    volume: s.volume || 0,
    totalTradedVolume: s.volume || 0,
    openInterest: 0,
    oiChange: 0,
    sector: s.sector || "",
  }));
}

export async function fetchTradingViewIndices(): Promise<any[]> {
  const url = `${PROXY_BASE}/api/tv-scan?type=indices`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TV indices error: ${res.status}`);
  const data = await res.json();
  return data.stocks || [];
}

// ── FII/DII Activity Data ──

export interface FIIDIIData {
  category: string; // "FII/FPI" or "DII"
  date: string;
  buyValue: number;
  sellValue: number;
  netValue: number;
}

export async function fetchFIIDII(): Promise<FIIDIIData[]> {
  const raw = await fetchNSEProxy("fii-dii");
  if (!raw?.data) return [];
  
  return raw.data.map((d: any) => ({
    category: d.category || "",
    date: d.date || "",
    buyValue: parseFloat(d.buyValue?.replace(/,/g, "")) || 0,
    sellValue: parseFloat(d.sellValue?.replace(/,/g, "")) || 0,
    netValue: parseFloat(d.netValue?.replace(/,/g, "")) || 0,
  }));
}

// ── Test Connection ──

export async function testDhanConnection(): Promise<{ status: string; message: string }> {
  const res = await fetch(`${PROXY_BASE}/api/test-connection`);
  return res.json();
}

export async function fetchProxyHealth(): Promise<any> {
  const res = await fetch(`${PROXY_BASE}/health`);
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
  return res.json();
}

// ── Instrument Master Download ──

export async function fetchInstrumentMaster(): Promise<{
  instruments: import("./localDatabase").Instrument[];
  count: number;
}> {
  let kiteAuthenticated = false;
  try {
    const kiteStatus = await fetch(`${PROXY_BASE}/api/kite/status`, { credentials: "include" });
    kiteAuthenticated = kiteStatus.ok && (await kiteStatus.json()).authenticated;
    if (kiteAuthenticated) {
      const result = await new ZerodhaAdapter().getInstruments();
      if (result.data?.length) return { instruments: result.data, count: result.data.length };
      throw new Error(result.message || "Kite instrument master is empty.");
    }
  } catch (error) {
    console.warn("Kite instrument master unavailable, trying Dhan:", error);
  }

  try {
    const result = await fetchDhanProxy("instruments");
    if (Array.isArray(result?.instruments) && result.instruments.length > 0) {
      const report = normalizeInstrumentMaster(result.instruments, "dhan");
      if (report.instruments.length > 0) return { instruments: report.instruments, count: report.instruments.length };
      throw new Error(`Dhan instrument master contained no valid instruments (${report.issues.length} rejected).`);
    }
  } catch (error) {
    console.warn("Dhan instrument master unavailable:", error);
  }

  if (!kiteAuthenticated) {
    const kiteStatus = await fetch(`${PROXY_BASE}/api/kite/status`, { credentials: "include" });
    if (kiteStatus.ok && (await kiteStatus.json()).authenticated) {
      const result = await new ZerodhaAdapter().getInstruments();
      if (result.data?.length) return { instruments: result.data, count: result.data.length };
      throw new Error(result.message || "Kite instrument master is empty.");
    }
  }

  throw new Error("No provider instrument master is available.");
}

// ── Historical Candle Data ──

export interface HistoricalCandleResponse {
  status: string;
  data: {
    timestamp: number[];
    open: number[];
    high: number[];
    low: number[];
    close: number[];
    volume: number[];
    oi?: number[];
  };
  remarks?: string;
}

export async function fetchHistoricalCandles(
  securityId: string,
  exchangeSegment: string = "IDX_I",
  instrument: string = "INDEX",
  interval: string = "5",
  fromDate?: string,
  toDate?: string,
): Promise<HistoricalCandleResponse> {
  const params: Record<string, string> = {
    securityId,
    exchangeSegment,
    instrument,
    interval,
  };
  if (fromDate) params.fromDate = fromDate;
  if (toDate) params.toDate = toDate;

  return fetchDhanProxy("historical", params);
}

// ── Yahoo Finance Chart Data (free, no auth) ──

export async function fetchYahooChart(
  symbol: string,
  interval: string = "D",
  fromDate?: string,
  toDate?: string,
): Promise<HistoricalCandleResponse> {
  const params = new URLSearchParams({ symbol, interval });
  if (fromDate) params.set("fromDate", fromDate);
  if (toDate) params.set("toDate", toDate);

  const url = `${PROXY_BASE}/api/yahoo-chart?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Yahoo chart error ${res.status}: ${errText}`);
  }
  return res.json();
}
