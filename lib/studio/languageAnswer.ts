/**
 * Preview's languages row (B2677, item 4) — the owner's answer for a trip
 * ("✦ Translate" / "Write it myself" / "<language> is fine") is remembered
 * per trip, so it is a fact on the next day rather than a question asked
 * again. `localStorage` is fine for this (B2677's own words) — it is a
 * convenience that saves a tap, never the record of what was actually
 * declined or translated, which the day document itself carries.
 */
export type LanguageAnswer = "translate" | "mine" | "default";

function key(username: string, tripId: string): string {
  return `fs.studio.lang.${username}.${tripId}`;
}

export function readLanguageAnswer(username: string, tripId: string): LanguageAnswer | null {
  try {
    const raw = window.localStorage.getItem(key(username, tripId));
    return raw === "translate" || raw === "mine" || raw === "default" ? raw : null;
  } catch {
    return null;
  }
}

export function saveLanguageAnswer(username: string, tripId: string, answer: LanguageAnswer): void {
  try {
    window.localStorage.setItem(key(username, tripId), answer);
  } catch {
    // A browser with no storage still works; it just asks again next time.
  }
}
