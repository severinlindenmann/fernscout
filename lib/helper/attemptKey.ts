/**
 * A per-attempt idempotency key that is not derived from content — B719.
 *
 * The wizard used to build a write-day key as `${trip}/${slug}/${prose.length}`,
 * so two different edits that happened to be the same number of characters
 * shared a key. The server's `fingerprintOf` check (`lib/idempotency.ts`) then
 * saw a key it already had an answer for, under a different body, and
 * answered `409` rather than writing the second edit up.
 *
 * The fix: a random key per distinct piece of content. Content already seen
 * gets its key back — that is what lets a genuine retry (the same tap, again,
 * after a timeout) replay rather than spend a second credit — and content
 * never seen before gets a fresh random one, so two edits can never collide
 * just because they happen to be the same length.
 */
export function attemptKeyFor(store: Map<string, string>, content: string): string {
  const existing = store.get(content);
  if (existing) return existing;
  const key = crypto.randomUUID();
  store.set(content, key);
  return key;
}
