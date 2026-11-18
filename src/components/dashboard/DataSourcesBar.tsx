import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCentralMarketDataStatus, useAllIndices, useFnOStocks, useLiveIndices, useLiveOptionChain } from "@/hooks/useMarketData";
import { useWebSocketStatus, useWebSocketVix } from "@/hooks/useWebSocket";
import { Activity, Zap, Radio, TrendingUp, BarChart3 } from "lucide-react";

interface SourceStatus {
  name: string;
  icon: React.ReactNode;
  status: "live" | "degraded" | "offline";
  detail?: string;
  primary?: boolean;
}

export function DataSourcesBar() {
  const { data: health, isError: healthFailed } = useCentralMarketDataStatus();
  const { data: allIndices } = useAllIndices();
  const liveIndices = useLiveIndices();
  const { data: fnoData, isError: fnoFailed } = useFnOStocks();
  const { data: niftyOC } = useLiveOptionChain("NIFTY");
  const wsConnected = useWebSocketStatus();
  const { vix: wsVix } = useWebSocketVix();

  const dhanConfigured = health?.configured === true;
  const dhanConnected = health?.is_connected === true;
  const fnoSource = fnoData?.source ?? "none";
  const ocSource = niftyOC?.source || "offline";
  const hasIndexData = liveIndices.data.data.length > 0;
  const hasFnoData = (fnoData?.allStocks.length ?? 0) > 0;

  const sources: SourceStatus[] = [
    {
      name: "Dhan API",
      icon: <TrendingUp className="h-3 w-3" />,
      status: dhanConnected
        ? health?.market_session?.is_live ? "live" : "degraded"
        : "offline",
      detail: healthFailed
        ? "Central market-data status unavailable"
        : !dhanConfigured
        ? "Founder Dhan credentials are not configured"
        : !dhanConnected
        ? health?.last_test_result || "Central Dhan connection is not verified"
        : health?.market_session?.is_live
        ? `Connected · live market data${ocSource === "dhan" ? " · option chain ready" : ""}`
        : `Connected · ${health?.market_session?.state ?? "market-data freshness unverified"}`,
      primary: true,
    },
    {
      name: "Central Stream",
      icon: <Zap className="h-3 w-3" />,
      status: wsConnected ? "live" : dhanConnected ? "degraded" : "offline",
      detail: wsConnected
        ? "Customer terminal connected to central realtime market data"
        : "Customer terminal is not connected to the central realtime stream",
    },
    {
      name: "Index Quotes",
      icon: <Radio className="h-3 w-3" />,
      status: hasIndexData ? liveIndices.data.isLive ? "live" : "degraded" : "offline",
      detail: hasIndexData
        ? `${liveIndices.data.data.length} central Dhan index quotes${liveIndices.data.isLive ? " · fresh" : " · not confirmed live"}`
        : "No central index quotes available",
    },
    {
      name: "F&O Quotes",
      icon: <BarChart3 className="h-3 w-3" />,
      status: hasFnoData ? fnoData?.isLive ? "live" : "degraded" : "offline",
      detail: hasFnoData
        ? `${fnoData?.allStocks.length} central Dhan F&O stocks${fnoData?.isLive ? " · fresh" : " · not confirmed live"}`
        : fnoFailed
        ? "Central Dhan F&O request failed"
        : fnoSource === "dhan" ? "No F&O quotes returned by central Dhan" : "No central F&O quotes available",
    },
    {
      name: "VIX",
      icon: <Activity className="h-3 w-3" />,
      status: wsVix
        ? health?.market_session?.is_live ? "live" : "degraded"
        : allIndices?.vix ? "degraded" : "offline",
      detail: wsVix
        ? `Central stream: ${wsVix.value.toFixed(2)}${health?.market_session?.is_live ? "" : " · not confirmed live"}`
        : allIndices?.vix
        ? `Central snapshot: ${allIndices.vix.value.toFixed(2)} · not confirmed live`
        : "No data",
    },
  ];

  const liveCount = sources.filter(s => s.status === "live").length;
  const totalCount = sources.length;

  const statusColor = (s: SourceStatus["status"]) => {
    switch (s) {
      case "live": return "bg-emerald-500";
      case "degraded": return "bg-amber-500";
      case "offline": return "bg-red-500";
    }
  };

  const statusTextColor = (s: SourceStatus["status"]) => {
    switch (s) {
      case "live": return "text-emerald-400";
      case "degraded": return "text-amber-400";
      case "offline": return "text-red-400";
    }
  };

  const statusLabel = (s: SourceStatus["status"]) => {
    switch (s) {
      case "live": return "Connected";
      case "degraded": return "Partial";
      case "offline": return "Offline";
    }
  };

  return (
    <div className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-card/60 border border-border/50 backdrop-blur-sm overflow-x-auto">
      {/* Overall status indicator */}
      <div className="flex items-center gap-1.5 mr-2 pr-2 border-r border-border/30 shrink-0">
        <div className={`h-2 w-2 rounded-full ${liveCount >= 4 ? "bg-emerald-500 animate-pulse" : liveCount >= 2 ? "bg-amber-500 animate-pulse" : "bg-red-500"}`} />
        <span className="text-xs font-semibold text-muted-foreground whitespace-nowrap">
          {liveCount}/{totalCount} Sources
        </span>
      </div>

      {/* Individual sources */}
      {sources.map((src) => (
        <Tooltip key={src.name}>
          <TooltipTrigger asChild>
            <div className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium cursor-default transition-all duration-200 shrink-0 ${
              src.primary 
                ? src.status === "live"
                  ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
                  : src.status === "degraded"
                  ? "bg-amber-500/10 border border-amber-500/20 text-amber-400"
                  : "bg-red-500/5 border border-red-500/10 text-red-400"
                : `${statusTextColor(src.status)} hover:bg-accent/30`
            }`}>
              <div className={`h-1.5 w-1.5 rounded-full shrink-0 ${statusColor(src.status)} ${src.status === "live" ? "animate-pulse" : ""}`} />
              {src.icon}
              <span className="hidden sm:inline whitespace-nowrap">{src.name}</span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-sm max-w-[280px]">
            <div className="space-y-1">
              <div className="flex items-center gap-1.5">
                <div className={`h-2 w-2 rounded-full shrink-0 ${statusColor(src.status)}`} />
                <span className="font-semibold">{src.name}</span>
                <Badge variant="outline" className={`text-xs h-5 px-1.5 ${statusTextColor(src.status)}`}>
                  {statusLabel(src.status)}
                </Badge>
              </div>
              <p className="text-muted-foreground text-xs leading-snug">{src.detail}</p>
            </div>
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
