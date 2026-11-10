import { StockChart } from "@/components/StockChart";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export type ChartTab = {
  id: string;
  label: string;
  tradingSymbol: string;
  underlying: string;
  strike: number;
  optionType: "CE" | "PE";
  expiry: string;
  securityId: string;
  exchangeSegment: string;
};

export function OptionContractChartTab({
  tab,
  onBuy,
  onSell,
}: {
  tab: ChartTab;
  onBuy: () => void;
  onSell: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold">{tab.label}</span>
          <Badge variant="outline" className="text-[10px]">
            {tab.exchangeSegment}
          </Badge>
          <span className="text-xs text-muted-foreground font-mono">
            {tab.underlying} · {tab.strike.toLocaleString("en-IN")} · {tab.optionType} · {tab.expiry}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            variant="default"
            className="h-7 text-xs bg-primary"
            onClick={onBuy}
          >
            Buy
          </Button>
          <Button
            size="sm"
            variant="destructive"
            className="h-7 text-xs"
            onClick={onSell}
          >
            Sell
          </Button>
        </div>
      </div>

      {/* Chart */}
      <div className="h-[600px] min-h-[400px]">
        <StockChart
          symbol={tab.tradingSymbol}
          inline
          fill
          candleOnly
          unavailableMessage="Historical OHLC for this contract is loading…"
        />
      </div>
    </div>
  );
}
