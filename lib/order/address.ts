import type { PostalAddress } from "../postcard/render";

/**
 * The address under the name, one line at a time — B1468.
 *
 * Its own file, and a small one, because the two callers cannot share any
 * larger one: `lib/order/view.ts` reaches `lib/postcard/orders.ts`, which is
 * `server-only`, and the photobook composer that also needs this is a client
 * component. It lived in `components/PhotobookPrintPanel.tsx` until this
 * ticket, which was the last thing in that file.
 *
 * The name is rendered separately and so is not repeated here, and an empty
 * `line2` is dropped rather than left as a blank line in the middle of an
 * envelope.
 */
export function addressLines(to: PostalAddress): string[] {
  return [to.line1, to.line2, `${to.postcode} ${to.city}`.trim(), to.country]
    .map((line) => line?.trim() ?? "")
    .filter((line) => line !== "");
}
