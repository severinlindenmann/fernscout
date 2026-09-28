import type { TranslationKey } from "./i18n";

/**
 * What the signed-out landing says, as data — B2488.
 *
 * `components/landing/SignedOut.tsx` draws these and `lib/landingMarkdown.ts`
 * writes them out as Markdown, so the page and its `.md` cannot say different
 * things: which lede, which steps, which questions in which order are decided
 * once, here. No imports but a type: the client component and the server
 * route both use it.
 */
export type LandingT = (key: TranslationKey, vars?: Record<string, string>) => string;

export type LandingFlags = {
  helperEnabled: boolean;
  postcards: boolean;
  photobook: boolean;
  inviteCta: "request" | "welcome";
  planPoint?: string | null;
  planFaq?: { q: string; a: string }[];
};

export type Item = { title: string; body: string };

export function landingHero(t: LandingT, f: LandingFlags) {
  return {
    kicker: t("landing.heroKicker"),
    title: t("landing.hero"),
    lede: t(f.photobook ? "landing.ledeBook" : "landing.lede"),
    points: [f.planPoint, t("landing.pointPrivate"), t("landing.pointExport")].filter((p): p is string => Boolean(p)),
  };
}

/** The prints block, or null where this instance prints nothing. */
export function landingPrints(t: LandingT, f: LandingFlags) {
  if (!f.postcards && !f.photobook) return null;
  return {
    kicker: t("landing.navPrints"),
    title: t(f.photobook ? "landing.printsTitle" : "landing.printsTitleCards"),
    body: t(f.photobook ? "landing.printsBody" : "landing.printsBodyCards"),
  };
}

export function landingHow(t: LandingT, f: LandingFlags): { kicker: string; title: string; steps: Item[] } {
  const keep = f.postcards && f.photobook;
  return {
    kicker: t("landing.navHow"),
    title: t("landing.howTitle"),
    steps: [
      { title: t("landing.howWrite"), body: t(f.helperEnabled ? "landing.howWriteBodyHelper" : "landing.howWriteBody") },
      { title: t("landing.howShare"), body: t("landing.howShareBody") },
      { title: t("landing.howKeep"), body: t(keep ? "landing.howKeepBody" : "landing.howKeepBodyPlain") },
    ],
  };
}

export function landingTrust(t: LandingT): (Item & { link?: string })[] {
  return [
    { title: t("landing.trustPrivateTitle"), body: t("landing.trustPrivateBody") },
    { title: t("landing.trustExportTitle"), body: t("landing.trustExportBody") },
    { title: t("landing.trustOpenTitle"), body: t("landing.trustOpenBody"), link: t("landing.trustOpenLink") },
  ];
}

export function landingFaq(t: LandingT, f: LandingFlags): { title: string; items: { q: string; a: string }[] } {
  const prints = f.postcards || f.photobook;
  const plan = f.planFaq ?? [];
  return {
    title: t("landing.faqTitle"),
    items: [
      ...(f.inviteCta === "request" ? [{ q: t("landing.faqInviteQ"), a: t("landing.faqInviteA") }] : []),
      ...(prints ? [{ q: t("landing.faqPrintQ"), a: t("landing.faqPrintA") }] : []),
      { q: t("landing.faqAppQ"), a: t("landing.faqAppA") },
      ...plan.slice(0, 1),
      { q: t("landing.faqWhoQ"), a: t("landing.faqWhoA") },
      ...plan.slice(1),
    ],
  };
}
