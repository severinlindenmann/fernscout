// Pure helpers for `FigureCreator` (B2021) — no fs, no fetch, so the studio
// component and its server doors can both import this and a unit test needs
// nothing running.
import type { Figure } from "../travellers/vocabulary";
import { resolvePreset } from "../travellers/presets";
import type { FigureDoc } from "../api/v2/schemas/figures";

// The same pattern `ID_RE` in `lib/tripWrite.ts` checks a figure id against
// (lowercase words joined by hyphens) — copied rather than imported: this
// file is reached from a client component (`FigureCreator`), and
// `tripWrite.ts` drags in the database layer behind it. A regex is cheap
// enough to keep in step by hand; `test/figures-creator.test.ts` and
// `test/api-v2-figures.test.ts` both exercise real ids against it, so the
// two drifting apart would fail loudly rather than silently.
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Apply a starting look onto whatever the person has already chosen.
 *
 * A preset only ever names `skin`, `hair`, `hairStyle`, `eyes` and `shirt`
 * (see `travellers/presets.ts`) — everything else on `current` (an outfit
 * already picked, an accessory, a build) survives the tap untouched, and so
 * does `id`/`name`/`person`, which no preset has ever heard of. `null` for an
 * unknown preset name leaves `current` exactly as it was — the caller asked
 * for something that does not exist, not for the figure to be cleared.
 */
export function applyPreset(
  current: Partial<FigureDoc>,
  presetName: string,
): Partial<FigureDoc> {
  const preset = resolvePreset(presetName);
  if (!preset) return current;
  return { ...current, ...preset };
}

/**
 * How a starting-look tile names itself — "long hair, coral": the hair
 * style and the shirt colour, with the hair's own colour named too only
 * when it is not black.
 *
 * Nine of the twelve starting points (`travellers/presets.ts`) use black
 * hair; naming it on all twelve would be noise on nine of them, and the
 * three that differ (blond, dark-brown twice) would say nothing louder for
 * it. This is a labelling choice about which twelve tiles look like a
 * meaningful set at a glance — distinct from, and not to be confused with,
 * the renderer's own fallback for an *absent* `hair` field elsewhere
 * (`dark-brown`, `lib/travellers/shapes.ts`): every preset here always
 * names a hair colour, so that fallback never actually applies to one.
 */
export function presetTileLabel(figure: Figure): string {
  const words = (s: string) => s.replace(/-/g, " ");
  const parts: string[] = [];
  if (figure.hairStyle) parts.push(`${words(figure.hairStyle)} hair`);
  if (figure.hair && figure.hair !== "black") parts.push(words(figure.hair));
  if (figure.shirt) parts.push(words(figure.shirt));
  return parts.join(", ");
}

/** Only these axes are ever proposed from a photograph — see the ticket:
 *  "never build or age even if the helper returns them". Also never `pants`
 *  or `outfit`, which the photo screen does not show at all. */
const PROPOSABLE_FIELDS = ["skin", "hair", "hairStyle", "eyes", "shirt"] as const;

/** "glasses or hat" is the whole of what the photo path proposes as an
 *  accessory — sunglasses, a cap, a beanie and the rest are left for the
 *  person to add by hand on the shaping screen. */
const PROPOSABLE_ACCESSORIES = new Set(["glasses", "hat"]);

export type PhotoProposal = { figure: Figure; unanswerable: string[] };

/**
 * Narrow one classification from `classifyTravellers` down to what the
 * creator is allowed to show as a proposal.
 *
 * `unanswerable` is filtered the same way the figure is: a field this
 * function will never propose (`build`, `age`, `pants`, `outfit`) has no
 * business being reported as "the photo didn't answer this" either — that
 * would read as a gap in a screen that never asked the question.
 */
export function filterPhotoProposal(result: PhotoProposal): PhotoProposal {
  const figure: Figure = {};
  for (const field of PROPOSABLE_FIELDS) {
    const value = result.figure[field];
    if (value !== undefined) (figure as Record<string, unknown>)[field] = value;
  }
  if (result.figure.accessories) {
    const kept = result.figure.accessories.filter((a) => PROPOSABLE_ACCESSORIES.has(a));
    if (kept.length > 0) figure.accessories = kept as Figure["accessories"];
  }
  const reportable = new Set<string>([...PROPOSABLE_FIELDS, "accessories"]);
  const unanswerable = result.unanswerable.filter((field) => reportable.has(field));
  return { figure, unanswerable };
}

/**
 * A figure id from a person's name — client-chosen, so this is the one
 * place that chooses it on their behalf. Lowercase words joined by hyphens,
 * matching `ID_RE`; a name with nothing left after that (all punctuation, an
 * empty string) falls back to `"figure"` rather than handing the PUT an
 * empty id. `existing` is checked in the order given, so pass ids already
 * sorted however the caller wants ties broken.
 */
export function deriveFigureId(name: string, existing: readonly string[] = []): string {
  const base =
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "figure";
  const id = ID_RE.test(base) ? base : "figure";
  if (!existing.includes(id)) return id;
  let n = 2;
  while (existing.includes(`${id}-${n}`)) n += 1;
  return `${id}-${n}`;
}
