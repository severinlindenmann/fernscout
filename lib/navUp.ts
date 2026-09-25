/**
 * Where *up* is, from any page inside a journal — B1728.
 *
 * This app draws no Back. The browser and the phone already own Back — swipe,
 * hardware button, Alt+← — and a control that competes with them has to answer
 * "where does this go?" with "wherever you were", which is not an answer a
 * label can carry. B822 tried it: one arrow that was a link to a fixed parent
 * on a fresh tab and a `router.back()` button once the tab had navigated once,
 * switched by a `sessionStorage` flag the reader could not see. What it did in
 * practice was latch — the flag was set by the first soft navigation and never
 * cleared — so the header's own breadcrumb, whose only job was to leave the
 * journal, spent the rest of the visit retracing instead.
 *
 * So: every arrow this app draws is *up*, to a fixed ancestor, with that
 * ancestor's own name on it. This is the one place that decides what the
 * ancestors are, and it is pure so a keeper can assert the whole map.
 *
 * The chain is returned **nearest first**, which is the order both consumers
 * want: the phone header takes `[0]` and nothing else, and the trail at `sm`
 * and up reverses it. It is at most three long, because the journal is at most
 * three deep.
 *
 * One decision worth naming: `/<user>/trips` is the journal's home here, not
 * `/<user>`. `/<user>` is the *current trip's story* (components/TripProvider)
 * — it is a trip, not a journal — and the trip list is the page that already
 * lists every trip a reader may see. The alternative was a new `/<user>`
 * overview, which would have had to take a URL every shared link already
 * points at.
 */

export type UpCrumb = {
  href: string;
  /**
   * What the crumb *is*, which is how `useUpCrumbs` knows what to call it:
   * `root` is the instance — a reader's own journals, or the landing page;
   * `journal` is this journal, meaning its trip list; `trip` is the story of
   * the trip this page belongs to.
   */
  kind: "root" | "journal" | "trip";
};

export type UpContext = {
  /** `/<username>`, or "" on a page that belongs to no journal. */
  userBase: string;
  /**
   * `TripProvider`'s `base` — `/<username>` for the current trip and
   * `/<username>/trips/<id>` for any other — or null where no trip is in
   * context, which is every journal-level page (`/trips`, `/search`, `/me`).
   */
  tripBase: string | null;
};

const ROOT: UpCrumb = { href: "/", kind: "root" };

/**
 * The ancestors of `pathname`, nearest first. Empty outside a journal — the
 * landing page has no parent, and `/docs` is a fixed link its own layout
 * writes out rather than a tree worth walking.
 */
export function upTrail(pathname: string, { userBase, tripBase }: UpContext): UpCrumb[] {
  if (!userBase || (pathname !== userBase && !pathname.startsWith(`${userBase}/`))) {
    return [];
  }

  const journal: UpCrumb = { href: `${userBase}/trips`, kind: "journal" };

  // Before the trip branches: the trip list is prefixed by `userBase` like
  // everything else, and for the *current* trip `tripBase` is `userBase`
  // itself, so a prefix test alone would make the trip list a page inside the
  // trip it lists.
  if (pathname === journal.href) return [ROOT];

  if (tripBase) {
    // A trip's own story — one step above it is the journal.
    if (pathname === tripBase) return [journal, ROOT];
    // Gallery, map, a day, an analysis: the story of the trip they belong to.
    if (pathname.startsWith(`${tripBase}/`)) {
      return [{ href: tripBase, kind: "trip" }, journal, ROOT];
    }
  }

  // Everything else under the journal — `/me`, `/search`, `/account`, the
  // trip gate, an invite. These belong to the journal rather than to any one
  // trip, so they go up to the trip list and not to whichever trip happened
  // to be current.
  return [journal, ROOT];
}
