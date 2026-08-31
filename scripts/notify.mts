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
import webpush, { WebPushError } from "web-push";
import { isOpenToLink } from "../lib/access";
import { getAllEntries, getDefaultDay, getEntryBySlug } from "../lib/entries";
import { isGoneSubscription, removeSubscriptions, subscribersFor } from "../lib/push";
import { currentTripRef, getTrip, getTripIds } from "../lib/trips";
import { getDefaultUsername, getUser, getUsernames } from "../lib/users";

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

const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  fail(
    "Missing VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY.\nRun:  npm run notify -- --generate-keys",
  );
}
try {
  webpush.setVapidDetails(
    VAPID_SUBJECT || "mailto:hello@example.com",
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY,
  );
} catch (err) {
  // Malformed keys otherwise surface as an unhandled throw with a stack.
  fail(
    `VAPID keys look wrong: ${(err as Error).message}\n` +
      "Regenerate with:  npm run notify -- --generate-keys",
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
  isCurrent ? `/${trip.username}/day/${slug}` : `/${trip.username}/trips/${trip.id}/day/${slug}`;

// ---- resolve which day this run is about -----------------------------------

const slug = valueOf("--day");
const entry = has("--latest") ? getDefaultDay(trip.ref)?.lead : getEntryBySlug(trip.ref, slug ?? "");

if (!entry) {
  const known = getAllEntries(trip.ref).map((e) => e.slug);
  fail(
    (slug ? `No entry with slug "${slug}" on ${trip.ref}.` : "Pass --day <slug> or --latest.") +
      `\nKnown slugs: ${known.join(", ") || "(none)"}`,
  );
}

const payload = JSON.stringify({
  title: entry.title,
  body: `${entry.location}${entry.country ? `, ${entry.country}` : ""}`,
  url: `${SITE_URL}${dayPath(entry.slug)}`,
  tag: `day-${entry.slug}`,
});

console.log(`\n  → "${entry.title}" (${trip.ref})`);
console.log(`    ${entry.location}${entry.country ? `, ${entry.country}` : ""} · ${entry.date}`);
console.log(`    ${SITE_URL}${dayPath(entry.slug)}\n`);

// ---- who gets it -------------------------------------------------------

const restricted = !isOpenToLink(trip);
const recipients = await subscribersFor(trip);

if (restricted) {
  console.log(
    `  "${trip.title}" is password-protected — only subscribers tied to an approved,\n` +
      "  signed-in contact with access to this trip are notified.\n",
  );
}

if (has("--dry-run")) {
  console.log(`  dry run — would send to ${recipients.length} subscriber(s)`);
  process.exit(0);
}

let sent = 0;
const dead: string[] = [];
await Promise.all(
  recipients.map(async (sub) => {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload);
      sent++;
    } catch (err) {
      // 404/410 mean the subscription is gone for good — the PWA was deleted
      // or the browser rotated it. Anything else is worth seeing. Pruning it
      // rather than throwing is the point: one dead subscription must not
      // fail the rest of the run.
      if (isGoneSubscription(err)) {
        dead.push(sub.endpoint);
      } else {
        const statusCode = err instanceof WebPushError ? err.statusCode : "?";
        const body = err instanceof WebPushError ? err.body : (err as Error).message;
        console.error(`    ! ${statusCode} ${String(body).slice(0, 120)}`);
      }
    }
  }),
);

if (dead.length > 0) {
  await removeSubscriptions(trip.username, dead);
}

console.log(`  sent ${sent} / ${recipients.length} subscribers`);
console.log(`  pruned ${dead.length} expired subscription${dead.length === 1 ? "" : "s"}\n`);
