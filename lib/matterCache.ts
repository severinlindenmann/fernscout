import matter from "gray-matter";

/**
 * Forgets gray-matter's own parse cache — not any module's, gray-matter's.
 *
 * `matter()` memoizes a parse *by raw content*, globally, for the life of the
 * process, and it writes that cache entry before it parses rather than after
 * — so a call that throws leaves a half-built, non-throwing result sitting
 * under the failing text's key. The next caller to hand it the same bytes
 * (the same broken entry or `trip.md`, read again after some other file in
 * the trip — or some other trip in the journal — changed and forced a
 * re-read) gets that stale result back instead of the same failure
 * repeating, which is exactly the silent success this guard exists to
 * prevent: `readTrip` would stop throwing into its own `catch` and instead
 * refuse the folder for the wrong reason ("no id" rather than "unparseable").
 * Every catch around a `matter()` call in `lib/entries.ts`, `lib/trips.ts`
 * and `lib/api/entries.ts` clears it for that reason. B236, B312.
 *
 * This lives in its own leaf module, importing nothing but `gray-matter`, so
 * that `lib/entries.ts` and `lib/trips.ts` — which already import from each
 * other — can both call it without creating a cycle. B343.
 *
 * Not in gray-matter's own `.d.ts` — `clearCache` exists on the runtime
 * export but is absent from its published types — hence the cast.
 */
export function clearMatterCache(): void {
  (matter as unknown as { clearCache: () => void }).clearCache();
}
