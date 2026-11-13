import { RefreshCw, X } from "lucide-react";
import type { OptionContract } from "@/components/OptionOrderPopup";
import { Button } from "@/components/ui/button";
import { describeDepthError, optionContractToMarketInstrument, useMarketDepth } from "@/hooks/useOptionMarketDepth";
import { DASH, fmtInt, fmtNum, fmtSigned, toneClass } from "@/lib/optionChainAnalytics";
import type { TerminalMarketDepthLevel } from "@/lib/terminalApi";

const LEVELS = 5;

function DepthRows({ bids, asks }: { bids: TerminalMarketDepthLevel[]; asks: TerminalMarketDepthLevel[] }) {
  const maxQty = Math.max(1, ...bids.map((level) => level.quantity), ...asks.map((level) => level.quantity));
  return (
    <>
      {Array.from({ length: LEVELS }).map((_, index) => {
        const bid = bids[index];
        const ask = asks[index];
        const best = index === 0;
        return (
          <div key={index} className="grid grid-cols-[2.2rem_1fr_1fr_1fr_1fr_2.2rem] items-center gap-x-2 py-[3px] font-mono text-[11px] tabular-nums" data-testid="depth-level">
            <span className="text-muted-foreground">{bid?.orders ?? (bid ? DASH : "")}</span>
            <span className="relative text-right">
              {bid && <span aria-hidden className="absolute inset-y-0 right-0 rounded-sm bg-bullish/15" style={{ width: `${(bid.quantity / maxQty) * 100}%` }} />}
              <span className="relative">{bid ? fmtInt(bid.quantity) : ""}</span>
            </span>
            <span className={`text-right text-bullish ${best && bid ? "rounded-sm bg-bullish/10 px-1 font-bold" : ""}`}>{bid ? fmtNum(bid.price) : ""}</span>
            <span className={`text-left text-bearish ${best && ask ? "rounded-sm bg-bearish/10 px-1 font-bold" : ""}`}>{ask ? fmtNum(ask.price) : ""}</span>
            <span className="relative text-left">
              {ask && <span aria-hidden className="absolute inset-y-0 left-0 rounded-sm bg-bearish/15" style={{ width: `${(ask.quantity / maxQty) * 100}%` }} />}
              <span className="relative">{ask ? fmtInt(ask.quantity) : ""}</span>
            </span>
            <span className="text-right text-muted-foreground">{ask?.orders ?? (ask ? DASH : "")}</span>
          </div>
        );
      })}
    </>
  );
}

export function MarketDepthPanel({ contract, onClose, onBuy, onSell }: {
  contract: OptionContract;
  onClose?: () => void;
  onBuy?: () => void;
  onSell?: () => void;
}) {
  const instrument = optionContractToMarketInstrument(contract);
  const depthQuery = useMarketDepth(instrument, true);
  const depth = depthQuery.data;
  const title = `${contract.underlying} ${contract.expiryLabel} ${contract.strike} ${contract.type === "CE" ? "CALL" : "PUT"}`;
  const updated = depth?.fetchedAt ? new Date(depth.fetchedAt).toLocaleTimeString("en-IN") : null;

  return (
    <div className="w-[340px] text-xs" role="dialog" aria-label={`Market depth ${title}`}>
      <div className="flex items-start justify-between gap-2 border-b border-border/70 pb-2">
        <div className="min-w-0">
          <p className="truncate font-semibold">{title}</p>
          <p className="mt-0.5 font-mono">
            <span className="font-semibold">{fmtNum(depth?.ltp ?? null)}</span>{" "}
            <span className={toneClass(depth?.change)}>
              {fmtSigned(depth?.change ?? null)} ({depth?.changePercent == null ? DASH : `${fmtSigned(depth.changePercent)}%`})
            </span>
          </p>
        </div>
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon" className="h-6 w-6" aria-label="Refresh market depth" onClick={() => void depthQuery.refetch()} disabled={depthQuery.isFetching}>
            <RefreshCw className={`h-3 w-3 ${depthQuery.isFetching ? "animate-spin" : ""}`} />
          </Button>
          {onClose && (
            <Button variant="ghost" size="icon" className="h-6 w-6" aria-label="Close market depth" onClick={onClose}>
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-4 pt-2 text-[10px] font-semibold text-muted-foreground">
        <span>Buy Orders</span><span>Sell Orders</span>
      </div>
      <div className="grid grid-cols-[2.2rem_1fr_1fr_1fr_1fr_2.2rem] gap-x-2 border-b border-border/50 pb-1 pt-1 text-[10px] text-muted-foreground">
        <span>Orders</span><span className="text-right">Qty</span><span className="text-right">Bid</span><span>Ask</span><span>Qty</span><span className="text-right">Orders</span>
      </div>

      {depthQuery.isLoading ? (
        <p className="py-6 text-center text-muted-foreground">Loading Dhan market depth…</p>
      ) : depthQuery.error ? (
        <p className="py-4 text-center text-amber-400" data-testid="depth-unavailable">
          Market depth unavailable. {describeDepthError(depthQuery.error)}
        </p>
      ) : depth && !depth.depthAvailable ? (
        <p className="py-4 text-center text-muted-foreground" data-testid="depth-unavailable">
          Dhan reported no resting bid/ask orders for this contract{depth.lastTradeTime ? "" : " (no trades in the current session)"}.
        </p>
      ) : depth ? (
        <DepthRows bids={depth.bids} asks={depth.asks} />
      ) : null}

      {depth && (
        <div className="grid grid-cols-2 gap-x-4 border-t border-border/50 pt-1.5 font-mono text-[11px]">
          <span>Total <b className="text-bullish">{fmtInt(depth.totalBuyQuantity)}</b></span>
          <span className="text-right">Total <b className="text-bearish">{fmtInt(depth.totalSellQuantity)}</b></span>
          <span className="text-[10px] text-muted-foreground">Vol {fmtInt(depth.volume)} · OI {fmtInt(depth.openInterest)}</span>
          <span className="text-right text-[10px] text-muted-foreground">Circuit {fmtNum(depth.lowerCircuit)}–{fmtNum(depth.upperCircuit)}</span>
        </div>
      )}

      <div className="mt-2 flex items-center justify-between gap-2 border-t border-border/50 pt-2">
        <span className="text-[10px] text-muted-foreground">
          {updated ? `Dhan · fetched ${updated}` : "Dhan"}{depth?.lastTradeTime ? ` · LTT ${depth.lastTradeTime}` : ""}
        </span>
        <div className="flex gap-1">
          {onBuy && <Button size="sm" className="h-6 bg-bullish px-2 text-[11px] text-white hover:bg-bullish/90" onClick={onBuy}>Buy</Button>}
          {onSell && <Button size="sm" className="h-6 bg-bearish px-2 text-[11px] text-white hover:bg-bearish/90" onClick={onSell}>Sell</Button>}
        </div>
      </div>
    </div>
  );
}
