/**
 * Send a push notification about one day to whoever opted in and can see it.
 *
 *   npm run notify -- --latest
 *   npm run notify -- --day hoi-an
 *   npm run notify -- --latest --dry-run
 *   npm run notify -- --latest --trip <username>/<trip-id>
 *   npm run notify -- --latest --user <username> --trip <trip-id>
 *
 * Defaults to the server's `site.defaultUser` (single-user instances only —
 * see `lib/users.ts#getDefaultUsername`) and that user's current trip; pass
 * `--user` and/or `--trip` to target another journal or trip explicitly.
 * `--trip` may be a bare id (combined with `--user`, or the default user) or
 * a full `<username>/<trip-id>` ref. The notification links to `/day/<slug>`
 * for a user's current trip and `/<username>/trips/<id>/day/<slug>` for any
 * other.
 *
 * Needs VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT in the
 * environment. Reads subscriptions through `lib/push.ts`, exactly the way the
 * app does — the database when `DATABASE_URL` is set, the `$DATA_DIR` JSON
 * file otherwise — so this works in both deployment shapes rather than
 * refusing to run under one of them. Generate a key pair once with:
 *
 *   npm run notify -- --generate-keys
 *
 * Run through `tsx --conditions=react-server` (see package.json). The
 * condition is not decoration: `lib/trips.ts` and friends are marked
 * `server-only`, whose package exports resolve to an empty module under that
 * condition and to a throwing one otherwise. It is the same switch Next flips
 * for server components, used here for the same reason — see
 * `scripts/photobook.ts` and `scripts/export.mts`, which do the same thing.
 */
import webpush from "web-push";
import { isOpenToLink, isTestContent } from "../lib/access";
import { AS_AUTHOR, getAllEntries, getDefaultDay, getEntryBySlug } from "../lib/entries";
import { translateIn } from "../lib/locales";
import { subscribersFor, type StoredSubscription } from "../lib/push";
import { localeForSubscriber, sendPush } from "../lib/push/send";
import { currentTripRef, getTrip, getTripIds } from "../lib/trips";
import { getDefaultUsername, getUser, getUsernames } from "../lib/users";
import { journalPath } from "../lib/journalPath";

const args = process.argv.slice(2);
const has = (flag: string) => args.includes(flag);
const valueOf = (flag: string): string | undefined => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (has("--generate-keys")) {
  const keys = webpush.generateVAPIDKeys();
  console.log("Add these to the server environment (and keep the private one secret):\n");
  console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
  console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
  console.log(`VAPID_SUBJECT=mailto:you@your-domain.com`);
  process.exit(0);
}

// `sendPush` (lib/push/send.ts) configures and calls `web-push` itself and
// simply sends nothing without a working VAPID setup or the `push`
// capability switched on — the same "absent, not broken" rule every
// capability follows. This script keeps its own eager check only for the
// person running it by hand: a silent zero-sent run is a worse experience
// than a message pointing at `--generate-keys`.
const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env;
if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  fail(
    "Missing VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY.\nRun:  npm run notify -- --generate-keys",
  );
}

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://example.com";

// ---- resolve which trip this run is about ----------------------------------

const tripArg = valueOf("--trip");
const userArg = valueOf("--user");

function resolveRef(): string {
  // A full ref carries its own username; --user is redundant with it and
  // would only be a way to say two different things.
  if (tripArg?.includes("/")) return tripArg;

  const username = userArg ?? getDefaultUsername() ?? undefined;
  if (!username) {
    fail(
      "No --user given and no site.defaultUser configured.\n" +
        `Known users: ${getUsernames().join(", ") || "(none)"}\n` +
        "Pass --user <username>, or --trip <username>/<trip-id>.",
    );
  }
  if (!getUser(username)) {
    fail(`No such user "${username}". Known users: ${getUsernames().join(", ")}`);
  }
  const ref = tripArg ? `${username}/${tripArg}` : currentTripRef(username);
  if (!ref) {
    fail(
      `${username} has no trip under content/${username}/trips declaring status: current, ` +
        "and none is finished either.\nPass --trip <trip-id> explicitly.",
    );
  }
  return ref;
}

const ref = resolveRef();
const trip = getTrip(ref);
if (!trip) {
  const parsedUser = ref.slice(0, ref.indexOf("/"));
  const known = getUser(parsedUser) ? getTripIds(parsedUser) : [];
  fail(
    `No trip "${ref}".` +
      (known.length > 0 ? ` Known trips for ${parsedUser}: ${known.join(", ")}` : ""),
  );
}

