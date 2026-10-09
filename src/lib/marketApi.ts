import type { OptionData, ExpiryDate, IndexData } from "./mockData";
import { classifyInstrument, isCashEquityListing, isCashEquitySymbol } from "./instrumentClassification";
import { normalizeProviderInstrument } from "./instrumentMaster";

// Local proxy base URL — override via VITE_PROXY_URL if deploying proxy elsewhere
const PROXY_BASE = import.meta.env.VITE_PROXY_URL || "http://localhost:4002";

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

// Broker credentials are server-side only; customer requests must never forward them.
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

export async function fetchDhanQuote(symbol: string): Promise<{
  symbol: string;
  ltp: number;
  change: number;
  changePercent: number;
  timestamp: string;
}> {
  const raw = await fetchDhanProxy("ltp", { symbol: symbol.toUpperCase() });
  const security = raw?.data?.IDX_I?.[0] || raw?.data?.NSE_EQ?.[0] || raw?.data?.[symbol.toUpperCase()]?.[0];
  
  if (!security?.last_price && !security?.ltp) {
    throw new Error(`Dhan quote unavailable for ${symbol}`);
  }
  
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

// ── Exported fetch functions ──

interface OptionUnderlying {
  securityId: string;
  exchangeSegment: string;
}

function getOptionUnderlyingParams(underlying?: OptionUnderlying): Record<string, string> {
  if (!underlying) return {};
  if (!/^\d+$/.test(underlying.securityId) || !underlying.exchangeSegment) {
    throw new Error("Option-chain requests require a numeric security ID and exchange segment");
  }
  return {
    underlyingScrip: underlying.securityId,
    underlyingSeg: underlying.exchangeSegment,
  };
}

// Dhan Option Chain (primary) with NSE fallback
export async function fetchLiveOptionChain(symbol: string, expiry?: string, underlying?: OptionUnderlying) {
  // Try Dhan first
  try {
    const underlyingParams = getOptionUnderlyingParams(underlying);
    const params: Record<string, string> = { symbol: symbol.toUpperCase(), ...underlyingParams };
    if (expiry) params.expiry = expiry;
    const raw = await fetchDhanProxy("option-chain", params);
    if (raw?.status === "success" && raw?.data?.oc) {
      const parsed = parseDhanOptionChain(raw);
      // Also fetch expiry list
      let expiries: ExpiryDate[] = [];
      try {
        const expiryRaw = await fetchDhanProxy("expiry-list", { symbol: symbol.toUpperCase(), ...underlyingParams });
        if (expiryRaw?.data) {
          expiries = expiryRaw.data.map((dateStr: string) => {
            const d = new Date(dateStr);
            const days = Math.max(0, Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
            return {
              label: d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
              value: dateStr,
              daysToExpiry: days,
            };
          });
        }
      } catch {
        // Expiry fetch failed, continue with chain data
      }
      return {
        ...parsed, expiries, source: "dhan" as const,
        afterHours: raw.afterHours || false,
        cachedAt: raw.cachedAt || null,
      };
    }
  } catch (e) {
    console.warn("Dhan option chain fetch failed, trying NSE:", e);
  }

  // Fallback to NSE
  try {
    const raw = await fetchNSEProxy("option-chain", symbol);
    const parsed = parseNSEOptionChain(raw, expiry);
    return { ...parsed, source: "nse" as const, afterHours: false, cachedAt: null };
  } catch (e) {
    console.warn("NSE option chain also failed:", e);
    throw e;
  }
}

// Dhan expiry list
export async function fetchExpiryList(symbol: string, underlying?: OptionUnderlying): Promise<ExpiryDate[]> {
  try {
    const raw = await fetchDhanProxy("expiry-list", {
      symbol: symbol.toUpperCase(),
      ...getOptionUnderlyingParams(underlying),
    });
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

export interface CashMarketQuote {
  ltp: number;
  open: number | null;
  high: number | null;
  low: number | null;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  openInterest: number | null;
  timestamp: string | null;
}

export function normalizeDhanQuoteTimestamp(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value > 1_000_000_000_000 ? value : value * 1000;
    const parsed = new Date(milliseconds);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
  }
  if (typeof value !== "string" || !value.trim()) return null;

  const text = value.trim();
  const localTime = text.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (localTime) {
    const [, dayText, monthText, yearText, hourText, minuteText, secondText] = localTime;
    const day = Number(dayText);
    const month = Number(monthText);
    const year = Number(yearText);
    const hour = Number(hourText);
    const minute = Number(minuteText);
    const second = Number(secondText);
    const istWallTime = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    if (
      istWallTime.getUTCFullYear() !== year ||
      istWallTime.getUTCMonth() !== month - 1 ||
      istWallTime.getUTCDate() !== day ||
      hour > 23 ||
      minute > 59 ||
      second > 59
    ) return null;
    return new Date(istWallTime.getTime() - 5.5 * 60 * 60 * 1000).toISOString();
  }

  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export async function fetchCashQuotes(exchangeSegment: string, securityIds: string[]): Promise<Record<string, CashMarketQuote>> {
  const allowedSegments = new Set(["NSE_EQ", "NSE_FNO", "BSE_EQ", "IDX_I", "BSE_IDX"]);
  const uniqueIds = [...new Set(securityIds.map((id) => id.trim()))];
  if (!allowedSegments.has(exchangeSegment)) throw new Error(`Unsupported market quote segment: ${exchangeSegment}`);
  if (uniqueIds.length === 0) return {};
  if (uniqueIds.length > 1000 || uniqueIds.some((id) => !/^\d+$/.test(id))) {
    throw new Error("Market quote requests require up to 1,000 numeric security IDs");
  }

  const response = await fetchDhanProxy("cash-quotes", {
    exchangeSegment,
    securityIds: uniqueIds.join(","),
  });
  const quotes = response?.data?.[exchangeSegment] || {};
  return Object.fromEntries(
    Object.entries(quotes).flatMap(([securityId, rawQuote]) => {
      const quote = rawQuote as {
        last_price?: number;
        ltp?: number;
        open?: number;
        high?: number;
        low?: number;
        close?: number;
        previous_close?: number;
        net_change?: number;
        volume?: number;
        oi?: number;
        last_trade_time?: string | number;
        timestamp?: string | number;
        ohlc?: { open?: number; high?: number; low?: number; close?: number };
      };
      const ltp = Number(quote.last_price ?? quote.ltp);
      if (!Number.isFinite(ltp) || ltp <= 0) return [];
      const readValue = (value: number | undefined) => value == null || !Number.isFinite(Number(value)) ? null : Number(value);
      const previousClose = readValue(quote.ohlc?.close ?? quote.previous_close ?? quote.close);
      const change = readValue(quote.net_change) ?? (previousClose == null ? null : ltp - previousClose);
      return [[securityId, {
        ltp,
        open: readValue(quote.ohlc?.open ?? quote.open),
        high: readValue(quote.ohlc?.high ?? quote.high),
        low: readValue(quote.ohlc?.low ?? quote.low),
        previousClose,
        change,
        changePercent: previousClose && change != null ? (change / previousClose) * 100 : null,
        volume: readValue(quote.volume),
        openInterest: readValue(quote.oi),
        timestamp: normalizeDhanQuoteTimestamp(quote.last_trade_time ?? quote.timestamp),
      }]];
    }),
  );
}

export async function fetchMarketStatus() {
  return fetchNSEProxy("market-status");
}

function getIndianMarketTime(now: Date): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
}

function isNseTradeDateToday(tradeDate: string, now: Date): boolean {
  const monthNumbers: Record<string, string> = {
    Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
    Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
  };
  const legacyDate = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})/.exec(tradeDate.trim());
  const isoDate = /^(\d{4})-(\d{2})-(\d{2})/.exec(tradeDate.trim());
  const apiDate = legacyDate && monthNumbers[legacyDate[2]]
    ? `${legacyDate[3]}-${monthNumbers[legacyDate[2]]}-${legacyDate[1].padStart(2, "0")}`
    : isoDate
      ? `${isoDate[1]}-${isoDate[2]}-${isoDate[3]}`
      : null;
  const local = getIndianMarketTime(now);
  return Boolean(apiDate && apiDate === `${local.year}-${local.month}-${local.day}`);
}

export function isWithinNseSessionAt(now = new Date()): boolean {
  const local = getIndianMarketTime(now);
  if (!["Mon", "Tue", "Wed", "Thu", "Fri"].includes(local.weekday)) return false;

  const minutes = Number(local.hour) * 60 + Number(local.minute);
  return minutes >= 9 * 60 + 15 && minutes <= 15 * 60 + 30;
}

export function isNseMarketOpenAt(
  marketStatus: string | undefined,
  tradeDate: string | undefined,
  now = new Date(),
): boolean {
  return marketStatus === "Open" &&
    Boolean(tradeDate && isNseTradeDateToday(tradeDate, now)) &&
    isWithinNseSessionAt(now);
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

function normalizeLookupKey(value: string | undefined): string {
  return (value ?? "").replace(/[^A-Z0-9]/gi, "").toUpperCase();
}

function isLikelyCashEquitySymbol(symbol: string | undefined): boolean {
  return Boolean(normalizeLookupKey(symbol)) && isCashEquitySymbol(symbol);
}

async function buildCashEquityLookup(): Promise<Set<string>> {
  try {
    const data = await fetchInstrumentMaster();
    const rows = normalizeInstrumentMasterResponse(data);
    const set = new Set<string>();

    for (const row of rows) {
      const normalized = normalizeProviderInstrument(row, "dhan");
      const instrument = normalized.instrument;
      if (!instrument || classifyInstrument(instrument) !== "stocks" || !isCashEquityListing(instrument)) continue;
      set.add(normalizeLookupKey(instrument.symbol));
      set.add(normalizeLookupKey(instrument.tradingSymbol));
    }

    return set;
  } catch (error) {
    console.warn("Cash equity instrument master lookup failed:", error);
    return new Set();
  }
}

export async function fetchLiveFnOStocks(): Promise<FnOStockData[]> {
  if (isWithinNseSessionAt()) {
    // Try NSE during regular hours for OI data; use the scanner for closed sessions.
    try {
      const raw = await fetchNSEProxy("equity-derivatives");
      if (raw?.data?.length > 0) {
        const cashEquityLookup = await buildCashEquityLookup();
        const rows = raw.data
          .filter((d: any) => d.symbol && d.symbol !== "NIFTY 50" && d.lastPrice)
          .filter((d: any) => {
            if (cashEquityLookup.size > 0) {
              const keys = [normalizeLookupKey(d.symbol), normalizeLookupKey(d.tradingSymbol), normalizeLookupKey(d.instrumentName)];
              return keys.some((key) => key && cashEquityLookup.has(key));
            }
            return isLikelyCashEquitySymbol(d.symbol);
          })
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

        if (rows.length > 0) return rows;
      }
    } catch (e) {
      console.warn("NSE F&O stocks fetch failed, trying TradingView:", e);
    }
  }

  // Fallback to TradingView Scanner (no OI but great LTP/volume data)
  try {
    const tvData = await fetchTradingViewStocks();
    if (tvData.length > 0) return tvData.filter((stock) => isLikelyCashEquitySymbol(stock.symbol));
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
  instruments: any[];
  count: number;
}> {
  const result = await fetchDhanProxy("instruments");
  return result;
}

// ── Normalize Instrument Master Response ──

export function normalizeInstrumentMasterResponse(response: any): any[] {
  // Handle various response shapes from the proxy
  if (Array.isArray(response)) {
    return response;
  }
  if (response?.data?.instruments) {
    return response.data.instruments;
  }
  if (response?.instruments) {
    return response.instruments;
  }
  return [];
}

// ── Normalize Dhan Quote Payload ──

export function normalizeDhanQuotePayload(
  payload: any,
  tradingSymbol: string,
  master: any,
  now: number
): { quote: any } {
  // Extract quote data from Dhan payload
  const data = payload?.data?.IDX_I?.[0] || payload?.data?.NSE_EQ?.[0] || payload?.data?.[tradingSymbol]?.[0];
  
  if (!data) {
    return { quote: null };
  }
  
  const ltp = Number(data.last_price ?? data.ltp ?? 0);
  const previousClose = Number(data.previous_close ?? data.close ?? ltp);
  const change = ltp - previousClose;
  const changePercent = previousClose ? (change / previousClose) * 100 : 0;
  
  // Extract canonical symbol from master if available
  const instrument = master?.getByExchangeSymbol?.("NSE", tradingSymbol);
  const normalizedSymbol = instrument?.symbol || tradingSymbol;
  
  return {
    quote: {
      symbol: normalizedSymbol,
      ltp,
      change,
      changePercent,
      open: Number(data.open ?? ltp),
      high: Number(data.high ?? ltp),
      low: Number(data.low ?? ltp),
      previousClose,
      volume: Number(data.volume ?? 0),
      timestamp: data.timestamp || new Date(now).toISOString(),
    },
  };
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
