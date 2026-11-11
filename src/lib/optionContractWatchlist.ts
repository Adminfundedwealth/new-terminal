import type { OptionContract } from "@/components/OptionOrderPopup";

const STORAGE_KEY = "fundedwealth.option-contract-watchlist.v1";

function isOptionContract(value: unknown): value is OptionContract {
  if (!value || typeof value !== "object") return false;
  const contract = value as Partial<OptionContract>;
  return typeof contract.tradingSymbol === "string"
    && typeof contract.underlying === "string"
    && typeof contract.strike === "number"
    && (contract.type === "CE" || contract.type === "PE")
    && typeof contract.expiry === "string"
    && typeof contract.expiryLabel === "string"
    && typeof contract.securityId === "string"
    && typeof contract.exchangeSegment === "string"
    && typeof contract.lotSize === "number"
    && typeof contract.ltp === "number";
}

export function readOptionContractWatchlist(): OptionContract[] {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      console.error("Saved option watchlist has an invalid format.");
      return [];
    }
    return parsed.filter(isOptionContract);
  } catch (error) {
    console.error("Saved option watchlist could not be read:", error);
    return [];
  }
}

export function saveOptionContractWatchlist(contracts: OptionContract[]): void {
  globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(contracts));
}

export function optionContractWatchlistKey(contract: Pick<OptionContract, "securityId" | "type">): string {
  return `${contract.securityId}:${contract.type}`;
}
