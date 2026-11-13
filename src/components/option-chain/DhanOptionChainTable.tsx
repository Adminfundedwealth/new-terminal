import { Fragment, memo, useState, type ReactNode } from "react";
import { Flame } from "lucide-react";
import type { OptionContract } from "@/components/OptionOrderPopup";
import {
  BUILDUP_SHORT,
  DASH,
  classifyBuildup,
  fmtCompact,
  fmtInt,
  fmtNum,
  fmtSigned,
  strikePcr,
  toneClass,
  type ActivityItem,
  type OptionLegView,
  type OptionRowView,
  type OptionSide,
} from "@/lib/optionChainAnalytics";
import { OptionLegActionBar, type LegAction } from "./OptionLegActionBar";

export type ColumnKey = "theta" | "delta" | "iv" | "volume" | "oi" | "oiChange" | "ltpChange" | "gamma" | "vega" | "bid" | "ask";
export type ColumnConfig = Record<ColumnKey, boolean>;

export const DEFAULT_COLUMNS: ColumnConfig = {
  theta: true, delta: true, iv: true, volume: true, oi: true, oiChange: true, ltpChange: true,
  gamma: false, vega: false, bid: false, ask: false,
};

export const COLUMN_LABELS: Record<ColumnKey, string> = {
  theta: "Theta", delta: "Delta", iv: "IV", volume: "Volume", oi: "OI", oiChange: "OI Chg",
  ltpChange: "LTP Chg (%)", gamma: "Gamma", vega: "Vega", bid: "Bid", ask: "Ask",
};

/** CE columns read outward → inward (Greeks first, LTP next to strike); PE mirrors this. */
const CE_ORDER: ColumnKey[] = ["vega", "gamma", "theta", "delta", "iv", "volume", "oi", "oiChange", "bid", "ask", "ltpChange"];

export type SideFilter = "BOTH" | "CE" | "PE";

export interface DhanOptionChainTableProps {
  rows: OptionRowView[];
  spot: number | null;
  atmStrike: number | null;
  maxPain: number | null;
  columns: ColumnConfig;
  sideFilter: SideFilter;
  perLotMultiplier: number;
  showBuildup: boolean;
  activity: ActivityItem[];
  oiRanks: { CE: Map<number, number>; PE: Map<number, number> };
  isInBasket: (strike: number, side: OptionSide) => boolean;
  isInWatchlist: (strike: number, side: OptionSide) => boolean;
  onToggleBasket: (strike: number, side: OptionSide) => void;
  onAction: (strike: number, side: OptionSide, action: LegAction) => void;
  resolveContract: (strike: number, side: OptionSide) => OptionContract | null;
  highlightedStrike: number | null;
}

function maxOf(rows: OptionRowView[], pick: (row: OptionRowView) => number | null): number {
  return Math.max(1, ...rows.map((row) => pick(row) ?? 0));
}

function Bar({ value, max, side }: { value: number | null; max: number; side: OptionSide }) {
  if (value === null || value <= 0) return null;
  return (
    <span aria-hidden className={`absolute bottom-0 h-[2px] rounded-full ${side === "CE" ? "right-1 bg-amber-500/70" : "left-1 bg-violet-500/70"}`} style={{ width: `${Math.min(100, (value / max) * 100) * 0.9}%` }} />
  );
}

function cellValue(key: ColumnKey, leg: OptionLegView, mult: number): ReactNode {
  switch (key) {
    case "theta": return fmtNum(leg.theta);
    case "delta": return fmtNum(leg.delta, 3);
    case "gamma": return fmtNum(leg.gamma, 4);
    case "vega": return fmtNum(leg.vega);
    case "iv": return fmtNum(leg.iv);
    case "volume": return fmtCompact(leg.volume);
    case "oi": return fmtInt(leg.oi);
    case "oiChange": return <span className={toneClass(leg.oiChange)}>{leg.oiChange === null ? DASH : fmtSigned(leg.oiChange, 0)}</span>;
    case "bid": return fmtNum(leg.bid === null ? null : leg.bid * mult);
    case "ask": return fmtNum(leg.ask === null ? null : leg.ask * mult);
    case "ltpChange":
      return (
        <span className={toneClass(leg.change)}>
          {leg.change === null ? DASH : fmtSigned(leg.change * mult)}
          {leg.changePercent !== null && <span className="ml-0.5">({fmtSigned(leg.changePercent)}%)</span>}
        </span>
      );
  }
}

interface RowProps extends Omit<DhanOptionChainTableProps, "rows" | "spot" | "activity" | "oiRanks" | "highlightedStrike"> {
  row: OptionRowView;
  ceItm: boolean;
  peItm: boolean;
  maxOi: number;
  maxVolume: number;
  ceHot: boolean;
  peHot: boolean;
  ceRank?: number;
  peRank?: number;
  highlighted: boolean;
}

