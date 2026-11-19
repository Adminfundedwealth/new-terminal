const CHUNK_RECOVERY_KEY = "fundedwealth:chunk-recovery-attempted";

type RecoveryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function shouldReloadAfterChunkLoadError(storage: RecoveryStorage): boolean {
  if (storage.getItem(CHUNK_RECOVERY_KEY) === "1") {
    return false;
  }

  storage.setItem(CHUNK_RECOVERY_KEY, "1");
  return true;
}

export function clearChunkRecoveryAttempt(storage: RecoveryStorage): void {
  storage.removeItem(CHUNK_RECOVERY_KEY);
}

export function installChunkLoadRecovery(
  target: Window,
  storage: RecoveryStorage,
  reload: () => void = () => target.location.reload(),
): () => void {
  const handlePreloadError = (event: Event) => {
    if (!shouldReloadAfterChunkLoadError(storage)) {
      return;
    }

    event.preventDefault();
    reload();
  };

  target.addEventListener("vite:preloadError", handlePreloadError);
  return () => target.removeEventListener("vite:preloadError", handlePreloadError);
}
