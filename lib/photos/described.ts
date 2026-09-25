import { z } from "zod";

/**
 * The shape of what a model may say about one photograph — B1866, design
 * "Bildwissen und Auswahlregeln" §2 as corrected by its Prüfung.
 *
 * A pure module: no `server-only`, no I/O, no model. It is the one place the
 * form is described, so the JSON schema sent to the API and the check applied
 * to a block read back out of a sidecar are the same statement rather than two
 * that have to be kept in step.
 *
 * Three texts and not one, because they answer three different questions about
 * the same pixels: a caption is what a person would print under the picture,
 * alt text is what somebody who cannot see it needs said, and a long
 * description exists only when there is genuinely more to say about it (a map,
 * a menu, a group) — more to *say*, never more to *transcribe*: a photograph
 * of a document is described by its kind, and what it says stays in the
 * picture (B1890). Each is per journal locale — `localesFor(user)` decides
 * which, never this file — because a journal in three languages needs the
 * alt text in three languages or it has it in none.
 *
 * `tags` is a set drawn from a vocabulary handed to the model in the prompt,
 * not a frozen enum in a contract: the list below can grow without a schema
 * version, and anything outside it is dropped after parsing rather than
 * failing the answer.
 */

/** Bumped when the form below stops meaning what a stored block meant. A
 *  sidecar carrying an older version is re-described, never migrated. */
export const DESCRIBED_SCHEMA_VERSION = 1;

/** The whole vocabulary, offered to the model in the prompt and enforced in
 *  code after the answer comes back. Not part of any API contract.
 *
 *  `document` means paper somebody is meant to read — a ticket, a menu, a
 *  form, a certificate, a sign — because B1956 reads it to mean "paper with
 *  words, do not open a spread with two of these", and a tag meaning two
 *  things is a rule that misfires (B1960). `packaging` is the word that keeps
 *  it single: a sweep of 1,269 backfilled blocks found medicine boxes and
 *  blister packs tagged `document` for want of anywhere else to put them, and
 *  saying so in prose did not hold — the model needed a word that fits.
 *  `screenshot` is an image of a screen and never a photograph of print.
 *  Adding a word costs no schema version: a tag outside this list is dropped
 *  after parsing, so an older block simply never carries the new one. */
export const DESCRIBED_TAG_VOCABULARY = [
  "portrait",
  "group",
  "crowd",
  "landscape",
  "seascape",
  "cityscape",
  "architecture",
  "interior",
  "food",
  "drink",
  "vehicle",
  "animal",
  "plant",
  "sport",
  "celebration",
  "night",
  "detail",
  "document",
  "packaging",
  "screenshot",
  "artwork",
] as const;

/**
 * `document` means paper and only paper — B1960, and the edge B1956 reads.
 *
 * The prompt says so at the point of choice and it mostly holds, but a
 * blister pack still came back `document, packaging` and a phone screen
 * `screenshot, document`: the model adds the word rather than choosing it.
 * These two are exclusive by definition rather than by taste, so the one
 * thing code can settle, code settles.
 */
export function settleDocumentTag(tags: readonly string[]): string[] {
  const exclusive = tags.includes("packaging") || tags.includes("screenshot");
  return tags.filter((tag) => !(exclusive && tag === "document"));
}

/** What alt text may be, in characters. A screen reader announces the whole of
 *  it; past this it stops being a description and starts being the article. */
export const ALT_TEXT_LIMIT = 250;

/** One field per locale, spelled out rather than a `z.record`, so the JSON
 *  schema carries `properties` + `required` + `additionalProperties: false` —
 *  which is what a structured output needs to constrain anything at all. */
function perLocale<T extends z.ZodTypeAny>(locales: readonly string[], value: T) {
  return z.object(Object.fromEntries(locales.map((code) => [code, value])) as Record<string, T>);
}

/**
 * The form one photograph comes back as, for the journal's own locales.
 *
 * No length constraint lives here: structured outputs reject `maxLength`, and
 * a limit the model is told about but the code does not enforce is not a
 * limit. `describeImage` truncates after parsing.
 */
