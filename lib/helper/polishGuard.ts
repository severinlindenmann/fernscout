/**
 * The server-side check on a polish rewrite — B2190.
 *
 * B829 showed that telling a model "write only what you were told" in the
 * prompt is not a guard, only a request. This is the guard: it looks at what
 * actually came back against what actually went in, the same way every other
 * honesty check in this file's neighbourhood does (`lib/helper/model.ts`'s
 * own comments on `amiss()`), and it knows nothing about the model's own
 * reasoning — only the two strings.
 *
 * **This catches an added number, an added currency/measurement unit, an
 * added personal pronoun and an added name — not every possible invented
 * fact.** A new verb standing for an action nobody described ("arrived"),
 * a new place-shaped word this guard's small vocabularies don't cover, or
 * any other fabrication expressed only in ordinary words this check has no
 * way to tell from tidied prose can still get through. The prompt
 * (`POLISH_SYSTEM_PROMPT` in `./model.ts`) is the first line and carries
 * everything this can't check; **the owner's own read of the side-by-side
 * preview and their tap on "Use this" is the real safeguard** — nothing
 * this guard passes is written anywhere on its own say-so.
 *
 * What it does check, in order: a number that was not in the input, a
 * currency or measurement unit that was not in the input, a personal
 * pronoun that was not in the input (a live call turned "rain all morning
 * then port at grahams" into "…then **we** arrived at port…" — the guard
 * did not catch it because "we" is neither a number nor capitalised, which
 * is why this check exists as its own thing rather than folding into the
 * capitalised-word one below), and a capitalised word (a name, a place)
 * whose stem is not in the input **anywhere, sentence-initial or not** — a
 * security review (B2190's second follow-up) found the original version
 * exempted a sentence-initial capital from the check and then let that
 * exemption leak into the rest of the guard (its stem got added to a
 * "seen" set later words in the same output could match), so "Zurich was
 * lovely… in Zurich" passed a `Zurich` that was never in the input at all.
 * Checking every capitalised word against the *input's* words, unconditionally,
 * closes that: `Rain` from an input `rain` still passes (its stem is in the
 * input), a new `Zurich` does not (its stem never was). Matching is
 * inflection-tolerant on purpose — "Graham's" against "grahams", "Pariba"
 * against "Paribas" — because a polish that fixes a person's own spelling is
 * exactly what this feature is for; only a genuinely new fact is refused.
 *
 * ponytail: a fixed, small vocabulary of currency/measurement words across
 * en/de/hu rather than a proper tokenizer or a second model call. Widen the
 * list (or swap in a real NLP tokenizer) if a false negative turns up in
 * practice — the risk here is a missed addition, not a false refusal.
 */

/** Currency codes/symbols and measurement words this guard watches for, across
 *  the journal's three languages. Case-insensitive, matched as whole words
 *  (except the bare symbols). */
const UNIT_WORDS = [
  // currency
  "chf",
  "eur",
  "usd",
  "gbp",
  "fr",
  "franken",
  "francs?",
  "euros?",
  "dollars?",
  "pfund",
  "forint(?:ok)?",
  "€",
  "\\$",
  "£",
  // distance / length
  "km",
  "kms",
  "kilomet(?:er|re|ers|res)",
  "kilométer(?:t|ek|es)?",
  "m",
  "cm",
  "mm",
  "miles?",
  "mérföld",
  // weight
  "kg",
  "kilos?",
  // temperature
  "°c",
  "°f",
  "degrees?",
  "grad",
  "fok(?:ban)?",
  // time
  "min(?:s|utes?)?",
  "minuten",
  "perc(?:ben|ek)?",
  "h(?:rs?|ours?)?",
  "stunden?",
  "óra(?:kor|k|ig)?",
] as const;

const UNIT_PATTERN = new RegExp(`\\b(?:${UNIT_WORDS.join("|")})\\b`, "giu");

/** Personal pronouns across the journal's three languages — a fixed word
 *  list, the same shape as `UNIT_WORDS` and for the same reason: cheap,
 *  whole-word, case-insensitive, no tokenizer. Deliberately narrow to
 *  pronouns that name a person ("I", "we", "she") rather than every pronoun
 *  ("it", "this") — an impersonal "it" is not the kind of addition the
 *  live bug report was about, and flagging it would refuse harmless
 *  fragment-to-sentence tidying far more often than it would catch anything. */
