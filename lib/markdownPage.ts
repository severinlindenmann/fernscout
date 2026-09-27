/**
 * Small pieces for the pages' Markdown versions — B2488. Plain strings in,
 * one document out; blocks that are absent (null, false, "") are dropped, so
 * a section a page does not draw is not written either.
 */
export type Block = string | null | undefined | false;

export function mdDocument(...blocks: Block[]): string {
  return blocks.filter(Boolean).join("\n\n").trim() + "\n";
}

export function mdList(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

/** A question-and-answer list, one `###` per question. */
export function mdFaq(items: { q: string; a: string }[] | [string, string][]): string {
  return items.map((item) => (Array.isArray(item) ? item : [item.q, item.a])).map(([q, a]) => `### ${q}\n\n${a}`).join("\n\n");
}
