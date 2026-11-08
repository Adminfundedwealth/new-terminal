import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { getSavedWatchlist, saveWatchlist, sameWatchlistInstrument, toWatchlistInstrument, watchlistInstrumentKey } from "@/lib/watchlist";
import type { Instrument } from "@/lib/localDatabase";
import type { WatchlistInstrument } from "@/lib/watchlist";

export function useUserWatchlist() {
  const { user, loading } = useAuth();
  const userId = user?.id ?? null;
  const [saved, setSaved] = useState<{ userId: string | null; instruments: WatchlistInstrument[] }>({
    userId: null,
    instruments: [],
  });

  useEffect(() => {
    setSaved({ userId, instruments: getSavedWatchlist(userId) });
  }, [userId]);

  const instruments = useMemo(
    () => saved.userId === userId ? saved.instruments : [],
    [saved.instruments, saved.userId, userId],
  );
  const watchedSymbols = useMemo(
    () => [...new Set(instruments.flatMap((instrument) => [instrument.symbol, instrument.tradingSymbol]))],
    [instruments],
  );

  const persist = useCallback((next: WatchlistInstrument[]) => {
    if (!userId) throw new Error("Sign in to save a watchlist.");
    saveWatchlist(next, userId);
    setSaved({ userId, instruments: next });
  }, [userId]);

  const addInstrument = useCallback((instrument: Instrument) => {
    const entry = toWatchlistInstrument(instrument);
    if (instruments.some((savedInstrument) => sameWatchlistInstrument(savedInstrument, entry))) return;
    persist([...instruments, entry]);
  }, [instruments, persist]);

  const toggleInstrument = useCallback((instrument: Instrument) => {
    const entry = toWatchlistInstrument(instrument);
    persist(instruments.some((savedInstrument) => sameWatchlistInstrument(savedInstrument, entry))
      ? instruments.filter((savedInstrument) => !sameWatchlistInstrument(savedInstrument, entry))
      : [...instruments, entry]);
  }, [instruments, persist]);

  const removeInstrument = useCallback((instrument: WatchlistInstrument) => {
    const key = watchlistInstrumentKey(instrument);
    persist(instruments.filter((savedInstrument) => watchlistInstrumentKey(savedInstrument) !== key));
  }, [instruments, persist]);

  return {
    instruments,
    watchedSymbols,
    isLoading: loading || (Boolean(userId) && saved.userId !== userId),
    userId,
    addInstrument,
    toggleInstrument,
    removeInstrument,
  };
}
