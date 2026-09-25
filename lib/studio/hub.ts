import "server-only";
import { listTrash } from "@/lib/dayTrash";
import { isEnabled } from "@/lib/capabilities";
import { balanceOf } from "@/lib/credits";
import { listAllOrders, listUnfinished, type OrderRow, type UnfinishedPrint } from "@paid/printOrder/lib/orders";
import { listPayments } from "@paid/credits/lib/payments";
import { storageFor } from "@/lib/storageQuota";
import { readersModel } from "@/lib/readers/model";
import { AS_AUTHOR, getDays, getEntryBySlug } from "@/lib/entries";
import { daysLeftToTell } from "@/lib/extract/group";
import { postcardSuggestion } from "@paid/postcard/lib/postcard/suggest";
import { unusedPhotoCount } from "@/lib/staging/expiry";
import { listRuns } from "@/lib/staging/manifest";
import { inboxSummary, waitingDaysFor } from "@/lib/studio/inbox";
import type { WaitingDays } from "@/lib/studio/dayCards";
import { getTrip, getTrips, parseTripRef, tripRef } from "@/lib/trips";
import { daysUntil, readerTodayISO } from "@/lib/tripTime";

/**
 * What `/[user]/studio` (B1829) needs to render its three non-default
 * states, computed once, server-side, from the same functions every other
 * owner page already reads — never a new capability check or a new content
 * reader invented for the hub.
 *
 * **Why this is a plain data model, not JSX.** `StudioHub.tsx` is a client
 * component (it needs `useI18n()`), and everything this file reads —
 * `getTrips`, `getDays`, `listRuns` — is server-only (`node:fs`, in
 * `lib/staging/manifest.ts`'s case, the same reason `PreviewScreen.tsx`'s own
 * doc comment gives for keeping `groupIntoDays` off the client bundle). The
 * split is the same one `app/[user]/studio/photos/page.tsx` already makes
 * for its own trip list.
 */
