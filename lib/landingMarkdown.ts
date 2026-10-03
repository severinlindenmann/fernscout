import "server-only";
import { planFaq, planPoint, printPriceRows } from "@paid/billing/lib/plans";
import { pricingMarkdown } from "@paid/billing/lib/markdown";
import { orgsNav } from "@paid/orgs/lib/nav";
import { isEnabled } from "./capabilities";
import { inviteRequestAvailable } from "./inviteRequest";
import { landingFaq, landingHero, landingHow, landingPrints, landingTrust, type LandingFlags } from "./landingContent";
import { languageHref } from "./languagePaths";
import { translateIn } from "./locales";
import { mdDocument, mdFaq, mdList } from "./markdownPage";
import { serverSite } from "./site";

/**
 * What decides which of the landing's sections exist and what they say —
 * the capabilities and the plans, the same answer for `app/page.tsx` and for
 * the Markdown below.
 */
export function landingFlags(locale: string): LandingFlags & { billingEnabled: boolean; printPrices: { label: string; price: string }[] } {
  const billingEnabled = isEnabled("billing");
  return {
    helperEnabled: isEnabled("helper"),
    postcards: isEnabled("postcards"),
    photobook: isEnabled("photobook"),
    inviteCta: inviteRequestAvailable() ? "request" : isEnabled("signup") ? "welcome" : "none",
    billingEnabled,
    planPoint: billingEnabled ? planPoint(locale) : null,
    planFaq: billingEnabled ? planFaq(locale) : [],
    printPrices: billingEnabled ? printPriceRows(locale) : [],
  };
}

/**
 * The signed-out landing as Markdown — B2488. The sections of
 * `components/landing/SignedOut.tsx`, from `lib/landingContent.ts`, in the
 * same order and on the same conditions; links are absolute and keep the
 * language. The one day beside the headline is left out: it is somebody's
 * journal, which has its own `.md`.
 */
export function landingMarkdown(locale: string): string {
  const site = serverSite();
  const t = (key: Parameters<typeof translateIn>[1], vars?: Record<string, string>) => translateIn(locale, key, vars);
  const f = landingFlags(locale);
  const href = (path: string) => `${site.url}${languageHref(locale, path)}`;
  const hero = landingHero(t, f);
  const prints = landingPrints(t, f);
  const how = landingHow(t, f);
  const faq = landingFaq(t, f);
  const cta =
    f.inviteCta === "request"
      ? `[${t("landing.requestInvite")}](${site.url}/invite)`
      : f.inviteCta === "welcome"
        ? `[${t("landing.startJournal")}](${site.url}/welcome)`
        : null;
  const docUrl = `${site.url}/documentation.txt`;
  const agentUrl = `${site.url}/skill/add-a-day.md`;
  const orgs = orgsNav(locale);

  return mdDocument(
    `# ${hero.title}`,
    `*${hero.kicker}*`,
    hero.lede,
    cta,
    mdList(hero.points),
    !f.helperEnabled &&
      mdDocument(
        `## ${t("landing.handTitle")}`,
        t("landing.handBody"),
        "```\n" + t("landing.instruction", { docUrl, agentUrl }) + "\n```",
      ),
    prints &&
      mdDocument(
        `## ${prints.title}`,
        prints.body,
        f.printPrices.length > 0 && mdList(f.printPrices.map((row) => `${row.label}: **${row.price}**`)),
      ),
    `## ${how.title}`,
    how.steps.map((step, i) => `${i + 1}. **${step.title}** ${step.body}`).join("\n"),
    landingTrust(t)
      .map((card) => `### ${card.title}\n\n${card.body}${card.link ? ` [${card.link}](${href("/docs")})` : ""}`)
      .join("\n\n"),
    f.billingEnabled && pricingMarkdown(locale),
    `## ${faq.title}`,
    mdFaq(faq.items),
    orgs.length > 0 && mdList(orgs.map((o) => `[${o.label}](${href(o.href)})`)),
    `[${t("landing.footerDocs")}](${href("/docs")})`,
  );
}
