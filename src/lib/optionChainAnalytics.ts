/**
 * Option-chain view model and analytics.
 *
 * Every value is `null` when the central Dhan feed did not supply it, so the UI can
 * render "—" instead of a fabricated zero. Derived values (PCR, max pain, straddle,
 * buildup, unusual activity) are computed only from supplied fields.
 */

export type OptionSide = "CE" | "PE";

/** Nullable per-leg shape returned by Terminal OS in `chain[].call` / `chain[].put`. */
export interface RawOptionLeg {
  ltp?: number | null;
  bid?: number | null;
  ask?: number | null;
  volume?: number | null;
  oi?: number | null;
  change?: number | null;
  change_percent?: number | null;
  iv?: number | null;
  oi_change?: number | null;
  greeks?: { delta?: number | null; gamma?: number | null; theta?: number | null; vega?: number | null; rho?: number | null } | null;
  security_id?: string | null;
  bid_quantity?: number | null;
  ask_quantity?: number | null;
  previous_close?: number | null;
  previous_oi?: number | null;
  previous_volume?: number | null;
}

/** Legacy zero-filled leg (`chain[].ce` / `chain[].pe`). */
export interface LegacyOptionLeg {
  ltp: number;
  oi: number;
  oiChange: number;
  volume: number;
  iv: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  bidPrice: number;
  askPrice: number;
}

export interface RawOptionChainRow {
  strikePrice: number;
  ce: LegacyOptionLeg;
  pe: LegacyOptionLeg;
  call?: RawOptionLeg | null;
  put?: RawOptionLeg | null;
}

export interface OptionLegView {
  present: boolean;
  ltp: number | null;
  change: number | null;
  changePercent: number | null;
  bid: number | null;
  ask: number | null;
  bidQuantity: number | null;
  askQuantity: number | null;
  volume: number | null;
  oi: number | null;
  oiChange: number | null;
  iv: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  rho: number | null;
  securityId: string | null;
}

export interface OptionRowView {
  strike: number;
  ce: OptionLegView;
  pe: OptionLegView;
}

