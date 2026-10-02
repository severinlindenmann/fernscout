/**
 * The primary button on Preview names who it publishes for — B2677, decision
 * D10 ("Publish for 14 readers" / "Publish for everyone"), never a generic
 * "Publish this day" a confirm sheet used to clarify. Pure: given what the
 * day's own audience already is (`PublishRow["audience"]`, `lib/studio/publishDay.ts`)
 * and how many people `readersOf` named, which line to show.
 */
export type PublishAudience = "public" | "link" | "guest" | "private";

export type PublishLabel = { kind: "everyone" } | { kind: "readers"; count: number };

/** `readerCount` is `readers?.length` from `readersOf` — `null`/`undefined`
 *  (a public/link day, where "anyone" has no names) reads the same as
 *  "everyone" the button names. */
export function publishAudienceLabel(audience: PublishAudience, readerCount: number | null | undefined): PublishLabel {
  if (audience === "public" || audience === "link" || readerCount == null) return { kind: "everyone" };
  return { kind: "readers", count: readerCount };
}