const PRONOUN_WORDS = [
  "i",
  "we",
  "us",
  "our",
  "ours",
  "you",
  "your",
  "yours",
  "he",
  "him",
  "his",
  "she",
  "her",
  "hers",
  "they",
  "them",
  "their",
  "theirs",
  "ich",
  "wir",
  "uns",
  "unser",
  "du",
  "dich",
  "dir",
  "dein",
  "er",
  "ihm",
  "sie",
  "ihr",
  "ihnen",
  "én",
  "mi",
  "mink",
  "te",
  "ti",
  "ő",
  "ők",
  "őt",
  "őket",
] as const;

const PRONOUN_PATTERN = new RegExp(`\\b(?:${PRONOUN_WORDS.join("|")})\\b`, "giu");

/** A run of digits — the cheapest possible "is this a new fact" signal, and
 *  reordering/punctuation never changes a digit run. */
const NUMBER_PATTERN = /\d+(?:[.,]\d+)?/g;

/** A capitalised word — candidate proper noun or place, in any script this
 *  journal's locales use. `\p{Lu}` (Unicode "uppercase letter") rather than
 *  a hand-picked Latin range, which is what let a Hungarian capital like
 *  "Ő" or "Ű" through unchecked — B2190's second follow-up. */
const WORD_PATTERN = /[\p{L}][\p{L}'’-]*/gu;
const CAPITALISED = /^\p{Lu}/u;

function normalise(word: string): string {
  return word.toLowerCase().replace(/['’]/g, "");
}

/** Loose stem: the first five characters (or the whole word if shorter) —
 *  enough to match "Graham's" against "grahams" and "Pariba" against
 *  "Paribas" without pulling in a real stemmer. */
function stem(word: string): string {
  const n = normalise(word);
  return n.length <= 5 ? n : n.slice(0, 5);
}

/** Every word in `text`, normalised and stemmed, for a cheap "did the input
 *  already have something like this" check. */
function wordStems(text: string): Set<string> {
  const stems = new Set<string>();
  for (const match of text.matchAll(WORD_PATTERN)) stems.add(stem(match[0]));
  return stems;
}

export type PolishGuardResult = { ok: true } | { ok: false; reason: string };

/**
 * Does `output` (a proposed polish of `input`) introduce a fact `input`
 * did not carry? Checks numbers, currency/measurement units, personal
 * pronouns and capitalised words. Never mutates either string, never calls
 * anything.
 */
export function checkPolishForAddedFacts(input: string, output: string): PolishGuardResult {
  const inputNumbers = new Set(Array.from(input.matchAll(NUMBER_PATTERN), (m) => m[0]));
  for (const match of output.matchAll(NUMBER_PATTERN)) {
    if (!inputNumbers.has(match[0])) {
      return { ok: false, reason: `a number not in the original: "${match[0]}"` };
    }
  }

  const inputUnits = new Set(
    Array.from(input.matchAll(UNIT_PATTERN), (m) => m[0].toLowerCase()),
  );
  for (const match of output.matchAll(UNIT_PATTERN)) {
    if (!inputUnits.has(match[0].toLowerCase())) {
      return { ok: false, reason: `a unit not in the original: "${match[0]}"` };
    }
  }

  const inputPronouns = new Set(
    Array.from(input.matchAll(PRONOUN_PATTERN), (m) => m[0].toLowerCase()),
  );
  for (const match of output.matchAll(PRONOUN_PATTERN)) {
    if (!inputPronouns.has(match[0].toLowerCase())) {
      return { ok: false, reason: `a pronoun not in the original: "${match[0]}"` };
    }
  }

  // No sentence-initial exemption: checked unconditionally against the
  // *input's* words only, so "Rain" from an input "rain" still passes (its
  // stem is in the input) and a name the polish moved to, or invented at,
  // a sentence start does not — B2190's second follow-up.
  const knownStems = wordStems(input);
  for (const match of output.matchAll(WORD_PATTERN)) {
    const word = match[0];
    if (!CAPITALISED.test(word)) continue;
    if (knownStems.has(stem(word))) continue;
    return { ok: false, reason: `a capitalised word not in the original: "${word}"` };
  }

  return { ok: true };
}
