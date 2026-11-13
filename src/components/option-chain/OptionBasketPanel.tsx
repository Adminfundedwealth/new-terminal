import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { basketLegKey, basketTotals, type OptionBasketLeg } from "@/lib/optionContractBasket";
import { DASH, fmtNum } from "@/lib/optionChainAnalytics";

export function OptionBasketPanel({ legs, onUpdate, onRemove, onClear, onOrderLeg, onBuildStrategy }: {
  legs: OptionBasketLeg[];
  onUpdate: (key: string, patch: Partial<Pick<OptionBasketLeg, "side" | "lots">>) => void;
  onRemove: (key: string) => void;
  onClear: () => void;
  onOrderLeg: (leg: OptionBasketLeg) => void;
  onBuildStrategy: () => void;
}) {
  const totals = basketTotals(legs);
  return (
    <div className="w-[460px] text-xs" data-testid="option-basket">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-semibold">Basket · {legs.length} leg{legs.length === 1 ? "" : "s"}</p>
        {legs.length > 0 && <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={onClear}>Clear all</Button>}
      </div>
      {legs.length === 0 ? (
        <p className="py-3 text-muted-foreground">Tick the CE/PE checkbox on any strike, or use “Add to Basket”, to build a multi-leg selection.</p>
      ) : (
        <>
          <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
            {legs.map((leg) => {
              const key = basketLegKey(leg);
              return (
                <div key={key} className="grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-2 rounded border border-border/60 px-2 py-1.5">
                  <div className="flex overflow-hidden rounded border border-border">
                    {(["BUY", "SELL"] as const).map((side) => (
                      <button
                        key={side}
                        type="button"
                        aria-pressed={leg.side === side}
                        aria-label={`${side} ${leg.tradingSymbol}`}
                        onClick={() => onUpdate(key, { side })}
                        className={`px-1.5 py-0.5 text-[10px] font-bold ${leg.side === side ? (side === "BUY" ? "bg-bullish text-white" : "bg-bearish text-white") : "text-muted-foreground"}`}
                      >{side[0]}</button>
                    ))}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-medium">{leg.underlying} {leg.strike} <span className={leg.type === "CE" ? "text-amber-500" : "text-violet-400"}>{leg.type}</span></p>
                    <p className="truncate text-[10px] text-muted-foreground">{leg.expiryLabel} · {leg.tradingSymbol} · ID {leg.securityId}</p>
                  </div>
                  <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    Lots
                    <Input
                      type="number"
                      min={1}
                      value={leg.lots}
                      onChange={(event) => onUpdate(key, { lots: Number(event.target.value) })}
                      className="h-6 w-14 px-1 text-xs"
                      aria-label={`Lots for ${leg.tradingSymbol}`}
                    />
                  </label>
                  <span className="w-20 text-right font-mono text-[10px]">
                    {leg.lotSize > 0 ? `${leg.lots * leg.lotSize} qty` : "Lot n/a"}<br />
                    <span className="text-muted-foreground">@ {leg.ltp > 0 ? fmtNum(leg.ltp) : DASH}</span>
                  </span>
                  <div className="flex items-center gap-0.5">
                    <Button size="sm" variant="outline" className="h-6 px-1.5 text-[10px]" onClick={() => onOrderLeg(leg)}>Order</Button>
                    <Button size="icon" variant="ghost" className="h-6 w-6" aria-label={`Remove ${leg.tradingSymbol} from basket`} onClick={() => onRemove(key)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-border/60 pt-2 font-mono text-[11px]">
            <span>Qty {totals.quantity.toLocaleString("en-IN")}</span>
            <span>
              Net premium{" "}
              {totals.netPremium === null ? DASH : (
                <b className={totals.netPremium > 0 ? "text-bearish" : "text-bullish"}>
                  ₹{fmtNum(Math.abs(totals.netPremium))} {totals.netPremium > 0 ? "debit" : "credit"}
                </b>
              )}
            </span>
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">Premium uses the last option-chain LTP. Orders are placed one leg at a time through the standard order ticket.</p>
          <Button size="sm" className="mt-2 h-7 w-full text-xs" onClick={onBuildStrategy}>Open in Strategy Builder</Button>
        </>
      )}
    </div>
  );
}
