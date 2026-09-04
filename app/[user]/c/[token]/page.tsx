import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import ContactManage from "@/components/ContactManage";
import LocaleProvider from "@/components/LocaleProvider";
import NoticeShell from "@/components/NoticeShell";
import PageHeader from "@/components/PageHeader";
import { isEnabled } from "@/lib/capabilities";
import { resolveManageToken } from "@/lib/contacts";
import { EMPTY_ADDRESS } from "@/lib/contacts/crypto";
import { fromAcceptLanguage, pickLocale } from "@/lib/contacts/locale";

import { dictionaryFor, localesFor, translateIn } from "@/lib/locales";
import { getUser } from "@/lib/users";
import { whatsappCountryCode } from "@/lib/whatsapp/settings";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * "Your details" — `/{user}/c/<token>`, reachable with no login at all (C13).
 *
 * The link every mail footer carries. Change the language, correct the address,
 * stop the emails, or delete the record entirely. The token in the URL is the
 * credential, which is the only design a seventy-eight-year-old will actually
 * use; it can touch exactly one row.
 *
 * The page renders in the language on the record, not the one in the browser —
 * somebody who asked to be written to in Hungarian gets a Hungarian page from
 * whatever device they opened the mail on.
 */
export default async function ManagePage({ params }: PageProps<"/[user]/c/[token]">) {
  const { user: username, token } = await params;
  const user = getUser(username);
  if (!user || !isEnabled("contacts", username)) notFound();

  const contact = await resolveManageToken(username, token);

  // An expired, revoked or invented token. There is no record to read a
  // language from, so this one falls back to what the browser asked for — and
  // it says what to do next, because "this link no longer works" on its own
  // reads as "you have been removed" to the person it happens to.
  if (!contact) {
    const accept = (await headers()).get("accept-language");
    const locale = pickLocale(fromAcceptLanguage(accept), user.defaultLocale);
    return (
      // Nested rather than left to the layout's own (browser/cookie-driven)
      // provider, for the same reason the body renders in this language: a
      // header in one language above a notice in another is exactly the
      // mismatch this page exists to avoid.
      <LocaleProvider locale={locale} dictionary={dictionaryFor(locale)}>
        <div className="min-h-screen">
          {/* Same reasoning as `/contacts` (B271): this page is a fresh tab
              with no history behind it, and the header is the way back to
              the journal — `useTrip()` is null here, so the title links
              there. */}
          <PageHeader />
          <NoticeShell
            lang={locale}
            title={translateIn(locale, "err.linkExpiredTitle")}
            body={translateIn(locale, "err.linkExpiredBody")}
            // It used to offer the open guestbook here, as the way to get a
            // fresh link. There is no open guestbook any more (B37), and the
            // body now says the true thing instead: ask whoever invited you.
            // Still not a 404 — see the note above.
            actions={[
              {
                href: `/${username}`,
                label: translateIn(locale, "err.goToJournal", { title: user.title }),
              },
            ]}
          />
        </div>
      </LocaleProvider>
    );
  }

  const locale = pickLocale(contact.locale, user.defaultLocale);
  const dictionary = dictionaryFor(locale);

  return (
    <LocaleProvider locale={locale} dictionary={dictionary}>
      <div className="min-h-screen">
        <PageHeader />
        <main id="main" tabIndex={-1}>
          <ContactManage
            locales={localesFor(username)}
            dictionary={dictionary}
            username={username}
            token={token}
            contact={{
              name: contact.name ?? "",
              email: contact.email,
              locale,
              status: contact.status,
              wantsEmailDigest: contact.wantsEmailDigest,
              wantsPostcard: contact.wantsPostcard,
              wantsWhatsapp: contact.wantsWhatsapp,
              address: contact.postalAddress ?? EMPTY_ADDRESS,
            }}
            // B385: same fallback `toE164` reads at send time.
            defaultCountryCode={whatsappCountryCode()}
          />
        </main>
      </div>
    </LocaleProvider>
  );
}
