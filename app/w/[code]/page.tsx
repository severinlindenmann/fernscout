import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import NoticeShell from "@/components/NoticeShell";
import { hasSwitchedOff, isEnabled } from "@/lib/capabilities";
import { pickLocale } from "@/lib/contacts/locale";
import { journalReader } from "@/lib/contacts/session";
import { buddyTripOf, maskEmail, maskMobile, ownerShortName, resolveWelcomeCode } from "@/lib/contacts/welcome";
import { guideWords, requestLocale, translateIn } from "@/lib/locales";
import { mailDisabledReason } from "@/lib/mail";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { getUser } from "@/lib/users";
import WelcomeGuide, { type GuideDetails } from "./WelcomeGuide";
import WelcomeOpened from "./WelcomeOpened";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

/** Per IP: a person opens their link a handful of times; a list of guesses is
 * something else. */
const LOOKUPS = { max: 30, windowMs: 15 * 60 * 1000 };

/**
 * `/w/<code>` — somebody's welcome link: the six-screen guide (B2293; the
 * link itself is B2292's).
 *
 * **It grants nothing.** Rendering opens no session and reads no grant. What
 * it shows before the person proves the channel the owner typed is a first
 * name, the owner's short name, the journal's title and a masked address —
 * the owner-typed details (`details`) are handed to the page only once the
 * session in this browser is this contact's. An unknown, blocked or
 * rate-limited code gets the same page, so the answer says nothing about
 * which it was.
 *
 * Runs once: a person who finished it (`onboarded_at`) and is signed in goes
 * straight to the journal.
 *
 * The first open is recorded by the browser after the page has loaded
 * (`WelcomeOpened`), not by this render: a link preview or a mail scanner
 * fetches the page too.
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

  const { owner, contact } = found;
  const reader = await journalReader(owner);
  const signedIn = reader.contact?.id === contact.id;
  if (signedIn && contact.onboardedAt) redirect(`/${owner}`);

  const locale = pickLocale(contact.locale, user.defaultLocale);
  const trip = await buddyTripOf(owner, contact.id);
  const hasEmail = contact.email.includes("@");
  const caps = {
    mail: !mailDisabledReason(owner),
    sms: isEnabled("sms"),
    whatsapp: isEnabled("whatsapp") && !hasSwitchedOff("whatsapp", owner),
    postcards: isEnabled("postcards", owner),
  };
  const self = signedIn ? reader.contact : null;
  const details: GuideDetails | null = self
    ? {
        name: self.name ?? "",
        email: self.email.includes("@") ? self.email : null,
        phone: self.phone,
        // Proved: the address this very session was signed in with, or a
        // number an SMS code stamped.
        emailProven: self.email.includes("@") && reader.email === self.email,
        phoneProven: Boolean(self.phoneProvenAt),
        address: {
          line1: self.postalAddress?.line1 ?? "",
          postcode: self.postalAddress?.postcode ?? "",
          city: self.postalAddress?.city ?? "",
          country: self.postalAddress?.country ?? "",
        },
        wantsEmailDigest: self.wantsEmailDigest,
        wantsWhatsapp: self.wantsWhatsapp,
        wantsSms: self.wantsSms,
        wantsPostcard: self.wantsPostcard,
      }
    : null;

  return (
    <main id="main" lang={locale} className="mx-auto w-full max-w-md px-4 py-8">
      <WelcomeGuide
        code={code}
        owner={owner}
        title={user.title}
        ownerName={ownerShortName(user)}
        firstName={(contact.name ?? "").trim().split(/\s+/)[0] ?? ""}
        kind={trip ? "buddy" : "reader"}
        trip={trip}
        signedIn={signedIn}
        onboarded={Boolean(contact.onboardedAt)}
        joined={(contact.createdVia ?? "").startsWith("invite:")}
        prove={{
          email: hasEmail && caps.mail ? maskEmail(contact.email) : null,
          mobile: contact.phone && caps.sms ? maskMobile(contact.phone) : null,
          preferred: contact.invitedVia === "sms" || contact.invitedVia === "whatsapp" || !hasEmail ? "sms" : "email",
        }}
        details={details}
        caps={caps}
        dictionary={guideWords(locale)}
      />
      <WelcomeOpened code={code} />
    </main>
  );
}
