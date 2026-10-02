/**
 * "What changed" — B2689. A simple word-level diff between the owner's own
 * notes and the composed "Close" text, so the review can underline only the
 * words that differ. Not a real LCS diff (no new dependency, and Close is
 * meant to be *tidying*, not reordering) — a greedy word-by-word walk that
 * treats a run of words present in both, in order, as unchanged, and
 * everything else in `after` as changed.
 */
export type DiffToken = { text: string; changed: boolean };

function tokenize(text: string): string[] {
  return text.trim() === "" ? [] : text.trim().split(/\s+/);
}

function normalise(word: string): string {
  return word.toLowerCase().replace(/[.,!?;:"'()]/g, "");
}

/** Greedy longest-common-subsequence-free word diff: walks `after` against
 *  `before`, consuming a matched word from `before` in order; a word in
 *  `after` with no remaining match in `before` is `changed: true`. */
export function wordDiff(before: string, after: string): DiffToken[] {
  const beforeWords = tokenize(before).map(normalise);
  const afterWords = tokenize(after);
  let cursor = 0;
  return afterWords.map((word) => {
    const needle = normalise(word);
    const found = beforeWords.indexOf(needle, cursor);
    if (found === -1) return { text: word, changed: true };
    cursor = found + 1;
    return { text: word, changed: false };
  });
}
