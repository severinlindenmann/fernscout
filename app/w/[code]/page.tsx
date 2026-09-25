import type { Metadata } from "next";
import { headers } from "next/headers";
import NoticeShell from "@/components/NoticeShell";
import { isEnabled } from "@/lib/capabilities";
import { pickLocale } from "@/lib/contacts/locale";
import { ownerShortName, resolveWelcomeCode } from "@/lib/contacts/welcome";
import { requestLocale, translateIn } from "@/lib/locales";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { getUser } from "@/lib/users";
import WelcomeOpened from "./WelcomeOpened";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

/** Per IP: a person opens their link a handful of times; a list of guesses is
 * something else. */
const LOOKUPS = { max: 30, windowMs: 15 * 60 * 1000 };

/**
 * `/w/<code>` — somebody's welcome link (B2292; the guide itself is B2293).
 *
 * **It grants nothing.** No session is opened, no cookie is set and no grant
 * is read: it says hello by first name and names the journal, and the way in
 * is still the journal's own sign-in with the channel the owner typed. An
 * unknown, blocked or rate-limited code gets the same page, so the answer
 * says nothing about which it was.
 *
 * The first open is recorded by the browser after the page has loaded
 * (`WelcomeOpened`), not by this render: a link preview or a mail scanner
 * fetches the page too, and it must not make "Send again" disappear from the
 * owner's card before a person has seen anything.
 */
export default async function WelcomePage({ params }: PageProps<"/w/[code]">) {
  const { code } = await params;
  const allowed = rateLimitFor("welcome-lookup", clientIp(await headers()), LOOKUPS).ok;
  const found = allowed && isEnabled("contacts") ? await resolveWelcomeCode(code) : null;
  // The journal's own contacts switch too, not only the server's (I3).
  const user = found && isEnabled("contacts", found.owner) ? getUser(found.owner) : null;

  if (!found || !user) {
    const locale = await requestLocale();
    return (
      <NoticeShell
        title={translateIn(locale, "welcomeLink.unknownTitle")}
        body={translateIn(locale, "welcomeLink.unknownBody")}
      />
    );
  }

  const locale = pickLocale(found.contact.locale, user.defaultLocale);
  const vars = {
    name: (found.contact.name ?? "").trim().split(/\s+/)[0] ?? "",
    owner: ownerShortName(user),
    title: user.title,
  };
  return (
    <NoticeShell
      lang={locale}
      title={translateIn(locale, "welcomeLink.hello", vars)}
      body={translateIn(locale, "welcomeLink.body", vars)}
      actions={[{ href: `/${found.owner}`, label: translateIn(locale, "welcomeLink.open", vars) }]}
    >
      <WelcomeOpened code={code} />
    </NoticeShell>
  );
}
