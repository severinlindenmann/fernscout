import "server-only";
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
   * Whether this reader has an access panel worth opening.
   *
   * False for a stranger, who would find one line telling them to follow the
   * link they were sent — a menu entry that leads to "you have nothing" is
   * worse than no menu entry. See app/[user]/me.
   */
  signedIn: boolean;
};

export function siteSummaryFor(
  user: UserConfig,
  isDefaultUser: boolean,
  signedIn = false,
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
  };
}

/** Convenience for routes that already know the username. */
export function siteSummary(
  username: string,
  isDefaultUser: boolean,
  signedIn = false,
): SiteSummary | null {
  const user = getUser(username);
  return user ? siteSummaryFor(user, isDefaultUser, signedIn) : null;
}