const OptionRow = memo(function OptionRow(props: RowProps) {
  const { row, columns, sideFilter, perLotMultiplier: mult, showBuildup, atmStrike, maxPain, ceItm, peItm, maxOi, maxVolume } = props;
  const [depthOpen, setDepthOpen] = useState<OptionSide | null>(null);
  const ceKeys = CE_ORDER.filter((key) => columns[key]);
  const peKeys = [...ceKeys].reverse();
  const isAtm = row.strike === atmStrike;
  const pcr = strikePcr(row);

  const renderSide = (side: OptionSide) => {
    const leg = side === "CE" ? row.ce : row.pe;
    const keys = side === "CE" ? ceKeys : peKeys;
    const itm = side === "CE" ? ceItm : peItm;
    const hot = side === "CE" ? props.ceHot : props.peHot;
    const rank = side === "CE" ? props.ceRank : props.peRank;
    const buildup = showBuildup ? classifyBuildup(leg) : null;
    const tint = itm ? (side === "CE" ? "bg-amber-500/[0.07]" : "bg-violet-500/[0.07]") : side === "CE" ? "bg-amber-500/[0.015]" : "bg-violet-500/[0.015]";
    const align = side === "CE" ? "text-right" : "text-left";
    const selected = props.isInBasket(row.strike, side);

    const dataCells = keys.map((key) => (
      <td key={`${side}-${key}`} className={`relative px-2 py-1.5 ${align} ${tint}`} data-col={key}>
        {cellValue(key, leg, mult)}
        {key === "oi" && <Bar value={leg.oi} max={maxOi} side={side} />}
        {key === "volume" && <Bar value={leg.volume} max={maxVolume} side={side} />}
        {key === "volume" && hot && <Flame className={`absolute top-1/2 h-3 w-3 -translate-y-1/2 text-orange-500 ${side === "CE" ? "left-0.5" : "right-0.5"}`} aria-label="Unusual activity" />}
        {key === "oi" && rank && <span className="ml-1 rounded-sm bg-orange-500/90 px-1 text-[9px] font-bold text-white">OI {rank}</span>}
        {key === "oiChange" && buildup && (
          <span className={`ml-1 rounded-sm px-1 text-[9px] font-bold ${buildup === "Long Buildup" || buildup === "Short Covering" ? "bg-bullish/15 text-bullish" : "bg-bearish/15 text-bearish"}`} title={buildup}>{BUILDUP_SHORT[buildup]}</span>
        )}
      </td>
    ));

    const ltpCell = (
      <td key={`${side}-ltp`} className={`relative px-2 py-1.5 font-semibold ${align} ${tint}`} data-col="ltp">
        {leg.ltp === null ? DASH : fmtNum(leg.ltp * mult)}
        {leg.present && (
          <div className={`absolute top-1/2 z-20 -translate-y-1/2 rounded bg-card/95 p-[3px] shadow-md ring-1 ring-border transition-opacity ${side === "CE" ? "right-full mr-1" : "left-full ml-1"} ${depthOpen === side ? "opacity-100" : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"}`}>
            <OptionLegActionBar
              strike={row.strike}
              side={side}
              resolveContract={() => props.resolveContract(row.strike, side)}
              onAction={(action) => props.onAction(row.strike, side, action)}
              inWatchlist={props.isInWatchlist(row.strike, side)}
              inBasket={selected}
              depthOpen={depthOpen === side}
              onDepthOpenChange={(open) => setDepthOpen(open ? side : null)}
            />
          </div>
        )}
      </td>
    );

    const checkbox = (
      <td key={`${side}-check`} className={`w-8 px-1 py-1.5 text-center ${tint}`}>
        <input
          type="checkbox"
          className={`h-3.5 w-3.5 cursor-pointer ${side === "CE" ? "accent-amber-500" : "accent-violet-500"}`}
          checked={selected}
          disabled={!leg.present}
          onChange={() => props.onToggleBasket(row.strike, side)}
          aria-label={`Select ${row.strike} ${side}`}
        />
      </td>
    );

    return side === "CE" ? [...dataCells, ltpCell, checkbox] : [checkbox, ltpCell, ...dataCells];
  };

  return (
    <tr
      id={`option-strike-${row.strike}`}
      data-strike={row.strike}
      className={`group border-b border-border/40 font-mono text-[11px] tabular-nums transition-colors hover:bg-accent/30 ${props.highlighted ? "outline outline-1 outline-primary" : ""}`}
    >
      {sideFilter !== "PE" && renderSide("CE")}
      <td className={`sticky left-auto border-x border-border/60 px-2 py-1.5 text-center font-semibold ${isAtm ? "bg-primary/15 text-primary" : "bg-muted/40"}`} data-col="strike">
        <span>{row.strike.toLocaleString("en-IN")}</span>
        {isAtm && <span className="ml-1 rounded-sm bg-primary px-1 text-[9px] font-bold text-primary-foreground">ATM</span>}
        {row.strike === maxPain && <span className="ml-1 rounded-sm bg-warning/20 px-1 text-[9px] font-bold text-warning" title="Max pain strike">MP</span>}
      </td>
      <td className="border-r border-border/60 bg-muted/30 px-2 py-1.5 text-center text-muted-foreground" data-col="pcr">{fmtNum(pcr)}</td>
      {sideFilter !== "CE" && renderSide("PE")}
    </tr>
  );
});

