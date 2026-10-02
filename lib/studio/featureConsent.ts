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

/** The two features Write gates on. `translate` (Preview's own, B2677) and
 *  any other helper-backed feature are not this ticket's concern. */
export type ConsentFeature = "voice" | "suggest";

/**
 * Which of the three API scopes `feature` still needs — empty once nothing
 * is left to ask. `voice` needs only `speech` (Deepgram hears the owner's
 * words, nothing else); `suggest` — today, reading a receipt — needs both
 * `words` and `photos`, since the photograph and what is read off it both
 * go to the same model call.
 */
export function missingConsentScopes(feature: ConsentFeature, consents: ConsentScopes): Array<keyof ConsentScopes> {
  const needed: Array<keyof ConsentScopes> = feature === "voice" ? ["speech"] : ["words", "photos"];
  return needed.filter((scope) => !consents[scope]);
}

/** Whether `feature` may run right now with no further ask. */
export function hasConsentFor(feature: ConsentFeature, consents: ConsentScopes): boolean {
  return missingConsentScopes(feature, consents).length === 0;
}
