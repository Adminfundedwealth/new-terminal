/**
 * Option-contract price alerts. These are evaluated in the browser against the central
 * Dhan option-chain LTP while the Option Chain is open; they are not server-side alerts.
 */
export interface OptionContractAlert {
  id: string;
  securityId: string;
  exchangeSegment: string;
  tradingSymbol: string;
  underlying: string;
  expiry: string;
  strike: number;
  type: "CE" | "PE";
  condition: "above" | "below";
  price: number;
  createdAt: string;
  triggeredAt: string | null;
}

const STORAGE_KEY = "fundedwealth.option-contract-alerts.v1";

function isAlert(value: unknown): value is OptionContractAlert {
  if (!value || typeof value !== "object") return false;
  const alert = value as Partial<OptionContractAlert>;
  return typeof alert.id === "string" && typeof alert.securityId === "string"
    && (alert.condition === "above" || alert.condition === "below")
    && typeof alert.price === "number" && alert.price > 0
    && (alert.type === "CE" || alert.type === "PE") && typeof alert.strike === "number";
}

export function readOptionAlerts(): OptionContractAlert[] {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isAlert) : [];
  } catch {
    return [];
  }
}

export function saveOptionAlerts(alerts: OptionContractAlert[]): void {
  globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(alerts));
}

/** Returns alerts that newly crossed their level given current LTPs keyed by security ID. */
export function evaluateOptionAlerts(
  alerts: OptionContractAlert[],
  ltpBySecurityId: Map<string, number>,
  now = new Date(),
): { alerts: OptionContractAlert[]; fired: OptionContractAlert[] } {
  const fired: OptionContractAlert[] = [];
  const next = alerts.map((alert) => {
    if (alert.triggeredAt) return alert;
    const ltp = ltpBySecurityId.get(alert.securityId);
    if (ltp === undefined || !(ltp > 0)) return alert;
    const hit = alert.condition === "above" ? ltp >= alert.price : ltp <= alert.price;
    if (!hit) return alert;
    const triggered = { ...alert, triggeredAt: now.toISOString() };
    fired.push(triggered);
    return triggered;
  });
  return { alerts: next, fired };
}
