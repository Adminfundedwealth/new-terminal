export interface ApprovedStockGroup {
  category: string;
  symbols: readonly string[];
}

export const APPROVED_STOCK_UNIVERSE: readonly ApprovedStockGroup[];
export const LEGACY_STOCK_SYMBOL_ALIASES: Readonly<Record<string, string>>;
export const UNRESOLVED_APPROVED_STOCK_SYMBOLS: readonly string[];
export function normalizeApprovedStockKey(value?: string | null): string;
export function resolveApprovedStockSymbol(value?: string | null): string | undefined;
