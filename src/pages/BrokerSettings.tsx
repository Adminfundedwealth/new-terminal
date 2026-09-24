import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { testDhanConnection } from "@/lib/marketApi";
import { useProxyHealth } from "@/hooks/useMarketData";
import { useWebSocketStatus } from "@/hooks/useWebSocket";
import {
  Shield, ExternalLink, CheckCircle2, Circle, Key, Plug, AlertTriangle,
  Server, Zap, Globe, BarChart3, Loader2, CheckCircle, XCircle, Wifi,
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
  const { data: health } = useProxyHealth();
  const wsConnected = useWebSocketStatus();
  const [dhanStatus, setDhanStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [dhanMessage, setDhanMessage] = useState("");

  const handleTestDhan = async () => {
    setDhanStatus("testing");
    try {
      const result = await testDhanConnection();
      if (result.status === "success") {
        setDhanStatus("success");
        setDhanMessage("Connected successfully");
        toast.success("Dhan API connection verified!");
      } else {
        setDhanStatus("error");
        setDhanMessage(result.message || "Connection failed");
        toast.error("Dhan connection failed: " + result.message);
      }
    } catch (e: any) {
      setDhanStatus("error");
      setDhanMessage(e.message || "Network error");
      toast.error("Connection test failed");
    }
  };

  const sources = [
    {
      name: "Dhan API (Primary)",
      icon: <Wifi className="h-4 w-4" />,
      status: dhanStatus === "success" ? "online" : dhanStatus === "error" ? "offline" : health?.sources?.dhan ? "online" : "unknown",
      detail: dhanStatus === "success"
        ? "Primary source · Option Chain, Greeks, WebSocket"
        : health?.sources?.dhan
        ? "Credentials loaded from .env · Option Chain, Expiry, WebSocket"
        : dhanMessage || "Click Test to verify — provides Option Chain, Greeks, Live Ticks",
      color: dhanStatus === "success" || health?.sources?.dhan ? "text-emerald-500" : dhanStatus === "error" ? "text-red-500" : "text-zinc-500",
    },
    {
      name: "Dhan WebSocket",
      icon: <Zap className="h-4 w-4" />,
      status: wsConnected ? "online" : "offline",
      detail: wsConnected
        ? `Live ticks · ${health?.websocket?.cachedTicks || 0} cached, ${health?.websocket?.instrumentsSubscribed || 0} instruments`
        : "Requires Dhan credentials · Real-time index + VIX ticks",
      color: wsConnected ? "text-emerald-500" : "text-zinc-500",
    },
    {
      name: "NSE India (Fallback)",
      icon: <Globe className="h-4 w-4" />,
      status: health?.reachable ? "online" : "offline",
      detail: "Fallback · Indices, Sectors, A/D, Option Chain if Dhan fails",
      color: health?.reachable ? "text-emerald-500" : "text-red-500",
    },
    {
      name: "TradingView Scanner",
      icon: <BarChart3 className="h-4 w-4" />,
      status: "online",
      detail: "No auth needed · 100+ F&O stocks LTP, Volume, Sectors",
      color: "text-emerald-500",
    },
    {
      name: "Proxy Server",
      icon: <Server className="h-4 w-4" />,
      status: health?.reachable ? "online" : "offline",
      detail: health?.reachable ? `Uptime: ${Math.floor((health.uptime || 0) / 60)}min · Routes all API traffic` : "Not reachable — run: npm run dev",
      color: health?.reachable ? "text-emerald-500" : "text-red-500",
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