export function DhanOptionChainTable(props: DhanOptionChainTableProps) {
  const { rows, spot, columns, sideFilter, activity, oiRanks } = props;
  const ceKeys = CE_ORDER.filter((key) => columns[key]);
  const sideCols = ceKeys.length + 2;
  const maxOi = maxOf(rows, (row) => Math.max(row.ce.oi ?? 0, row.pe.oi ?? 0));
  const maxVolume = maxOf(rows, (row) => Math.max(row.ce.volume ?? 0, row.pe.volume ?? 0));
  const hot = new Set(activity.map((item) => `${item.strike}:${item.side}`));
  const spotIndex = spot === null ? -1 : rows.findIndex((row) => row.strike > spot);
  const totalCols = (sideFilter !== "PE" ? sideCols : 0) + (sideFilter !== "CE" ? sideCols : 0) + 2;

  const header = (side: OptionSide) => {
    const keys = side === "CE" ? ceKeys : [...ceKeys].reverse();
    const cells = keys.map((key) => (
      <th key={`${side}-${key}`} className={`px-2 py-2 font-medium ${side === "CE" ? "text-right" : "text-left"}`}>{COLUMN_LABELS[key]}</th>
    ));
    const ltp = <th key={`${side}-ltp`} className={`px-2 py-2 font-semibold ${side === "CE" ? "text-right" : "text-left"}`}>LTP</th>;
    const tag = (
      <th key={`${side}-tag`} className="w-8 px-1 py-2 text-center">
        <span className={`rounded-sm border px-1 text-[10px] font-bold ${side === "CE" ? "border-amber-500 text-amber-500" : "border-violet-500 text-violet-400"}`}>{side}</span>
      </th>
    );
    return side === "CE" ? [...cells, ltp, tag] : [tag, ltp, ...cells];
  };

  return (
    <table className="w-full min-w-[1100px] border-collapse text-xs" data-testid="dhan-option-chain">
      <thead className="sticky top-0 z-30 bg-card text-[11px] text-muted-foreground shadow-[0_1px_0_hsl(var(--border))]">
        <tr className="text-[10px] uppercase tracking-wider">
          {sideFilter !== "PE" && <th colSpan={sideCols} className="bg-amber-500/[0.06] py-1 text-center font-bold text-amber-500">Calls</th>}
          <th colSpan={2} className="border-x border-border/60 bg-muted/40 py-1 text-center font-bold">Strike</th>
          {sideFilter !== "CE" && <th colSpan={sideCols} className="bg-violet-500/[0.06] py-1 text-center font-bold text-violet-400">Puts</th>}
        </tr>
        <tr>
          {sideFilter !== "PE" && header("CE")}
          <th className="border-x border-border/60 bg-muted/40 px-2 py-2 text-center font-semibold text-foreground">Strike Price</th>
          <th className="border-r border-border/60 bg-muted/40 px-2 py-2 text-center font-semibold">PCR</th>
          {sideFilter !== "CE" && header("PE")}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <Fragment key={row.strike}>
            {index === spotIndex && index > 0 && spot !== null && (
              <tr aria-label={`Underlying at ${spot}`} data-testid="spot-marker">
                <td colSpan={totalCols} className="relative h-0 p-0">
                  <div className="absolute inset-x-0 top-0 border-t border-dashed border-bullish/70" />
                  <span className="absolute left-1/2 top-0 z-10 -translate-x-1/2 -translate-y-1/2 rounded bg-bullish px-2 py-0.5 font-mono text-[11px] font-bold text-white shadow">
                    {spot.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </td>
              </tr>
            )}
            <OptionRow
              {...props}
              row={row}
              ceItm={spot !== null && row.strike < spot}
              peItm={spot !== null && row.strike > spot}
              maxOi={maxOi}
              maxVolume={maxVolume}
              ceHot={hot.has(`${row.strike}:CE`)}
              peHot={hot.has(`${row.strike}:PE`)}
              ceRank={oiRanks.CE.get(row.strike)}
              peRank={oiRanks.PE.get(row.strike)}
              highlighted={props.highlightedStrike === row.strike}
            />
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}
