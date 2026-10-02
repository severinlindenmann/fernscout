/**
 * Deepgram keyterms built from the trip itself — B2691.
 *
 * Nova-3 mishears "Széchenyi" or a companion's own name because it has no
 * way to know either word exists; a keyterm is how it is told. Built only
 * from what the trip already carries — a day's own place name, a travelling
 * companion's name or nickname — and **never an email address**, which is
 * not something to hand a transcription provider.
 *
 * Pure: no fs, no network, so the cap and the no-email, no-duplicate rules
 * are checkable without a trip on disk — `lib/entries.ts`'s `getPlaces` and
 * a `Trip`'s own `people` are what a caller passes in.
 */

/** Deepgram's own `keyterm` ceiling for Nova-3 is per-request, not
 *  documented as an exact number as of this writing; 50 terms is a trip's
 *  own vocabulary comfortably, and nowhere near "pass every word a journal
 *  has ever used". */
export const KEYTERM_MAX_COUNT = 50;
/** Nova-3's own per-term character ceiling. */
export const KEYTERM_MAX_CHARS = 50;

export function keytermsFor(
  places: { location: string }[],
  people: { name: string; nickname?: string }[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (raw: string | undefined) => {
    if (out.length >= KEYTERM_MAX_COUNT) return;
    const term = (raw ?? "").trim();
    if (term === "" || term.length > KEYTERM_MAX_CHARS) return;
    const key = term.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(term);
  };
  for (const place of places) add(place.location);
  for (const person of people) {
    // Nickname first: it is what a journal's own words actually call them,
    // and the more likely word to turn up spoken aloud.
    add(person.nickname);
    add(person.name);
  }
  return out;
}
