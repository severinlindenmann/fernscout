import { headers } from "next/headers";
import { cache } from "react";
import type { UserConfig } from "@/lib/config";
import { isEnabled } from "@/lib/capabilities";
import { fromAcceptLanguage, pickLocale } from "@/lib/contacts/locale";
import { resolveWelcomeCode } from "@/lib/contacts/welcome";
import { requestLocale } from "@/lib/locales";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { getUser } from "@/lib/users";

/** Per IP: a person opens their link a handful of times; a list of guesses is
 * something else. */
const LOOKUPS = { max: 30, windowMs: 15 * 60 * 1000 };

export type Lookup = { found: Awaited<ReturnType<typeof resolveWelcomeCode>>; user: UserConfig | null };

/** One rate-limited lookup per request, shared by the page, its metadata and
 * its layout (the frame's language). */
export const lookup = cache(async (code: string): Promise<Lookup> => {
  const allowed = rateLimitFor("welcome-lookup", clientIp(await headers()), LOOKUPS).ok;
  const found = allowed && isEnabled("contacts") ? await resolveWelcomeCode(code) : null;
  // The journal's own contacts switch too, not only the server's (I3).
  const user = found && isEnabled("contacts", found.owner) ? getUser(found.owner) : null;
  return { found, user };
});

/** The frame's language — B2533: the contact's own, same as the page content
 * below it (B2456's reasoning), so a header in one language never sits above
 * a notice in another. Falls back to the browser's when there is no contact
 * to read one from (an unknown, blocked or rate-limited code). */
export async function frameLocale(code: string): Promise<string> {
  const { found, user } = await lookup(code);
  if (!found || !user) return requestLocale();
  return pickLocale(fromAcceptLanguage((await headers()).get("accept-language")), found.contact.locale, user.defaultLocale);
}
