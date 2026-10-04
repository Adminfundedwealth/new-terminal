import { useQuery } from "@tanstack/react-query";
import { useAccountContext } from "@/hooks/useAccountContext";
import { normalizeCandlePayload } from "@/lib/historicalData";
import { requestTerminalMarketData, resolveTerminalMarketDataProvider, TerminalMarketDataError, } from "@/lib/terminalApi";
export const KITE_INDEX_TOKEN_MAP = {
    NIFTY: "256265",
    BANKNIFTY: "260105",
    FINNIFTY: "257801",
};
const KITE_HISTORICAL_SYMBOL_ALIASES = {
    NIFTY: ["NIFTY 50"],
    BANKNIFTY: ["NIFTY BANK"],
    FINNIFTY: ["NIFTY FIN SERVICE"],
    MIDCPNIFTY: ["NIFTY MID SELECT", "NIFTY MIDCAP 50"],
    NIFTY_MIDCAP_50: ["NIFTY MIDCAP 50"],
};
// ── Security ID lookup: indices + top F&O stocks ──
// Hardcoded to avoid downloading the 30MB instrument master CSV for every sparkline.
// Dhan security IDs for NSE equity stocks (from api-scrip-master.csv).
const SECURITY_MAP = {
    // ─── Indices ───
    NIFTY: { secId: "13", exchSeg: "IDX_I", instrument: "INDEX" },
    BANKNIFTY: { secId: "25", exchSeg: "IDX_I", instrument: "INDEX" },
    FINNIFTY: { secId: "27", exchSeg: "IDX_I", instrument: "INDEX" },
    MIDCPNIFTY: { secId: "442", exchSeg: "IDX_I", instrument: "INDEX" },
    NIFTY_MIDCAP_50: { secId: "NIFTY_MIDCAP_50", exchSeg: "IDX_I", instrument: "INDEX" },
    INDIAVIX: { secId: "26", exchSeg: "IDX_I", instrument: "INDEX" },
    SENSEX: { secId: "1", exchSeg: "IDX_I", instrument: "INDEX" },
    // ─── NIFTY 50 Stocks ───
    RELIANCE: { secId: "2885", exchSeg: "NSE_EQ", instrument: "EQUITY" },
    TCS: { secId: "11536", exchSeg: "NSE_EQ", instrument: "EQUITY" },
    HDFCBANK: { secId: "1333", exchSeg: "NSE_EQ", instrument: "EQUITY" },
    INFY: { secId: "1594", exchSeg: "NSE_EQ", instrument: "EQUITY" },
    ICICIBANK: { secId: "4963", exchSeg: "NSE_EQ", instrument: "EQUITY" },
    HINDUNILVR: { secId: "1394", exchSeg: "NSE_EQ", instrument: "EQUITY" },
    ITC: { secId: "1660", exchSeg: "NSE_EQ", instrument: "EQUITY" },
    SBIN: { secId: "3045", exchSeg: "NSE_EQ", instrument: "EQUITY" },
    BHARTIARTL: { secId: "10604", exchSeg: "NSE_EQ", instrument: "EQUITY" },
    KOTAKBANK: { secId: "1922", exchSeg: "NSE_EQ", instrument: "EQUITY" },
    LT: { secId: "11483", exchSeg: "NSE_EQ", instrument: "EQUITY" },
    AXISBANK: { secId: "5900", exchSeg: "NSE_EQ", instrument: "EQUITY" },
    ASIANPAINT: { secId: "236", exchSeg: "NSE_EQ", instrument: "EQUITY" },
    MARUTI: { secId: "10999", exchSeg: "NSE_EQ", instrument: "EQUITY" },
    TITAN: { secId: "3506", exchSeg: "NSE_EQ", instrument: "EQUITY" },
    SUNPHARMA: { secId: "3351", exchSeg: "NSE_EQ", instrument: "EQUITY" },
    BAJFINANCE: { secId: "317", exchSeg: "NSE_EQ", instrument: "EQUITY" },
    BAJFINSV: { secId: "16669", exchSeg: "NSE_EQ", instrument: "EQUITY" },
    WIPRO: { secId: "3787", exchSeg: "NSE_EQ", instrument: "EQUITY" },
    HCLTECH: { secId: "7229", exchSeg: "NSE_EQ", instrument: "EQUITY" },
    TATAMOTORS: { secId: "3456", exchSeg: "NSE_EQ", instrument: "EQUITY" },
    TATASTEEL: { secId: "3499", exchSeg: "NSE_EQ", instrument: "EQUITY" },
    NTPC: { secId: "11630", exchSeg: "NSE_EQ", instrument: "EQUITY" },
    POWERGRID: { secId: "14977", exchSeg: "NSE_EQ", instrument: "EQUITY" },
    ONGC: { secId: "2475", exchSeg: "NSE_EQ", instrument: "EQUITY" },
    JSWSTEEL: { secId: "11723", exchSeg: "NSE_EQ", instrument: "EQUITY" },
    M_M: { secId: "2031", exchSeg: "NSE_EQ", instrument: "EQUITY" },
    ADANIENT: { secId: "25", exchSeg: "NSE_EQ", instrument: "EQUITY" },
    ADANIPORTS: { secId: "15083", exchSeg: "NSE_EQ", instrument: "EQUITY" },
    ULTRACEMCO: { secId: "11532", exchSeg: "NSE_EQ", instrument: "EQUITY" },
    TECHM: { secId: "13538", exchSeg: "NSE_EQ", instrument: "EQUITY" },
    INDUSINDBK: { secId: "5258", exchSeg: "NSE_EQ", instrument: "EQUITY" },
    DRREDDY: { secId: "881", exchSeg: "NSE_EQ", instrument: "EQUITY" },
    CIPLA: { secId: "694", exchSeg: "NSE_EQ", instrument: "EQUITY" },
    EICHERMOT: { secId: "910", exchSeg: "NSE_EQ", instrument: "EQUITY" },
    DIVISLAB: { secId: "10940", exchSeg: "NSE_EQ", instrument: "EQUITY" },
    BPCL: { secId: "526", exchSeg: "NSE_EQ", instrument: "EQUITY" },
    COALINDIA: { secId: "20374", exchSeg: "NSE_EQ", instrument: "EQUITY" },
    GRASIM: { secId: "1232", exchSeg: "NSE_EQ", instrument: "EQUITY" },
    APOLLOHOSP: { secId: "157", exchSeg: "NSE_EQ", instrument: "EQUITY" },
    HEROMOTOCO: { secId: "1348", exchSeg: "NSE_EQ", instrument: "EQUITY" },
    TATACONSUM: { secId: "3432", exchSeg: "NSE_EQ", instrument: "EQUITY" },
    SBILIFE: { secId: "21808", exchSeg: "NSE_EQ", instrument: "EQUITY" },
    BRITANNIA: { secId: "547", exchSeg: "NSE_EQ", instrument: "EQUITY" },
    NESTLEIND: { secId: "17963", exchSeg: "NSE_EQ", instrument: "EQUITY" },
    BAJAJ_AUTO: { secId: "16669", exchSeg: "NSE_EQ", instrument: "EQUITY" },
    HDFCLIFE: { secId: "467", exchSeg: "NSE_EQ", instrument: "EQUITY" },
    VEDL: { secId: "3063", exchSeg: "NSE_EQ", instrument: "EQUITY" },
    HINDALCO: { secId: "1363", exchSeg: "NSE_EQ", instrument: "EQUITY" },
    BANKBARODA: { secId: "4668", exchSeg: "NSE_EQ", instrument: "EQUITY" },
    PNB: { secId: "10666", exchSeg: "NSE_EQ", instrument: "EQUITY" },
    DLF: { secId: "14732", exchSeg: "NSE_EQ", instrument: "EQUITY" },
    TRENT: { secId: "1964", exchSeg: "NSE_EQ", instrument: "EQUITY" },
};
// Alias: M&M uses underscore in our map
if (!SECURITY_MAP["M&M"])
    SECURITY_MAP["M&M"] = SECURITY_MAP["M_M"];
