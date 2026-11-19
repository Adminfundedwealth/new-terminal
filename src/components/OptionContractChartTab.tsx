import { StockChart } from "@/components/StockChart";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { TerminalMarketDataInstrument } from "@/lib/terminalApi";

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
  lotSize: number;
  instrument: TerminalMarketDataInstrument;
};

export function OptionContractChartTab({
  tab,
  onBuy,
  onSell,
  fill = false,
}: {
  tab: ChartTab;
  onBuy: () => void;
  onSell: () => void;
  fill?: boolean;
}) {
  return (
    <div className={fill ? "flex h-full min-h-0 flex-1 flex-col gap-2" : "flex flex-col gap-3"}>
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
          <span className="text-[10px] text-muted-foreground font-mono">
            ID {tab.securityId} · Lot {tab.lotSize}
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
      <div className={fill ? "min-h-0 flex-1" : "h-[min(70dvh,720px)] min-h-[320px]"}>
        <StockChart
          symbol={tab.tradingSymbol}
          selectedInstrument={tab.instrument}
          onBuy={onBuy}
          onSell={onSell}
          inline
          fill={fill}
          showInstrumentLabel={false}
          showTradeActions={false}
          unavailableMessage="Historical OHLC for this contract is loading…"
        />
      </div>
    </div>
  );
}
