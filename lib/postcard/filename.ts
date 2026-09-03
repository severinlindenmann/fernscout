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
 */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
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
 */
export function recipientBase(name: string, index: number): string {
  return slug(name) || `recipient-${index + 1}`;
}
