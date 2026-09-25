/**
 * The trip id slug rule — B2008.
 *
 * Shared by the three places that used to carry their own copy: `idFrom` in
 * `app/api/helper/[user]/trip/route.ts`, `previewId` in
 * `components/studio/trip/NewTripFlow.tsx`, and `idFrom` in
 * `lib/extract/commit.ts`. Client-safe on purpose (no `server-only` import)
 * so the preview can call the exact function the server does — the two
 * copies drifting was the bug.
 */

/** Any text into a trip-id slug — also the address section's suggestion (B2139). */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip the diacritics NFKD split off, not the letter under them
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * A title and a start date into the base of a trip id — no collision
 * suffix, that's the caller's own job against its own journal. When the
 * slugified title already ends in the start year (a title like "Asien
 * 2027"), the year is not appended a second time.
 */
export function tripIdBase(title: string, start: string): string {
  const year = start.slice(0, 4);
  const titleSlug = slugify(title);
  const base = titleSlug === year || titleSlug.endsWith(`-${year}`) ? titleSlug : slugify(`${title}-${year}`);
  return base || `trip-${year}`;
}
