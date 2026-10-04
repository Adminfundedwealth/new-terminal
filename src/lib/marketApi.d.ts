import type { OptionData, ExpiryDate, IndexData } from "./mockData";
import type { NormalizedQuote } from "./brokerAdapter";
import { type TerminalMarketDataInstrument, type TerminalMarketDataProvider, type TerminalMarketDataQuote } from "./terminalApi";
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
export declare function fetchIndianMarketNews(): Promise<{
    provider: string;
    articles: IndianNewsArticle[];
    fetchedAt: string;
}>;
export declare function normalizeInstrumentMasterResponse(raw: unknown): Array<Record<string, unknown>>;
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
            ce_delta?: number;
            ce_gamma?: number;
            ce_theta?: number;
            ce_vega?: number;
            pe_delta?: number;
            pe_gamma?: number;
            pe_theta?: number;
            pe_vega?: number;
        }>;
        last_price?: number;
        oi_data?: Record<string, {
            ce_oi?: number;
            pe_oi?: number;
            ce_oi_chg?: number;
            pe_oi_chg?: number;
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
export declare function parseDhanOptionChain(raw: DhanOptionChainData): {
    chain: OptionData[];
    spotPrice: number;
    totalCEOI: number;
    totalPEOI: number;
};
export declare function parseNSEIndices(raw: any): IndexData[];
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
        CE: {
            totOI: number;
            totVol: number;
        };
        PE: {
            totOI: number;
            totVol: number;
        };
    };
}
export declare function parseNSEOptionChain(raw: NSEOptionChainResponse, selectedExpiry?: string): {
    chain: OptionData[];
    spotPrice: number;
    expiries: ExpiryDate[];
    totalCEOI: number;
    totalPEOI: number;
};
export declare function fetchLiveOptionChain(symbol: string, expiry: string | undefined, accountId: string, provider: TerminalMarketDataProvider): Promise<{
    chain: {
        strikePrice: number;
        ce: OptionData["ce"];
        pe: OptionData["pe"];
    }[];
    spotPrice: number;
    expiries: {
        label: string;
        value: string;
        daysToExpiry: number;
    }[];
    totalCEOI: number;
    totalPEOI: number;
    source: "dhan" | "zerodha";
    afterHours: boolean;
    cachedAt: string | number;
    greeksAvailable: boolean;
    oiChangeAvailable: boolean;
}>;
export declare function fetchDhanQuote(symbol: string): Promise<{
    symbol: string;
    ltp: number;
    change: number;
    changePercent: number;
    timestamp: string;
}>;
export declare function normalizeDhanQuotePayload(raw: unknown, symbol: string, master: import("./instrumentMaster").InstrumentMaster, now?: number): {
    quote: import("./quoteService").LegacyQuote;
    freshness: import("./quoteService").QuoteFreshness;
    error?: import("./quoteService").QuoteError;
};
export declare function normalizeTerminalMarketQuote(quote: TerminalMarketDataQuote, instrument: TerminalMarketDataInstrument, canonicalInstrumentId?: string, now?: number): NormalizedQuote;
export declare function fetchExpiryList(symbol: string, accountId: string, provider: TerminalMarketDataProvider): Promise<ExpiryDate[]>;
export declare function fetchLiveIndices(accountId: string, provider: TerminalMarketDataProvider): Promise<IndexData[]>;
export declare function fetchMarketStatus(): Promise<any>;
export declare function fetchFnOStocks(): Promise<any>;
export declare function fetchAllIndices(): Promise<{
    vix: {
        value: any;
        change: any;
        changePercent: any;
        high: any;
        low: any;
    };
    sectors: any;
    advances: any;
    declines: any;
    unchanged: any;
}>;
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
    totalTradedVolume?: number;
    openInterest?: number;
    oiChange?: number;
    sector?: string;
}
export declare function normalizeKiteFnOStockQuotes(instruments: import("./localDatabase").Instrument[], quotes: NormalizedQuote[]): FnOStockData[];
export declare function fetchLiveFnOStocks(accountId: string, provider: TerminalMarketDataProvider): Promise<FnOStockData[]>;
export declare function fetchTradingViewStocks(): Promise<FnOStockData[]>;
export declare function fetchTradingViewIndices(): Promise<any[]>;
export interface FIIDIIData {
    category: string;
    date: string;
    buyValue: number;
    sellValue: number;
    netValue: number;
}
export declare function fetchFIIDII(): Promise<FIIDIIData[]>;
export declare function testDhanConnection(): Promise<{
    status: string;
    message: string;
}>;
export declare function fetchProxyHealth(): Promise<any>;
export declare function fetchInstrumentMaster(): Promise<{
    instruments: import("./localDatabase").Instrument[];
    count: number;
}>;
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
export declare function fetchHistoricalCandles(securityId: string, exchangeSegment?: string, instrument?: string, interval?: string, fromDate?: string, toDate?: string): Promise<HistoricalCandleResponse>;
export declare function fetchYahooChart(symbol: string, interval?: string, fromDate?: string, toDate?: string): Promise<HistoricalCandleResponse>;
export {};
