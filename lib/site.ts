import "server-only";
import { loadServerConfig, type UserConfig } from "./config";
import { getUser } from "./users";

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

/** Nicknames joined with "+", as a user's site refers to its travellers. */
export function travellerNamesOf(user: UserConfig): string {
  return user.travellers.map((t) => t.nickname).join(" + ");
}

/** Full names joined with "&", for metadata and credits. */
export function travellerFullNamesOf(user: UserConfig): string {
  return user.travellers.map((t) => t.name).join(" & ");
}

/** The serialisable subset handed to client components. */
export type SiteSummary = {
  username: string;
  title: string;
  tagline: string;
  url: string;
  startLocation: string;
  travellerNames: string;
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
    travellerNames: travellerNamesOf(user),
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
