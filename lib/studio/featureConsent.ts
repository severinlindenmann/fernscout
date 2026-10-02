/**
 * Per-feature consent, asked once on first use — B2676 (V2.1, decision D8).
 *
 * The old flow asked one "with or without the assistant" question up front,
 * behind which every helper-backed thing on the page sat gated — and the
 * gate itself was the bug the owner filed (P1): it failed silently and came
 * back every time the switch was turned on, because the screen conflated
 * three different permissions (speech, and two different uses of the words
 * model) into one yes/no.
 *
 * Here each *feature* names the scopes it actually needs, and this module
 * only ever answers one question: given what has already been agreed to
 * (`/api/helper/{user}/consent`'s own three scopes), is there anything left
 * to ask before this feature may run. Pure — no fetch, no store — so the
 * sheet that asks and the route that records the "yes" stay exactly where
 * they already are; this is only the decision between them.
 */

/** The three scopes `POST /api/helper/{user}/consent` already records. */
export type ConsentScopes = { words: boolean; photos: boolean; speech: boolean };

/** `translate` (Preview's own, B2677) needs `words` only — no photo ever
 *  goes with a translation. */
export type ConsentFeature = "voice" | "suggest" | "translate";

/**
 * Which of the three API scopes `feature` still needs — empty once nothing
 * is left to ask. `voice` needs only `speech` (Deepgram hears the owner's
 * words, nothing else); `suggest` — tidied words, titles, captions, tags —
 * and `translate` both go to the words model, but only `suggest` also reads
 * a photograph (captions, tags from photos).
 */
export function missingConsentScopes(feature: ConsentFeature, consents: ConsentScopes): Array<keyof ConsentScopes> {
  const needed: Array<keyof ConsentScopes> =
    feature === "voice" ? ["speech"] : feature === "translate" ? ["words"] : ["words", "photos"];
  return needed.filter((scope) => !consents[scope]);
}

/** Whether `feature` may run right now with no further ask. */
export function hasConsentFor(feature: ConsentFeature, consents: ConsentScopes): boolean {
  return missingConsentScopes(feature, consents).length === 0;
}
