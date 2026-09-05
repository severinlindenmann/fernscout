import type { Metadata } from "next";
import Landing from "@/components/Landing";
import { CODE_TTL_MINUTES } from "@/lib/auth";
import { publicJournals } from "@/lib/home";
import { hasLegal } from "@/lib/legal";
import { installedLocales, requestLocale, translateIn } from "@/lib/locales";
import { serverSite } from "@/lib/site";

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

export default function Root() {
  const site = serverSite();

  return (
    <Landing
      siteName={site.name}
      docUrl={`${site.url}/documentation.txt`}
      agentUrl={`${site.url}/agent.md`}
      // The advertised list, and nothing personal: this page is the same
      // document for everybody, so it stays cacheable. What one signed-in
      // reader may open arrives separately from `/api/v1/me/home` — see
      // `Landing`, and B412 for the cache that keeps the two apart.
      journals={publicJournals()}
      // No journal owns this page, so the choice is every language this build
      // ships chrome for rather than one person's `locales:` list.
      locales={installedLocales()}
      // Both absent unless this instance sets them — see site.repository and
      // site.credit in content/config.json. A fork gets to name itself.
      repository={site.repository}
      credit={site.credit}
      // Absent unless this instance wrote one — see lib/legal.ts. A fork that
      // has not written its own imprint gets no link to mine.
      legal={hasLegal()}
      // The number comes from CODE_TTL_MS rather than from a sentence, so the
      // three locale files cannot outlive a change to it — see B426 and the
      // note on CODE_TTL_MINUTES.
      codeMinutes={CODE_TTL_MINUTES}
    />
  );
}
