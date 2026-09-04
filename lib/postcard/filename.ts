/**
 * What one recipient's PDFs are called on disk.
 *
 * Deliberately not `slugify` from `lib/slug.ts`, and B77 is the reason. That
 * one mints permanent public identifiers and its rule is the point of it; this
 * names generated output in a gitignored folder that is rewritten on every
 * run, and nothing links to it. B77 considered unifying the private copies and
 * rejected it: they differ in their fallback word, and parameterising the
 * shared slug rule is a weaker guarantee than an unparameterised one.
 *
 * It lives under `lib/` rather than in `scripts/postcard.ts` only so a test can
 * reach it — that script parses `process.argv` at import time and cannot be
 * imported from one.
 */

/**
 * Latin-ish, lowercase, hyphen-separated. Returns `""` when nothing survives,
 * which is every name written in a non-Latin script — `recipientBase` is what
 * answers for that, not this.
 *
 * **How far it folds, and where it deliberately stops.** It spells `ß` out and
 * then takes the accents off, which is the same pair of passes
 * `lib/mail/index.ts` runs (B151). It does *not* carry `lib/slug.ts`'s
 * transliteration table, so `ü` here is `u` and there is `ue`. That table
 * earns its keep by keeping two German words apart in an address somebody has
 * already shared, for ever; nothing this function names is shared, resolved or
 * permanent, so the guarantee is not worth the coupling — B77 decided that,
 * B86 and B151 restated it.
 */
export function slug(text: string): string {
  return (
    text
      .toLowerCase()
      // **`ß` before the accents come off, because it has none.** NFD has
      // nothing to decompose in it, so the strip below cannot help and the
      // character class after it turns the letter into a hyphen: a recipient
      // called Straßer was `stra-er`, one letter short of their own name on
      // the envelope the author hands to a printer (B202). Lowercased first,
      // so capital `ẞ` arrives here as `ß`.
      .replace(/ß/g, "ss")
      // Then the accents, and only the accents: "Bergström" becomes
      // `bergstrom` and "Hội An" `hoi-an`, rather than losing the vowels.
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
  );
}

/**
 * The base name for the recipient at `index` in this run's batch.
 *
 * B86: this used to be `slug(name)` alone, with no fallback where
 * `lib/slug.ts` has `SLUG_FALLBACK`. A name in Greek, Cyrillic, Hebrew,
 * Chinese, Japanese or Korean survives none of the passes above, so the files
 * became `.pdf` and `-front.pdf` — dotfiles, hidden from a plain `ls`, in a
 * folder the author is expected to open and hand to a printer.
 *
 * Hidden was not the worst of it. **Every such recipient wrote to those same
 * two names**, so a run addressed to three of them silently produced one card,
 * and the only evidence was a folder holding fewer files than the address list
 * — with nothing to say which were missing or why.
 *
 * The fallback is therefore the position in the batch and not a shared
 * constant. A constant would have fixed the hidden dotfile and left the
 * overwrite, which is the half that loses somebody's post. One-based, because
 * it is read by a person counting down a list of addresses.
 *
 * This is the rule for *one* name and it cannot see the batch, so it cannot
 * answer for two people who are called the same thing. `recipientBases` is
 * what a run should call.
 */
export function recipientBase(name: string, index: number): string {
  return slug(name) || `recipient-${index + 1}`;
}

/** One recipient's file name, and whether the batch had to move it. */
export type RecipientFile = {
  /** The name as it was given, so a caller can report on it. */
  name: string;
  /** What the files for this recipient are called, without an extension. */
  base: string;
  /** The name `recipientBase` asked for, when something else already had it. */
  wanted: string;
  /** True when `base` is not `wanted` — the run should say so. */
  renamed: boolean;
};

/**
 * Names for a whole batch, with no two the same.
 *
 * B150: the fallback B86 added answers for a name that slugs to *nothing*, and
 * a mother and a daughter both called Anna Meier slug to the same *something*.
 * Both cards were written to `anna-meier.pdf`, the second over the first, and
 * the run reported two lines and left one file — the same silent overwrite
 * B86 fixed, reached by a different route, and by a far more ordinary one: a
 * christening or a wedding list has repeated names in it.
 *
 * **The name stays the identifier, and only a collision is numbered.** The
 * alternative was to number every file `01-anna-meier.pdf`, which is honest
 * about the position being the only unique thing in a batch and sorts the
 * folder in the order of the address list — but it renames every card anybody
 * has ever generated, and B86's acceptance ("recipients with Latin names keep
 * the filenames they get today") is the promise this keeps instead.
 *
 * **Deterministic, so a re-run does not renumber people.** Names are claimed
 * in list order — first line keeps the plain name — and a suffix counts up
 * past whatever is already taken, so a hand-written "Anna Meier 2" further
 * down the list is pushed to `anna-meier-2-2` rather than being written over
 * by the second Anna Meier. Ugly, and it is the ugly case: the same JSON in
 * produces the same filenames out, every run, which is what a person
 * re-rendering a batch after fixing one address needs.
 */
export function recipientBases(names: string[]): RecipientFile[] {
  const taken = new Set<string>();
  return names.map((name, index) => {
    const wanted = recipientBase(name, index);
    let base = wanted;
    for (let n = 2; taken.has(base); n++) base = `${wanted}-${n}`;
    taken.add(base);
    return { name, base, wanted, renamed: base !== wanted };
  });
}
