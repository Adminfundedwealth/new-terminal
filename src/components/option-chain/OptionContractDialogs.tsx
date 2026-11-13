import { useEffect, useState } from "react";
import type { OptionContract } from "@/components/OptionOrderPopup";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { OptionContractAlert } from "@/lib/optionContractAlerts";
import { DASH, fmtNum } from "@/lib/optionChainAnalytics";

export function OptionContractDetailsDialog({ contract, onClose }: { contract: OptionContract | null; onClose: () => void }) {
  return (
    <Dialog open={contract !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Contract details</DialogTitle>
          <DialogDescription>Resolved from Dhan's instrument master.</DialogDescription>
        </DialogHeader>
        {contract && (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs" data-testid="contract-details">
            <dt className="text-muted-foreground">Trading symbol</dt><dd className="font-mono">{contract.tradingSymbol}</dd>
            <dt className="text-muted-foreground">Underlying</dt><dd>{contract.underlying}</dd>
            <dt className="text-muted-foreground">Expiry</dt><dd>{contract.expiryLabel} ({contract.expiry})</dd>
            <dt className="text-muted-foreground">Strike / type</dt><dd>{contract.strike} {contract.type}</dd>
            <dt className="text-muted-foreground">Security ID</dt><dd className="font-mono">{contract.securityId}</dd>
            <dt className="text-muted-foreground">Exchange segment</dt><dd>{contract.exchangeSegment}</dd>
            <dt className="text-muted-foreground">Instrument</dt><dd>{contract.instrumentType}</dd>
            <dt className="text-muted-foreground">Lot size</dt><dd>{contract.lotSize > 0 ? contract.lotSize : "Unavailable"}</dd>
            <dt className="text-muted-foreground">Tick size</dt><dd>{contract.tickSize > 0 ? contract.tickSize : "Unavailable"}</dd>
            <dt className="text-muted-foreground">Last price</dt><dd>{contract.ltp > 0 ? fmtNum(contract.ltp) : DASH}</dd>
            <dt className="text-muted-foreground">IV</dt><dd>{contract.iv > 0 ? `${fmtNum(contract.iv)}%` : DASH}</dd>
          </dl>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function OptionAlertDialog({ contract, alerts, onCreate, onDelete, onClose }: {
  contract: OptionContract | null;
  alerts: OptionContractAlert[];
  onCreate: (condition: "above" | "below", price: number) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [condition, setCondition] = useState<"above" | "below">("above");
  const [price, setPrice] = useState("");
  useEffect(() => {
    if (contract) {
      setPrice(contract.ltp > 0 ? contract.ltp.toFixed(2) : "");
      setCondition("above");
    }
  }, [contract]);
  const parsed = Number(price);
  const valid = Number.isFinite(parsed) && parsed > 0;
  const existing = contract ? alerts.filter((alert) => alert.securityId === contract.securityId) : [];

  return (
    <Dialog open={contract !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Set alert · {contract ? `${contract.underlying} ${contract.strike} ${contract.type}` : ""}</DialogTitle>
          <DialogDescription>
            Triggers on the central Dhan option-chain LTP while the Option Chain is open in this browser.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-xs">
          <p>Current LTP: <b className="font-mono">{contract && contract.ltp > 0 ? fmtNum(contract.ltp) : DASH}</b></p>
          <div className="flex gap-2">
            {(["above", "below"] as const).map((value) => (
              <Button key={value} type="button" size="sm" variant={condition === value ? "default" : "outline"} className="h-7 flex-1 text-xs" onClick={() => setCondition(value)}>
                LTP {value === "above" ? "≥" : "≤"}
              </Button>
            ))}
          </div>
          <div>
            <Label htmlFor="option-alert-price" className="text-xs">Price</Label>
            <Input id="option-alert-price" type="number" step="0.05" min="0.05" value={price} onChange={(event) => setPrice(event.target.value)} className="h-8 text-xs" />
          </div>
          {existing.length > 0 && (
            <div className="space-y-1">
              <p className="font-semibold">Alerts on this contract</p>
              {existing.map((alert) => (
                <div key={alert.id} className="flex items-center justify-between rounded border border-border/60 px-2 py-1">
                  <span>LTP {alert.condition === "above" ? "≥" : "≤"} {fmtNum(alert.price)} {alert.triggeredAt ? <span className="text-bullish">· triggered</span> : <span className="text-muted-foreground">· active</span>}</span>
                  <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={() => onDelete(alert.id)}>Delete</Button>
                </div>
              ))}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
          <Button size="sm" disabled={!valid} onClick={() => onCreate(condition, parsed)}>Create alert</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
