/**
 * Preview's own compose cache — B2689. Compose runs once per visit when
 * nothing about the inputs changed: a hash of the notes, the photo srcs and
 * the answers so far, held in `sessionStorage` per slug. Reopening Preview
 * with nothing changed reads the cached result and fires no call; any
 * change (new words, a new photo, a new answer) misses and composes again.
 *
 * `sessionStorage` rather than `localStorage`: a stale compose from a day
 * that was edited in another tab yesterday must not resurface today.
 * Wrapped in try/catch throughout — a private window or blocked storage
 * must never break Preview, only skip the cache.
 */

export type ComposeCacheKey = { username: string; tripId: string; slug: string };

function storageKey(key: ComposeCacheKey): string {
  return `fs.compose.${key.username}.${key.tripId}.${key.slug}`;
}

/** A small, fast, non-cryptographic hash — good enough to notice "nothing
 *  changed", never used for anything that needs to be collision-proof. */
export function hashInputs(notes: string, photoSrcs: string[], answers: string[]): string {
  const input = `${notes}\n::\n${photoSrcs.join(",")}\n::\n${answers.join("\n")}`;
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (Math.imul(31, h) + input.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

export function readComposeCache<T>(key: ComposeCacheKey, hash: string): T | null {
  try {
    const raw = window.sessionStorage.getItem(storageKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { hash: string; result: T };
    return parsed.hash === hash ? parsed.result : null;
  } catch {
    return null;
  }
}

export function writeComposeCache<T>(key: ComposeCacheKey, hash: string, result: T): void {
  try {
    window.sessionStorage.setItem(storageKey(key), JSON.stringify({ hash, result }));
  } catch {
    // A private window, or storage full/blocked — the cache is a nicety.
  }
}

export function clearComposeCache(key: ComposeCacheKey): void {
  try {
    window.sessionStorage.removeItem(storageKey(key));
  } catch {
    // Nothing to clear if storage was never reachable.
  }
}