export interface ChainCapabilities {
  greeksAvailable: boolean;
  oiChangeAvailable: boolean;
}

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positive(value: unknown): number | null {
  const parsed = finite(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

const EMPTY_LEG: OptionLegView = {
  present: false, ltp: null, change: null, changePercent: null, bid: null, ask: null,
  bidQuantity: null, askQuantity: null, volume: null, oi: null, oiChange: null, iv: null,
  delta: null, gamma: null, theta: null, vega: null, rho: null, securityId: null,
};

function fromRawLeg(leg: RawOptionLeg | null | undefined): OptionLegView {
  if (!leg) return EMPTY_LEG;
  const greeks = leg.greeks ?? null;
  return {
    present: true,
    ltp: finite(leg.ltp),
    change: finite(leg.change),
    changePercent: finite(leg.change_percent),
    bid: positive(leg.bid),
    ask: positive(leg.ask),
    bidQuantity: finite(leg.bid_quantity),
    askQuantity: finite(leg.ask_quantity),
    volume: finite(leg.volume),
    oi: finite(leg.oi),
    oiChange: finite(leg.oi_change),
    iv: positive(leg.iv),
    delta: greeks ? finite(greeks.delta) : null,
    gamma: greeks ? finite(greeks.gamma) : null,
    theta: greeks ? finite(greeks.theta) : null,
    vega: greeks ? finite(greeks.vega) : null,
    rho: greeks ? finite(greeks.rho) : null,
    securityId: leg.security_id ? String(leg.security_id) : null,
  };
}

/** Legacy legs are zero-filled, so zeros are only trusted where the feed flags the field as available. */
function fromLegacyLeg(leg: LegacyOptionLeg | undefined, caps: ChainCapabilities): OptionLegView {
  if (!leg) return EMPTY_LEG;
  return {
    ...EMPTY_LEG,
    present: true,
    ltp: positive(leg.ltp),
    bid: positive(leg.bidPrice),
    ask: positive(leg.askPrice),
    volume: finite(leg.volume),
    oi: finite(leg.oi),
    oiChange: caps.oiChangeAvailable ? finite(leg.oiChange) : null,
    iv: positive(leg.iv),
    delta: caps.greeksAvailable ? finite(leg.delta) : null,
    gamma: caps.greeksAvailable ? finite(leg.gamma) : null,
    theta: caps.greeksAvailable ? finite(leg.theta) : null,
    vega: caps.greeksAvailable ? finite(leg.vega) : null,
  };
}

export function toOptionRowViews(rows: RawOptionChainRow[], caps: ChainCapabilities): OptionRowView[] {
  return rows
    .filter((row) => Number.isFinite(row.strikePrice) && row.strikePrice > 0)
    .map((row) => ({
      strike: row.strikePrice,
      ce: row.call !== undefined ? fromRawLeg(row.call) : fromLegacyLeg(row.ce, caps),
      pe: row.put !== undefined ? fromRawLeg(row.put) : fromLegacyLeg(row.pe, caps),
    }))
    .sort((a, b) => a.strike - b.strike);
}

function sum(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length ? present.reduce((total, value) => total + value, 0) : null;
}

export interface ChainSummary {
  totalCeOi: number | null;
  totalPeOi: number | null;
  totalCeVolume: number | null;
  totalPeVolume: number | null;
  pcr: number | null;
  atmStrike: number | null;
  atmRow: OptionRowView | null;
  straddle: number | null;
  atmIv: number | null;
  maxPain: number | null;
}

/** ATM = listed strike closest to spot (Dhan behaviour); never a synthetic rounded strike. */
export function findAtmStrike(rows: OptionRowView[], spot: number | null): number | null {
  if (!rows.length || spot === null || !(spot > 0)) return null;
  return rows.reduce((best, row) => Math.abs(row.strike - spot) < Math.abs(best - spot) ? row.strike : best, rows[0].strike);
}

/** Max pain: strike minimising total intrinsic payout to option buyers, using reported OI only. */
export function computeMaxPain(rows: OptionRowView[]): number | null {
  const withOi = rows.filter((row) => row.ce.oi !== null || row.pe.oi !== null);
  if (!withOi.length) return null;
  let best: { strike: number; pain: number } | null = null;
  for (const candidate of withOi) {
    let pain = 0;
    for (const row of withOi) {
      if (row.ce.oi) pain += Math.max(candidate.strike - row.strike, 0) * row.ce.oi;
      if (row.pe.oi) pain += Math.max(row.strike - candidate.strike, 0) * row.pe.oi;
    }
    if (!best || pain < best.pain) best = { strike: candidate.strike, pain };
  }
  return best && (withOi.some((row) => (row.ce.oi ?? 0) > 0 || (row.pe.oi ?? 0) > 0)) ? best.strike : null;
}

export function summarizeChain(rows: OptionRowView[], spot: number | null): ChainSummary {
  const totalCeOi = sum(rows.map((row) => row.ce.oi));
  const totalPeOi = sum(rows.map((row) => row.pe.oi));
  const atmStrike = findAtmStrike(rows, spot);
  const atmRow = rows.find((row) => row.strike === atmStrike) ?? null;
  const straddle = atmRow && atmRow.ce.ltp !== null && atmRow.pe.ltp !== null ? atmRow.ce.ltp + atmRow.pe.ltp : null;
  const ivs = atmRow ? [atmRow.ce.iv, atmRow.pe.iv].filter((value): value is number => value !== null) : [];
  return {
    totalCeOi,
    totalPeOi,
    totalCeVolume: sum(rows.map((row) => row.ce.volume)),
    totalPeVolume: sum(rows.map((row) => row.pe.volume)),
    pcr: totalCeOi && totalPeOi !== null ? totalPeOi / totalCeOi : null,
    atmStrike,
    atmRow,
    straddle,
    atmIv: ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : null,
    maxPain: computeMaxPain(rows),
  };
}

export function strikePcr(row: OptionRowView): number | null {
  return row.ce.oi && row.pe.oi !== null ? row.pe.oi / row.ce.oi : null;
}

export type Buildup = "Long Buildup" | "Short Buildup" | "Short Covering" | "Long Unwinding";

/** Standard price/OI classification. Requires both a reported price change and OI change. */
export function classifyBuildup(leg: OptionLegView): Buildup | null {
  if (leg.change === null || leg.oiChange === null || leg.change === 0 || leg.oiChange === 0) return null;
  if (leg.change > 0) return leg.oiChange > 0 ? "Long Buildup" : "Short Covering";
  return leg.oiChange > 0 ? "Short Buildup" : "Long Unwinding";
}

export const BUILDUP_SHORT: Record<Buildup, string> = {
  "Long Buildup": "LB",
  "Short Buildup": "SB",
  "Short Covering": "SC",
  "Long Unwinding": "LU",
};

export type ActivityKind = "VOLUME_SPIKE" | "OI_BUILDUP" | "OI_UNWINDING";

export interface ActivityItem {
  strike: number;
  side: OptionSide;
  kind: ActivityKind;
  /** Multiple of the chain average for that side and metric. */
  ratio: number;
  value: number;
}

/**
 * Unusual activity relative to the displayed chain:
 * - VOLUME_SPIKE: leg volume > `threshold` × average volume for that side.
 * - OI_BUILDUP / OI_UNWINDING: |OI change| > `threshold` × average |OI change| for that side.
 */
export function detectUnusualActivity(rows: OptionRowView[], threshold = 3): ActivityItem[] {
  const items: ActivityItem[] = [];
  for (const side of ["CE", "PE"] as const) {
    const key = side === "CE" ? "ce" : "pe";
    const volumes = rows.map((row) => row[key].volume).filter((value): value is number => value !== null && value > 0);
    const oiChanges = rows.map((row) => row[key].oiChange).filter((value): value is number => value !== null && value !== 0).map(Math.abs);
    const avgVolume = volumes.length ? volumes.reduce((a, b) => a + b, 0) / rows.length : 0;
    const avgOiChange = oiChanges.length ? oiChanges.reduce((a, b) => a + b, 0) / rows.length : 0;
    for (const row of rows) {
      const leg = row[key];
      if (avgVolume > 0 && leg.volume !== null && leg.volume > avgVolume * threshold) {
        items.push({ strike: row.strike, side, kind: "VOLUME_SPIKE", ratio: leg.volume / avgVolume, value: leg.volume });
      }
      if (avgOiChange > 0 && leg.oiChange !== null && Math.abs(leg.oiChange) > avgOiChange * threshold) {
        items.push({ strike: row.strike, side, kind: leg.oiChange > 0 ? "OI_BUILDUP" : "OI_UNWINDING", ratio: Math.abs(leg.oiChange) / avgOiChange, value: leg.oiChange });
      }
    }
  }
  return items.sort((a, b) => a.strike - b.strike || a.side.localeCompare(b.side));
}

/** Rank (1 = highest) of the top-N OI strikes per side, used for Dhan-style "OI 1/2/3" badges. */
export function topOiRanks(rows: OptionRowView[], side: OptionSide, count = 3): Map<number, number> {
  const key = side === "CE" ? "ce" : "pe";
  const ranked = rows
    .filter((row) => (row[key].oi ?? 0) > 0)
    .sort((a, b) => (b[key].oi ?? 0) - (a[key].oi ?? 0))
    .slice(0, count);
  return new Map(ranked.map((row, index) => [row.strike, index + 1]));
}

/* ── Formatting: "—" whenever a value was not supplied ─────────────────── */

export const DASH = "—";

export function fmtNum(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  return value.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtInt(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  return Math.round(value).toLocaleString("en-IN");
}

/** Indian compact units used by Dhan: L (lakh) and Cr (crore). */
export function fmtCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  const abs = Math.abs(value);
  if (abs >= 1e7) return `${(value / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `${(value / 1e5).toFixed(2)} L`;
  return Math.round(value).toLocaleString("en-IN");
}

export function fmtSigned(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  const text = Math.abs(value).toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return value > 0 ? `+${text}` : value < 0 ? `-${text}` : text;
}

export function toneClass(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return "text-muted-foreground";
  return value > 0 ? "text-bullish" : "text-bearish";
}
