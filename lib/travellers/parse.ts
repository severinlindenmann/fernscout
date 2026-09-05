import {
  ACCESSORIES,
  AGES,
  BUILDS,
  HAIR_STYLES,
  MAX_FIGURES,
  type Accessory,
  type Age,
  type Build,
  type Figure,
  type HairStyle,
} from "./vocabulary";

/**
 * The `travellers:` block — how the people on this trip are drawn.
 *
 * ## Why this is not part of `people:`
 *
 * The tempting shape is `people: [{ name, email, figure: {…} }]`, and it is
 * the one thing this parser exists to avoid. `parsePeople` in `lib/trips.ts`
 * fails **closed**: one malformed entry drops the whole list, deliberately,
 * because that list is *who may write to the trip*. Put a hair colour in there
 * and a typo in a hair colour revokes everybody's write access to the trip.
 *
 * So `travellers:` is a separate block with a separate parser, and this one
 * fails **open** in the opposite direction: an unrecognised value falls back
 * to the neutral default, a malformed figure is dropped on its own, and the
 * rest of the party still draws. Nothing here can change what `peopleOf()`
 * returns. `test/travellers-parse.test.ts` asserts that directly.
 *
 * The two are tied together by an optional `for:` carrying an email that
 * appears in `people:` — enough for the byline and the figures to agree,
 * without the parsers ever meeting.
 *
 * ## Where it fails closed instead
 *
 * On the write path, where somebody is listening: `travellersBlock` in
 * `lib/tripWrite.ts` refuses a bad value with a message naming it, rather
 * than writing a file the reader will then silently reinterpret.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A string field, or undefined — which reads as "unanswered", not "wrong". */
function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function oneOf<T extends string>(value: unknown, allowed: ReadonlyArray<T>): T | undefined {
  const v = text(value);
  return v && (allowed as ReadonlyArray<string>).includes(v) ? (v as T) : undefined;
}

function parseAccessories(value: unknown): Accessory[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: Accessory[] = [];
  for (const item of value) {
    const one = oneOf<Accessory>(item, ACCESSORIES);
    // Skipped rather than fatal: an unknown accessory is a word this version
    // does not draw, and the figure is still the person it describes.
    if (one && !out.includes(one)) out.push(one);
  }
  return out.length > 0 ? out : undefined;
}

/** One figure, or `null` when the entry is not a mapping at all. */
function parseFigure(raw: unknown): Figure | null {
  if (!isRecord(raw)) return null;
  const figure: Figure = {};

  const forWhom = text(raw.for);
  if (forWhom) figure.for = forWhom.toLowerCase();

  // Colours take a token or a hex code, and `colour()` in vocabulary.ts is
  // what decides which — so an unrecognised word survives to the renderer and
  // is resolved to the default there, in one place, rather than twice.
  for (const key of ["skin", "hair", "eyes", "shirt", "pants", "pack", "headscarf"] as const) {
    const value = text(raw[key]);
    if (value) figure[key] = value;
  }

  const style = oneOf<HairStyle>(raw.hairStyle, HAIR_STYLES);
  if (style) figure.hairStyle = style;

  const build = oneOf<Build>(raw.build, BUILDS);
  if (build) figure.build = build;

  const age = oneOf<Age>(raw.age, AGES);
  if (age) figure.age = age;

  const accessories = parseAccessories(raw.accessories);
  if (accessories) figure.accessories = accessories;

  return figure;
}

/**
 * Read a `travellers:` block from frontmatter or from a journal's config.
 *
 * `where` names the file in any warning, and warnings are all this does when
 * something is wrong — see the header. An absent block yields `[]`, which
 * every caller reads as "the journal's default party", and ultimately as one
 * neutral figure.
 */
export function parseTravellers(raw: unknown, where: string): Figure[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    console.warn(`[travellers] ${where} has a travellers: block that is not a list — ignoring it.`);
    return [];
  }

  const figures: Figure[] = [];
  for (const item of raw) {
    if (figures.length >= MAX_FIGURES) {
      console.warn(
        `[travellers] ${where} draws more than ${MAX_FIGURES} travellers — ` +
          `keeping the first ${MAX_FIGURES}.`,
      );
      break;
    }
    const figure = parseFigure(item);
    if (figure) {
      figures.push(figure);
    } else {
      // Dropped alone, and the party still draws. The opposite of
      // `parsePeople`, and the whole reason this is a separate parser.
      console.warn(`[travellers] ${where} has a travellers: entry that is not a mapping — skipping it.`);
    }
  }
  return figures;
}

/**
 * The party actually drawn, given what the trip says and what the journal
 * says.
 *
 * A trip's own block wins outright rather than merging: a trip is who was on
 * *it*, and a half-merged party would put last year's travellers into this
 * year's group photograph. Absent everywhere is **one neutral figure** — not
 * the two that used to be hard-coded into every journal on earth.
 */
export function partyFor(tripFigures: Figure[], journalFigures: Figure[]): Figure[] {
  if (tripFigures.length > 0) return tripFigures;
  if (journalFigures.length > 0) return journalFigures;
  return [{}];
}
