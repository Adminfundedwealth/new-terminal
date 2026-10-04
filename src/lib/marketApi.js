import { ZerodhaAdapter } from "./zerodhaAdapter";
import { InstrumentMaster, normalizeInstrumentMaster } from "./instrumentMaster";
import { normalizeQuote, toLegacyQuote } from "./quoteService";
import { classifyInstrument, isProductionInstrument } from "./instrumentClassification";
import { getFnOStockList } from "./localDatabase";
import { requestTerminalMarketData, toTerminalMarketDataInstrument, } from "./terminalApi";
// Local proxy base URL — override via VITE_PROXY_URL if deploying proxy elsewhere
const PROXY_BASE = import.meta.env.VITE_PROXY_URL || "";
// The proxy owns broker credentials; browser requests never carry them.
async function fetchDhanProxy(endpoint, params) {
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
async function fetchNSEProxy(endpoint, symbol) {
    const params = new URLSearchParams({ endpoint });
    if (symbol)
        params.set("symbol", symbol);
    const url = `${PROXY_BASE}/api/nse-proxy?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`NSE proxy error ${res.status}: ${errText}`);
    }
    return res.json();
}
export async function fetchIndianMarketNews() {
    const res = await fetch(`${PROXY_BASE}/api/indian-news`);
    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Indian news proxy error ${res.status}: ${errText}`);
    }
    return res.json();
}
export function normalizeInstrumentMasterResponse(raw) {
    if (Array.isArray(raw))
        return raw;
    if (!raw || typeof raw !== "object")
        return [];
    const response = raw;
    if (Array.isArray(response.instruments))
        return response.instruments;
    if (response.data && Array.isArray(response.data.instruments))
        return response.data.instruments;
    return [];
}
export function parseDhanOptionChain(raw) {
    const oc = raw?.data?.oc || {};
    const spotPrice = raw?.data?.last_price || 0;
    let totalCEOI = 0;
    let totalPEOI = 0;
    const chain = Object.keys(oc)
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
export function parseNSEIndices(raw) {
    const indices = ["NIFTY 50", "NIFTY BANK", "NIFTY FINANCIAL SERVICES", "NIFTY MIDCAP 50"];
    const symbolMap = {
        "NIFTY 50": "NIFTY",
        "NIFTY BANK": "BANKNIFTY",
        "NIFTY FINANCIAL SERVICES": "FINNIFTY",
        "NIFTY MIDCAP 50": "MIDCPNIFTY",
    };
    if (!raw?.data)
        return [];
    return raw.data
        .filter((d) => indices.includes(d.index))
        .map((d) => ({
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
export function parseNSEOptionChain(raw, selectedExpiry) {
    // Guard against malformed/empty response
    if (!raw?.records?.expiryDates || !raw?.records?.data) {
        return { chain: [], spotPrice: 0, expiries: [], totalCEOI: 0, totalPEOI: 0 };
    }
    const expiries = raw.records.expiryDates.map((exp) => {
        const d = new Date(exp);
        const now = new Date();
        const days = Math.max(0, Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
        return { label: exp, value: exp, daysToExpiry: days };
    });
    const expiryFilter = selectedExpiry || raw.records.expiryDates[0];
    const filteredData = raw.records.data.filter((d) => d.expiryDate === expiryFilter);
    let spotPrice = 0;
    const chain = filteredData.map((item) => {
        if (item.CE?.underlyingValue)
            spotPrice = item.CE.underlyingValue;
        if (item.PE?.underlyingValue)
            spotPrice = item.PE.underlyingValue;
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
export async function fetchLiveOptionChain(symbol, expiry, accountId, provider) {
    const result = await requestTerminalMarketData(accountId, provider, {
        operation: "getOptionChain",
        underlying: symbol,
        expiry,
    });
    return {
        chain: result.chain,
        spotPrice: result.spotPrice,
        expiries: result.expiries.map((value) => ({ label: value, value, daysToExpiry: 0 })),
        totalCEOI: result.totalCEOI,
        totalPEOI: result.totalPEOI,
        source: result.provider === "kite" ? "zerodha" : "dhan",
        afterHours: result.afterHours ?? false,
        cachedAt: result.cachedAt ?? null,
        greeksAvailable: result.greeksAvailable,
        oiChangeAvailable: result.oiChangeAvailable ?? false,
    };
}
export async function fetchDhanQuote(symbol) {
    const raw = await fetchDhanProxy("ltp", { symbol: symbol.toUpperCase() });
    const security = raw?.data?.IDX_I?.[0] || raw?.data?.NSE_EQ?.[0] || raw?.data?.[symbol.toUpperCase()]?.[0];
    if (!security?.last_price && !security?.ltp)
        throw new Error(`Dhan quote unavailable for ${symbol}`);
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
export function normalizeDhanQuotePayload(raw, symbol, master, now = Date.now()) {
    const instrument = master.getByExchangeSymbol("NSE", symbol) || master.getByExchangeSymbol("NSE", `${symbol} 50`);
    const result = normalizeQuote({ provider: "dhan", payload: raw, providerInstrumentId: instrument?.providerInstrumentId, exchange: instrument?.exchange, symbol: instrument?.tradingSymbol, now }, master);
    return { ...result, quote: result.quote ? toLegacyQuote(result.quote) : undefined };
}
export function normalizeTerminalMarketQuote(quote, instrument, canonicalInstrumentId, now = Date.now()) {
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
export async function fetchExpiryList(symbol, accountId, provider) {
    try {
        const result = await requestTerminalMarketData(accountId, provider, {
            operation: "getOptionChain",
            underlying: symbol.toUpperCase(),
        });
        if (result.expiries) {
            return result.expiries.map((dateStr) => {
                const d = new Date(dateStr);
                const days = Math.max(0, Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
                return {
                    label: d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
                    value: dateStr,
                    daysToExpiry: days,
                };
            });
        }
    }
    catch (e) {
        console.warn("Dhan expiry list fetch failed:", e);
    }
    return [];
}
// NSE Indices (Dhan doesn't provide broad index overview the same way)
export async function fetchLiveIndices(accountId, provider) {
    const symbols = [
        { symbol: "NIFTY", name: "NIFTY 50" },
        { symbol: "BANKNIFTY", name: "BANK NIFTY" },
        { symbol: "FINNIFTY", name: "FIN NIFTY" },
        { symbol: "MIDCPNIFTY", name: "MIDCAP NIFTY" },
    ];
    return Promise.all(symbols.map(async ({ symbol, name }) => {
        const instruments = await requestTerminalMarketData(accountId, provider, {
            operation: "searchInstruments",
            query: symbol,
        });
        const normalized = symbol.replace(/[^A-Z0-9]/g, "");
        const instrument = instruments.find((item) => item.provider === provider && (item.symbol.toUpperCase().replace(/[^A-Z0-9]/g, "") === normalized ||
            item.tradingSymbol.toUpperCase().replace(/[^A-Z0-9]/g, "") === normalized));
        if (!instrument)
            return null;
        const quote = await requestTerminalMarketData(accountId, provider, { operation: "getQuote", instrument });
        return {
            name,
            symbol,
            ltp: quote.ltp,
            change: quote.change ?? 0,
            changePercent: quote.changePercent ?? 0,
            high: quote.high ?? quote.ltp,
            low: quote.low ?? quote.ltp,
            open: quote.open ?? quote.ltp,
            prevClose: quote.previousClose ?? quote.ltp,
        };
    })).then((items) => items.filter((item) => item !== null));
}
export async function fetchMarketStatus() {
    return fetchNSEProxy("market-status");
}
export async function fetchFnOStocks() {
    return fetchNSEProxy("equity-derivatives");
}
// ── All Indices (for VIX, sector performance) ──
const SECTOR_INDEX_MAP = {
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
    if (!raw?.data)
        return null;
    // Extract VIX
    const vixEntry = raw.data.find((d) => d.index === "INDIA VIX");
    const vix = vixEntry ? {
        value: vixEntry.last,
        change: vixEntry.variation || 0,
        changePercent: vixEntry.percentChange || 0,
        high: vixEntry.high || vixEntry.last,
        low: vixEntry.low || vixEntry.last,
    } : null;
    // Extract sector indices
    const sectors = raw.data
        .filter((d) => SECTOR_INDEX_MAP[d.index])
        .map((d) => ({
        name: SECTOR_INDEX_MAP[d.index],
        fullName: d.index,
        change: d.percentChange || 0,
        ltp: d.last || 0,
        open: d.open || d.last,
        high: d.high || d.last,
        low: d.low || d.last,
    }));
    // Advance/Decline from NIFTY 50
    const nifty50 = raw.data.find((d) => d.index === "NIFTY 50");
    const advances = nifty50?.advances || 0;
    const declines = nifty50?.declines || 0;
    const unchanged = nifty50?.unchanged || 0;
    return { vix, sectors, advances, declines, unchanged };
}
export function normalizeKiteFnOStockQuotes(instruments, quotes) {
    const quotesByToken = new Map(quotes.map((quote) => [quote.providerInstrumentId ?? quote.instrumentId ?? "", quote]));
    const futuresSymbols = new Set(instruments
        .filter((instrument) => isProductionInstrument(instrument) && classifyInstrument(instrument) === "futures")
        .map((instrument) => instrument.symbol.toUpperCase()));
    return instruments.flatMap((instrument) => {
        if (classifyInstrument(instrument) !== "stocks" || ![instrument.symbol, instrument.tradingSymbol].some((symbol) => futuresSymbols.has(symbol.toUpperCase())))
            return [];
        const quote = quotesByToken.get(instrument.providerInstrumentId) ?? quotesByToken.get(instrument.securityId);
        if (!quote || quote.ltp <= 0)
            return [];
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
let quoteInstrumentMasterPromise;
async function getQuoteInstrumentMaster() {
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
async function canonicalizeFnOStocks(stocks, provider) {
    const master = await Promise.race([
        getQuoteInstrumentMaster(),
        new Promise((resolve) => setTimeout(() => resolve(undefined), 3000)),
    ]);
    if (!master)
        return stocks;
    return stocks.flatMap((stock) => {
        const instrument = master.getByExchangeSymbol("NSE", stock.symbol)
            ?? master.values().find((candidate) => candidate.exchange === "NSE" && candidate.symbol.toUpperCase() === stock.symbol.toUpperCase());
        if (!instrument)
            return [];
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
        if (!quote)
            return [];
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
export async function fetchLiveFnOStocks(accountId, provider) {
    const instruments = await getFnOStockList();
    const providerInstruments = instruments.filter((instrument) => isProductionInstrument(instrument) &&
        (instrument.provider === provider || (provider === "kite" && instrument.provider === "zerodha")));
    const quotes = [];
    for (let offset = 0; offset < providerInstruments.length; offset += 10) {
        const batch = providerInstruments.slice(offset, offset + 10);
        const results = await Promise.allSettled(batch.map(async (instrument) => {
            const terminalInstrument = toTerminalMarketDataInstrument(instrument, provider);
            const quote = await requestTerminalMarketData(accountId, provider, { operation: "getQuote", instrument: terminalInstrument });
            return normalizeTerminalMarketQuote(quote, terminalInstrument, instrument.securityId);
        }));
        for (const result of results)
            if (result.status === "fulfilled")
                quotes.push(result.value);
    }
    return normalizeKiteFnOStockQuotes(providerInstruments, quotes);
}
// ── TradingView Scanner API ──
export async function fetchTradingViewStocks() {
    const url = `${PROXY_BASE}/api/tv-scan?type=stocks`;
    const res = await fetch(url);
    if (!res.ok)
        throw new Error(`TV scan error: ${res.status}`);
    const data = await res.json();
    return (data.stocks || []).map((s) => ({
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
export async function fetchTradingViewIndices() {
    const url = `${PROXY_BASE}/api/tv-scan?type=indices`;
    const res = await fetch(url);
    if (!res.ok)
        throw new Error(`TV indices error: ${res.status}`);
    const data = await res.json();
    return data.stocks || [];
}
export async function fetchFIIDII() {
    const raw = await fetchNSEProxy("fii-dii");
    if (!raw?.data)
        return [];
    return raw.data.map((d) => ({
        category: d.category || "",
        date: d.date || "",
        buyValue: parseFloat(d.buyValue?.replace(/,/g, "")) || 0,
        sellValue: parseFloat(d.sellValue?.replace(/,/g, "")) || 0,
        netValue: parseFloat(d.netValue?.replace(/,/g, "")) || 0,
    }));
}
// ── Test Connection ──
export async function testDhanConnection() {
    const res = await fetch(`${PROXY_BASE}/api/test-connection`);
    return res.json();
}
export async function fetchProxyHealth() {
    const res = await fetch(`${PROXY_BASE}/health`);
    if (!res.ok)
        throw new Error(`Health check failed: ${res.status}`);
    return res.json();
}
// ── Instrument Master Download ──
export async function fetchInstrumentMaster() {
    let kiteAuthenticated = false;
    try {
        const kiteStatus = await fetch(`${PROXY_BASE}/api/kite/status`, { credentials: "include" });
        kiteAuthenticated = kiteStatus.ok && (await kiteStatus.json()).authenticated;
        if (kiteAuthenticated) {
            const result = await new ZerodhaAdapter().getInstruments();
            if (result.data?.length)
                return { instruments: result.data, count: result.data.length };
            throw new Error(result.message || "Kite instrument master is empty.");
        }
    }
    catch (error) {
        console.warn("Kite instrument master unavailable, trying Dhan:", error);
    }
    try {
        const result = await fetchDhanProxy("instruments");
        if (Array.isArray(result?.instruments) && result.instruments.length > 0) {
            const report = normalizeInstrumentMaster(result.instruments, "dhan");
            if (report.instruments.length > 0)
                return { instruments: report.instruments, count: report.instruments.length };
            throw new Error(`Dhan instrument master contained no valid instruments (${report.issues.length} rejected).`);
        }
    }
    catch (error) {
        console.warn("Dhan instrument master unavailable:", error);
    }
    if (!kiteAuthenticated) {
        const kiteStatus = await fetch(`${PROXY_BASE}/api/kite/status`, { credentials: "include" });
        if (kiteStatus.ok && (await kiteStatus.json()).authenticated) {
            const result = await new ZerodhaAdapter().getInstruments();
            if (result.data?.length)
                return { instruments: result.data, count: result.data.length };
            throw new Error(result.message || "Kite instrument master is empty.");
        }
    }
    throw new Error("No provider instrument master is available.");
}
export async function fetchHistoricalCandles(securityId, exchangeSegment = "IDX_I", instrument = "INDEX", interval = "5", fromDate, toDate) {
    const params = {
        securityId,
        exchangeSegment,
        instrument,
        interval,
    };
    if (fromDate)
        params.fromDate = fromDate;
    if (toDate)
        params.toDate = toDate;
    return fetchDhanProxy("historical", params);
}
// ── Yahoo Finance Chart Data (free, no auth) ──
export async function fetchYahooChart(symbol, interval = "D", fromDate, toDate) {
    const params = new URLSearchParams({ symbol, interval });
    if (fromDate)
        params.set("fromDate", fromDate);
    if (toDate)
        params.set("toDate", toDate);
    const url = `${PROXY_BASE}/api/yahoo-chart?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Yahoo chart error ${res.status}: ${errText}`);
    }
    return res.json();
}
