"use client";

/**
 * The worker's own caches, shared between `ThisPhone`'s owner-only *Clear
 * cache* row and `OfflineTrips`' *Clear saved trips* button for every reader
 * — B2463. One function rather than two copies of the same regex and
 * `KEPT_CHANGED` dispatch, which is the whole of what B2463's Work section
 * asked for here ("reusing clearCache()'s logic — extract it rather than
 * copy"). `KEPT_CHANGED` itself stays imported from `KeepTrip.tsx` at each
 * call site rather than re-exported from here, to keep this file free of
 * anything React.
 */
export async function clearKeptCaches(): Promise<{ freed: number }> {
  try {
    const before = (await navigator.storage?.estimate?.())?.usage ?? 0;
    const names = (await caches.keys()).filter((n) => /^(shell|runtime|kept)-/.test(n));
    await Promise.all(names.map((n) => caches.delete(n)));
    // Re-run the worker's install so the offline page is precached again.
    void navigator.serviceWorker?.getRegistration().then((r) => r?.update()).catch(() => undefined);
    const after = (await navigator.storage?.estimate?.())?.usage ?? 0;
    return { freed: Math.max(0, before - after) };
  } catch {
    return { freed: 0 };
  }
}
