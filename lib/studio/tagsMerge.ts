/**
 * Preview's tags row (B2677, item 3) — the place as a fact, "used before"
 * tags (no AI, `GET /api/helper/{user}/tags`), and, only after ✦ Suggest, AI
 * tags as dashed chips. Pure merge: one ordered, deduplicated list, each tag
 * knowing where it came from and whether it is selected right now.
 *
 * Selection is entirely the caller's (`selected`, a plain set of lowercase
 * tags) — this module only decides the *shape* of the row, never which chip
 * starts on. The place is "already added" per the ticket, so a caller seeds
 * its selection set with the place the first time it builds one; "used
 * before" and AI chips start unselected until tapped or "Add all".
 */
type TagSource = "place" | "usedBefore" | "ai";
export type TagChip = { tag: string; source: TagSource; selected: boolean };

export function mergeTags(
  place: string | null,
  usedBefore: readonly string[],
  ai: readonly string[],
  selected: ReadonlySet<string>,
): TagChip[] {
  const seen = new Set<string>();
  const chips: TagChip[] = [];
  const add = (tag: string, source: TagSource) => {
    const key = tag.trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    chips.push({ tag: key, source, selected: selected.has(key) });
  };
  if (place) add(place, "place");
  for (const tag of usedBefore) add(tag, "usedBefore");
  for (const tag of ai) add(tag, "ai");
  return chips;
}

/** "Add all" — every AI chip joins the selection in one tap; everything else
 *  already on stays on. */
export function addAllAiTags(chips: readonly TagChip[], selected: ReadonlySet<string>): Set<string> {
  const next = new Set(selected);
  for (const chip of chips) if (chip.source === "ai") next.add(chip.tag);
  return next;
}

/** A tap on a chip — on becomes off, off becomes on. */
export function toggleTag(selected: ReadonlySet<string>, tag: string): Set<string> {
  const next = new Set(selected);
  const key = tag.trim().toLowerCase();
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}
