import "server-only";
import { headers } from "next/headers";
import { isTestContent } from "../access";
import { afterResponse } from "../afterResponse";
import { isEnabled } from "../capabilities";
import { isOwner } from "../contacts/session";
import { getDatabaseOrNull, newId, nowIso } from "../db";
import { clientIp, rateLimitFor } from "../rateLimit";
import type { Trip } from "../types";
import { looksLikeBot, visitorHash } from "./visitor";

/**
 * One page opened, recorded — B566.
 *
 * ## Why this is server-side and there is no beacon
 *
 * The obvious shape is a `sendBeacon` from a client component, and it was
 * rejected: it is a new public write endpoint on an instance whose whole
 * threat model is "an unauthenticated stranger can reach every page", it
 * misses every reader with an ad-blocker (which is most of them, and not
 * randomly distributed), and it puts a script in the bundle of a site that
 * currently ships none for this.
 *
 * Recording from the render works here because of a property of this codebase
 * that is worth stating: **`/[user]` is already dynamic**. `app/[user]/layout.tsx`
 * reads `cookies()`, so nothing under it is statically served and every open
 * is a real render. That also means the gallery — `/[user]/gallery`, its own
 * route — is countable without any client code at all, which is the question
 * the owner asked and the reason no beacon was needed to answer it.
 *
 * ## What is deliberately not counted
 *
 * Each of these is a way the numbers would lie:
 *
 * - **The owner.** Someone re-reading their own journal must not appear in
 *   their own figures — it is the single fastest way to make the number
 *   useless. Includes `FERNSCOUT_ADMIN_EMAIL` (B480), through `isOwner`.
 * - **Bots.** See `looksLikeBot`.
 * - **Prefetches.** Next fetches a route before the reader clicks it. A
 *   prefetch is not an open, and counting them would make the nav's shape
 *   rather than the reader's interest the thing being measured.
 * - **`test: true` content**, for the reason it is out of the feed, the search
 *   index and the sitemap: nobody lived it, so nobody read it. That check is
 *   the caller's — the page already has the trip in hand.
 *
 * ## Failure is silent, always
 *
 * Everything below is inside `afterResponse`, which runs after the response
 * has gone and swallows what it catches. A journal must render when its
 * database is down, and a counter is never a reason a reader sees an error
 * page. `getDatabaseOrNull` returning null is the same non-event.
 */

/** The closed list. Mirrored in the `kind` comment in lib/db/schema.ts and in
 * the OpenAPI-free page; there is no second copy to drift because nothing
 * outside this module constructs one. */
export const VIEW_KINDS = ["journal", "trip", "day", "gallery", "map", "photobook"] as const;

export type ViewKind = (typeof VIEW_KINDS)[number];

/**
 * How long a row lives.
 *
 * Stated to readers in `site/legal/*.md`. The two numbers are one fact in two
 * files: change them together, or the imprint becomes a false statement about
 * what this server keeps.
 */
export const RETENTION_DAYS = 90;

/**
 * How many views one address may have counted, and over how long — B571.
 *
 * Set from what a *household* can honestly read rather than from what one
 * person can: everybody behind one home connection or one hostel wifi shares
 * an address, and they are exactly the group most likely to read the same
 * journal on the same evening. Three hundred pages in an hour is far more than
 * four people can get through and far less than a script manages in a second,
 * which is the gap this number lives in.
 *
 * Exported so the test can assert the ceiling rather than restate it, and so
 * the number has one home. Being generous is deliberate: the cost of setting
 * it too low is a family's real reading going uncounted and the owner drawing
 * the wrong conclusion from it, which is worse than the disk cost of an
 * over-generous bound.
 */
export const VIEW_BUDGET = { max: 300, windowMs: 60 * 60 * 1000 };

export type ViewTarget = {
  kind: ViewKind;
  /** Unqualified — `owner_id` carries the journal. Omitted for `journal`. */
  tripId?: string;
  /** Only for `day`. */
  slug?: string;
};

