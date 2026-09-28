import { headers } from "next/headers";
import { cache } from "react";
import type { UserConfig } from "@/lib/config";
import type { Trip } from "@/lib/types";
import { isEnabled } from "@/lib/capabilities";
import { fromAcceptLanguage, pickLocale } from "@/lib/contacts/locale";
import { resolveJoinCode, type JoinInvite } from "@/lib/contacts/welcome";
import { requestLocale } from "@/lib/locales";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { getTrip, tripRef } from "@/lib/trips";
import { getUser } from "@/lib/users";

const LOOKUPS = { max: 30, windowMs: 15 * 60 * 1000 };

export type Lookup = { invite: JoinInvite | null; user: UserConfig | null; trip: Trip | undefined | null };

/** One rate-limited lookup per request, shared by the page, its metadata and
 * its layout (the frame's language) — `cache` makes the second and third ask
 * free, so a render spends one. */
export const lookup = cache(async (code: string): Promise<Lookup> => {
  const allowed = rateLimitFor("join-lookup", clientIp(await headers()), LOOKUPS).ok;
  const invite = allowed && isEnabled("contacts") ? await resolveJoinCode(code) : null;
  const user = invite && isEnabled("contacts", invite.owner) ? getUser(invite.owner) : null;
  const trip = invite?.tripId ? getTrip(tripRef(invite.owner, invite.tripId)) : null;
  return { invite, user, trip };
});

/** The frame's language — B2533: the contact's own, same as the page content
 * below it, so a header in one language never sits above a notice in
 * another. Falls back to the browser's when there is no invite to read one
 * from (an unknown, stopped or rate-limited code). */
export async function frameLocale(code: string): Promise<string> {
  const { invite, user } = await lookup(code);
  if (!invite || !user) return requestLocale();
  return pickLocale(fromAcceptLanguage((await headers()).get("accept-language")), invite.locale, user.defaultLocale);
}
