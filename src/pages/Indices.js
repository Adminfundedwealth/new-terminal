import { jsx as _jsx } from "react/jsx-runtime";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLiveIndices } from "@/hooks/useMarketData";
import { useAccountContext } from "@/hooks/useAccountContext";
import { InstrumentExplorer } from "@/components/InstrumentExplorer";
import { getSavedWatchlist, saveWatchlist } from "@/lib/watchlist";
export default function Indices() {
    const navigate = useNavigate();
    const { activeAccountId } = useAccountContext();
    const [watchedSymbols, setWatchedSymbols] = useState(() => getSavedWatchlist());
    const { data, isLoading } = useLiveIndices();
    const rows = useMemo(() => {
        return (data?.data || []).map((index) => ({
            symbol: index.symbol,
            chartSymbol: index.name === "NIFTY MIDCAP 50" ? "NIFTY_MIDCAP_50" : undefined,
            label: index.name || index.symbol,
            ltp: index.ltp,
            change: index.change,
            changePercent: index.changePercent,
            open: index.open,
            high: index.high,
            low: index.low,
            volume: null,
            searchText: `${index.symbol} ${index.name || ""}`,
        }));
    }, [data]);
    const handleWatchlistToggle = (symbol) => {
        const next = watchedSymbols.includes(symbol) ? watchedSymbols.filter((entry) => entry !== symbol) : [...watchedSymbols, symbol];
        setWatchedSymbols(next);
        saveWatchlist(next);
    };
    return (_jsx("main", { className: "mx-auto flex h-full min-h-0 w-full max-w-[1500px] flex-col p-3 sm:p-5", children: _jsx(InstrumentExplorer, { title: "Indices", subtitle: "NIFTY, BANKNIFTY, FINNIFTY and other cash index quotes.", asset: "indices", rows: rows, isLoading: isLoading, watchedSymbols: watchedSymbols, onToggleWatchlist: handleWatchlistToggle, activeAccountId: activeAccountId, onTradeOpen: (symbol) => navigate(`/option-chain?symbol=${symbol}`), footerLabel: "indices", searchPlaceholder: "Search indices..." }) }));
}
