import type { Reaction, ReactionCounts, DayCounts } from "../reactionSet";

/**
 * The repository seam.
 *
 * Each of these has two implementations — one over `$DATA_DIR/*.json`, one
 * over the database — and callers get whichever the deployment supports
 * without being told which. That is what lets the no-database prototype
 * (ROADMAP §2.2) keep working features rather than losing them.
 */

export type VoteResult = { counts: DayCounts; mine: Reaction | null };

/** A comment as stored. `authorEmail` is for ownership checks and must never
 * reach a client. */
export type StoredComment = {
  id: string;
  tripId: string;
  daySlug: string;
  authorEmail: string;
  authorName: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
};

export type CommentRepo = {
  /** Oldest first. With `limit`, only the latest that many (still oldest
   * first); `total` is always the whole count. */
  list(tripId: string, daySlug: string, limit?: number): Promise<{ comments: StoredComment[]; total: number }>;
  get(tripId: string, daySlug: string, id: string): Promise<StoredComment | null>;
  add(comment: Omit<StoredComment, "id" | "editedAt">): Promise<StoredComment>;
  update(tripId: string, daySlug: string, id: string, body: string): Promise<StoredComment | null>;
  remove(tripId: string, daySlug: string, id: string): Promise<boolean>;
  /** How many comments this address has written on this trip since `sinceIso`. */
  countByAuthorSince(tripId: string, authorEmail: string, sinceIso: string): Promise<number>;
};

export type ReactionRepo = {
  /** Every day's counts for one trip, for the initial page load. */
  getAllCounts(tripId: string): Promise<ReactionCounts>;
  /** What this reader has already picked, keyed like `getAllCounts`. Spans
   * every trip — the browser holds one voter id across all of them — but
   * still takes the trip in view, because the file store needs it to rewrite
   * votes cast before trips existed. */
  getVotesFor(voterId: string, tripId: string): Promise<Record<string, Reaction>>;
  /** Record, change, or withdraw one reader's reaction to one day. Picking
   * the emoji they already chose removes it. */
  vote(
    tripId: string,
    daySlug: string,
    voterId: string,
    emoji: Reaction,
  ): Promise<VoteResult>;
};

/**
 * `web` is a browser's Push API subscription — `endpoint` is the push
 * service's own URL and `keys` are real. `apns` (B2115) is an iPhone shell
 * registered directly with Apple: there is no push service URL and no
 * encryption keypair, so `endpoint` holds the device token APNs handed back
 * and `keys` is a pair of empty strings — kept rather than made optional so
 * every reader of this type still gets one shape, and the database's
 * `p256dh`/`auth` columns (`NOT NULL` since 001-initial) need no migration
 * of their own. `lib/push/apns.ts` is the only thing that reads `endpoint`
 * as a device token.
 */
type SubscriptionKind = "web" | "apns";

export type StoredSubscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  /** ISO date (`YYYY-MM-DD`), so it is obvious when someone signed up. */
  created: string;
  /** Best-effort note of what subscribed, to make pruning legible. */
  agent?: string;
  /** Which journal this belongs to — content is multi-user, and a deployment
   * can serve several. Without this, notifying one user's trip would fan out
   * to every other journal's subscribers too. */
  username: string;
  /** The known reader this browser belongs to, set at subscribe time from a
   * signed-in guest session matched to an active contact (W10). Null for an
   * anonymous subscriber, and always null without a database — contacts
   * require one. See `lib/push.ts#subscribersFor`. */
  contactId?: string | null;
  /** Which transport this row sends through — see `SubscriptionKind`.
   * Defaults to `"web"` for every row written before B2115, both in the
   * database (migration backfills the column) and in the file store (never
   * written, so a reader who finds it absent means `"web"`). */
  kind?: SubscriptionKind;
  /**
   * Whether this browser belongs to the journal's own owner — B2447/B2448
   * item 4's push branch. Decided once, at subscribe time
   * (`app/api/push/subscribe/route.ts`), from the same owner-cookie check
   * every other owner-only door uses (`isOwner`, lib/contacts/session.ts) —
   * **never** trusted from anything the client's own request body claims,
   * and never decided from a bearer token either (an agent is not "the
   * owner's own device"). Absent or `false` for every subscription written
   * before this field existed, and for any reader's. See
   * `ownerPushSubscription` in lib/digest/firstTrip.ts for the one place
   * this actually gets read.
   */
  isOwner?: boolean;
};

export type PushRepo = {
  list(username: string): Promise<StoredSubscription[]>;
  /** Keyed by username + endpoint, so re-subscribing the same browser to the
   * same journal updates rather than duplicating — which browsers do
   * routinely — while the same endpoint subscribing to two journals on one
   * deployment stays two rows. */
  save(sub: StoredSubscription): Promise<void>;
  remove(username: string, endpoints: string[]): Promise<void>;
};
