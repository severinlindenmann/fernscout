import "server-only";
import { getDatabaseOrNull, newId, nowIso } from "../db";

/**
 * Whether a composed day was kept, edited or thrown away — B2693. Counts
 * only, beside the existing per-user cost record (`lib/usage.ts`): which
 * variant, the outcome, and a capped word-level edit distance. Never the
 * text — nothing here ever receives or stores the composed or saved words.
 *
 * Swallows a missing database the same way `lib/usage.ts`'s `recordUsage`
 * does: a dropped count is recoverable, and the owner's save must never
 * wait on or fail because of this.
 */
export type ComposeVariantKind = "close" | "story" | "none";
export type ComposeOutcomeKind = "kept" | "edited" | "discarded";

/** Word-level Levenshtein, capped at `cap` so one enormous paste cannot
 *  blow up the loop — the exact number is never shown to anyone, only
 *  whether it stayed under the cap. */
export function wordEditDistance(a: string, b: string, cap = 200): number {
  const wa = a.trim() === "" ? [] : a.trim().split(/\s+/);
  const wb = b.trim() === "" ? [] : b.trim().split(/\s+/);
  const n = wa.length;
  const m = wb.length;
  let prev = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    const row = [i];
    for (let j = 1; j <= m; j++) {
      row.push(wa[i - 1] === wb[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j], row[j - 1], prev[j - 1]));
    }
    prev = row;
  }
  return Math.min(prev[m], cap);
}

export async function recordComposeOutcome(
  owner: string,
  variant: ComposeVariantKind,
  outcome: ComposeOutcomeKind,
  editDistance: number,
): Promise<void> {
  try {
    const handle = await getDatabaseOrNull();
    if (!handle) return;
    await handle.db
      .insertInto("compose_outcomes")
      .values({
        id: newId(),
        owner_id: owner,
        variant,
        outcome,
        edit_distance: Math.max(0, Math.round(editDistance)),
        occurred_at: nowIso(),
      })
      .execute();
  } catch {
    // Never cost the owner their save over a dropped count.
  }
}