export type StudioHubModel =
  | {
      kind: "empty";
      /** A journal can have a half-done photographs import before it has
       *  its first trip at all — `TripModeStep` (Step 02 of that flow)
       *  offers "a new trip" from inside the import itself, so an empty
       *  journal with something to resume is a real, reachable state, not
       *  an edge case. Resume banners belong above *this* screen's own CTA
       *  too (spec §3: "Resume lives on the hub, not only inside each
       *  flow"), which is why this field exists on both branches of the
       *  union rather than only on "full". */
      account: HubAccount;
      print: HubPrint;
      resumableImports: ResumableImportSummary[];
      /** Whether this journal counts its readers at all — B566, moved into
       *  the model by B2017 so the Journal group's Visitors card is gated
       *  the same way the nav row already was. On both branches for the
       *  same reason `resumableImports` is. */
      analyticsEnabled: boolean;
      /** The one postcard-shaped moment worth surfacing, if there is one
       *  right now — B436, carried into the hub model from `/[user]/me` by
       *  B2017. `null` where there is nothing to send: an empty journal has
       *  no published day to have one about, so this is always `null` here
       *  in practice, kept on both branches for the same reason
       *  `resumableImports` is. */
      postcardSuggestion: PostcardCard | null;
      /** Empty on this branch — there are no trips yet — kept for the same
       *  reason `resumableImports` is on both. */
      routeRecordingTrips: { id: string; title: string; start: string; end: string }[];
      /** B2193 — "Waiting for your words", on both branches: photographs
       *  shared before any trip exists are exactly what proposes the first. */
      waitingDays?: WaitingDays;
    }
  | {
      kind: "full";
      /** The proposal for the main "Add a day" card, and whether it is
       *  actually the trip today falls inside — `current: false` means this
       *  is `getCurrentTrip`'s own past-trip fallback (B1951). The hub must
       *  not say "the trip you are on" about a trip that has ended, so this
       *  flag, not merely the trip's presence, decides which sentence the
       *  main card gets. `null` when there is no current trip *and* no past
       *  one to fall back to — every trip on the journal is still upcoming
       *  — which is a real, if untested-by-B1951, state kept exactly as it
       *  rendered before this ticket: a generic "Add a day" card naming no
       *  trip. */
      addDayTrip: { id: string; title: string; current: boolean } | null;
      /** B2304 — whether the reader's own today already has a day written
       *  on `addDayTrip` (only ever true when `addDayTrip.current`; a
       *  finished or nameless trip has no "today" to have told). Read from
       *  the same `days` this function already loads for `facts.drafts`
       *  and `totalDays`, restricted to the current trip — no second disk
       *  walk. Drives the calmer hero's "you already told today" wording. */
      /** Optional so a model built elsewhere (the private features repo's own
       * fixtures) without it still type-checks; absent means "not yet". */
      toldToday?: boolean;
      /** The nearest trip that has not started yet — B2011's own hub card,
       *  "Plan a trip". `null` hides that card outright rather than showing
       *  it disabled: a journal with nothing upcoming has nothing to plan,
       *  which is a different state from a capability being switched off. */
      planTrip: { id: string; title: string } | null;
      /**
       * The two reasons a card is shown greyed, worded apart (spec §3).
       * Never used to hide a card — every key here is read by the hub as
       * "show this card, but say why it cannot run right now".
       *
       * **The spec's third reason — "it is broken and we know" — has no
       * field here.** It shipped once, hardcoded to the location card for
       * B1819's Android-Timeline bug, and B1819 fixed that bug while this
       * branch was still open: the sentence went from true to false within
       * the hour, because it was a fact stored a second time instead of
       * read from something real. Nothing in this codebase currently
       * tracks "this importer is known broken" as a fact a page can read —
       * `lib/capabilities.ts` is on/off switches, not a defect ledger — so
       * there is no honest source to drive that reason from today. Adding
       * one (a known-issues list, checked here) is real work with its own
       * shape and belongs to whichever ticket first needs a *second*
       * instance of this reason; until then, location is an ordinary card
       * with no reason attached, same as every other unbuilt flow.
       */
      cannotRun: {
        /** The operator switched printing off. */
        postcard: boolean;
        photobook: boolean;
        /** There is nothing to act on — no day exists yet to change or to
         *  refile. True only when every trip on this journal has zero days;
         *  the empty-journal state above already covers zero *trips*. */
        changeDay: boolean;
        reshapeDay: boolean;
      };
      account: HubAccount;
      print: HubPrint;
      resumableImports: ResumableImportSummary[];
      /** Whether this journal counts its readers at all — B566, moved into
       *  the model by B2017. Only ever true for the owner, which is who
       *  this whole model is built for. */
      analyticsEnabled: boolean;
      /** The one postcard-shaped moment worth surfacing, if there is one
       *  right now — B436, carried into the hub model from `/[user]/me` by
       *  B2017. The same function `journalStatus` reads its own
       *  `suggestions` field from (`paid/postcard/lib/postcard/suggest.ts`), so the hub
       *  banner and that field can never disagree. `null`, not a banner
       *  with nothing in it, the moment any of that function's conditions
       *  fails. */
      postcardSuggestion: PostcardCard | null;
      /** B2067 — the neutral facts the hub's rows carry as chips. Each is
       *  read from something this function already loads, except
       *  `readersAsking`, which is `readersModel`'s `asking` (B2133). A chip renders
       *  only when its fact is non-zero; a draft count is never aged or
       *  ranked — publishing is never nagged. */
      facts: HubFacts;
      /** `isEnabled("routeRecording", username)`'s trips, `{id, title,
       *  start, end}` — B2197's shell-only scheduling effect needs dates
       *  from *somewhere* server-side, the same way `app/[user]/studio/
       *  location/page.tsx:25` already reads trips for its own client
       *  component. Empty when the capability is off, so the effect that
       *  reads it never even asks the plugin whether it is native. */
      routeRecordingTrips: { id: string; title: string; start: string; end: string }[];
      /** B2193 — waiting photographs as one card per day; absent in tests. */
      waitingDays?: WaitingDays;
    };

