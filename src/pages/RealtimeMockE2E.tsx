import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { marketWS, type TickData, type ConnectionState } from "@/lib/terminalRealtimeClient";
import { REALTIME_MOCK_TEST_SCOPE } from "@/lib/realtimeMockTestScope";

const TEST_SECURITY_ID = 13;

export default function RealtimeMockE2E() {
  const [connectionState, setConnectionState] = useState<ConnectionState>(marketWS.state);
  const [tick, setTick] = useState<TickData | null>(marketWS.getLatest(TEST_SECURITY_ID) ?? null);
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
  const heartbeatHealthy = heartbeatTimestamp > 0 && Date.now() - heartbeatTimestamp < 45_000;

  return (
    <main className="space-y-6 p-6" data-testid="realtime-mock-e2e">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Realtime mock verification</h1>
          <p className="mt-1 text-sm text-muted-foreground">Synthetic paper scope · mock provider</p>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={reconnect} title="Disconnect and request a fresh ticket">
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Reconnect
        </Button>
      </header>

      <dl className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-md border p-4">
          <dt className="text-sm text-muted-foreground">Connection</dt>
          <dd data-testid="realtime-state" className="mt-2 font-medium">{connectionState}</dd>
        </div>
        <div className="rounded-md border p-4">
          <dt className="text-sm text-muted-foreground">Heartbeat</dt>
          <dd data-testid="realtime-heartbeat" className="mt-2 font-medium">
            {heartbeatHealthy ? "Healthy" : "Waiting"}
          </dd>
          <time data-testid="realtime-heartbeat-time" className="mt-1 block text-xs text-muted-foreground">
            {heartbeatTimestamp ? new Date(heartbeatTimestamp).toISOString() : ""}
          </time>
        </div>
        <div className="rounded-md border p-4">
          <dt className="text-sm text-muted-foreground">Mock event</dt>
          <dd data-testid="realtime-event" className="mt-2 font-medium">
            {tick ? `${tick.symbol} ${tick.ltp} · ${tick.source}` : "Waiting"}
          </dd>
        </div>
      </dl>
    </main>
  );
}