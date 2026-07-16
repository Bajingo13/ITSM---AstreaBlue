const RELOAD_KEY = "astreablue:chunk-recovery-at";
const RELOAD_COOLDOWN_MS = 15_000;

export function isChunkLoadError(value) {
  const message = String(value?.message || value?.reason?.message || value || "");
  return /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|expected a javascript-or-wasm module script|mime type.*text\/html/i.test(message);
}

export function recoverFromStaleChunk(error) {
  if (!isChunkLoadError(error)) return false;

  const now = Date.now();
  const previousReload = Number.parseInt(window.sessionStorage.getItem(RELOAD_KEY) || "0", 10);
  if (Number.isFinite(previousReload) && now - previousReload < RELOAD_COOLDOWN_MS) return false;

  window.sessionStorage.setItem(RELOAD_KEY, String(now));
  window.location.reload();
  return true;
}

export function installChunkRecovery() {
  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    recoverFromStaleChunk(event.payload || event);
  });

  window.addEventListener("unhandledrejection", (event) => {
    if (recoverFromStaleChunk(event.reason)) event.preventDefault();
  });
}
