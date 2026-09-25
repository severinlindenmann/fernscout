// How a photograph is addressed, and who may see it.
//
// Pure on purpose, the same discipline as lib/validate/entry.ts beside it: no
// fs, no "server-only", nothing that only runs in a route handler. Both halves
// are needed on either side of the line — the read layer strips items, the
// media route refuses files, the validator checks a key it was handed, and the
// OpenAPI document publishes the vocabulary — so anything here has to be
// importable from all of them.

/**
 * `/alex/media/algarve/lagos/01.jpg` → `algarve/lagos/01.jpg`.
 *
 * A photograph's identity, and the one rule about it. The owner is prefixed at
 * read time (`mediaWithOwner` in lib/trips.ts) while the file on disk carries
 * `/media/…`, so the same picture has two spellings depending on which side of
 * the API it is seen from — and a caller sending back what it was given has to
 * work. What follows `/media/` is the part both agree on.
 *
 * It was written three times before this: in `spliceCaptions`, in
 * `checkCaptions`, and it was about to be written a fourth time in the media
 * route. A rule about identity that lives in three files is one that disagrees
 * with itself within a month.
 */
export function mediaKey(src: string): string {
  return src.replace(/^.*\/media\//, "");
}

/**
 * What a photograph may be held back to — and there is deliberately no
 * `public`.
 *
 * A label **narrows and never widens**. The trip's own `visibility` already
 * says who is let in at all; this says that one picture is for fewer of them
 * than the rest of the day. So the effective requirement is the stricter of
 * the two, and a `guest` photograph on a `private` trip stays private — the
 * label cannot let anybody past the gate the trip is holding.
 *
 * The two words mean the same populations they mean on a trip, which is why
 * they are the same two words: `guest` is everybody the owner has let into the
 * journal, plus the people who were on the trip; `private` is the people who
 * were there, and the owner.
 */
export const PHOTO_VISIBILITIES = ["guest", "private"] as const;

export type PhotoVisibility = (typeof PHOTO_VISIBILITIES)[number];

/**
 * How far a particular reader has got, on the same scale.
 *
 * `person` is somebody who was on the trip, or the journal's owner — which
 * since B480 can also be the instance's admin. `guest` is an approved contact
 * of the *journal*. `public` is everybody else, including a signed-in stranger:
 * proving an address opens nothing on its own (see the long note at the end of
 * `mayReadTrip`).
 */
const READER_LEVELS = ["public", "guest", "person"] as const;

export type ReaderLevel = (typeof READER_LEVELS)[number];

/**
 * A label read back off a file, or `undefined` for a photograph nobody held
 * back.
 *
 * An unrecognised word reads as `private`, never as "no label" — the same
 * fail-closed rule a trip's `visibility` gets, and for the same reason: a typo
 * must not publish somebody's photograph. `public` is not a value here (see
 * `PHOTO_VISIBILITIES`), so it is a typo like any other and lands closed
 * rather than being obeyed as a request to widen.
 */
export function parsePhotoVisibility(raw: unknown): PhotoVisibility | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const word = String(raw).trim().toLowerCase();
  return (PHOTO_VISIBILITIES as readonly string[]).includes(word)
    ? (word as PhotoVisibility)
    : "private";
}

/** How much a label demands, on `READER_LEVELS`' scale. */
const DEMANDS: Record<PhotoVisibility, ReaderLevel> = {
  guest: "guest",
  private: "person",
};

/**
 * Whether a reader at `level` may see a photograph carrying `visibility`.
 *
 * The one comparison, so nothing else has to know the order. An unlabelled
 * photograph is visible to anybody the trip already let in — this function is
 * never the trip's gate and must not be mistaken for one.
 */
export function maySeePhoto(visibility: PhotoVisibility | undefined, level: ReaderLevel): boolean {
  if (!visibility) return true;
  return READER_LEVELS.indexOf(level) >= READER_LEVELS.indexOf(DEMANDS[visibility]);
}

/**
 * The stricter of two labels — `undefined` (no requirement) is the loosest
 * thing there is.
 *
 * Narrowing composes: a photograph inside a held-back update is held back to
 * whichever of the two demands more, the same sentence `PHOTO_VISIBILITIES`
 * makes about a label inside a trip. Here rather than at the call site so
 * that the order lives in exactly one file — `DEMANDS` above is the order,
 * and nothing else should be spelling it out.
 */
export function strictestVisibility(
  a: PhotoVisibility | undefined,
  b: PhotoVisibility | undefined,
): PhotoVisibility | undefined {
  if (!a) return b;
  if (!b) return a;
  return READER_LEVELS.indexOf(DEMANDS[a]) >= READER_LEVELS.indexOf(DEMANDS[b]) ? a : b;
}

/**
 * The three words a reader-facing label may say, widest first — B1585.
 *
 * Deliberately *not* `PHOTO_VISIBILITIES` with `public` bolted on. Those two
 * are what a photograph or an update may be **set** to, and `public` is
 * excluded there on purpose: a label narrows and can never widen. This is the
 * different question of what the audience for a thing **turns out to be** once
 * its own label and every gate above it are taken together, and the answer to
 * that genuinely can be "everybody".
 *
 * Same order as `READER_LEVELS` above and the same order as a trip's own
 * `VISIBILITIES`, which is what lets one comparison serve all three.
 */
export const AUDIENCES = ["public", "guest", "private"] as const;

export type Audience = (typeof AUDIENCES)[number];

/**
 * What a thing's audience actually is, given the gate above it and its own
 * label — B1585.
 *
 * The whole of "effective visibility", and it is one line because
 * `AUDIENCES`' order is the whole rule: a label narrows, so the answer is
 * whichever of the two is further down the list. A `guest` photograph inside a
 * `private` trip is private; a `private` update on a `public` trip is private;
 * an unlabelled day on a `guest` trip is guest.
 *
 * Never a gate. `maySeePhoto`, `visible()` and `mayReadTrip` decide who gets
 * in; this decides what to *say* about it, and a page that used this to admit
 * somebody would be asking the wrong function.
 */
export function effectiveAudience(
  above: Audience,
  own: PhotoVisibility | undefined,
): Audience {
  if (!own) return above;
  return AUDIENCES.indexOf(own) > AUDIENCES.indexOf(above) ? own : above;
}

/**
 * The looser of two labels, which is the right answer when one file is
 * reachable by more than one route.
 *
 * A photograph that appears in a public update and again in a held-back one
 * is on the public page, and refusing the file would break the page that is
 * legitimately showing it. So across *different* updates the effective demand
 * is the smallest, while within one update it is `strictestVisibility` — two
 * different questions that look alike: "is there a way you may see this" and
 * "what does this one way require".
 */
export function loosestVisibility(
  a: PhotoVisibility | undefined,
  b: PhotoVisibility | undefined,
): PhotoVisibility | undefined {
  if (!a || !b) return undefined;
  return strictestVisibility(a, b) === a ? b : a;
}
