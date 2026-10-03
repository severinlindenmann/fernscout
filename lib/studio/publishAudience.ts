/**
 * The primary button on Preview names who it publishes for — B2677, decision
 * D10 ("Publish for 14 readers" / "Publish for everyone"), never a generic
 * "Publish this day" a confirm sheet used to clarify. Pure: given what the
 * day's own audience already is (`PublishRow["audience"]`, `lib/studio/publishDay.ts`)
 * and how many people `readersOf` named, which line to show.
 */
export type PublishAudience = "public" | "link" | "guest" | "private";

export type PublishLabel = { kind: "everyone" } | { kind: "readers"; count: number } | { kind: "onlyYou" };

/** `readerCount` is `readers?.length` from `readersOf` — `null`/`undefined`
 *  (a public/link day, where "anyone" has no names) reads the same as
 *  "everyone" the button names. */
export function publishAudienceLabel(audience: PublishAudience, readerCount: number | null | undefined): PublishLabel {
  if (audience === "public" || audience === "link" || readerCount == null) return { kind: "everyone" };
  // B2776 — "Publish for 0 readers" is a count nobody can act on; a closed
  // trip nobody else can open says so instead.
  if (readerCount === 0) return { kind: "onlyYou" };
  return { kind: "readers", count: readerCount };
}

/** B2776 — the two ways out of "only you can see this trip", as locale keys
 *  and hrefs. `private` means the people on the trip (and the close circle),
 *  so the first door is People and the second widens the trip to the journal's
 *  readers; a `guest` trip has no readers yet, so the first door is the
 *  readers invite. Never "invite readers" on a private trip: a reader let
 *  into the journal still cannot open it. */
export function reachActions(
  audience: PublishAudience,
  base: string,
  tripId: string,
): { key: "studio.reach.addSomeone" | "studio.reach.letReadersIn" | "studio.reach.inviteReader" | "studio.reach.changeWho"; href: string }[] {
  const visibility = { key: audience === "private" ? "studio.reach.letReadersIn" : "studio.reach.changeWho", href: `${base}/studio/trip/visibility?trip=${encodeURIComponent(tripId)}` } as const;
  return audience === "private"
    ? [{ key: "studio.reach.addSomeone", href: `${base}/studio/people` }, visibility]
    : [{ key: "studio.reach.inviteReader", href: `${base}/studio/readers#invite` }, visibility];
}

/** B2677, bug 11 — Preview's "Readers" fact row. "Everyone · public" for a
 *  public/link day; otherwise names which of `private`'s own trip people or
 *  `guest`'s own approved readers the count is counting. */
export type ReadersFact = { kind: "everyone" } | { kind: "private"; count: number } | { kind: "guest"; count: number };

export function readersFact(audience: PublishAudience, readerCount: number | null | undefined): ReadersFact {
  if (audience === "public" || audience === "link" || readerCount == null) return { kind: "everyone" };
  return { kind: audience === "private" ? "private" : "guest", count: readerCount };
}

/** B2677, bug 11 — Preview's "Message" fact row. The old sentence
 *  ("Publishing tells nobody…") never said *why* — off at the server, no
 *  reader has notifications on yet, or the owner's own narrowed choice —
 *  so it read as broken rather than as the truth. Pure: the same inputs
 *  `TellWho`'s own `tellCounts` already produces, plus whether the owner
 *  touched the "Who to tell" chips at all (`selected !== null`). */
export type MessageFact = { kind: "serverOff" } | { kind: "noneYet" } | { kind: "chosenNone" } | { kind: "counts"; push: number; mail: number };

export function messageFact(opts: {
  pushOn: boolean;
  mailOn: boolean;
  hasReaders: boolean;
  explicitChoice: boolean;
  push: number;
  mail: number;
}): MessageFact {
  if (!opts.pushOn && !opts.mailOn) return { kind: "serverOff" };
  if (opts.push === 0 && opts.mail === 0) {
    if (opts.hasReaders && opts.explicitChoice) return { kind: "chosenNone" };
    return { kind: "noneYet" };
  }
  return { kind: "counts", push: opts.push, mail: opts.mail };
}
