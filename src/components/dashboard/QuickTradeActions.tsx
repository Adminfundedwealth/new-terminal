import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { BarChart3, CandlestickChart, Star, TableProperties, TrendingUp } from "lucide-react";

const actions = [
  {
    label: "Stocks",
    icon: TrendingUp,
    path: "/stocks",
    desc: "Equity option chain",
    accent: "text-cyan-600 border-cyan-500/20 bg-cyan-500/[0.045] hover:border-cyan-500/35 dark:text-cyan-400",
  },
  {
    label: "Indices",
    icon: BarChart3,
    path: "/indices",
    desc: "NIFTY / BANKNIFTY",
    accent: "text-emerald-600 border-emerald-500/20 bg-emerald-500/[0.045] hover:border-emerald-500/35 dark:text-emerald-400",
  },
  {
    label: "Option Chain",
    icon: TableProperties,
    path: "/option-chain",
    desc: "NIFTY / BNIFTY chain",
    accent: "text-amber-600 border-amber-500/20 bg-amber-500/[0.045] hover:border-amber-500/35 dark:text-amber-400",
  },
  {
    label: "Futures",
    icon: CandlestickChart,
    path: "/futures",
    desc: "Futures market overview",
    accent: "text-orange-600 border-orange-500/20 bg-orange-500/[0.045] hover:border-orange-500/35 dark:text-orange-400",
  },
  {
    label: "OI Analysis",
    icon: BarChart3,
    path: "/oi-analysis",
    desc: "Call/Put OI trends",
    accent: "text-rose-600 border-rose-500/20 bg-rose-500/[0.045] hover:border-rose-500/35 dark:text-rose-400",
  },
  {
    label: "Watchlist",
    icon: Star,
    path: "/watchlist",
    desc: "Track your scripts",
    accent: "text-violet-600 border-violet-500/20 bg-violet-500/[0.045] hover:border-violet-500/35 dark:text-violet-400",
  },
];

export function QuickTradeActions() {
  const navigate = useNavigate();

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {actions.map((a) => (
        <Card
          key={a.path}
          className={`group relative min-h-[96px] cursor-pointer overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card-hover ${a.accent}`}
          onClick={() => navigate(a.path)}
        >
          <CardContent className="relative z-10 flex h-full flex-col items-center justify-center gap-2 p-3 text-center">
            <div className="rounded-lg border border-border/60 bg-background/45 p-1.5 transition-colors duration-200 group-hover:border-current/25">
              <a.icon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-[13px] font-bold leading-tight">{a.label}</p>
              <p className="mt-1 hidden text-[11px] font-semibold uppercase leading-tight tracking-[0.04em] text-muted-foreground sm:block">
                {a.desc}
              </p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
