import type { Metadata } from "next";
import { headers } from "next/headers";
import { cache } from "react";
import type { UserConfig } from "@/lib/config";
import { inviteMetadata, inviteSubject } from "@/lib/invitePreview";
import type { Trip } from "@/lib/types";
import NoticeShell from "@/components/NoticeShell";
import { hasSwitchedOff, isEnabled } from "@/lib/capabilities";
import { fromAcceptLanguage, pickLocale } from "@/lib/contacts/locale";
import { isJournalGuest, isOwner, journalReader } from "@/lib/contacts/session";
import { maskEmail, ownerShortName, resolveJoinCode, type JoinInvite } from "@/lib/contacts/welcome";
import { dictionaryFor, localesFor, requestLocale, translateIn } from "@/lib/locales";
import { mailDisabledReason } from "@/lib/mail";
import { subjectPhone } from "@/lib/phone";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { isPersonOn } from "@/lib/tripPeople";
import { getTrip, tripRef } from "@/lib/trips";
import { getUser } from "@/lib/users";
import JoinFlow from "./JoinFlow";

import { journalPath } from "@/lib/journalPath";
export const dynamic = "force-dynamic";

const LOOKUPS = { max: 30, windowMs: 15 * 60 * 1000 };

type Lookup = { invite: JoinInvite | null; user: UserConfig | null; trip: Trip | undefined | null };

/** One rate-limited lookup per request, shared by the preview's metadata and
 * the page — `cache` makes the second ask free, so a render spends one. */
const lookup = cache(async (code: string): Promise<Lookup> => {
  const allowed = rateLimitFor("join-lookup", clientIp(await headers()), LOOKUPS).ok;
  const invite = allowed && isEnabled("contacts") ? await resolveJoinCode(code) : null;
  const user = invite && isEnabled("contacts", invite.owner) ? getUser(invite.owner) : null;
  const trip = invite?.tripId ? getTrip(tripRef(invite.owner, invite.tripId)) : null;
  return { invite, user, trip };
});

/** The link preview — B2502: an invitation to the journal, in its language
 * (a preview bot sends no Accept-Language). Still noindex. */
export async function generateMetadata({ params }: PageProps<"/j/[code]">): Promise<Metadata> {
  const { code } = await params;
  const { invite, user, trip } = await lookup(code);
  const valid = invite && user && !(invite.kind === "buddy" && !trip);
  return inviteMetadata(`/j/${code}`, valid ? inviteSubject(user, invite.locale) : null);
}

/**
 * `/j/<code>` — a group link (B2293, B2291 "Share an invite link"). It grants
 * nothing: whoever opens it names themselves, proves an email or a mobile
 * number with a code, and becomes a request the owner answers. An unknown,
 * stopped, expired or rate-limited code gets the same page.
 */
export default async function JoinPage({ params }: PageProps<"/j/[code]">) {
  const { code } = await params;
  const { invite, user, trip } = await lookup(code);

  if (!invite || !user || (invite.kind === "buddy" && !trip)) {
    const locale = await requestLocale();
    // B2368 — a group link was never sent by email; "Links sent by email
    // expire on purpose" is simply false here.
    return (
      <NoticeShell
        title={translateIn(locale, "err.linkExpiredTitle")}
        body={translateIn(locale, "err.linkExpiredBodyShared")}
      />
    );
  }

  const owner = invite.owner;
  const locale = pickLocale(fromAcceptLanguage((await headers()).get("accept-language")), invite.locale, user.defaultLocale);
  const home = { href: journalPath(owner), label: translateIn(locale, "err.goToJournal", { title: user.title }) };

  // Following your own link is not a way of joining your own journal.
  if (await isOwner(owner)) {
    return (
      <NoticeShell
        lang={locale}
        title={translateIn(locale, "invite.ownerTitle")}
        body={translateIn(locale, "invite.ownerBody")}
        actions={[home]}
      />
    );
  }
  const reader = await journalReader(owner);
  const alreadyIn = trip ? await isPersonOn(trip, reader.email) : await isJournalGuest(owner);
  if (alreadyIn) {
    return (
      <NoticeShell lang={locale} title={translateIn(locale, "join.alreadyTitle")} body={translateIn(locale, "join.alreadyBody", { title: user.title })} actions={[home]} />
    );
  }

  const knownEmail = reader.email && !subjectPhone(reader.email) ? maskEmail(reader.email) : null;
  return (
    <main id="main" lang={locale} className="mx-auto w-full max-w-md px-4 py-8">
      <JoinFlow
        code={code}
        owner={owner}
        title={user.title}
        ownerName={ownerShortName(user)}
        kind={invite.kind === "buddy" ? "buddy" : "guest"}
        tripTitle={trip?.title ?? null}
        knownEmail={knownEmail}
        caps={{
          mail: !mailDisabledReason(owner),
          sms: isEnabled("sms"),
          whatsapp: isEnabled("whatsapp") && !hasSwitchedOff("whatsapp", owner),
          postcards: isEnabled("postcards", owner),
        }}
        dictionary={dictionaryFor(locale, "guide")}
        locale={locale}
        locales={localesFor(owner)}
        addressLookupEnabled={isEnabled("addressLookup", owner)}
      />
    </main>
  );
}
