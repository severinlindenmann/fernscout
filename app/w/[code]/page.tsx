import type { Metadata } from "next";
import { headers } from "next/headers";
import { inviteMetadata, inviteSubject } from "@/lib/invitePreview";
import { redirect } from "next/navigation";
import NoticeShell from "@/components/NoticeShell";
import PageShell from "@/components/landing/PageShell";
import { guestLanding, isOpenToApprovedGuest } from "@/lib/access";
import { hasSwitchedOff, isEnabled } from "@/lib/capabilities";
import { fromAcceptLanguage, pickLocale } from "@/lib/contacts/locale";
import { journalReader } from "@/lib/contacts/session";
import { buddyTripOf, maskEmail, maskMobile, ownerShortName } from "@/lib/contacts/welcome";
import { dictionaryFor, localesFor, requestLocale, translateIn } from "@/lib/locales";
import { mailDisabledReason } from "@/lib/mail";
import { getTrips } from "@/lib/trips";
import { siteSummaryFor } from "@/lib/site";
import { lookup } from "./lookup";
import WelcomeGuide, { type GuideDetails } from "./WelcomeGuide";

export const dynamic = "force-dynamic";

/** The link preview — B2502: an invitation to the journal, in its language.
 * The journal's title only, never the name the owner typed for the person. */
export async function generateMetadata({ params }: PageProps<"/w/[code]">): Promise<Metadata> {
  const { code } = await params;
  const { found, user } = await lookup(code);
  return inviteMetadata(`/w/${code}`, found ? inviteSubject(user) : null);
}

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
 * The first open is recorded when the person asks for their code (the
 * `send` step), not by this render: a link preview or a mail scanner fetches
 * the page too, and neither presses a button (B2368).
 */
export default async function WelcomePage({ params }: PageProps<"/w/[code]">) {
  const { code } = await params;
  const { found, user } = await lookup(code);

  if (!found || !user) {
    const locale = await requestLocale();
    return (
      // B2533: the slim header C and the shared footer, same as every other
      // mid-task page — this one used to draw no frame at all.
      <PageShell slim>
        <NoticeShell
          inFrame
          lang={locale}
          title={translateIn(locale, "welcomeLink.unknownTitle")}
          body={translateIn(locale, "welcomeLink.unknownBody")}
          actions={[{ href: "/", label: translateIn(locale, "err.goToStart") }]}
        />
      </PageShell>
    );
  }

  const { owner, contact } = found;
  const reader = await journalReader(owner);
  const signedIn = reader.contact?.id === contact.id;
  const trips = getTrips(owner);
  const landing = guestLanding(owner, trips);
  const journalFigures = siteSummaryFor(user, false).travellerFigures;
  if (signedIn && contact.onboardedAt) redirect(landing);

  // B2456: the browser first, as on /j. The guide runs only until the person
  // is onboarded (then it redirects), so this never overrides a language they
  // later set on their own page; the stored locale is only a guess before then
  // (an owner's default, or whatever an earlier code request carried).
  const locale = pickLocale(fromAcceptLanguage((await headers()).get("accept-language")), contact.locale, user.defaultLocale);
  const trip = await buddyTripOf(owner, contact.id);
  const hasEmail = contact.email.includes("@");
  const caps = {
    mail: !mailDisabledReason(owner),
    // B2597: readers sign in by email only — no SMS channel here, whatever
    // this instance's own SMS transport (`isEnabled("sms")`) is set up for
    // elsewhere (the owner's own phone check).
    sms: false,
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
    <PageShell slim>
      <div lang={locale} className="mx-auto w-full max-w-md px-4 py-8">
        <WelcomeGuide
          code={code}
          owner={owner}
          title={user.title}
          ownerName={ownerShortName(user)}
          firstName={(contact.name ?? "").trim().split(/\s+/)[0] ?? ""}
          kind={trip ? "buddy" : "reader"}
          trip={trip}
          hasGuestTrip={trips.some(isOpenToApprovedGuest)}
          landing={landing}
          figures={
            // The journal's own party, else the party of its newest trip a
            // guest may read (a journal like /severin draws its figures per
            // trip) — never a private trip's (B2457).
            journalFigures.length > 0
              ? journalFigures
              : (trips.find((t) => isOpenToApprovedGuest(t) && t.status !== "upcoming" && t.travellers.length > 0)?.travellers ?? [])
          }
          recent={
            // B2457: only once this browser's session is this contact's — a
            // forwarded link must not show which trips a journal has.
            signedIn
              ? trips
                  .filter((t) => isOpenToApprovedGuest(t) && t.status !== "upcoming")
                  .slice(0, 3)
                  .map((t) => ({ id: t.id, title: t.title, cover: t.cover ?? null, year: t.start.slice(0, 4) }))
              : []
          }
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
          dictionary={dictionaryFor(locale, "guide")}
          locale={locale}
          locales={localesFor(owner)}
          addressLookupEnabled={isEnabled("addressLookup", owner)}
        />
      </div>
    </PageShell>
  );
}
