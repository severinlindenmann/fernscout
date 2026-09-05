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
import { resolveAccess } from "@/lib/auth/handshake";
import { listableTrips } from "@/lib/tripGate";
import { getCurrentTrip, getTrips } from "@/lib/trips";
import { currencyOptions } from "@/lib/rates";
import { dictionaryFor, readerLocale } from "@/lib/locales";
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
  // case no page of it is advertised whatever its trips say. `user.visibility`
  // is already normalised by `lib/config.ts` — a journal on disk still saying
  // the old `private` reads back here as `guest`.
  const trip = getCurrentTrip(username);
  const robots =
    user.visibility === "guest" || (trip && !isIndexable(trip))
      ? { index: false, follow: false }
      : undefined;

  return {
    // A tagline is optional (lib/config.ts defaults it to ""), and joining
    // parts that exist keeps a dangling "— " out of the tab and the og:title
    // for a journal that has none — B418.
    title: {
      default: [user.title, user.tagline].filter(Boolean).join(" — "),
      template: `%s · ${user.title}`,
    },
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
  // Either credential counts (B410). A reader holding only an instance-wide
  // identity is as signed in as one holding this journal's own session, and
  // hiding the panel from them would hide the one page that tells them what
  // they may open.
  const signedIn = Boolean((await resolveAccess(username)).email);

  // A reader's choice from the language switcher, honoured only if this
  // journal actually offers it — otherwise a cookie set on one journal would
  // silently pick a language another one does not speak.
  //
  // Through `readerLocale` rather than written out here, because the same
  // question is asked again by every `generateMetadata` on the way to the
  // browser tab, and the second copy of the expression asked it differently:
  // it narrowed to the languages the *project* maintains rather than the ones
  // this journal offers, so a German cookie carried in from another journal
  // gave a German `<title>` over this English page. B140, B185.
  const chosen = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = readerLocale(chosen, user.locales, user.defaultLocale);

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
      <LocaleProvider
        locale={locale}
        dictionary={dictionaryFor(locale)}
        writtenLocale={user.defaultLocale}
      >
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
