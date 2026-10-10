import { headers } from "next/headers";
import { cache } from "react";
import type { UserConfig } from "@/lib/config";
import { fromAcceptLanguage, pickLocale } from "@/lib/contacts/locale";
import { requestLocale } from "@/lib/locales";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { resolveReadCode, type ReadLink } from "@/lib/tripLink";
import { getUser } from "@/lib/users";

const LOOKUPS = { max: 30, windowMs: 15 * 60 * 1000 };

export type Lookup = { link: ReadLink | null; user: UserConfig | null };

/** One rate-limited lookup per request, shared by the page, its metadata and
 * its layout. Unknown, stopped, expired, trip gone, trip not guest, contacts
 * off and rate-limited all come back as the same `link: null`. */
export const lookup = cache(async (code: string): Promise<Lookup> => {
  const allowed = rateLimitFor("trip-link-lookup", clientIp(await headers()), LOOKUPS).ok;
  const link = allowed ? await resolveReadCode(code) : null;
  return { link, user: link ? (getUser(link.owner) ?? null) : null };
});

/** The frame's language: the journal's default against the browser's — a read
 * link names no person, so there is no contact language to prefer. */
export async function frameLocale(code: string): Promise<string> {
  const { user } = await lookup(code);
  if (!user) return requestLocale();
  return pickLocale(fromAcceptLanguage((await headers()).get("accept-language")), null, user.defaultLocale);
}
