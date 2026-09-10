/**
 * What the wizard at `/agent/<user>` knows about a half-written day — B682.
 *
 * Deliberately client-safe (no `server-only`): the page derives this on the
 * server from the entries on disk, and the wizard re-derives the same answer
 * in the browser after every write, so both sides have to agree about what
 * "unfinished" means.
 *
 * **There is no wizard-position field anywhere**, and that is the whole design
 * (`docs/plans/2026-09-07-web-helper-agent.md` §1). The step is a function of
 * the draft, so a killed tab, a second phone and a day somebody else's agent
 * wrote all resolve to the same place — and there is no second copy of the
 * fact to disagree with the first.
 */

/**
 * The `content` a day is created with, before anybody has written anything.
 *
 * A day cannot be created without prose — `validateDraft` requires it — but
 * the draft has to exist as soon as the trip and the date are known, or a
 * closed tab loses the photographs. So it is created with an ellipsis, which
 * is the one string that is honestly *nothing*: no weather nobody mentioned,
 * no day nobody described. The words step replaces it, and `written` below is
 * how everything else knows it has not been replaced yet.
 */
export const NO_PROSE = "…";

/** One unfinished day, as both the page and the wizard see it. */
export type WizardDraft = {
  /** The trip id within this journal — not a full ref. */
  trip: string;
  slug: string;
  date: string;
  title: string;
  /** How many photographs are on the day right now. */
  photos: number;
  /** Whether the prose is a person's rather than `NO_PROSE`. */
  written: boolean;
  /**
   * Whether the day is on the site already — B816. Absent means a draft,
   * which is what everything written here starts as.
   *
   * The wizard holds a published day so a typo can be fixed and a forgotten
   * photograph added, and this is the one field that changes what the screen
   * *says*: saving a published day changes what people can already read, and
   * the publish button is a takedown instead. It changes no write — `PATCH`
   * cannot publish and cannot unpublish, before this field existed or after.
   */
  published?: true;
  /** Whether the day carries coordinates — B1218 (D48): the "look the
   *  weather up" chip only ever offers itself where a lookup could answer,
   *  never as a guess about a day that has none. */
  hasCoordinates?: true;
};

export const WIZARD_STEPS = ["trip", "date", "photos", "words", "preview", "publish"] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

/** Whether this day's prose is somebody's words rather than the placeholder. */
export function isWritten(content: string): boolean {
  return content.trim() !== "" && content.trim() !== NO_PROSE;
}

/**
 * Where a person picking this up again should land.
 *
 * The earliest step that is not answered yet, so somebody who left after the
 * photographs returns to the words rather than to the top. A day that has
 * everything lands on the preview — never on `publish`, which is a button
 * somebody presses and not a state a machine can arrive at by itself.
 *
 * `"date"` is never returned, and that is not an omission: the trip and the
 * date are asked on one screen, because the answer to one is usually the
 * answer to the other — the photographs say which day it was, and the day says
 * which trip it belongs to. Two screens would have been two taps to say one
 * thing. It stays in `WIZARD_STEPS` because it is a step of the flow the
 * screen carries out, and because the six names are what a person is counting.
 */
export function stepFor(draft: WizardDraft | null): WizardStep {
  if (!draft) return "trip";
  if (draft.photos === 0) return "photos";
  if (!draft.written) return "words";
  return "preview";
}

/**
 * The step a way back leads to, or `null` on the first screen — B769.
 *
 * Cheap for the same reason `stepFor` is: nothing is unwound, because nothing
 * about where somebody is standing is written down. Going back shows an
 * earlier screen; the day on disk, and the photographs still climbing out of
 * the queue, carry on exactly as they were.
 *
 * `"publish"` leads back to the words rather than the preview, because the
 * preview is what a person is looking at when they reach it — the two are one
 * screen, as `stepFor`'s own note about `"date"` explains for the other pair.
 */
export function backFrom(step: WizardStep): "trip" | "photos" | "words" | null {
  if (step === "trip" || step === "date") return null;
  if (step === "photos") return "trip";
  if (step === "words") return "photos";
  return "words";
}
