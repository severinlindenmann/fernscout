import type { PackKind } from "./dayContext";
import { CAPITALISED, NUMBER_PATTERN, UNIT_PATTERN, WORD_PATTERN, normalise, stem, titleIsGroundedInNotes, wordStems } from "./polishGuard";

/**
 * The code checks on a composed day — B2688.
 *
 * `compose` (lib/helper/compose.ts) asks the model to say, per sentence,
 * which pack items it rests on. That is what makes these checks possible at
 * all: a sentence is judged against the text of its *own* cited items, not
 * against everything the day carries. Pure functions over the pack's items
 * and the model's output — nothing here calls anything.
 *
 * What is checked, per variant (`close`, `story`):
 * 1. every cited id exists in the pack (a voice sample is never citable);
 * 2. a sentence's capitalised words, numbers and units appear (stem match)
 *    in its own cited items; a sentence with no sources carries no longer
 *    word the pack never had;
 * 3. a clock time (HH:MM) only from the owner's notes or answers, never a
 *    camera clock; a month or weekday name agrees with the day's date;
 * 4. no banned machine phrase unless the owner wrote it (`bannedHits`,
 *    which the caller retries once);
 * 5. "we" only when the party is bigger than one or the notes say it;
 * 6. a name or number found only in a voice sample is a leak;
 * 7. length: story ≤ 3× the owner's words, close ≤ 1.3× (plus a little);
 * 8. titles grounded in the pack, and a `quote` title is in the notes —
 *    a failing title is dropped, never its variant (`keptTitles`).
 *
 * ponytail: stems are the first five letters (polishGuard's `stem`), number
 * words ("three") are not checked, and Hungarian "mi" is both "we" and
 * "what". A real tokenizer or a verifier call (B2692) is the upgrade if a
 * miss turns up; the owner's own read of the proposal stays the last guard.
 */

export type GuardItem = { id: string; kind: PackKind; text: string };
export type ComposeSentence = { text: string; sources: string[] };
export type TitleKind = "label" | "quote" | "pair";
export type ComposeTitle = { text: string; kind: TitleKind; sources: string[] };
export type ComposeVariant = { titles: ComposeTitle[]; paragraphs: { sentences: ComposeSentence[] }[] };

export type GuardContext = {
  /** Every citable item: the pack minus voice samples, plus trip, companions
   *  and the owner's answers. */
  items: GuardItem[];
  /** Voice-sample texts — style only, never a source. */
  voice: string[];
  /** The day's date, YYYY-MM-DD. */
  date: string;
  partySize?: number;
  /** Languages whose banned list applies (output's and journal's). */
  languages: string[];
};

export type VariantVerdict = { ok: boolean; reasons: string[]; banned: string[] };

/** Words readers recognise as machine-written, per locale (B2688 spec). A
 *  phrase is matched at a word start, so "unvergesslich" also catches
 *  "unvergessliche". Exported as data: the prompt interpolates it. */
export const BANNED_PHRASES: Record<string, readonly string[]> = {
  en: [
    "unforgettable",
    "breathtaking",
    "hidden gem",
    "nestled",
    "vibrant",
    "bustling",
    "a testament to",
    "soak in the atmosphere",
    "soak up the atmosphere",
    "feast for the senses",
    "couldn't help but",
    "little did we know",
    "memories that will last a lifetime",
    "perfect end to a perfect day",
    "delve",
    "truly",
    "magical",
    "in the heart of",
    "boasts",
    "quaint",
    "charming",
    "stunning",
  ],
  de: ["unvergesslich", "atemberaubend", "Geheimtipp", "malerisch", "pulsierend", "ein Muss", "wie im Märchen", "rundum gelungen"],
  fr: ["inoubliable", "à couper le souffle", "niché", "incontournable", "magique"],
  it: ["indimenticabile", "mozzafiato", "incastonato", "imperdibile", "magico"],
  hu: ["felejthetetlen", "lélegzetelállító", "mesés", "varázslatos"],
};

/** A whole string, accent-free and lowercase, with every run of non-letters
 *  turned into one space and a space at either end — so a phrase can be
 *  looked for at a word start with a plain `includes`. */
