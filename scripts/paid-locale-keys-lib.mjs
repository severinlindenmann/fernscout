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

// Whether paid/'s HEAD is safe to generate from, checked against
// paid's own origin/main — B2712. `decidePaidLocaleKeysAction` above only
// compares against the commit the file was *last* generated from, which
// says nothing about whether paid/ ever reached paid's real main: a
// worktree's paid/ can sit on a branch, or on unpushed local commits, that
// is ahead of the last generation and still never lands.
//
// `isAncestor(headSha, originMainSha)` true means every commit at HEAD
// already sits on origin/main — HEAD is caught up or merely behind it (a
// normal, harmless lag; warn so an agent knows to fast-forward, but still
// generate). False means HEAD holds a commit origin/main does not have —
// refuse unless --force, because a paidLocaleKeys.json key that depends on
// work which never merges leaves every other checkout unable to explain it.
/**
 * @param {{
 *   headSha: string,
 *   originMainSha?: string | null,
 *   isAncestor?: (ancestor: string, descendant: string) => boolean,
 *   force?: boolean,
 * }} options
 */
export function checkPaidAgainstOriginMain({ headSha, originMainSha = null, isAncestor = () => false, force = false }) {
  if (!originMainSha || headSha === originMainSha) return { ok: true };
  if (isAncestor(headSha, originMainSha)) {
    return {
      ok: true,
      warning:
        `paid/ is behind origin/main (HEAD ${headSha}, origin/main ${originMainSha}) — a key added there may ` +
        `look orphaned here until you fast-forward: git -C paid merge --ff-only origin/main`,
    };
  }
  if (force) {
    return {
      ok: true,
      warning: `--force: paid/ HEAD ${headSha} is not on origin/main (${originMainSha}) — generating from paid/ work that has not landed.`,
    };
  }
  return {
    ok: false,
    message:
      `paid/ HEAD ${headSha} is not on paid origin/main (${originMainSha}) — refusing to regenerate ` +
      `lib/paidLocaleKeys.json from paid/ work that might never land. Fast-forward it first: ` +
      `git -C paid merge --ff-only origin/main. Rerun with --force to override.`,
  };
}
