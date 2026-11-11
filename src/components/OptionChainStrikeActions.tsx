import { useState } from "react";
import { BarChart3, Check, MoreHorizontal, Star, TrendingDown, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { OptionContract } from "@/components/OptionOrderPopup";

type OptionType = "CE" | "PE";

export function OptionChainStrikeActions({
  strike,
  onChart,
  onBuy,
  onSell,
  isSelected,
  onToggleSelection,
  isInWatchlist,
  onToggleWatchlist,
  onFullscreen,
  onAlert,
  onForeverOrder,
  resolveContract,
}: {
  strike: number;
  onChart: (type: OptionType) => void;
  onBuy: (type: OptionType) => void;
  onSell: (type: OptionType) => void;
  isSelected: (type: OptionType) => boolean;
  onToggleSelection: (type: OptionType) => void;
  isInWatchlist: (type: OptionType) => boolean;
  onToggleWatchlist: (type: OptionType) => void;
  onFullscreen: (type: OptionType) => void;
  onAlert: (type: OptionType) => void;
  onForeverOrder: (type: OptionType) => void;
  resolveContract: (type: OptionType) => OptionContract | null;
}) {
  const [depthType, setDepthType] = useState<OptionType | null>(null);
  const [detailsContract, setDetailsContract] = useState<OptionContract | null>(null);

  return (
    <>
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
            size="icon"
            className={`h-5 w-5 ${isSelected(type) ? "text-primary" : "text-muted-foreground"}`}
            onClick={() => onToggleSelection(type)}
            title={`${isSelected(type) ? "Remove" : "Add"} ${strike} ${type} ${isSelected(type) ? "from" : "to"} basket`}
            aria-label={`${isSelected(type) ? "Remove" : "Add"} ${strike} ${type} ${isSelected(type) ? "from" : "to"} basket`}
            aria-pressed={isSelected(type)}
          >
            <Check className={`h-3 w-3 ${isSelected(type) ? "opacity-100" : "opacity-25"}`} aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={`h-5 w-5 ${isInWatchlist(type) ? "text-amber-400" : "text-muted-foreground"}`}
            onClick={() => onToggleWatchlist(type)}
            title={`${isInWatchlist(type) ? "Remove" : "Add"} ${strike} ${type} ${isInWatchlist(type) ? "from" : "to"} watchlist`}
            aria-label={`${isInWatchlist(type) ? "Remove" : "Add"} ${strike} ${type} ${isInWatchlist(type) ? "from" : "to"} watchlist`}
            aria-pressed={isInWatchlist(type)}
          >
            <Star className={`h-3 w-3 ${isInWatchlist(type) ? "fill-current" : ""}`} aria-hidden="true" />
          </Button>
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
          <Popover open={depthType === type} onOpenChange={(open) => setDepthType(open ? type : null)}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1 text-[9px] text-muted-foreground"
                onClick={() => setDepthType(type)}
                aria-label={`Market depth ${strike} ${type}`}
              >
                Depth
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-3 text-xs" align="center">
              <p className="font-semibold">{strike} {type} Market Depth</p>
              <p className="mt-2 text-muted-foreground">
                Market-depth levels are unavailable from the connected Dhan market-data service. No bid/ask levels are being fabricated.
              </p>
            </PopoverContent>
          </Popover>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6" aria-label={`More actions ${strike} ${type}`}>
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onSelect={() => onFullscreen(type)}>Fullscreen chart</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onAlert(type)}>Set alert</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onForeverOrder(type)}>Forever order</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onToggleWatchlist(type)}>
                {isInWatchlist(type) ? "Remove from watchlist" : "Add to watchlist"}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onToggleSelection(type)}>
                {isSelected(type) ? "Remove from basket" : "Add to basket"}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setDepthType(type)}>Open market depth</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setDetailsContract(resolveContract(type))}>Contract details</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ))}
    </div>
    <Dialog open={detailsContract !== null} onOpenChange={(open) => { if (!open) setDetailsContract(null); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Option contract details</DialogTitle></DialogHeader>
        {detailsContract && (
          <dl className="grid grid-cols-2 gap-2 text-xs">
            <dt className="text-muted-foreground">Trading symbol</dt><dd>{detailsContract.tradingSymbol}</dd>
            <dt className="text-muted-foreground">Underlying</dt><dd>{detailsContract.underlying}</dd>
            <dt className="text-muted-foreground">Expiry</dt><dd>{detailsContract.expiryLabel}</dd>
            <dt className="text-muted-foreground">Strike / side</dt><dd>{detailsContract.strike} {detailsContract.type}</dd>
            <dt className="text-muted-foreground">Security ID</dt><dd>{detailsContract.securityId}</dd>
            <dt className="text-muted-foreground">Exchange segment</dt><dd>{detailsContract.exchangeSegment}</dd>
            <dt className="text-muted-foreground">Lot size</dt><dd>{detailsContract.lotSize > 0 ? detailsContract.lotSize : "Unavailable"}</dd>
          </dl>
        )}
      </DialogContent>
    </Dialog>
    </>
  );
}