const isCurrent = trip.ref === currentTripRef(trip.username);
const dayPath = (slug: string) =>
  isCurrent ? `${journalPath(trip.username)}/day/${slug}` : `${journalPath(trip.username)}/trips/${trip.id}/day/${slug}`;

// ---- resolve which day this run is about -----------------------------------

const slug = valueOf("--day");
// Read as the author — B632. A day carrying its own `visibility` is dropped
// at the closed default reader, so without this the operator announcing their
// own held-back day is told there is no such day. Who is *told* about it is
// `subscribersFor`'s question, below, and the label narrows it there.
const entry = has("--latest")
  ? getDefaultDay(trip.ref, AS_AUTHOR)?.lead
  : getEntryBySlug(trip.ref, slug ?? "", AS_AUTHOR);

if (!entry) {
  const known = getAllEntries(trip.ref, AS_AUTHOR).map((e) => e.slug);
  fail(
    (slug ? `No entry with slug "${slug}" on ${trip.ref}.` : "Pass --day <slug> or --latest.") +
      `\nKnown slugs: ${known.join(", ") || "(none)"}`,
  );
}

const url = `${SITE_URL}${dayPath(entry.slug)}`;
const tag = `day-${entry.slug}`;

console.log(`\n  → "${entry.title}" (${trip.ref})`);
console.log(`    ${entry.location}${entry.country ? `, ${entry.country}` : ""} · ${entry.date}`);
console.log(`    ${SITE_URL}${dayPath(entry.slug)}\n`);

// ---- who gets it -------------------------------------------------------

const closed = !isOpenToLink(trip);
// The entry, not just the trip: a `test: true` day inside a real trip is
// announced to nobody, the same as a whole test trip (B70).
const recipients = await subscribersFor(trip, entry);

if (isTestContent(trip, entry)) {
  console.log(
    "  This day is marked `test: true` — content nobody lived — so nobody is\n" +
      "  notified about it. The page itself still says so, in a banner.\n",
  );
}

// There has been no trip password since B39 — no hash, no cookie, no unlock
// form. What narrows the audience now is the trip's `visibility`, and the two
// closed values narrow it by different amounts, so they get different
// sentences. Telling an operator their trip is "password-protected" sends them
// looking for a password that does not exist.
if (trip.visibility === "private") {
  console.log(
    `  "${trip.title}" is private — it belongs to the people who were on it, and\n` +
      "  nothing here records who they were, so nobody is notified at all (B68).\n",
  );
} else if (closed) {
  console.log(
    `  "${trip.title}" is a guest trip, so only subscriptions tied to a contact of\n` +
      "  this journal who is active and holds a live read grant are notified.\n",
  );
}

// The day's own label, which narrows against the trip's — B632. Said
// separately from the trip's sentence above, because an operator looking at a
// public trip and a recipient count of nought needs to know it was this
// update and not the whole journey.
if (entry.visibility === "private") {
  console.log(
    "  This update is marked `private` — it belongs to the people who were\n" +
      "  there, and nothing here records who they were, so nobody is notified.\n",
  );
} else if (entry.visibility === "guest" && !closed) {
  console.log(
    "  This update is marked `guest`, so it is announced only to subscriptions\n" +
      "  tied to an active contact holding a live read grant — not to everyone\n" +
      "  the trip itself is open to.\n",
  );
}

if (has("--dry-run")) {
  console.log(`  dry run — would send to ${recipients.length} subscriber(s)`);
  process.exit(0);
}

// Grouped by locale, so every subscriber sees the day's title through the
// same `news.push` template the publish route's automatic fan-out uses
// (lib/push/send.ts) — one rendered call per locale rather than one per
// recipient.
const owner = getUser(trip.username);
const byLocale = new Map<string, StoredSubscription[]>();
for (const sub of recipients) {
  const locale = await localeForSubscriber(trip.username, sub);
  const group = byLocale.get(locale);
  if (group) group.push(sub);
  else byLocale.set(locale, [sub]);
}

let sent = 0;
let pruned = 0;
for (const [locale, subs] of byLocale) {
  const outcome = await sendPush({
    template: "news.push",
    subscriptions: subs,
    title: owner?.title ?? trip.title,
    body: translateIn(locale, "push.newDay.body", { day: entry.title }),
    url,
    tag,
    locale,
  });
  sent += outcome.sent;
  pruned += outcome.pruned;
}

console.log(`  sent ${sent} / ${recipients.length} subscribers`);
console.log(`  pruned ${pruned} expired subscription${pruned === 1 ? "" : "s"}\n`);
