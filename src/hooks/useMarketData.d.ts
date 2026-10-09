import type { FnOStockData, OptionUnderlying } from "@/lib/marketApi";
import type { OptionData, IndexData, ExpiryDate } from "@/lib/mockData";
export declare function useLiveIndices(): {
    data: {
        data: IndexData[];
        isLive: boolean;
        source: "terminal-os";
    } | {
        data: IndexData[];
        isLive: boolean;
        source: "database";
    } | {
        data: IndexData[];
        isLive: boolean;
        source?: undefined;
    };
    isLoading: boolean;
};
export declare function useMarketStatus(): import("@tanstack/react-query").UseQueryResult<NoInfer<{
    isOpen: boolean;
    status: string;
    isLive: boolean;
    giftNifty: any;
    indicativeNifty: any;
}>, Error>;
interface LiveOptionChainState {
    chain: OptionData[];
    spotPrice: number;
    expiries: ExpiryDate[];
    lotSize: number;
    stepSize: number;
    maxPain: number;
    totalCEOI: number;
    totalPEOI: number;
    isLive: boolean;
    afterHours: boolean;
    source: string;
    cachedAt: string | number | null;
    greeksAvailable?: boolean;
    oiChangeAvailable?: boolean;
    errorMessage?: string | null;
    unsupported?: boolean;
}
export declare function useLiveOptionChain(symbol: string, expiry?: string, enabled?: boolean, underlying?: OptionUnderlying): import("@tanstack/react-query").UseQueryResult<NoInfer<LiveOptionChainState>, Error>;
export declare function useExpiryList(symbol: string, underlying?: OptionUnderlying): import("@tanstack/react-query").UseQueryResult<NoInfer<{
    expiries: ExpiryDate[];
    isLive: boolean;
}>, Error>;
export declare function useAllIndices(): {
    data: {
        isLive: boolean;
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
    };
    isLoading: boolean;
};
export declare function useFnOStocks(): import("@tanstack/react-query").UseQueryResult<NoInfer<{
    gainers: FnOStockData[];
    losers: FnOStockData[];
    mostActive: {
        oi: number;
        oiChange: number;
        oiInterpretation: string;
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
        sector?: string;
    }[];
    allStocks: FnOStockData[];
    isLive: boolean;
    source: "terminal-os";
} | {
    gainers: FnOStockData[];
    losers: FnOStockData[];
    mostActive: {
        oi: number;
        oiChange: number;
        oiInterpretation: string;
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
        sector?: string;
    }[];
    allStocks: FnOStockData[];
    isLive: boolean;
    source: "database";
} | {
    gainers: any[];
    losers: any[];
    mostActive: any[];
    allStocks: FnOStockData[];
    isLive: boolean;
    source: "none";
}>, Error>;
export declare function useStoredCandles(symbol: string, interval?: string): import("@tanstack/react-query").UseQueryResult<NoInfer<{
    symbol: string;
    interval: string;
    lastUpdated: number;
    candles: {
        time: number;
        date: string;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
        oi: number;
    }[];
}>, Error>;
export declare function resetProxyStatus(): void;
/**
 * Invalidate the local price cache so next fetch
 * re-reads from IndexedDB (call after DB update).
 */
export declare function invalidateLocalPriceCache(): void;
export declare function useProxyHealth(): import("@tanstack/react-query").UseQueryResult<any, Error>;
export {};