/**
 * Record that somebody opened something, unless they are the owner, a bot, or
 * a prefetch — and unless the journal never asked for this.
 *
 * Call it from a page's render and do not await the writing: the `await` here
 * covers only the decisions, which are a cookie read the page has already
 * done (memoised by `resolveAccess`) and two header reads.
 */
export async function recordView(username: string, target: ViewTarget): Promise<void> {
  if (!isEnabled("analytics", username)) return;

  const h = await headers();

  // Next asks for a route before the reader has chosen it. Counting that
  // measures the navigation's shape, not the reader.
  if (h.get("next-router-prefetch") === "1" || h.get("purpose") === "prefetch") return;

  const userAgent = h.get("user-agent");
  if (looksLikeBot(userAgent)) return;

  // Last, because it is the most expensive of the four and the other three
  // reject far more traffic. Memoised per request, so a page that already
  // asked pays nothing here.
  if (await isOwner(username)) return;

  const ip = clientIp(h);

  /**
   * The write budget — B571.
   *
   * **Last of the five checks, and that is the whole design.** It counts rows
   * that were about to be *written*, not requests that arrived: a bot, a
   * prefetch and the owner's own reading all return above without spending
   * anything, so a busy owner cannot exhaust the budget their family's visits
   * are then counted against.
   *
   * Page renders are not rate-limited anywhere in this codebase —
   * `lib/rateLimit.ts` is called from `app/api/` only — because until B566 a
   * page request cost CPU and no storage. It costs a row now, so an
   * unauthenticated loop against `/<user>` cost unbounded rows, on the one
   * disk Postgres is on, for every journal on the instance. Ninety-day
   * retention caps the age of that, not the rate.
   *
   * **Dropping is the correct answer, not refusing.** The reader still gets
   * their page; only the counting stops. A counter that misses part of a flood
   * is right — a flood is not readership — and a 429 on a travel journal
   * because somebody else is hammering it would be the counter deciding who
   * may read, which is exactly backwards.
   *
   * Keyed on the address, which is trustworthy *here*: `deploy/fernscout.caddy`
   * sets `header_up X-Forwarded-For {remote_host}`, overwriting whatever the
   * client sent, so the value `clientIp` reads cannot be chosen by the caller.
   * Behind a proxy that appends instead, this bound is forgeable and so is
   * every other limit in the application — see the long note in
   * `lib/rateLimit.ts`.
   *
   * ponytail: one in-memory bucket per process, which is what `rateLimitFor`
   * already is. It bounds a flood from one source, which is the realistic one
   * for a journal a family reads. It does **not** bound a distributed flood,
   * and it does not bound the table by construction — a per-journal-per-day
   * row ceiling would, at the price of a query per view. Do that instead if a
   * real journal is ever filled from many addresses at once.
   */
  if (!rateLimitFor("analytics-view", ip, VIEW_BUDGET).ok) return;

  // The hash is computed here rather than inside the deferred task on
  // purpose: `headers()` is request-scoped, and the salt must be today's at
  // the moment of the visit rather than whenever the write happens to run.
  const hash = visitorHash(username, ip, userAgent);

  afterResponse("analytics", async () => {
    const handle = await getDatabaseOrNull();
    if (!handle) return;
    await handle.db
      .insertInto("analytics_events")
      .values({
        id: newId(),
        owner_id: username,
        kind: target.kind,
        trip_id: target.tripId ?? null,
        slug: target.slug ?? null,
        visitor_hash: hash,
        occurred_at: nowIso(),
      })
      .execute();
  });
}

/**
 * The form every page actually calls: a view of something on a trip.
 *
 * The `test: true` check is here rather than at each of the five call sites,
 * because a check repeated five times is a check that will be four times next
 * year. Content nobody lived has no readers to count, which is the same reason
 * it is out of the feed, the search index and the sitemap — and it is asked of
 * the *entry* as well as the trip, because a demonstration day can be written
 * into a journal that is otherwise real.
 */
export async function recordTripView(
  trip: { username: string; id: string; test?: boolean },
  kind: ViewKind,
  entry?: { slug: string; test?: boolean },
): Promise<void> {
  if (isTestContent(trip as Trip, entry)) return;
  await recordView(trip.username, { kind, tripId: trip.id, slug: entry?.slug });
}