export type HubFacts = {
  /** Draft days across every trip, from the days already read AS_AUTHOR. */
  drafts: number;
  /** Every card the inbox page renders, flat bucket and day folders alike
   *  (B2134), from `inboxSummary`. */
  inboxCount: number;
  inboxBytes: number;
  /** Whole days until `planTrip` starts; `null` when there is no planTrip. */
  planStartsInDays: number | null;
  /** Contacts whose request to read is still waiting on the owner. 0 when
   *  contacts are off on this journal. */
  readersAsking: number;
  /** B2259 — days in "Recently deleted"; reading it purges what is past its
   *  30 days (`listTrash`), which is the purge running on studio load. */
  deleted?: number;
};

/** B2134 — the Credits & storage row's chips, from the same reads the
 *  account page makes: `balanceOf` (`null` when this instance does not
 *  charge), its transaction list's "awaiting approval" rows, `storageFor`. */
export type HubAccount = {
  credits: number | null;
  purchasesOpen: number;
  storage: { usedBytes: number; limitBytes: number } | null;
};

/** B2135 — print work left half done, and the Print card's last three orders
 *  (drafts left out: they are the unfinished list). */
type HubPrint = { unfinished: UnfinishedPrint[]; recentOrders: OrderRow[] };

async function hubAccount(username: string): Promise<HubAccount> {
  const [credits, payments, usage] = await Promise.all([balanceOf(username), listPayments(username), storageFor(username)]);
  return {
    credits,
    purchasesOpen: credits === null ? 0 : payments.filter((p) => p.status === "requested").length,
    storage: usage.limitBytes === null ? null : { usedBytes: usage.usedBytes, limitBytes: usage.limitBytes },
  };
}

async function hubPrint(username: string): Promise<HubPrint> {
  const [unfinished, orders] = await Promise.all([listUnfinished(username), listAllOrders(username)]);
  return { unfinished, recentOrders: orders.filter((o) => o.status !== "draft").slice(0, 3) };
}

export type ResumableImportSummary = {
  runId: string;
  createdAt: string;
  expiresAt: string;
  /** Photographs still on the server for this run, not yet moved into a
   *  committed day. */
  livePhotoCount: number;
  daysLeftToTell: number;
  stagedBytes: number;
};

/** `GET .../studio/runs`'s own read-only listing, reused rather than
 *  re-derived — see that route's doc comment for why the list is filtered to
 *  runs with something left to resume. This is the same filter, called
 *  directly (server component, no HTTP round trip to itself). */
function resumableImports(username: string): ResumableImportSummary[] {
  return listRuns(username)
    .filter((run) => unusedPhotoCount(run) > 0)
    .map((run) => {
      const live = run.photos.filter((p) => !p.dropped);
      return {
        runId: run.runId,
        createdAt: run.createdAt,
        expiresAt: run.expiresAt,
        livePhotoCount: live.length,
        daysLeftToTell: daysLeftToTell(run),
        // This run's own bytes, not the journal's whole staging footprint
        // (`journalStagingBytes`) — a hub listing several half-done imports
        // must not repeat one journal-wide total on every card, the same
        // reasoning `ResumeScreen.tsx`'s own doc comment gives for keeping
        // that figure to one summary line rather than per-run.
        stagedBytes: live.reduce((sum, p) => sum + p.bytes, 0),
      };
    });
}

/** What the hub's postcard card needs to name its day. `dayTitle` is null
 *  for a day not yet named; `dayDate` is its ISO date. */
export type PostcardCard = {
  dayTitle: string | null;
  dayDate: string | null;
  tripTitle: string | null;
  dayHref: string;
};

/** The one postcard-shaped moment worth surfacing, if there is one — B436,
 *  moved here from `app/[user]/me/page.tsx` by B2017 so it can sit beside the
 *  hub's own resume banners rather than only on `/[user]/me`. Kept as raw
 *  data (a day's own title, not a rendered English sentence) rather than the
 *  translated copy that page used to build — this module has no locale to
 *  translate into, and `StudioHub.tsx`'s own `t()` already composes
 *  `me.postcardCardBody` from a `{title}` variable, which is exactly this
 *  field. */