export function describedFormSchema(locales: readonly string[]) {
  return z.object({
    /** A suggestion for the printed caption. `""` when nothing is safe to say. */
    caption: perLocale(locales, z.string()),
    /** One sentence of what is visible. `""` when nothing is safe to say. */
    altText: perLocale(locales, z.string()),
    /** Two to four sentences, only when the image needs them; `null` otherwise.
     *  Never a transcription — see the header, and `describeImageSystemPrompt`. */
    // `z.literal(null)` rather than `.nullable()`: Zod folds the latter into
    // `type: ["string", "null"]`, and a structured output's documented schema
    // subset covers `anyOf` and `const` but says nothing about a type array.
    longDescription: perLocale(locales, z.union([z.string(), z.literal(null)])),
    tags: z.array(z.string()),
    confidence: z.enum(["high", "medium", "low"]),
    /**
     * Where the subject is — the review of 2026-09-22 (Åland p. 6/12,
     * Algarve p. 8): a column crop anchored at the centre cut people in
     * half because nothing said where they were. Fractions of the frame,
     * `x`/`y` the top-left corner; `null` when the picture has no one
     * subject (a landscape, a texture). The planner turns the centre into
     * `BookPhoto.focal` and the box into "can this crop hold it".
     */
    subject: z.union([
      z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
      z.literal(null),
    ]),
    /** Visible people, counted. `0` for none. Integer after `clampSignals`. */
    people: z.number(),
    /** "Would I print this in a photobook", 1 (no) to 5 (yes). */
    printworthiness: z.number(),
  });
}

export type DescribedForm = z.infer<ReturnType<typeof describedFormSchema>>;

/**
 * What a *stored* block may lack — the three signals arrived after 1 500
 * photographs had already been described (2026-09-22), and a block from
 * before is still a full answer for everything it does say. Optional here,
 * required in `describedFormSchema` so the model is never allowed to skip
 * them. Same `DESCRIBED_SCHEMA_VERSION`: bumping it would null every stored
 * block and strip alt text from every page until somebody paid to redo it.
 */
function describedStoredSchema(locales: readonly string[]) {
  return describedFormSchema(locales).partial({ subject: true, people: true, printworthiness: true });
}

/** Clamp what the model said about the three signals into their ranges —
 * structured outputs cannot enforce a minimum, so the code does, the same
 * way `ALT_TEXT_LIMIT` is applied after parsing rather than asked for. */
export function clampSignals<T extends Pick<DescribedForm, "subject" | "people" | "printworthiness">>(form: T): T {
  // Rounded to six decimal places: a fraction of a frame does not need more
  // precision than that, and `1 - 0.9` in floating point is 0.09999999999999998
  // without it — a rectangle a person typed as round numbers coming back not
  // round at all.
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  const unit = (n: number) => round(Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0)));
  let subject: DescribedForm["subject"] = null;
  if (form.subject) {
    const x = unit(form.subject.x);
    const y = unit(form.subject.y);
    const width = round(Math.min(1 - x, unit(form.subject.width)));
    const height = round(Math.min(1 - y, unit(form.subject.height)));
    subject = width > 0 && height > 0 ? { x, y, width, height } : null;
  }
  const people = Math.max(0, Math.floor(Number.isFinite(form.people) ? form.people : 0));
  const printworthiness = Math.min(5, Math.max(1, Math.round(Number.isFinite(form.printworthiness) ? form.printworthiness : 3)));
  return { ...form, subject, people, printworthiness };
}

/** The form plus what makes a stored block answerable: when it was written,
 *  by which model, against which schema, and for which exact bytes. */
export type Described = z.infer<ReturnType<typeof describedStoredSchema>> & {
  at: string;
  model: string;
  schemaVersion: number;
  contentHash: string;
};

/**
 * Read a stored block back. A malformed one is `null` — absent, never a
 * half-answer: the ticket's own rule, and the reason the sidecar can be
 * hand-edited without a way to poison a caption.
 */
export function parseDescribed(value: unknown, locales: readonly string[]): Described | null {
  const result = describedStoredSchema(locales)
    .extend({
      at: z.string(),
      model: z.string(),
      schemaVersion: z.number(),
      contentHash: z.string(),
    })
    .safeParse(value);
  return result.success ? result.data : null;
}

/**
 * An answer with no caption is not an answer — B1923.
 *
 * `describeImage` came back once with all four fields empty and
 * `confidence: "high"`, and the block was written; because a stored block is
 * keyed by the content hash, that photograph was then done forever, with an
 * empty string standing in for alt text on a page that believed it had some.
 * Measured over 32 calls on the owner's own photographs it reproduces on
 * replica weapons and nowhere else, so refusing it here is cheap and refusing
 * it here is also the only place that holds whatever the prompt says next.
 *
 * Empty in *any* locale, not all: a journal in three languages with a caption
 * in two has it in none, and the measurement found no answer that was empty
 * in only some. A refused answer is not written, so the photograph stays
 * pending — a state the code already handles — rather than described as
 * nothing.
 */
export function captionIsEmpty(form: DescribedForm): boolean {
  return Object.values(form.caption).some((text) => !text.trim());
}
