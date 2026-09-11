import type { BookRecipient } from "@/lib/photobook/recipients";
import type { PostalAddress } from "@/lib/postcard/render";

/**
 * A recipient as the photobook UI needs them: the agent-safe row, plus the
 * address the owner is posting to — B1145.
 *
 * The address is added *here* rather than in `bookRecipients`, which stays a
 * name and a town: that shape is what an agent proposing a book receives, and
 * a street must not join it. Used by `BookLevelView.tsx`'s own address
 * disclosure in the one-press order flow (B1157) — the print button this file
 * used to render for the pre-B1157 flow was deleted whole by B1428, since
 * nothing but the demo journal had ever addressed a book that way.
 */
export type PanelRecipient = BookRecipient & { address: PostalAddress };

/**
 * The address under the name, one line at a time. The name is rendered
 * separately and is therefore not repeated here, and an empty `line2` is
 * dropped rather than left as a blank line in the middle of an envelope.
 */
export function addressLines(to: PostalAddress): string[] {
  return [to.line1, to.line2, `${to.postcode} ${to.city}`.trim(), to.country]
    .map((line) => line?.trim() ?? "")
    .filter((line) => line !== "");
}
