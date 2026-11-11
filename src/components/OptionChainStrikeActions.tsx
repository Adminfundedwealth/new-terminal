import { BarChart3, TrendingDown, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";

type OptionType = "CE" | "PE";

export function OptionChainStrikeActions({
  strike,
  onChart,
  onBuy,
  onSell,
}: {
  strike: number;
  onChart: (type: OptionType) => void;
  onBuy: (type: OptionType) => void;
  onSell: (type: OptionType) => void;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5 mt-1">
      {([
        { type: "CE", label: "CALL", sideClass: "text-primary" },
        { type: "PE", label: "PUT", sideClass: "text-bearish" },
      ] as const).map(({ type, label, sideClass }) => (
        <div
          key={type}
          role="group"
          aria-label={`${strike} ${label} (${type}) actions`}
          className="flex items-center justify-center gap-0.5"
        >
          <span className={`w-5 text-left text-[9px] font-bold ${sideClass}`}>{type}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-0.5 px-1 text-[9px] text-primary hover:bg-primary/10 hover:text-primary"
            onClick={() => onChart(type)}
            title={`Chart ${strike} ${type}`}
            aria-label={`Chart ${strike} ${type}`}
          >
            <BarChart3 className="h-3 w-3" aria-hidden="true" />
            Chart
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-0.5 px-1 text-[9px] text-bullish hover:bg-bullish/10 hover:text-bullish"
            onClick={() => onBuy(type)}
            title={`Buy ${strike} ${type}`}
            aria-label={`Buy ${strike} ${type}`}
          >
            <TrendingUp className="h-3 w-3" aria-hidden="true" />
            Buy
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-0.5 px-1 text-[9px] text-bearish hover:bg-bearish/10 hover:text-bearish"
            onClick={() => onSell(type)}
            title={`Sell ${strike} ${type}`}
            aria-label={`Sell ${strike} ${type}`}
          >
            <TrendingDown className="h-3 w-3" aria-hidden="true" />
            Sell
          </Button>
        </div>
      ))}
    </div>
  );
}
