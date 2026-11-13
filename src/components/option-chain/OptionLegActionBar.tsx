import { useState } from "react";
import { BarChart3, Bell, Info, Layers, Maximize2, MoreVertical, ShoppingBasket, Star, Timer } from "lucide-react";
import type { OptionContract } from "@/components/OptionOrderPopup";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MarketDepthPanel } from "./MarketDepthPanel";

export type LegAction =
  | "buy" | "sell" | "chart" | "fullscreen" | "alert" | "forever"
  | "watchlist" | "basket" | "details";

export interface OptionLegActionBarProps {
  strike: number;
  side: "CE" | "PE";
  /** Resolves the exact Dhan contract; null when the instrument master cannot resolve it. */
  resolveContract: () => OptionContract | null;
  onAction: (action: LegAction) => void;
  inWatchlist: boolean;
  inBasket: boolean;
  /** Controlled depth popover so the advanced menu can open it too. */
  depthOpen: boolean;
  onDepthOpenChange: (open: boolean) => void;
}

const iconButton = "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[3px] border text-[10px] font-bold leading-none transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary";

export function OptionLegActionBar({ strike, side, resolveContract, onAction, inWatchlist, inBasket, depthOpen, onDepthOpenChange }: OptionLegActionBarProps) {
  const [depthContract, setDepthContract] = useState<OptionContract | null>(null);
  const label = `${strike} ${side}`;

  const openDepth = (open: boolean) => {
    if (open) {
      const contract = resolveContract();
      if (!contract) return;
      setDepthContract(contract);
    }
    onDepthOpenChange(open);
  };

  return (
    <div role="group" aria-label={`${label} contract actions`} className="flex items-center gap-[3px]" onClick={(event) => event.stopPropagation()}>
      <button type="button" className={`${iconButton} border-bullish bg-bullish px-1 text-white hover:bg-bullish/85`} aria-label={`Buy ${label}`} title={`Buy ${label}`} onClick={() => onAction("buy")}>B</button>
      <button type="button" className={`${iconButton} border-bearish bg-bearish px-1 text-white hover:bg-bearish/85`} aria-label={`Sell ${label}`} title={`Sell ${label}`} onClick={() => onAction("sell")}>S</button>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className={`${iconButton} border-border bg-card text-muted-foreground hover:text-primary`} aria-label={`Chart ${label}`} onClick={() => onAction("chart")}>
            <BarChart3 className="h-3 w-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-[10px]">Chart</TooltipContent>
      </Tooltip>
      <Popover open={depthOpen} onOpenChange={openDepth}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button type="button" className={`${iconButton} ${depthOpen ? "border-amber-500 bg-amber-500 text-white" : "border-border bg-card text-muted-foreground hover:text-amber-500"}`} aria-label={`Market depth ${label}`}>
                <Layers className="h-3 w-3" />
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-[10px]">Depth</TooltipContent>
        </Tooltip>
        <PopoverContent side="bottom" align={side === "CE" ? "end" : "start"} className="w-auto p-3">
          {depthContract && (
            <MarketDepthPanel
              contract={depthContract}
              onClose={() => onDepthOpenChange(false)}
              onBuy={() => { onDepthOpenChange(false); onAction("buy"); }}
              onSell={() => { onDepthOpenChange(false); onAction("sell"); }}
            />
          )}
        </PopoverContent>
      </Popover>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className={`${iconButton} border-border bg-card text-muted-foreground hover:text-foreground`} aria-label={`More actions ${label}`}>
            <MoreVertical className="h-3 w-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={side === "CE" ? "end" : "start"} className="w-48 text-xs">
          <DropdownMenuItem onSelect={() => onAction("fullscreen")}><Maximize2 className="mr-2 h-3.5 w-3.5" />Fullscreen Chart</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onAction("alert")}><Bell className="mr-2 h-3.5 w-3.5" />Set Alert</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onAction("forever")}><Timer className="mr-2 h-3.5 w-3.5" />Forever Order</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onAction("watchlist")}><Star className={`mr-2 h-3.5 w-3.5 ${inWatchlist ? "fill-amber-400 text-amber-400" : ""}`} />{inWatchlist ? "Remove from Watchlist" : "Add to Watchlist"}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onAction("basket")}><ShoppingBasket className="mr-2 h-3.5 w-3.5" />{inBasket ? "Remove from Basket" : "Add to Basket"}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setTimeout(() => openDepth(true), 0)}><Layers className="mr-2 h-3.5 w-3.5" />Market Depth</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onAction("details")}><Info className="mr-2 h-3.5 w-3.5" />Contract Details</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