export function resolveKiteHistoricalToken(symbol, instrumentToken) {
    return instrumentToken?.trim() || KITE_INDEX_TOKEN_MAP[symbol.toUpperCase()];
}
// ── Map a UI time range to candle interval + lookback days ──
function rangeToParams(range) {
    switch (range) {
        case "1W": return { interval: "15", daysBack: 10 };
        case "1M": return { interval: "60", daysBack: 31 };
        case "3M": return { interval: "D", daysBack: 92 };
        case "6M": return { interval: "D", daysBack: 183 };
        case "1Y": return { interval: "D", daysBack: 365 };
        default: return { interval: "D", daysBack: 92 };
    }
}
/**
 * Parses the proxy's column-array candle response (shared by Dhan + Yahoo,
 * which both return { open[], high[], low[], close[], volume[], timestamp[] }).
 * Exported for unit testing.
 */
export function parseColumnarCandles(rawData) {
    const normalized = normalizeCandlePayload(rawData, {
        instrumentId: "chart-data",
        symbol: "UNKNOWN",
        exchange: "NSE",
        interval: "D",
    });
    return normalized.map((candle) => ({
        time: candle.timestamp,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
    }));
}
function normalizeInstrumentName(value) {
    return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
async function findGatewayInstrument(accountId, provider, symbol, instrumentToken) {
    const normalizedSymbol = symbol.toUpperCase();
    const search = await requestTerminalMarketData(accountId, provider, {
        operation: "searchInstruments",
        query: symbol.replace(/_/g, " "),
    });
    const token = instrumentToken || (provider === "kite" ? resolveKiteHistoricalToken(normalizedSymbol) : undefined);
    if (token) {
        const tokenMatch = search.find((instrument) => instrument.providerInstrumentId === token);
        if (tokenMatch)
            return tokenMatch;
    }
    const dhanToken = provider === "dhan" ? SECURITY_MAP[normalizedSymbol]?.secId : undefined;
    if (dhanToken) {
        const knownMatch = search.find((instrument) => instrument.providerInstrumentId === dhanToken);
        if (knownMatch)
            return knownMatch;
    }
    const acceptedNames = new Set([
        normalizedSymbol,
        ...(provider === "kite" ? KITE_HISTORICAL_SYMBOL_ALIASES[normalizedSymbol] ?? [] : []),
    ].map(normalizeInstrumentName));
    return search.find((instrument) => acceptedNames.has(normalizeInstrumentName(instrument.tradingSymbol)) ||
        acceptedNames.has(normalizeInstrumentName(instrument.symbol))) ?? null;
}
function toChartCandles(candles) {
    return candles.flatMap((candle) => {
        const time = typeof candle.timestamp === "number"
            ? Math.floor(candle.timestamp > 1e12 ? candle.timestamp / 1000 : candle.timestamp)
            : Math.floor(Date.parse(candle.timestamp) / 1000);
        if (!Number.isFinite(time))
            return [];
        return [{ time, open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume }];
    });
}
async function fetchGatewayHistorical(accountId, provider, symbol, range, instrumentToken) {
    const instrument = await findGatewayInstrument(accountId, provider, symbol, instrumentToken);
    if (!instrument)
        return [];
    const { interval, daysBack } = rangeToParams(range);
    const now = new Date();
    const from = new Date(now);
    from.setDate(from.getDate() - daysBack);
    const apiInterval = interval === "D"
        ? "day"
        : provider === "kite"
            ? interval === "15" ? "15minute" : "60minute"
            : `${interval}m`;
    const result = await requestTerminalMarketData(accountId, provider, {
        operation: "getHistoricalCandles",
        instrument,
        interval: apiInterval,
        fromDate: from.toISOString().split("T")[0],
        toDate: now.toISOString().split("T")[0],
    });
    return toChartCandles(result);
}
/** Fetch OHLCV candles only through the account-scoped Terminal OS gateway. */
async function fetchHistorical(symbol, range, accountId, provider, instrumentToken) {
    if (accountId && provider) {
        try {
            const candles = await fetchGatewayHistorical(accountId, provider, symbol, range, instrumentToken);
            if (candles.length > 0)
                return candles;
        }
        catch (error) {
            if (!(error instanceof TerminalMarketDataError) || error.code !== "MISSING_CREDENTIALS")
                throw error;
        }
    }
    return [];
}
/**
 * React Query hook for chart data. Fetches OHLCV candles from Dhan API.
 */
export function useChartData(symbol, range = "3M", enabled = true, instrumentToken) {
    const { activeAccountId, accounts } = useAccountContext();
    const activeAccount = accounts.find((account) => account.id === activeAccountId);
    const provider = resolveTerminalMarketDataProvider(activeAccount?.broker_provider);
    return useQuery({
        queryKey: ["chart-data", activeAccountId, provider, symbol, range, instrumentToken],
        queryFn: () => fetchHistorical(symbol, range, activeAccountId, provider, instrumentToken),
        enabled: !!symbol && enabled,
        staleTime: 5 * 60 * 1000, // 5 min cache
        refetchOnWindowFocus: false,
        retry: 1,
    });
}
/**
 * Fetches a quick sparkline (close prices only) for mini charts.
 */
export function useSparklineData(symbol, enabled = true) {
    const { activeAccountId, accounts } = useAccountContext();
    const activeAccount = accounts.find((account) => account.id === activeAccountId);
    const provider = resolveTerminalMarketDataProvider(activeAccount?.broker_provider);
    return useQuery({
        queryKey: ["sparkline", activeAccountId, provider, symbol],
        queryFn: async () => {
            const candles = await fetchHistorical(symbol, "3M", activeAccountId, provider);
            if (candles.length > 0) {
                return candles.map(c => c.close);
            }
            return [];
        },
        enabled: !!symbol && enabled,
        staleTime: 10 * 60 * 1000, // 10 min cache
        refetchOnWindowFocus: false,
        retry: 1,
    });
}
