const STORAGE_KEY = "optionsdesk_watchlist";
export function getSavedWatchlist() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
    }
    catch {
        return [];
    }
}
export function saveWatchlist(symbols) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(symbols));
}
export function toggleWatchlistSymbol(symbol, current) {
    const value = symbol.trim().toUpperCase();
    if (!value)
        return current;
    const hasValue = current.includes(value);
    const next = hasValue ? current.filter((entry) => entry !== value) : [...current, value];
    saveWatchlist(next);
    return next;
}
export function isWatchlisted(symbol, current) {
    return current.includes(symbol.trim().toUpperCase());
}
export const WATCHLIST_STORAGE_KEY = STORAGE_KEY;
