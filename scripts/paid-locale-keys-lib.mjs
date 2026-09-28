// Whether `npm run i18n:keys` (scripts/i18n-keys.mjs) may rewrite
// lib/paidLocaleKeys.json this run — B2515.
//
// That file is computed from `paid/`, which only the main checkout has; every
// worktree either lacks it or clones it at whatever commit it branched from,
// which drifts behind paid's own main as soon as that repo moves. A checkout
// with no paid/, or a stale one, can only compute a *smaller* answer than the
// truth — never a bigger one, since a key paid/ stops using also stops being
// paid-only key material. Regenerating from either silently deletes keys the
// real paid/ still owns, and test/studio-text-sweep.test.tsx then reports
// them "orphaned" in every other checkout. So this is deliberately
// conservative: no paid/, a dirty paid/, or a paid/ behind the commit the
// file was last generated from all leave the file exactly as it is, and only
// an explicit override writes anyway.
//
// Pure so a test can fake `isAncestor` and `paidExists`/`paidDirty` rather
// than depending on a real paid/ checkout.
/**
 * @param {{
 *   paidExists: boolean,
 *   paidDirty?: boolean,
 *   previousGeneratedFrom?: string | null,
 *   currentCommit?: string | null,
 *   isAncestor?: (ancestor: string, descendant: string) => boolean,
 *   force?: boolean,
 * }} options
 */
export function decidePaidLocaleKeysAction({
  paidExists,
  paidDirty = false,
  previousGeneratedFrom = null,
  currentCommit = null,
  isAncestor = () => false,
  force = false,
}) {
  if (!paidExists) {
    return {
      action: "skip",
      message:
        "No paid/ here — leaving lib/paidLocaleKeys.json as the main checkout last wrote it.",
    };
  }
  if (force) {
    return { action: "write" };
  }
  if (paidDirty) {
    return {
      action: "refuse",
      message:
        "paid/ has uncommitted changes — refusing to regenerate lib/paidLocaleKeys.json from a dirty tree. Commit or stash paid/, or rerun with --force.",
    };
  }
  if (previousGeneratedFrom && previousGeneratedFrom !== currentCommit) {
    if (!isAncestor(previousGeneratedFrom, currentCommit)) {
      return {
        action: "refuse",
        message: `paid/ is at ${currentCommit}, which is not ahead of ${previousGeneratedFrom} (the commit lib/paidLocaleKeys.json was last generated from) — refusing to regenerate from a stale paid/. Update paid/, or rerun with --force.`,
      };
    }
  }
  return { action: "write" };
}
