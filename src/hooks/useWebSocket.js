import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccountContext } from "@/hooks/useAccountContext";
import { SYMBOL_TO_SECURITY_ID } from "@/lib/websocketClient";
import { marketWS } from "@/lib/terminalRealtimeClient";
import { reconnectTerminalMarketDataStreams, resolveTerminalMarketDataProvider, subscribeToTerminalMarketDataStream, } from "@/lib/terminalApi";
const INDEX_SYMBOLS = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"];
const REALTIME_SYMBOLS = [...INDEX_SYMBOLS, "INDIAVIX"];
function toConnectionState(status) {
    if (status === "connected")
        return "CONNECTED";
    if (status === "connecting")
        return "CONNECTING";
    if (status === "reconnecting")
        return "RECONNECTING";
    return "DISCONNECTED";
}
function useTerminalTicks(symbols) {
    const { activeAccountId, accounts } = useAccountContext();
    const activeAccount = accounts.find((account) => account.id === activeAccountId);
    const provider = resolveTerminalMarketDataProvider(activeAccount?.broker_provider);
    const symbolsKey = symbols.join(",");
    const [ticks, setTicks] = useState({});
    const [state, setState] = useState("DISCONNECTED");
    useEffect(() => {
        setTicks({});
        if (!activeAccountId || !provider) {
            setState("DISCONNECTED");
            return;
        }
        const subscribedSymbols = symbolsKey.split(",").filter(Boolean);
        if (import.meta.env.VITE_REALTIME_URL?.trim()) {
            const unsubscribers = subscribedSymbols.flatMap((symbol) => {
                const securityId = SYMBOL_TO_SECURITY_ID[symbol];
                return securityId ? [marketWS.subscribe(securityId, (tick) => setTicks((current) => ({ ...current, [symbol]: tick })))] : [];
            });
            const unsubscribeState = marketWS.onConnectionState(setState);
            return () => {
                unsubscribers.forEach((unsubscribe) => unsubscribe());
                unsubscribeState();
            };
        }
        return subscribeToTerminalMarketDataStream(activeAccountId, provider, subscribedSymbols, (event) => {
            const securityId = SYMBOL_TO_SECURITY_ID[event.symbol];
            if (!securityId)
                return;
            const quote = event.quote;
            const tick = {
                type: "ticker",
                securityId,
                symbol: event.symbol,
                exchangeSegment: quote.exchange,
                ltp: quote.ltp,
                change: quote.change ?? undefined,
                changePercent: quote.changePercent ?? undefined,
                open: quote.open ?? undefined,
                high: quote.high ?? undefined,
                low: quote.low ?? undefined,
                prevClose: quote.previousClose ?? undefined,
                volume: quote.volume ?? undefined,
                oi: quote.openInterest ?? undefined,
                timestamp: Date.parse(quote.timestamp),
                source: provider === "kite" ? "zerodha" : "dhan",
                provider: provider === "kite" ? "zerodha" : "dhan",
                connected: true,
            };
            setTicks((current) => ({ ...current, [event.symbol]: tick }));
        }, (status) => setState(toConnectionState(status)));
    }, [activeAccountId, provider, symbolsKey]);
    return { ticks, state, isConnected: state === "CONNECTED" };
}
export function useWebSocketStatus() {
    return useTerminalTicks(REALTIME_SYMBOLS).isConnected;
}
export function useWebSocketConnectionState() {
    return useTerminalTicks(REALTIME_SYMBOLS).state;
}
export function useWebSocketTick(symbol) {
    const { ticks } = useTerminalTicks([symbol]);
    return ticks[symbol] ?? null;
}
const INDEX_NAMES = {
    NIFTY: "NIFTY 50",
    BANKNIFTY: "NIFTY BANK",
    FINNIFTY: "NIFTY FINANCIAL SERVICES",
    MIDCPNIFTY: "NIFTY MIDCAP 50",
};
export function useWebSocketIndices() {
    const { ticks, isConnected } = useTerminalTicks(INDEX_SYMBOLS);
    const indices = useMemo(() => {
        const result = [];
        for (const [symbol, name] of Object.entries(INDEX_NAMES)) {
            const tick = ticks[symbol];
            if (tick?.ltp) {
                result.push({
                    symbol,
                    name,
                    ltp: tick.ltp,
                    change: tick.change || 0,
                    changePercent: tick.changePercent || 0,
                    open: tick.open || tick.ltp,
                    high: tick.high || tick.ltp,
                    low: tick.low || tick.ltp,
                    prevClose: tick.prevClose || tick.close || tick.ltp,
                });
            }
        }
        return result;
    }, [ticks]);
    return { indices, isConnected };
}
export function useWebSocketVix() {
    const { ticks, isConnected } = useTerminalTicks(["INDIAVIX"]);
    const tick = ticks.INDIAVIX;
    const vix = useMemo(() => {
        if (!tick?.ltp)
            return null;
        return {
            value: tick.ltp,
            change: tick.change || 0,
            changePercent: tick.changePercent || 0,
            high: tick.high || tick.ltp,
            low: tick.low || tick.ltp,
        };
    }, [tick]);
    return { vix, isConnected };
}
// ── Hook: Force reconnect ──
export function useWebSocketReconnect() {
    return useCallback(() => reconnectTerminalMarketDataStreams(), []);
}
