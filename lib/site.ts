import "server-only";
import { isEnabled } from "./capabilities";
import { costsAvailable } from "./costs";
import { loadServerConfig, type UserConfig } from "./config";
import { getUser } from "./users";
import type { Trip, TripPerson } from "./types";

/**
 * Site identity.
 *
 * There are two of them now. The *server* has a name and a URL and belongs to
 * whoever runs the instance; a *user* has a title, travellers and a language
 * and belongs to a person. Keeping them apart is what lets one instance carry
 * several unrelated travel blogs.
 *
 * Server-only on purpose: both reach the filesystem. Client components get the
 * values through `SiteProvider`, seeded once per request — the same reasoning
 * the root layout already documents for `getTrips()`.
 */

export function serverSite() {
  const config = loadServerConfig();
  return {
    name: config.site.name,
    /** NEXT_PUBLIC_SITE_URL wins on the server, so one build serves any host. */
    url: process.env.NEXT_PUBLIC_SITE_URL ?? config.site.url,
    defaultUser: config.site.defaultUser,
    repository: config.site.repository,
    credit: config.site.credit,
  };
}

/**
 * Who a trip is credited to, owner first.
 *
 * The same owner-first union `peopleOf()` computes for write access, so the
 * credit on a trip and the right to edit it cannot disagree. De-duplicated on
 * the address, because an owner who also lists themselves in `people:` is one
 * person, not two.
 */
export function travellersOf(user: UserConfig, trip: Trip): TripPerson[] {
  const owner: TripPerson = {
    name: user.owner.name,
    email: user.owner.email ?? "",
    nickname: user.owner.nickname,
  };
  const out = [owner];
  const seen = new Set([owner.email.trim().toLowerCase()]);
  for (const person of trip.people) {
    const email = person.email.trim().toLowerCase();
    if (seen.has(email)) continue;
    seen.add(email);
    out.push(person);
  }
  return out;
}

/**
 * What to call the person whose journal this is, in one word — B20.
 *
 * `nickname` is the short form a journal already keeps for exactly this, and
 * `lib/journals.ts` requires it rather than deriving one, because a first-word
 * guess is wrong for plenty of names. This is the fallback for a journal
 * written before that or edited by hand: the first word of `name`, which is
 * wrong less often than a full "Firstname Lastname" where a first name was
 * meant.
 *
 * Undefined when the config names nobody, so a caller has to have a sentence
 * for that case rather than rendering "Ask ." — an owner block with no name in
 * it is a malformed config, not a reason to print a blank.
 *
 * **Nothing else about the owner comes out of here.** `owner.email` sits in
 * the same object and is the one field on it that must never reach a browser;
 * the point of a function that returns a single string is that a component
 * cannot be handed the object and pick wrong later.
 */
export function ownerShortName(user: UserConfig): string | undefined {
  const nickname = user.owner.nickname?.trim();
  if (nickname) return nickname;
  const first = user.owner.name?.trim().split(/\s+/)[0];
  return first || undefined;
}

/** Short forms joined with "+", as a journal refers to the people on a trip. */
export function travellerNamesOf(user: UserConfig, trip: Trip): string {
  return travellersOf(user, trip)
    .map((p) => p.nickname || p.name)
    .join(" + ");
}

/** Full names joined with "&", for credits and metadata. */
export function travellerFullNamesOf(user: UserConfig, trip: Trip): string {
  return travellersOf(user, trip)
    .map((p) => p.name)
    .join(" & ");
}

/**
 * The serialisable subset handed to client components.
 *
 * Deliberately no traveller names. Who was on a trip is a per-trip fact
 * (`travellersOf`), and this summary is seeded once per request by a layout
 * that has no trip in hand — a journal-wide answer here is how every trip
 * came to be credited to the same two people.
 */