async function postcardCard(
  username: string,
): Promise<PostcardCard | null> {
  const suggestion = await postcardSuggestion(username);
  if (!suggestion) return null;
  const entry = getEntryBySlug(suggestion.trip, suggestion.day, AS_AUTHOR);
  return {
    // `||`, not `??`: a day not yet named has `title: ""`, which `??` let
    // through and the card rendered as „“. And no slug in its place — the
    // card names an untitled day by its date and trip instead.
    dayTitle: entry?.title?.trim() || null,
    dayDate: entry?.date ?? null,
    tripTitle: getTrip(suggestion.trip)?.title ?? null,
    dayHref: `/${username}/trips/${parseTripRef(suggestion.trip)?.tripId ?? ""}/day/${suggestion.day}`,
  };
}

export async function buildStudioHubModel(username: string): Promise<StudioHubModel> {
  const trips = getTrips(username);
  const analyticsEnabled = isEnabled("analytics", username);
  const postcardSuggestionCard = await postcardCard(username);
  const [account, print] = await Promise.all([hubAccount(username), hubPrint(username)]);
  const waitingDays = waitingDaysFor(username);
  if (trips.length === 0) {
    return {
      kind: "empty",
      account,
      print,
      resumableImports: resumableImports(username),
      analyticsEnabled,
      postcardSuggestion: postcardSuggestionCard,
      routeRecordingTrips: [],
      waitingDays,
    };
  }

  // `trips` is already sorted current-first, then upcoming, then most-recently
  // -ended first (`loadTrips`'s own sort) — the same order `getCurrentTrip`
  // (`lib/trips.ts`) reads its fallback from, so finding directly here gets
  // its answer without a second `getTrips` call, and — unlike that
  // function's return value alone — keeps the `status` that tells current
  // and fallback apart.
  const current = trips.find((t) => t.status === "current");
  const mostRecentlyEnded = trips.find((t) => t.status === "past");
  // `trips` is current-first-then-upcoming (see the comment above), so the
  // first `status === "upcoming"` found here is the nearest one — exactly
  // the trip `getPlan`/`derivePlan` mean by "an upcoming trip" elsewhere.
  const upcoming = trips.find((t) => t.status === "upcoming");
  const planTrip = upcoming ? { id: upcoming.id, title: upcoming.title } : null;
  const addDayTrip = current
    ? { id: current.id, title: current.title, current: true }
    : mostRecentlyEnded
      ? { id: mostRecentlyEnded.id, title: mostRecentlyEnded.title, current: false }
      : null;

  // `AS_AUTHOR` — the owner's own count of days includes drafts, the same
  // way every other owner-facing surface (`app/[user]/me/page.tsx`,
  // `app/[user]/about/page.tsx`) reads its own content back. Kept per trip
  // so `toldToday` can ask only the current trip's own days, not the whole
  // journal's, without a second `getDays` call.
  const daysByTrip = trips.map((trip) => ({ id: trip.id, days: getDays(tripRef(username, trip.id), AS_AUTHOR) }));
  const days = daysByTrip.flatMap((t) => t.days);
  const totalDays = days.length;
  const toldToday =
    current !== undefined &&
    (daysByTrip.find((t) => t.id === current.id)?.days.some((d) => d.date === readerTodayISO()) ?? false);
  const inbox = inboxSummary(username);
  // B2133 — the readers page's own count (confirmed requests only), not
  // every pending row: one model, so chip and page cannot disagree.
  const readersAsking = isEnabled("contacts", username) ? (await readersModel(username)).asking : 0;

  return {
    kind: "full",
    addDayTrip,
    toldToday,
    planTrip,
    cannotRun: {
      postcard: !isEnabled("postcards", username),
      photobook: !isEnabled("photobook", username),
      changeDay: totalDays === 0,
      reshapeDay: totalDays === 0,
    },
    account,
    print,
    resumableImports: resumableImports(username),
    analyticsEnabled,
    postcardSuggestion: postcardSuggestionCard,
    facts: {
      drafts: days.flatMap((d) => d.entries).filter((e) => e.draft).length,
      inboxCount: inbox.count,
      inboxBytes: inbox.bytes,
      planStartsInDays: upcoming ? daysUntil(upcoming.start) : null,
      readersAsking,
      deleted: listTrash(username).length,
    },
    routeRecordingTrips: isEnabled("routeRecording", username)
      ? trips.map((t) => ({ id: t.id, title: t.title, start: t.start, end: t.end }))
      : [],
    waitingDays,
  };
}
