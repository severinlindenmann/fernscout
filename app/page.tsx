import type { Metadata } from "next";
import Landing from "@/components/Landing";
import Pricing from "@/components/Pricing";
import { isEnabled } from "@/lib/capabilities";
import { CODE_TTL_MINUTES } from "@/lib/auth";
import { publicJournals } from "@/lib/home";
import { hasLegal } from "@/lib/legal";
import { installedLocales, requestLocale, translateIn } from "@/lib/locales";
import { bannerFor, serverSite } from "@/lib/site";

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
      absolute: translateIn(locale, "landing.metaTitle", {
        name: serverSite().name,
      }),
    },
    description: translateIn(locale, "landing.metaDescription"),
    alternates: { canonical: "/" },
  };
}

/**
 * Whether `/agent` can actually write on this instance — B694.
 *
 * `helper` off is the default and is what every self-hosted instance has, so
 * the hero keeps the agent instruction as its primary route there: a button
 * leading to a page that cannot write is the "worse than no button" case
 * `docs/plans/2026-09-07-web-helper-agent.md` warns about. On, `/agent`
 * becomes the primary call to action and bring-your-own moves to the quiet
 * line beneath it — one page, two arrangements.
 *
 * B694 was built beside B684, which is what added `helper` to `FEATURE_NAMES`,
 * and had to hardcode `false` until that landed. It has landed.
 */
const helperEnabled = isEnabled("helper");

export default async function Root() {
  const site = serverSite();
  // The notice is the operator's own words in the reader's language — see
  // bannerFor(). Same locale rule as the tab title above, and for the same
  // reason: a German page with an English warning across the top of it is the
  // bug B225 fixed, one element higher.
  const locale = await requestLocale();
  const banner = bannerFor(locale);

  return (
    <>
      {/*
        The operator's own notice, when there is one — site.banner in the
        server config. Coral and not yellow, like every other notice here:
        yellow is the brand's colour and reads as decoration.

        Rendered beside the page rather than inside `Landing`, which has two
        different orders of the same sections and would have needed it twice.
      */}
      {banner && (
        <div
          role="note"
          className="border-b-2 border-coral-600 bg-coral-300 px-6 py-3 text-center text-sm leading-6 text-navy-900"
        >
          {banner}
        </div>
      )}
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
        // site.credit in site/config.json. A fork gets to name itself.
        repository={site.repository}
        credit={site.credit}
        // Absent unless this instance wrote one — see lib/legal.ts. A fork that
        // has not written its own imprint gets no link to mine.
        legal={hasLegal()}
        // The number comes from CODE_TTL_MS rather than from a sentence, so the
        // three locale files cannot outlive a change to it — see B426 and the
        // note on CODE_TTL_MINUTES.
        codeMinutes={CODE_TTL_MINUTES}
        helperEnabled={helperEnabled}
        // Rendered here and handed over, because `Landing` is a client
        // component and `Pricing` is a server one: it reads a price from the
        // `server-only` module that charges it rather than having a dozen
        // numbers drilled through as props. Absent — not empty — on an
        // instance that charges nothing at all. B840.
        pricing={isEnabled("credits") ? <Pricing locale={locale} /> : null}
      />
    </>
  );
}