function flat(text: string): string {
  return ` ${normalise(text).replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
}

const NOTE_ID = /^[na]\d+$/;
/** The owner's own words: notes, answers, their own photo captions. */
function isNote(id: string): boolean {
  return NOTE_ID.test(id) || id.endsWith("-caption");
}

export function notesText(items: GuardItem[]): string {
  return items
    .filter((i) => isNote(i.id))
    .map((i) => i.text)
    .join("\n");
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** The owner's words, counted — the base every length cap is measured from. */
export function ownerWordCount(items: GuardItem[]): number {
  return wordCount(notesText(items));
}

/** Banned phrases in `text`, skipping any the owner's own notes use. */
export function bannedHits(text: string, languages: string[], notes: string): string[] {
  const hay = flat(text);
  const own = flat(notes);
  const hits: string[] = [];
  for (const lang of new Set(languages)) {
    for (const phrase of BANNED_PHRASES[lang] ?? []) {
      const needle = ` ${flat(phrase).trim()}`;
      if (hay.includes(needle) && !own.includes(needle)) hits.push(phrase);
    }
  }
  return hits;
}

const CLOCK_PATTERN = /\b(?:[01]?\d|2[0-3]):[0-5]\d\b/g;

const WE_WORDS = new Set([
  "we", "us", "our", "ours", "ourselves",
  "wir", "uns", "unser", "unsere", "unseren", "unserem", "unserer", "unseres",
  "nous", "notre", "nos",
  "noi", "nostro", "nostra", "nostri", "nostre",
  "mi", "minket", "mienk",
]);

function usesWe(text: string): string | undefined {
  for (const m of text.matchAll(WORD_PATTERN)) {
    if (WE_WORDS.has(normalise(m[0]))) return m[0];
  }
  return undefined;
}

const CAL_LOCALES = ["en", "de", "fr", "it", "hu"] as const;
/** Months and weekdays are lowercase in these, so a lowercase match counts;
 *  in en/de only a capitalised one does ("may", "march" are verbs). */
const LOWERCASE_CAL = new Set(["fr", "it", "hu"]);

type CalNames = { any: Map<string, Set<string>> };
let calendar: CalNames | null = null;

/** Every month and weekday name, normalised, mapped to the locales that use
 *  it — built once from `Intl`, no hand-kept list. */
function calendarNames(): CalNames {
  if (calendar) return calendar;
  const any = new Map<string, Set<string>>();
  const add = (name: string, locale: string) => {
    const key = normalise(name);
    if (!any.has(key)) any.set(key, new Set());
    any.get(key)!.add(locale);
  };
  for (const locale of CAL_LOCALES) {
    for (let m = 0; m < 12; m++) {
      add(new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(Date.UTC(2024, m, 1)), locale);
    }
    for (let d = 0; d < 7; d++) {
      add(new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(Date.UTC(2024, 0, 1 + d)), locale);
    }
  }
  calendar = { any };
  return calendar;
}

function namesOfDate(date: string): Set<string> {
  const out = new Set<string>();
  const t = Date.parse(`${date}T12:00:00Z`);
  if (!Number.isFinite(t)) return out;
  for (const locale of CAL_LOCALES) {
    out.add(normalise(new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(t)));
    out.add(normalise(new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(t)));
  }
  return out;
}

function isCalendarWord(word: string): boolean {
  const locales = calendarNames().any.get(normalise(word));
  if (!locales) return false;
  if (CAPITALISED.test(word)) return true;
  return [...locales].some((l) => LOWERCASE_CAL.has(l));
}

function numbersIn(text: string): Set<string> {
  return new Set(Array.from(text.matchAll(NUMBER_PATTERN), (m) => m[0]));
}

function unitsIn(text: string): Set<string> {
  return new Set(Array.from(text.matchAll(UNIT_PATTERN), (m) => m[0].toLowerCase()));
}

export function sentencesOf(variant: ComposeVariant): ComposeSentence[] {
  return variant.paragraphs.flatMap((p) => p.sentences);
}

export function variantText(variant: ComposeVariant): string {
  return variant.paragraphs.map((p) => p.sentences.map((s) => s.text.trim()).join(" ")).join("\n\n");
}

/** Guards 1–7 over one variant. `banned` is kept apart from `reasons` so the
 *  caller can tell "only a banned phrase" (retry once) from anything else. */
export function checkVariant(ctx: GuardContext, variant: ComposeVariant, which: "close" | "story"): VariantVerdict {
  const reasons: string[] = [];
  const byId = new Map(ctx.items.map((i) => [i.id, i]));
  const notes = notesText(ctx.items);
  const packAll = ctx.items.map((i) => i.text).join("\n");
  const packStems = wordStems(packAll);
  const packNumbers = numbersIn(packAll);
  const voiceAll = ctx.voice.join("\n");
  const voiceStems = wordStems(voiceAll);
  const voiceNumbers = numbersIn(voiceAll);
  const dateNames = namesOfDate(ctx.date);
  const whole = variantText(variant);
  // Words the variant itself writes in lowercase somewhere — a capital on
  // one of these at a sentence start is grammar, not a name.
  const lowerWords = new Set(
    Array.from(whole.matchAll(WORD_PATTERN), (m) => m[0])
      .filter((w) => !CAPITALISED.test(w))
      .map(normalise),
  );
  const sentences = sentencesOf(variant);

  if (sentences.length === 0) reasons.push(`${which}: empty`);

  for (const sentence of sentences) {
    const text = sentence.text;
    const label = `${which}: "${text.slice(0, 60)}"`;
    // 1 — every source exists.
    const unknown = sentence.sources.filter((id) => !byId.has(id));
    if (unknown.length > 0) {
      reasons.push(`${label} cites unknown ${unknown.join(", ")}`);
      continue;
    }
    const cited = sentence.sources.map((id) => byId.get(id)!);
    const citedText = cited.map((i) => i.text).join("\n");
    const citedStems = wordStems(citedText);
    const citedNotes = cited.filter((i) => isNote(i.id)).map((i) => i.text).join("\n");

    // 3 — clock times only from the owner's own words; then strip them so
    // their digits are not checked twice as plain numbers.
    for (const m of text.matchAll(CLOCK_PATTERN)) {
      if (!citedNotes.includes(m[0])) reasons.push(`${label} clock time ${m[0]} not in a cited note`);
    }
    const withoutClocks = text.replace(CLOCK_PATTERN, " ");

    // 2 — numbers and units from the cited items.
    const citedNumbers = numbersIn(citedText);
    for (const n of numbersIn(withoutClocks)) {
      if (!citedNumbers.has(n)) reasons.push(`${label} number ${n} not in its sources`);
      // 6 — a number only a voice sample has.
      if (voiceNumbers.has(n) && !packNumbers.has(n)) reasons.push(`${label} number ${n} from a voice sample`);
    }
    const citedUnits = unitsIn(citedText);
    for (const u of unitsIn(withoutClocks)) {
      if (!citedUnits.has(u)) reasons.push(`${label} unit ${u} not in its sources`);
    }

    const words = Array.from(text.matchAll(WORD_PATTERN), (m) => m[0]);
    for (const [index, word] of words.entries()) {
      const n = normalise(word);
      const s = stem(word);
      // 3 — a month or weekday has to be the day's own (or written).
      if (isCalendarWord(word)) {
        if (!dateNames.has(n) && !citedStems.has(s)) reasons.push(`${label} ${word} does not match ${ctx.date}`);
        continue;
      }
      if (sentence.sources.length === 0) {
        // 2 — a connective sentence carries no longer word the pack lacks.
        if (n.length >= 5 && !packStems.has(s)) reasons.push(`${label} uncited, and "${word}" is not in the day`);
        continue;
      }
      if (!CAPITALISED.test(word) || n.length <= 1) continue;
      // A sentence's first word is capitalised by grammar, not because it
      // is a name: a short function word, or one the variant also writes in
      // lowercase, is not checked as a name.
      if (index === 0 && (n.length <= 3 || lowerWords.has(n))) continue;
      // 6 — a name only a voice sample has is a leak, whatever it cites.
      if (voiceStems.has(s) && !packStems.has(s)) {
        reasons.push(`${label} "${word}" only in a voice sample`);
        continue;
      }
      if (citedStems.has(s)) continue;
      if (index === 0 && packStems.has(s)) continue;
      reasons.push(`${label} "${word}" not in its sources`);
    }
  }

  // 5 — "we" only for a party, or when the writer says it.
  const we = usesWe(whole);
  if (we && !((ctx.partySize ?? 1) > 1) && !usesWe(notes)) reasons.push(`${which}: "${we}" but the writer travels alone`);

  // 7 — length.
  const base = ownerWordCount(ctx.items);
  const words = wordCount(whole);
  const cap = which === "story" ? base * 3 : Math.max(12, Math.ceil(base * 1.3) + 3);
  if (words > cap) reasons.push(`${which}: ${words} words, at most ${cap}`);

  // 4 — banned phrases, kept apart for the one retry.
  const banned = bannedHits(whole, ctx.languages, notes);

  return { ok: reasons.length === 0 && banned.length === 0, reasons, banned };
}

/** Under this many owner words a story is padding — forced to null. */
export const STORY_MIN_WORDS = 25;

/** Guard 8 — titles grounded in the pack; a quote must be in the notes.
 *  Returns the kept titles and why any were dropped. */
export function keptTitles(ctx: GuardContext, titles: ComposeTitle[]): { titles: ComposeTitle[]; reasons: string[] } {
  const packAll = ctx.items.map((i) => i.text).join("\n");
  const notes = flat(notesText(ctx.items));
  const kept: ComposeTitle[] = [];
  const reasons: string[] = [];
  for (const title of titles) {
    const text = title.text.trim();
    if (text === "") continue;
    if (!titleIsGroundedInNotes(packAll, text)) {
      reasons.push(`title "${text}" not grounded in the day`);
      continue;
    }
    if (title.kind === "quote" && !notes.includes(flat(text))) {
      reasons.push(`quote title "${text}" not in the notes`);
      continue;
    }
    kept.push({ ...title, text });
  }
  return { titles: kept, reasons };
}
