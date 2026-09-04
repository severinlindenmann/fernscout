import type { Metadata } from "next";
import Landing, { type PublicJournal } from "@/components/Landing";
import { isIndexable } from "@/lib/access";
import { getAllEntries } from "@/lib/entries";
import { installedLocales, requestLocale, translateIn } from "@/lib/locales";
import { serverSite } from "@/lib/site";
import { getTrips } from "@/lib/trips";
import { getUser, listedUsernames } from "@/lib/users";

/**
 * The bare domain is the landing page.
 *
 * It used to redirect to the default journal, on the reasoning that a
 * single-user instance should not make its owner type their own name. That
 * was the wrong trade: the root is where somebody arrives who does not yet
 * know what this is, and sending them straight into one person's holiday
 * answers a question they had not asked. The journals are one click away, and
 * `site.defaultUser` still decides whose language and name the instance wears.
 */

/**
 * The tab title, in the language the page underneath it renders in.
 *
 * These two strings were English literals in a static `metadata` object, so a
 * German reader got "Fernscout — a travel journal your agent writes" over an
 * `<h1>` reading "Ein Reisetagebuch, das dein Agent für dich schreibt" — and
 * got the same English title with a Croatian cookie, where the page really is
 * English, which is what showed the title was not locale-dependent at all
 * (B225).
 *
 * Nothing here decides a locale: `requestLocale()` is the one rule B140 left,
 * and outside a journal there is no `user.locales` to narrow against, so the
 * maintained set stands in and the reader's choice counts. The page was
 * already picking the right language; it simply had nothing to say in it.
 *
 * `absolute` because the root layout's template appends the site name, and
 * `{name}` puts it in the sentence already.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  return {
    title: {
      absolute: translateIn(locale, "landing.metaTitle", { name: serverSite().name }),
    },
    description: translateIn(locale, "landing.metaDescription"),
    alternates: { canonical: "/" },
  };
}

/** A journal's first public photograph, for the preview card. */
function coverFor(username: string): string | undefined {
  for (const trip of getTrips(username).filter(isIndexable)) {
    for (const entry of getAllEntries(trip.ref)) {
      const image = entry.gallery.find((item) => item.type === "image");
      if (image) return image.src;
    }
  }
  return undefined;
}

export default function Root() {
  const site = serverSite();

  // listedUsernames() rather than getUsernames(): a journal whose config says
  // `visibility: "private"` is not advertised, and the landing page is the most
  // advertised surface there is.
  const journals: PublicJournal[] = listedUsernames().flatMap((username) => {
    const user = getUser(username);
    if (!user) return [];
    const trips = getTrips(username).filter(isIndexable);
    // A journal with nothing public has nothing to show a stranger.
    if (trips.length === 0) return [];
    return [
      {
        username,
        title: user.title,
        tagline: user.tagline,
        trips: trips.length,
        cover: coverFor(username),
      },
    ];
  });

  return (
    <Landing
      siteName={site.name}
      docUrl={`${site.url}/documentation.txt`}
      journals={journals}
      // No journal owns this page, so the choice is every language this build
      // ships chrome for rather than one person's `locales:` list.
      locales={installedLocales()}
      // Both absent unless this instance sets them — see site.repository and
      // site.credit in content/config.json. A fork gets to name itself.
      repository={site.repository}
      credit={site.credit}
    />
  );
}
