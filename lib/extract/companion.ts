import type { RunManifest } from "@/lib/staging/manifest";

export type CompanionSuggestion = {
  /** Exactly the word as the person wrote it — never re-cased, never
   *  corrected. */
  name: string;
  /** Every date (yyyy-mm-dd) this run's own days carry the word on, sorted
   *  ascending. Always at least two — see `suggestCompanion` below. */
  dates: string[];
};

/** Common capitalised words that are not a name — sentence connectives that
 *  slip past the "not the first word of its sentence" check because a
 *  person's own punctuation is not always where a parser would put it. */
const STOPWORDS = new Set([
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
  "January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December",
  "I", "We", "They", "He", "She", "It", "This", "That", "There", "Then",
  "Also", "But", "And", "So", "The", "Our", "My", "Your", "His", "Her",
]);

const WORD_RE = /^[A-Z][a-zA-Z'-]{1,30}$/;

/**
 * A companion's name — drawn only from what the person actually wrote in
 * their own day answers (`DayRow.words`), or `null` when nothing in those
 * answers is a clear enough candidate to name.
 *
 * **Never invented.** The only input is the person's own text; nothing here
 * ever makes up a name, a day, or a count. A word has to appear on at least
 * two of this run's own days before it is ever suggested at all, matching
 * the design's own example ("on Tuesday and Thursday") — a name mentioned
 * once is exactly as likely to be a one-off (a stranger, a place, a shop)
 * as a travelling companion, and this only ever suggests, never asserts.
 *
 * A day's own `location` answer is read too, and every capitalised word in
 * it is excluded from the count — a place a person named in answer to
 * "where were you" (`Hoi An`, `Hué`) must never be offered back to them as
 * a person.
 *
 * **German gets no suggestion at all — not a weaker one, none.** German
 * capitalises every noun, not just proper ones, so "Wir gingen zum Strand"
 * / "Am Strand war es kalt" makes "Strand" ("the beach") pass every check
 * above exactly as "Nora" would: mid-sentence, repeated, on two different
 * days. There is no threshold that fixes this — the capitalisation signal
 * this whole function is built on simply carries no information in German,
 * the same way Deepgram's own confidence carries none when it sends no
 * number at all (`CheckWording.tsx`'s uncertain-word highlight goes silent
 * there too, for the identical reason). `locale` is checked first and
 * German returns `null` before either pass ever runs.
 *
 * English and Hungarian both capitalise proper nouns only, so the signal
 * means something in both and the suggestion stands there.
 *
 * ponytail: a capitalised-word heuristic, not a real name-entity
 * recognizer — even gated to a language where capitalisation is
 * informative, it can still miss a name given only once, or snag a
 * genuinely repeated common noun or brand ("Ibis", "Zara") that happens to
 * open two sentences and read mid-sentence in a third. Left as a known
 * false-positive rather than patched with a second heuristic, because the
 * screen only ever *asks* ("is that them?") rather than asserting — quoting
 * a person's own word back at them as a question is a different act from
 * writing a name into their journal. The ties-are-refused rule below is the
 * one guard that is worth having on top: two equally-likely candidates is
 * exactly the case where picking one would be inventing the answer, and
 * there is no dependency-free upgrade path better than either of these
 * until a real NER model is already a repo dependency for some other
 * reason.
 */
export function suggestCompanion(manifest: RunManifest, locale: string): CompanionSuggestion | null {
  // German capitalises every noun — see the doc comment above. No fixture
  // of German prose can be told apart from a fixture of English prose by
  // this function, so this is the one branch guarded by a level, not a
  // heuristic.
  if (locale.startsWith("de")) return null;

  const locationWords = new Set<string>();
  for (const day of manifest.days) {
    if (!day.location) continue;
    for (const word of day.location.match(/[A-Z][a-zA-Z'-]*/g) ?? []) locationWords.add(word);
  }

  // Every day's own answer, split into sentences and then words, once —
  // used for both passes below.
  const perDay = manifest.days
    .filter((day) => day.words)
    .map((day) => ({
      date: day.date,
      sentences: day.words!.split(/(?<=[.!?\n])\s+/).map((s) => s.trim().split(/\s+/)),
    }));

  function clean(raw: string): string {
    return raw.replace(/[^a-zA-Z'-]+$/, "");
  }

  // Pass one: which capitalised words are ever used *mid*-sentence — that
  // is the only position that actually distinguishes a name from a sentence
  // simply starting with it. A word never seen there is never a candidate,
  // however often it opens a sentence.
  const confirmed = new Set<string>();
  for (const { sentences } of perDay) {
    for (const words of sentences) {
      for (let i = 1; i < words.length; i += 1) {
        const word = clean(words[i]);
        if (WORD_RE.test(word) && !STOPWORDS.has(word) && !locationWords.has(word)) confirmed.add(word);
      }
    }
  }

  // Pass two: every date a confirmed word appears on at all — including a
  // sentence where it happens to lead, once it is already known (from
  // somewhere else in these same answers) to be used as a name rather than
  // only ever as a sentence's own first word.
  const datesFor = new Map<string, Set<string>>();
  for (const { date, sentences } of perDay) {
    for (const words of sentences) {
      for (const raw of words) {
        const word = clean(raw);
        if (!confirmed.has(word)) continue;
        if (!datesFor.has(word)) datesFor.set(word, new Set());
        datesFor.get(word)!.add(date);
      }
    }
  }

  const candidates = [...datesFor.entries()]
    .filter(([, dates]) => dates.size >= 2)
    .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]));

  if (candidates.length === 0) return null;
  // Two names mentioned on exactly as many days as each other is not a
  // clear winner — guessing between them would be inventing the answer.
  if (candidates.length > 1 && candidates[1][1].size === candidates[0][1].size) return null;

  const [name, dates] = candidates[0];
  return { name, dates: [...dates].sort() };
}
