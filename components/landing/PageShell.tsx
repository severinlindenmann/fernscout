import type { ReactNode } from "react";
import { orgsNav } from "@paid/orgs/lib/nav";
import { landingFlags } from "@/lib/landingMarkdown";
import { hasLegal } from "@/lib/legal";
import { installedLocales, requestLocale } from "@/lib/locales";
import { serverSite } from "@/lib/site";
import { SiteFrame, type Audience } from "./Frame";

/**
 * Every page outside the journal, framed alike — B2531. The header (A for a
 * visitor signed out, B signed in, or the slim C with `slim`), `<main>` and
 * the homepage's footer; the page brings its bands (`Band` in ./kit).
 *
 * The facts the frame needs are read here, on the server, the same way `/`
 * reads them, so a door for a capability this instance does not have is
 * absent from the document rather than drawn and hidden.
 */
export default async function PageShell({
  slim = false,
  audience = "personal",
  children,
}: {
  slim?: boolean;
  /** Whom the page is for: its tint (the stripe, the badge, the hero ground,
   *  chips, dots, tiles, eyebrows on navy). Everything else is the same. */
  audience?: Audience;
  children: ReactNode;
}) {
  const site = serverSite();
  const locale = await requestLocale();
  const flags = landingFlags(locale);
  const orgs = orgsNav(locale);
  // The badge is the group's own nav word, so it is translated where the
  // nav is and absent in a build without the groups pages.
  const badge = { personal: undefined, school: "/schools", operator: "/tour-operators" }[audience];
  return (
    <SiteFrame
      slim={slim}
      audience={audience}
      badge={badge && orgs.find((o) => o.href === badge)?.label}
      siteName={site.name}
      locales={installedLocales()}
      inviteCta={flags.inviteCta}
      helperEnabled={flags.helperEnabled}
      prints={flags.postcards || flags.photobook}
      pricing={flags.credits}
      orgs={orgs}
      repository={site.repository}
      credit={site.credit}
      legal={hasLegal()}
    >
      {children}
    </SiteFrame>
  );
}