export type SiteSummary = {
  username: string;
  title: string;
  tagline: string;
  url: string;
  startLocation: string;
  baseCurrency: string;
  /** The languages this journal offers, in config order. */
  locales: string[];
  /** Always "/<username>": that is the canonical form (W22). */
  base: string;
  /**
   * Whether this reader holds a guest session on this journal.
   *
   * It once decided whether the access panel was offered at all, and that was
   * a closed loop — the panel exists for the reader who lost the mail she was
   * let in with, so requiring a session meant only a reader who still had it
   * could reach it. The entry is now offered to everyone (components/SiteNav),
   * and this decides how it is *drawn*: a stranger is shown a door, somebody
   * who is already in is shown the panel's own name. See app/[user]/me.
   */
  signedIn: boolean;
  /**
   * Whether this journal can issue a sign-in code at all — `features.auth`,
   * resolved for this user by `isEnabled`.
   *
   * The header needs it (B44): the way back in is a door marked in words, and
   * a door is only drawn where there is a form behind it. On a journal with
   * `auth` off, `/<user>/me` has nothing to press and says so, and a control
   * promising otherwise is the bug recorded at app/[user]/me/MePageContent.tsx.
   *
   * Deliberately journal-wide and viewer-independent: it comes from config and
   * from nothing the reader is or is not allowed to see.
   */
  canSignIn: boolean;
  /**
   * Whether this reader holds an instance-wide identity — B433.
   *
   * The header's way back out of a journal, and the only thing that decides
   * whether it is drawn. It is **not** `signedIn`: that is a guest session on
   * *this* journal, and a reader can hold one without holding an identity —
   * every session issued before B410, and every one issued by a journal's own
   * `/<user>/me` form. Sending those readers to `/` would land them on the
   * public landing page having promised them "your journals".
   *
   * Deliberately not "does this reader have more than one journal". That would
   * be `journalsFor()` — a walk of every journal on the instance with two
   * indexed queries each — on every page render of every journal, to decide
   * whether to draw one link. The link is honest either way: somebody with one
   * journal who follows it gets that journal and the page that lists it, which
   * is where the way to the rest of the instance is.
   */
  hasIdentity: boolean;
  /**
   * Whether this journal's costs page has anything to show — `features.costs`
   * on (`isEnabled`), *and* at least one trip actually has a `costs.md`
   * (`costsAvailable` in lib/costs.ts).
   *
   * The nav needs it (B165, B267): with the capability off both costs pages
   * answer 404, and a tab that links at one is the same bug the sign-in door
   * above records — a control promising something that is not there. Absent
   * rather than broken. The capability check alone was not enough: it is on
   * by default at trip creation (lib/journals.ts), so a journal that never
   * wrote a budget still got the tab, leading to a page with nothing on it —
   * the same failure with an extra step. B267 added the second half.
   *
   * Journal-wide and viewer-independent, exactly like `canSignIn`, and for the
   * same reason: it comes from config and from nothing the reader is or is not
   * allowed to see. It is not `costsVisibility`, which is per trip and per
   * reader and is decided by `mayViewCosts` on the server.
   */
  costsEnabled: boolean;
};

export function siteSummaryFor(
  user: UserConfig,
  isDefaultUser: boolean,
  signedIn = false,
  hasIdentity = false,
): SiteSummary {
  return {
    username: user.username,
    title: user.title,
    tagline: user.tagline,
    url: serverSite().url,
    startLocation: user.startLocation,
    baseCurrency: user.baseCurrency,
    locales: user.locales,
    base: `/${user.username}`,
    signedIn,
    hasIdentity,
    // Asked here rather than threaded through as a fourth positional boolean:
    // it is a property of the journal, so every caller would compute the same
    // answer, and one of them would eventually forget to.
    canSignIn: isEnabled("auth", user.username),
    costsEnabled: costsAvailable(user.username),
  };
}

/** Convenience for routes that already know the username. */
export function siteSummary(
  username: string,
  isDefaultUser: boolean,
  signedIn = false,
  hasIdentity = false,
): SiteSummary | null {
  const user = getUser(username);
  return user ? siteSummaryFor(user, isDefaultUser, signedIn, hasIdentity) : null;
}
