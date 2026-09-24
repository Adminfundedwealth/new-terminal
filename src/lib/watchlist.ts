const STORAGE_KEY = "optionsdesk_watchlist";

export function getSavedWatchlist(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveWatchlist(symbols: string[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(symbols));
}

export function toggleWatchlistSymbol(symbol: string, current: string[]) {
  const value = symbol.trim().toUpperCase();
  if (!value) return current;
  const hasValue = current.includes(value);
  const next = hasValue ? current.filter((entry) => entry !== value) : [...current, value];
  saveWatchlist(next);
  return next;
}

export function isWatchlisted(symbol: string, current: string[]) {
  return current.includes(symbol.trim().toUpperCase());
}

export const WATCHLIST_STORAGE_KEY = STORAGE_KEY;
