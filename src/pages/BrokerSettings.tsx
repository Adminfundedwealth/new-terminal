import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  BROKERS,
  getSavedBrokers,
  getActiveBroker,
  saveBrokerCredentials,
  setActiveBroker,
  type BrokerInfo,
  type BrokerCredentials,
} from "@/lib/brokerConfig";
import { fetchTerminalMarketDataStatus } from "@/lib/terminalApi";
import { useCentralMarketDataStatus, useFnOStocks } from "@/hooks/useMarketData";
import { useWebSocketStatus } from "@/hooks/useWebSocket";
import {
  Shield, ExternalLink, CheckCircle2, Circle, Key, Plug, AlertTriangle,
  Zap, BarChart3, Loader2, CheckCircle, XCircle, Wifi,
} from "lucide-react";
import { DatabaseManager } from "@/components/DatabaseManager";
import { ChartDataDownloader } from "@/components/ChartDataDownloader";

function BrokerCard({
  broker,
  saved,
  isActive,
  onSetActive,
}: {
  broker: BrokerInfo;
  saved?: BrokerCredentials;
  isActive: boolean;
  onSetActive: (brokerId: string) => void;
}) {
  return (
    <Card className={`transition-all duration-200 ${isActive ? "ring-2 ring-primary shadow-lg" : "hover:shadow-md"}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{broker.logo}</span>
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                {broker.name}
                {saved && (
                  <Badge variant={isActive ? "default" : "secondary"} className="text-2xs">
                    {isActive ? "Active" : "Configured"}
                  </Badge>
                )}
              </CardTitle>
              <CardDescription className="text-xs mt-0.5">{broker.description}</CardDescription>
            </div>
          </div>
          <a href={broker.docsUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors">
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>

        <div className="flex flex-wrap gap-1.5 mt-2">
          {broker.features.map((f) => (
            <Badge key={f} variant="outline" className="text-2xs font-normal">
              {f}
            </Badge>
          ))}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {saved ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-amber-500" />
              <span>{broker.fields.filter((f) => f.required).length} keys configured</span>
              <span className="text-2xs">• Added {new Date(saved!.addedAt).toLocaleDateString("en-IN")}</span>
            </div>
            <div className="flex gap-2">
              {broker.id === "zerodha" && (
                <Button size="sm" variant="outline" onClick={() => window.location.assign("/api/kite/login")}>
                  Connect with Kite OAuth
                </Button>
              )}
              {!isActive && (
                <Button size="sm" variant="outline" onClick={() => onSetActive(broker.id)} className="flex-1">
                  <Circle className="h-3.5 w-3.5 mr-1.5" />
                  Set Active
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>Credentials are configured in the local proxy environment.</p>
            {broker.id === "zerodha" && (
              <Button size="sm" variant="outline" className="w-full" onClick={() => window.location.assign("/api/kite/login")}>
                Connect with Kite OAuth
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ConnectionStatusPanel() {
  const { data: health } = useCentralMarketDataStatus();
  const { data: fnoData, isError: fnoFailed } = useFnOStocks();
  const wsConnected = useWebSocketStatus();
  const [dhanStatus, setDhanStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [dhanMessage, setDhanMessage] = useState("");

  const handleTestDhan = async () => {
    setDhanStatus("testing");
    try {
      const result = await fetchTerminalMarketDataStatus(null, "dhan", "production");
      if (!result.configured) {
        setDhanStatus("error");
        setDhanMessage("Founder Dhan credentials are not configured in Terminal OS.");
        toast.error("Central Dhan credentials are not configured.");
      } else if (result.is_connected) {
        setDhanStatus("success");
        setDhanMessage(result.market_session?.is_live
          ? "Central Dhan connection verified; fresh market data is available."
          : `Central Dhan connection verified; market state: ${result.market_session?.state ?? "unverified"}.`);
        toast.success("Central Dhan API connection verified.");
      } else {
        setDhanStatus("error");
        setDhanMessage(result.last_test_result || "Central Dhan connection is not verified.");
        toast.error("Central Dhan connection is not verified.");
      }
    } catch (error: unknown) {
      setDhanStatus("error");
      setDhanMessage(error instanceof Error ? error.message : "The central market-data status request failed.");
      toast.error("Central Dhan status check failed.");
    }
  };

  const dhanConnected = health?.configured === true && health.is_connected === true;
  const fnoCount = fnoData?.allStocks.length ?? 0;

  const sources = [
    {
      name: "Dhan API (Central)",
      icon: <Wifi className="h-4 w-4" />,
      status: dhanStatus === "success" || (dhanStatus === "idle" && dhanConnected)
        ? "online"
        : dhanStatus === "error" || (health?.configured && !health.is_connected) ? "offline" : "unknown",
      detail: dhanStatus === "success"
        ? dhanMessage
        : dhanMessage || (dhanConnected
          ? `Central credentials verified · ${health.market_session?.state ?? "market state unverified"}`
          : health?.configured
          ? health.last_test_result || "Central Dhan connection is not verified"
          : "Founder Dhan credentials are not configured"),
      color: dhanStatus === "success" || (dhanStatus === "idle" && dhanConnected)
        ? "text-emerald-500"
        : dhanStatus === "error" || (health?.configured && !health.is_connected) ? "text-red-500" : "text-zinc-500",
    },
    {
      name: "Central Realtime Stream",
      icon: <Zap className="h-4 w-4" />,
      status: wsConnected ? "online" : "offline",
      detail: wsConnected
        ? "Customer terminal connected to central realtime market data"
        : "Customer terminal is not connected to the central realtime stream",
      color: wsConnected ? "text-emerald-500" : "text-zinc-500",
    },
    {
      name: "Central F&O Quotes",
      icon: <BarChart3 className="h-4 w-4" />,
      status: fnoData?.isLive ? "online" : fnoCount ? "unknown" : "offline",
      detail: fnoCount
        ? `${fnoCount} central Dhan F&O stocks${fnoData?.isLive ? " · fresh quotes" : " · freshness not confirmed"}`
        : fnoFailed ? "Central Dhan F&O request failed" : "No central Dhan F&O quotes available",
      color: fnoData?.isLive ? "text-emerald-500" : fnoCount ? "text-zinc-500" : "text-red-500",
    },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Wifi className="h-4 w-4 text-primary" />
          Connection Status
          <Badge variant="outline" className="text-2xs ml-auto">
            {sources.filter(s => s.status === "online").length}/{sources.length} Online
          </Badge>
        </CardTitle>
        <CardDescription className="text-xs">Real-time status of all data sources</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {sources.map((src) => (
          <div key={src.name} className="flex items-center gap-3 p-2 rounded-md bg-accent/20">
            <div className={src.color}>{src.icon}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium">{src.name}</span>
                <div className={`h-1.5 w-1.5 rounded-full ${
                  src.status === "online" ? "bg-emerald-500" :
                  src.status === "offline" ? "bg-red-500" : "bg-zinc-500"
                }`} />
              </div>
              <p className="text-xs text-muted-foreground truncate">{src.detail}</p>
            </div>
            {src.name.startsWith("Dhan API") && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1"
                onClick={handleTestDhan}
                disabled={dhanStatus === "testing"}
              >
                {dhanStatus === "testing" ? (
                  <><Loader2 className="h-3 w-3 animate-spin" /> Testing</>
                ) : dhanStatus === "success" ? (
                  <><CheckCircle className="h-3 w-3 text-emerald-500" /> Connected</>
                ) : dhanStatus === "error" ? (
                  <><XCircle className="h-3 w-3 text-red-500" /> Retry</>
                ) : (
                  <>Test</>
                )}
              </Button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function DhanControlCenter() {
  const [clientId, setClientId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [running, setRunning] = useState(false);
  const [stages, setStages] = useState<Record<string, { status: string; detail: string }>>({});
  const [message, setMessage] = useState("");

  const control = async (action: "save" | "test" | "initialize" | "reinitialize" | "reconnect") => {
    setRunning(true);
    setMessage("");
    try {
      const response = await fetch("/api/dhan/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "save"
          ? { action, clientId, accessToken }
          : { action, ...(clientId ? { clientId } : {}), ...(accessToken ? { accessToken } : {}) }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Dhan control action failed.");
      if (payload.stages) setStages(payload.stages);
      setMessage(payload.message || (payload.success ? "Dhan action completed." : "Dhan action requires attention."));
      toast.success(payload.message || "Dhan action completed.");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Dhan control action failed.";
      setMessage(detail);
      toast.error(detail);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Key className="h-5 w-5" />
          Dhan Central Market-Data Control
        </CardTitle>
        <CardDescription>
          Save and initialize the canonical Dhan market-data infrastructure.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <Input value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder="Dhan Client ID" autoComplete="off" />
          <Input value={accessToken} onChange={(event) => setAccessToken(event.target.value)} placeholder="Dhan Access Token" type="password" autoComplete="off" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => control("save")} disabled={running || !clientId.trim() || !accessToken.trim()}>
            {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Shield className="mr-2 h-4 w-4" />}
            Save Keys
          </Button>
          <Button variant="outline" onClick={() => control("test")} disabled={running}>Test Authentication</Button>
          <Button variant="outline" onClick={() => control("initialize")} disabled={running}>Initialize Infrastructure</Button>
          <Button variant="outline" onClick={() => control("reinitialize")} disabled={running}>Reinitialize Safely</Button>
          <Button variant="outline" onClick={() => control("reconnect")} disabled={running}>Reconnect WebSocket</Button>
        </div>
        {message && (
          <div className="rounded-md border p-3 text-sm text-muted-foreground">{message}</div>
        )}
        {Object.keys(stages).length > 0 && (
          <div className="grid gap-2 md:grid-cols-2">
            {Object.entries(stages).map(([name, stage]) => (
              <div key={name} className="flex items-start gap-2 rounded-md border p-3">
                {stage.status === "operational"
                  ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-500" />
                  : <XCircle className="mt-0.5 h-4 w-4 text-red-500" />}
                <div>
                  <p className="text-sm font-medium">{name}</p>
                  <p className="text-xs text-muted-foreground">{stage.detail}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function BrokerSettings() {
  const [savedBrokers, setSavedBrokers] = useState(getSavedBrokers());
  const activeBroker = getActiveBroker();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("kite") !== "connected") return;
    saveBrokerCredentials({
      brokerId: "zerodha",
      values: {},
      addedAt: new Date().toISOString(),
      isActive: true,
    });
    setActiveBroker("zerodha");
    setSavedBrokers(getSavedBrokers());
    window.history.replaceState({}, "", "/broker-settings");
  }, []);


  const handleSetActive = (brokerId: string) => {
    setActiveBroker(brokerId);
    setSavedBrokers(getSavedBrokers());
    toast.success(`${BROKERS.find((b) => b.id === brokerId)?.name} is now active`);
  };

  const connectedIds = savedBrokers.map((b) => b.brokerId);
  const availableBrokers = BROKERS.filter((b) => !connectedIds.includes(b.id));
  const connectedBrokers = BROKERS.filter((b) => connectedIds.includes(b.id));

  return (
    <div className="space-y-6 p-1">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Plug className="h-6 w-6 text-primary" />
          Broker API Settings
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Connect broker accounts through the local proxy. Broker secrets must be configured on the server, never in the browser.
        </p>
      </div>

      {/* Security Notice */}
      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardContent className="flex items-start gap-3 py-3">
          <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-foreground">Security Notice</p>
              <p className="text-muted-foreground text-xs mt-0.5">
                This browser does not persist or forward broker secrets. Configure provider credentials in the proxy server environment and use read-only tokens when available.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Connection Status Panel */}
      <ConnectionStatusPanel />
      <DhanControlCenter />

      {/* Database Manager */}
      <DatabaseManager />

      {/* Chart Data Downloader */}
      <ChartDataDownloader />

      <Tabs defaultValue={connectedBrokers.length > 0 ? "connected" : "available"}>
        <TabsList>
          <TabsTrigger value="connected" className="gap-1.5">
            <Shield className="h-3.5 w-3.5" />
            Configured ({connectedBrokers.length})
          </TabsTrigger>
          <TabsTrigger value="available" className="gap-1.5">
            <Plug className="h-3.5 w-3.5" />
            Available ({availableBrokers.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="connected" className="mt-4">
          {connectedBrokers.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center">
                <Key className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No brokers connected yet</p>
                <p className="text-xs text-muted-foreground/60 mt-1">Switch to "Available" tab to configure a broker</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {connectedBrokers.map((broker) => (
                <BrokerCard
                  key={broker.id}
                  broker={broker}
                  saved={savedBrokers.find((s) => s.brokerId === broker.id)}
                  isActive={activeBroker?.brokerId === broker.id}
                  onSetActive={handleSetActive}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="available" className="mt-4">
          <div className="grid gap-4 md:grid-cols-2">
            {availableBrokers.map((broker) => (
              <BrokerCard
                key={broker.id}
                broker={broker}
                isActive={false}
                onSetActive={handleSetActive}
              />
            ))}
          </div>
        </TabsContent>
      </Tabs>

      {/* How It Works */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">How It Works</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              { step: "1", title: "Configure the proxy", desc: "Set provider credentials in the local server environment" },
              { step: "2", title: "Verify the connection", desc: "Use the status panel to confirm the server-side provider connection" },
              { step: "3", title: "Live Data Flows", desc: "Option chain, LTP, Greeks, and OI update in real-time" },
            ].map((s) => (
              <div key={s.step} className="flex gap-3">
                <div className="h-7 w-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-bold shrink-0">
                  {s.step}
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{s.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
