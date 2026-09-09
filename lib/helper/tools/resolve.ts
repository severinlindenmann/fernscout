import "server-only";
import { isEnabled } from "../../capabilities";
import { listContacts } from "../../contacts";
import { AS_AUTHOR, getAllEntries } from "../../entries";
import { getTrip, getTrips, tripRef } from "../../trips";
import type { Say } from "../intents";

/**
 * Turning what somebody called a thing into the thing — B927, B940, B954,
 * B965.
 *
 * Every one of these carries a ticket in its own comment, and they are the
 * most-corrected code in the helper: what a person means by "the last one" or
 * "Georgia" has been got wrong in four distinct ways, each of which reached a
 * live instance. They are together in one file because the corrections are a
 * single argument — a name that means nothing, or means two things, must not
 * quietly become a third — and reading them apart is how the fifth mistake
 * gets made.
 */
/** Letters and digits, lower case, everything else a single space — so
 *  "Georgia 2026", "georgia-2026" and "GEORGIA" are one word to compare. */
function flatten(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
/**
 * The trip somebody means — **by name, not by id** (B927).
 *
 * The model was guessing an id back from the title: it made a trip called
 * Georgia, the server answered `georgia-2026`, and two turns later it wrote
 * `georgia` and got `unknown_trip` three times in one session. An id it never
 * handles is an id it cannot get wrong, so this takes whatever the person
 * called the trip — the id, the title, half the title — and resolves it here,
 * the way `read_day` already resolves a date.
 *
 * Exact id first, so nothing that used to work stops. Then the title, then a
 * prefix, then anything containing it, newest first at every step.
 *
 * **A name matching none of those resolves to nothing** — B940. It used to
 * fall through to the newest trip, and that is the one case where falling
 * through is wrong: somebody who asked for a day in their *Antarctica
 * Expedition*, in a journal whose only trip was a week in Tokyo, was shown a
 * filled-in proposal for Tokyo and told nothing about it. Nothing was written,
 * because nobody pressed it — but it was ready to be.
 *
 * The fallback is kept for an **omitted** name, which is what B927 is actually
 * about: a person mid-write-up means the trip they are writing up. And the
 * four steps above already catch what B927 added it for — a model shortening
 * `georgia-2026` to `georgia` is a prefix, not a miss. What was left for the
 * fallback to catch is a name that means nothing in this journal, which is
 * exactly the name that must not quietly become a different trip.
 */
export function resolveTrip(username: string, id?: string) {
  // One, or none. Two trips answering to the same words is not an answer, and
  // taking the first is how the older of them became unreachable — B965.
  const fits = resolveTrips(username, id);
  return fits.length === 1 ? fits[0] : undefined;
}
/**
 * Every trip a name fits, at the best step it fits any — B965.
 *
 * B940 stopped a name that matches **nothing** from resolving to the newest
 * trip. A name that matches **several** still did, silently: `Balkan` is a
 * prefix of both `balkan-loop-2026` and `balkan-loop-check`, so the older was
 * unreachable by that word and nobody was told there had been a choice.
 *
 * Five of six forms resolved correctly in the journal that found this. The
 * sixth is the one where somebody writes a day into the wrong trip, and it is
 * the case where they were least specific and so least likely to check.
 *
 * **The step matters and the tie is only within it.** An exact id still beats
 * a title that also matches, and a title still beats a substring: *"Danube
 * Circuit"* is not ambiguous because *"Danube"* also fits something else. What
 * is ambiguous is two trips answering equally well to the same words.
 */
function resolveTrips(username: string, id?: string) {
  const trips = [...getTrips(username)].sort((a, b) => b.start.localeCompare(a.start));
  const said = flatten(id ?? "");
  if (said === "") return trips.slice(0, 1);

  const exact = trips.filter((one) => one.id === id?.trim());
  if (exact.length > 0) return exact;

  for (const fits of [
    (one: (typeof trips)[number]) => flatten(one.id) === said,
    (one: (typeof trips)[number]) => flatten(one.title) === said,
    (one: (typeof trips)[number]) =>
      flatten(one.id).startsWith(said) || flatten(one.title).startsWith(said),
    (one: (typeof trips)[number]) =>
      flatten(one.id).includes(said) || flatten(one.title).includes(said),
  ]) {
    const found = trips.filter(fits);
    if (found.length > 0) return found;
  }
  return [];
}
/**
 * Why a trip did not resolve, in words the model can repeat — B940.
 *
 * All four reads answered "there are no trips in this journal", which stops
 * being true the moment a *name* misses in a journal that has several. Being
 * told there are no trips when there are three is being told something false
 * about your own journal, and it is the answer a person is least able to
 * argue with.
 */
export function noTrip(username: string, said?: string) {
  // Two trips answering to the same words is a different answer from none —
  // B965. Naming them is the whole of it: the person knows which they meant.
  const fits = resolveTrips(username, said);
  if (fits.length > 1) {
    return {
      found: false,
      why: `"${said?.trim()}" fits more than one trip — ${fits
        .map((one) => `${one.title} (${one.id})`)
        .join(" and ")}: ask which they mean and do not choose for them`,
    };
  }
  return {
    found: false,
    why:
      said && said.trim() !== "" && getTrips(username).length > 0
        ? `there is no trip called "${said.trim()}" here: say so, and ask which of their trips they mean`
        : "there are no trips in this journal",
  };
}
/** The day a slug or a date names, or the newest draft when neither is given
 *  — the day somebody mid-write-up means. */
export function resolveDay(username: string, args: Record<string, string>) {
  const trip = resolveTrip(username, args.trip);
  if (!trip) return null;
  const entries = getAllEntries(trip.ref, AS_AUTHOR);
  const bySlug = args.slug ? entries.find((entry) => entry.slug === args.slug) : undefined;
  if (bySlug) return { trip, entry: bySlug, guessed: false };
  /**
   * **A date nobody wrote a day for is not the newest day** — B925.
   *
   * "Put these on yesterday", where yesterday has no day yet, used to fall
   * through to whatever was written last: a proposal about the wrong day, or
   * — when the trip had no days at all — a proposal with an empty slug, which
   * is the `unknown_day` the press came back with. Saying there is no such day
   * is the honest answer, and `proposalFor` below makes sure there is nothing
   * to press when there is nothing to press it on.
   */
  if (args.date) {
    const onDate = entries.find((entry) => entry.date === args.date);
    return onDate ? { trip, entry: onDate, guessed: false } : null;
  }
  /**
   * The newest day, **and it says that it guessed** — B954.
   *
   * Somebody writing up a three-week trip months later said *"the last one"*,
   * meaning the flight home, which had no day yet. This returned the Alhambra
   * draft — the most recently written — and `set_day_words` built a
   * confidently worded, filled-in proposal to overwrite that day's words with
   * the flight-home narrative. Then *"the rainy one"*, about a day never
   * mentioned, resolved to an existing Seville day the same way.
   *
   * The default is still right, and this is why it is a flag rather than a
   * deletion: somebody who has just started a day and says "now the words"
   * means that day, and asking them which would be absurd. What is not right
   * is a **guess** standing behind a write that replaces what is already
   * there. `guessed` is how the tool that overwrites can tell the two apart.
   */
  const newest = [...entries].sort((a, b) => b.date.localeCompare(a.date))[0];
  return newest ? { trip, entry: newest, guessed: true } : null;
}
/**
 * The trip a proposal is about, even when the day is not there — B925.
 *
 * `resolveDay` answers null for a date nobody has written, and the trip field
 * used to fall back to whatever the model typed: a proposal about a day that
 * does not exist reported a trip that does not exist either, and the sentence
 * a person read named the wrong missing half.
 *
 * It no longer falls back to `args.trip` at all — B940. An unresolved
 * name is a name for no trip here, and putting it in the field would
 * send it to a route that answers `unknown_trip`. Empty is what reaches
 * the "nothing was proposed" path in `runTool`, which asks.
 */
export function tripIdFor(
  username: string,
  args: Record<string, string>,
  found: { trip: { id: string } } | null,
): string {
  return found?.trip.id ?? resolveTrip(username, args.trip)?.id ?? "";
}

/**
 * Who will be able to read this trip once a day of it is on the site — B933.
 *
 * The people rather than the vocabulary, and a count only where the people
 * are not the owner's to name: a journal's guests are approved one at a time
 * on the contacts page and are not the trip's business, while the people on a
 * trip are written into `trip.md` by hand and are exactly who it says.
 */
export async function readersOf(username: string, tripId: string, say: Say): Promise<string> {
  const trip = getTrip(tripRef(username, tripId));
  if (!trip) return "";
  if (trip.visibility === "public") return say("agent.tool.publishReadersPublic");
  if (trip.visibility === "guest") {
    const approved = isEnabled("contacts", username)
      ? (await listContacts(username)).filter((one) => one.approvedAt !== null).length
      : 0;
    return approved === 0
      ? say("agent.tool.publishReadersGuestNobody")
      : say("agent.tool.publishReadersGuest", { count: String(approved) });
  }
  const named = trip.people.map((one) => one.name).filter((name) => name !== "");
  return named.length === 0
    ? say("agent.tool.publishReadersPrivateNobody")
    : say("agent.tool.publishReadersPrivate", { people: named.join(", ") });
}
/**
 * The first day of a trip nobody has written yet — B818.
 *
 * **Not today.** Somebody writing up a trip is behind it, not on it: the day
 * they mean is the earliest one with nothing on it, and defaulting to today
 * was how a person on the road ended up with a day for a date they had not
 * reached. Every day written and the trip still running: the day after the
 * last one written, clipped to the trip.
 */
export function firstUnwritten(username: string, tripId: string, today: string): string {
  const trip = resolveTrip(username, tripId);
  if (!trip) return today;
  const written = new Set(getAllEntries(trip.ref, AS_AUTHOR).map((entry) => entry.date));
  const last = today < trip.end ? today : trip.end;
  for (let at = new Date(`${trip.start}T00:00:00Z`); ; at.setUTCDate(at.getUTCDate() + 1)) {
    const date = at.toISOString().slice(0, 10);
    if (date > last) break;
    if (!written.has(date)) return date;
  }
  return last;
}
