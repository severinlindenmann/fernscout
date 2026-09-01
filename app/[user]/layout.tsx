import type { Metadata } from "next";
import { cookies } from "next/headers";
import { LOCALE_COOKIE } from "@/lib/requestKeys";
import { notFound } from "next/navigation";
import SiteProvider from "@/components/SiteProvider";
import CurrencyProvider from "@/components/CurrencyProvider";
import HtmlLang from "@/components/HtmlLang";
import LocaleProvider from "@/components/LocaleProvider";
import TripListProvider from "@/components/TripListProvider";
import { isIndexable } from "@/lib/access";
import { siteSummaryFor } from "@/lib/site";
import { GUEST_COOKIE, resolveSession } from "@/lib/auth";
import { listableTrips } from "@/lib/tripGate";
import { getCurrentTrip, getTrips } from "@/lib/trips";
import { currencyOptions } from "@/lib/rates";
import { dictionaryFor } from "@/lib/locales";
import { getDefaultUsername, getUser } from "@/lib/users";

/**
 * One user's site.
 *
 * Everything personal is resolved here, once: whose site this is, which trips
 * they have, and whether the viewer may see the one they landed on. Gating in
 * the layout rather than in each page means adding a page cannot add an
 * unguarded route.
 */
export async function generateMetadata({
  params,
}: LayoutProps<"/[user]">): Promise<Metadata> {
  const { user: username } = await params;
  const user = getUser(username);
  if (!user) return {};

  // Two independent reasons not to be indexed, and either is enough. The trip
  // on show may be private or unlisted; and the whole journal may be, in which
  // case no page of it is advertised whatever its trips say.
  const trip = getCurrentTrip(username);
  const robots =
    user.visibility === "private" || (trip && !isIndexable(trip))
      ? { index: false, follow: false }
      : undefined;

  return {
    title: { default: `${user.title} — ${user.tagline}`, template: `%s · ${user.title}` },
    description: user.tagline,
    alternates: { canonical: `/${username}` },
    ...(robots ? { robots } : {}),
  };
}

export default async function UserLayout({ children, params }: LayoutProps<"/[user]">) {
  const { user: username } = await params;
  const user = getUser(username);
  if (!user) notFound();

  const isDefault = getDefaultUsername() === username;

  // Whether to offer the access panel at all. A stranger opening it would find
  // one line telling them to follow the link they were sent, and a menu entry
  // that leads to "you have nothing" is worse than no entry.
  const signedIn = Boolean(
    await resolveSession((await cookies()).get(GUEST_COOKIE)?.value, "guest"),
  );

  // A reader's choice from the language switcher, honoured only if this
  // journal actually offers it — otherwise a cookie set on one journal would
  // silently pick a language another one does not speak.
  const chosen = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale =
    chosen && user.locales.includes(chosen) ? chosen : user.defaultLocale;

  // Trimmed to what the switcher needs: a trip's `intro` has no business in
  // the client bundle, and getTrips() touches node:fs.
  const trips = (await listableTrips(getTrips(username))).map(
    ({ id, ref, username: owner, title, start, end, status, translations }) => ({
      id,
      ref,
      username: owner,
      title,
      start,
      end,
      status,
      translations,
    }),
  );

  return (
    <SiteProvider value={siteSummaryFor(user, isDefault, signedIn)}>
      {/* The journal's own language, rendered on the server. This used to be
          English on the server and the reader's choice after hydration, which
          is why no German page had a URL of its own and search engines only
          ever saw English. */}
      <LocaleProvider locale={locale} dictionary={dictionaryFor(locale)}>
        <HtmlLang locale={locale} />
      <TripListProvider trips={trips}>
        {/* Currency options are per user: two people on one server may budget
            in different currencies and offer different display currencies. */}
        <CurrencyProvider options={currencyOptions(username)}>
        {children}
        </CurrencyProvider>
      </TripListProvider>
      </LocaleProvider>
    </SiteProvider>
  );
}
