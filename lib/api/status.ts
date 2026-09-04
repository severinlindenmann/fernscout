import type { Session } from "@/lib/auth";
import { SESSION_SCOPE } from "@/lib/auth";
import { resolveCapabilities } from "@/lib/capabilities";
import type { FeatureName } from "@/lib/config";
import { listDrafts, tripSummary } from "@/lib/api/entries";
import { writableTrips } from "@/lib/api/auth";
import { getTrips } from "@/lib/trips";
import { serverSite } from "@/lib/site";
import { getUser } from "@/lib/users";

/**
 * One call that says where an agent stands — B91.
 *
 * An agent that has just authenticated knows nothing about the journal it holds
 * a token for, and finding out took a call per question: `/drafts` for what is
 * waiting, `/trips` for what exists, `/api/health` for what this server can do,
 * `/invites` for the links. Four round trips before the first useful act, and
 * the guide never said to make any of them — so an agent either skipped
 * orienting and wrote into a journal without noticing three drafts already
 * waiting for approval, or reconstructed the picture differently every time.
 *
 * This is a **view over what already exists**, never a second source of truth.
 * Every field below is read from the function that owns it: `listDrafts` and
 * `tripSummary` from `lib/api/entries.ts`, `resolveCapabilities` from
 * `lib/capabilities.ts` — the same one `/api/health` reads. Nothing here
 * computes an answer of its own, because the second copy of an answer is the
 * one that goes stale.
 */

/**
 * The capabilities an agent can *act on*.
 *
 * Not every one this server has: `reactions` and `costs` are what a reader
 * does and what a trip declares, and an agent knowing their state would only
 * be noise. These four are the ones where an agent might otherwise build a
 * request that cannot be sent.
 */
const AGENT_FEATURES: readonly FeatureName[] = ["mail", "push", "postcards", "photobook"] as const;

export type DraftRow = {
  slug: string;
  title: string;
  date: string;
  test?: true;
  trip: string;
  publish: string;
};

/**
 * Everything waiting for a person to approve it, scoped to what this token may
 * reach.
 *
 * Extracted from `app/api/v1/[user]/drafts/route.ts` so that route and
 * `/status` cannot disagree about the shape — an acceptance criterion of B91,
 * and the reason is B134: `test` is inherited from the trip, so a second
 * hand-rolled draft list is a second chance to report invented content as
 * something somebody lived.
 *
 * A trip-scoped token sees its own trip's drafts and no others. That is
 * `writableTrips`, the same gate the drafts and trips routes apply — not a
 * rule reinvented here.
 */
export async function draftQueue(
  user: string,
  session: Session,
  base: string,
): Promise<DraftRow[]> {
  const trips = await writableTrips(session, getTrips(user));
  return trips.flatMap((trip) =>
    listDrafts(trip.ref).map((draft) => ({
      ...draft,
      trip: trip.ref,
      publish: `POST ${base}/api/v1/${user}/trips/${trip.id}/days/${draft.slug}/publish`,
    })),
  );
}

/** What to do next, in the order an agent should care about it. */
function nextStep(drafts: number, trips: number, scoped: boolean): string {
  if (drafts > 0) {
    return (
      `${drafts} ${drafts === 1 ? "day is" : "days are"} written and not on the site. ` +
      "Tell the person what is waiting and ask which to publish — `publish` on each draft " +
      "below is the call that acts on their answer. Never publish because it looks finished."
    );
  }
  if (trips === 0) {
    return scoped
      ? "This token is scoped to a trip that has no days yet. Ask what happened, then write one."
      : "There is no trip to write into yet. Ask about the journey, then POST to " +
          "`/trips` to make one. A trip is not a draft; if you omit its visibility it " +
          "defaults to this journal's own answer, never wider — ask rather than relying on it.";
  }
  return (
    "Nothing is waiting. Ask what happened, write it as a draft, and report back — " +
    "what an agent writes arrives as a draft and stays one until a person says otherwise."
  );
}

/**
 * The journal, the queue, the trips, what this server can do, and what to do
 * next.
 *
 * **Scoping is `writableTrips` and nothing else.** A trip-scoped token — held
 * by somebody who came on one trip — sees that trip and is told in words that
 * is what it is seeing, because an agent that cannot tell a slice from the
 * whole will report "this journal has one trip" to somebody who has five.
 */
export async function journalStatus(user: string, session: Session) {
  const site = serverSite();
  const base = site.url;
  const journal = getUser(user);
  const scoped = session.scope !== SESSION_SCOPE.agent;

  const trips = await writableTrips(session, getTrips(user));
  const drafts = await draftQueue(user, session, base);

  const resolved = resolveCapabilities(user);
  const features = Object.fromEntries(
    AGENT_FEATURES.map((name) => [
      name,
      resolved[name].enabled
        ? { enabled: true }
        : // Reported as off with the reason, never omitted. An agent that is
          // told nothing about `postcards` cannot tell "off" from "this build
          // does not have the concept", and will build the request either way.
          { enabled: false, reason: resolved[name].reason },
    ]),
  );

  return {
    user,
    // Said plainly rather than left to be inferred from a one-item list.
    scope: scoped
      ? {
          kind: "trip" as const,
          trips: trips.map((t) => t.ref),
          note:
            "This token is scoped to the trips listed here. Everything below is that slice " +
            "of the journal, not the whole of it — do not describe it as the journal's total.",
        }
      : { kind: "journal" as const },
    journal: {
      url: `${base}/${user}`,
      title: journal?.title ?? null,
      // The journal's own visibility, which is whether this instance advertises
      // it — not who may read a trip. That is each trip's `visibility` below.
      visibility: journal?.visibility ?? null,
      locale: journal?.defaultLocale ?? null,
      locales: journal?.locales ?? [],
    },
    drafts: { count: drafts.length, items: drafts },
    trips: trips.map((t) => tripSummary(user, t.id)).filter(Boolean),
    features,
    // Only where there is somewhere for a redemption to land. `contacts` off
    // means no queue, so `POST /invites` answers 404 — an absent key is the
    // honest answer, and the feature block above says why.
    ...(resolved.contacts.enabled
      ? { invites: `GET ${base}/api/v1/${user}/invites` }
      : {}),
    // `credits` and `pricing` are deliberately absent until B89 exists. Absent
    // rather than zero: a balance of 0 is a statement about an account, and
    // there are no accounts. Slot them in beside `features` when B89 lands.
    next: nextStep(drafts.length, trips.length, scoped),
  };
}
