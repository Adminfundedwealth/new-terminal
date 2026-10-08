import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Gauge, Info } from "lucide-react";

// Compact IV Rank badge for inline use
export function IVRankBadge({ ivRank, ivPercentile }: { ivRank: number; ivPercentile: number }) {
  const color = ivRank > 50 ? "text-bearish" : ivRank < 20 ? "text-bullish" : "text-warning";
  const bgColor = ivRank > 50 ? "bg-bearish/10 border-bearish/20" : ivRank < 20 ? "bg-bullish/10 border-bullish/20" : "bg-warning/10 border-warning/20";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className={`text-[11px] font-mono gap-1 ${bgColor} ${color} cursor-help`}>
          IVR {ivRank}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        <p>IV Rank: {ivRank}% | IV Percentile: {ivPercentile}%</p>
        <p className="text-muted-foreground">{ivRank > 50 ? "IV is elevated — good for selling" : "IV is low — good for buying"}</p>
      </TooltipContent>
    </Tooltip>
  );
}

// Compact card widget
export function IVRankCard({ symbol, currentIV }: { symbol: string; currentIV: number }) {
  return (
    <Card>
      <CardContent className="pt-3 pb-3">
        <div className="flex items-center gap-1.5 mb-1">
          <Gauge className="h-3.5 w-3.5 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">{symbol} IV Rank</p>
        </div>
        <p className="text-lg font-bold font-mono text-muted-foreground">Unavailable</p>
        <div className="mt-1.5">
          <p className="text-[11px] text-muted-foreground">
            {Number.isFinite(currentIV) && currentIV > 0
              ? `Current volatility: ${currentIV.toFixed(2)}. Verified historical IV is not available.`
              : "No current volatility quote or verified historical IV is available."}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// Full IV Rank dashboard widget
export function IVRankDashboard() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Gauge className="h-4 w-4 text-primary" />
          IV Rank & Percentile Scanner
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-3 w-3 text-muted-foreground cursor-help" />
            </TooltipTrigger>
            <TooltipContent className="text-xs max-w-[250px]">
              <p><strong>IV Rank</strong>: Where current IV sits in the 52-week range (0=low, 100=high).</p>
              <p className="mt-1"><strong>IV Percentile</strong>: % of trading days IV was below current level.</p>
              <p className="mt-1"><strong>VRP</strong>: Volatility Risk Premium (IV - HV). Positive = sellers have edge.</p>
            </TooltipContent>
          </Tooltip>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">
          IV rank, percentile, and volatility risk premium require verified historical implied-volatility data. No history is currently available, so these metrics are not displayed.
        </p>
      </CardContent>
    </Card>
  );
}
