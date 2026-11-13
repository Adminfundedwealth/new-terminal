import type { OptionContract } from "@/components/OptionOrderPopup";

/** A basket leg keeps the full resolved contract identity plus the user's side and lots. */
export interface OptionBasketLeg extends OptionContract {
  side: "BUY" | "SELL";
  lots: number;
}

const STORAGE_KEY = "fundedwealth.option-basket.v1";

/** Security ID is the identity; one leg per contract, never duplicated. */
export function basketLegKey(contract: Pick<OptionContract, "securityId" | "exchangeSegment">): string {
  return `${contract.exchangeSegment}:${contract.securityId}`;
}

function isLeg(value: unknown): value is OptionBasketLeg {
  if (!value || typeof value !== "object") return false;
  const leg = value as Partial<OptionBasketLeg>;
  return typeof leg.securityId === "string" && leg.securityId.length > 0
    && typeof leg.exchangeSegment === "string"
    && typeof leg.tradingSymbol === "string"
    && typeof leg.strike === "number"
    && (leg.type === "CE" || leg.type === "PE")
    && typeof leg.expiry === "string"
    && typeof leg.lotSize === "number"
    && (leg.side === "BUY" || leg.side === "SELL")
    && typeof leg.lots === "number" && leg.lots >= 1;
}

export function readOptionBasket(): OptionBasketLeg[] {
  try {
    const raw = globalThis.sessionStorage?.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? dedupeBasket(parsed.filter(isLeg)) : [];
  } catch {
    return [];
  }
}

export function saveOptionBasket(legs: OptionBasketLeg[]): void {
  globalThis.sessionStorage?.setItem(STORAGE_KEY, JSON.stringify(dedupeBasket(legs)));
}

export function dedupeBasket(legs: OptionBasketLeg[]): OptionBasketLeg[] {
  const byKey = new Map<string, OptionBasketLeg>();
  for (const leg of legs) byKey.set(basketLegKey(leg), leg);
  return [...byKey.values()];
}

export function toggleBasketLeg(legs: OptionBasketLeg[], contract: OptionContract, side: "BUY" | "SELL" = "BUY"): OptionBasketLeg[] {
  const key = basketLegKey(contract);
  return legs.some((leg) => basketLegKey(leg) === key)
    ? legs.filter((leg) => basketLegKey(leg) !== key)
    : [...legs, { ...contract, side, lots: 1 }];
}

export function updateBasketLeg(legs: OptionBasketLeg[], key: string, patch: Partial<Pick<OptionBasketLeg, "side" | "lots">>): OptionBasketLeg[] {
  return legs.map((leg) => {
    if (basketLegKey(leg) !== key) return leg;
    const lots = patch.lots === undefined ? leg.lots : Math.max(1, Math.floor(patch.lots));
    return { ...leg, ...patch, lots: Number.isFinite(lots) ? lots : leg.lots };
  });
}

export interface BasketTotals {
  legs: number;
  quantity: number;
  /** Net premium: positive = paid (debit), negative = received (credit). Null if any leg lacks LTP. */
  netPremium: number | null;
}

export function basketTotals(legs: OptionBasketLeg[]): BasketTotals {
  let netPremium: number | null = 0;
  let quantity = 0;
  for (const leg of legs) {
    const qty = leg.lots * leg.lotSize;
    quantity += qty;
    if (!(leg.ltp > 0) || !(leg.lotSize > 0)) netPremium = null;
    else if (netPremium !== null) netPremium += (leg.side === "BUY" ? 1 : -1) * leg.ltp * qty;
  }
  return { legs: legs.length, quantity, netPremium };
}
