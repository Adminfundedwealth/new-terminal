import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { marketWS } from "@/lib/terminalRealtimeClient";
import { REALTIME_MOCK_TEST_SCOPE } from "@/lib/realtimeMockTestScope";
const TEST_SECURITY_ID = 13;
export default function RealtimeMockE2E() {
    const [connectionState, setConnectionState] = useState(marketWS.state);
    const [tick, setTick] = useState(marketWS.getLatest(TEST_SECURITY_ID) ?? null);
    const [heartbeatTimestamp, setHeartbeatTimestamp] = useState(marketWS.heartbeatTimestamp);
    useEffect(() => {
        const unsubscribeState = marketWS.onConnectionState(setConnectionState);
        const unsubscribeTick = marketWS.subscribe(TEST_SECURITY_ID, setTick);
        marketWS.start(REALTIME_MOCK_TEST_SCOPE);
        const heartbeatInterval = window.setInterval(() => setHeartbeatTimestamp(marketWS.heartbeatTimestamp), 1000);
        return () => {
            window.clearInterval(heartbeatInterval);
            unsubscribeTick();
            unsubscribeState();
            marketWS.stop();
        };
    }, []);
    const reconnect = () => {
        setTick(null);
        marketWS.disconnect();
        marketWS.start(REALTIME_MOCK_TEST_SCOPE);
    };
    const heartbeatHealthy = heartbeatTimestamp > 0 && Date.now() - heartbeatTimestamp < 45000;
    return (_jsxs("main", { className: "space-y-6 p-6", "data-testid": "realtime-mock-e2e", children: [_jsxs("header", { className: "flex flex-wrap items-center justify-between gap-4", children: [_jsxs("div", { children: [_jsx("h1", { className: "text-2xl font-semibold", children: "Realtime mock verification" }), _jsx("p", { className: "mt-1 text-sm text-muted-foreground", children: "Synthetic paper scope \u00B7 mock provider" })] }), _jsxs(Button, { variant: "outline", size: "sm", className: "gap-2", onClick: reconnect, title: "Disconnect and request a fresh ticket", children: [_jsx(RefreshCw, { className: "h-4 w-4", "aria-hidden": "true" }), "Reconnect"] })] }), _jsxs("dl", { className: "grid gap-4 sm:grid-cols-3", children: [_jsxs("div", { className: "rounded-md border p-4", children: [_jsx("dt", { className: "text-sm text-muted-foreground", children: "Connection" }), _jsx("dd", { "data-testid": "realtime-state", className: "mt-2 font-medium", children: connectionState })] }), _jsxs("div", { className: "rounded-md border p-4", children: [_jsx("dt", { className: "text-sm text-muted-foreground", children: "Heartbeat" }), _jsx("dd", { "data-testid": "realtime-heartbeat", className: "mt-2 font-medium", children: heartbeatHealthy ? "Healthy" : "Waiting" }), _jsx("time", { "data-testid": "realtime-heartbeat-time", className: "mt-1 block text-xs text-muted-foreground", children: heartbeatTimestamp ? new Date(heartbeatTimestamp).toISOString() : "" })] }), _jsxs("div", { className: "rounded-md border p-4", children: [_jsx("dt", { className: "text-sm text-muted-foreground", children: "Mock event" }), _jsx("dd", { "data-testid": "realtime-event", className: "mt-2 font-medium", children: tick ? `${tick.symbol} ${tick.ltp} · ${tick.source}` : "Waiting" })] })] })] }));
}
