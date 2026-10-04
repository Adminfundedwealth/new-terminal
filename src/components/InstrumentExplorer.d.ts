import type { Instrument } from "@/lib/localDatabase";
export type ExplorerAsset = "stocks" | "indices" | "futures";
export interface ExplorerRow {
    symbol: string;
    chartSymbol?: string;
    instrument?: Instrument;
    label: string;
    contract?: string;
    underlying?: string;
    expiry?: string;
    ltp: number | null;
    change: number | null;
    changePercent: number | null;
    open: number | null;
    high: number | null;
    low: number | null;
    volume: number | null;
    oi?: number | null;
    oiChange?: number | null;
    isLive?: boolean;
    searchText?: string;
}
interface ExplorerProps {
    title: string;
    subtitle: string;
    rows: ExplorerRow[];
    asset: ExplorerAsset;
    footerLabel?: string;
    isLoading?: boolean;
    watchedSymbols: string[];
    onToggleWatchlist: (symbol: string) => void;
    onTradeOpen?: (symbol: string) => void;
    activeAccountId?: string | null;
    activeAccountProvider?: string | null;
    searchPlaceholder?: string;
    initialWorkspaceContext?: "stocks" | "options" | "futures";
    initialChartSymbol?: string;
    initialUnderlying?: string;
    initialExpiry?: string;
    initialInstrumentToken?: string;
}
export declare function InstrumentExplorer({ title, subtitle, rows, asset, footerLabel, isLoading, watchedSymbols, onToggleWatchlist, onTradeOpen, activeAccountId, activeAccountProvider, searchPlaceholder, initialWorkspaceContext, initialChartSymbol, initialUnderlying, initialExpiry, initialInstrumentToken, }: ExplorerProps): import("react").JSX.Element;
export {};
