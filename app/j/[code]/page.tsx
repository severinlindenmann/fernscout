import type { Metadata } from "next";
import { headers } from "next/headers";
import { inviteMetadata, inviteSubject } from "@/lib/invitePreview";
import NoticeShell from "@/components/NoticeShell";
import PageShell from "@/components/landing/PageShell";
import { hasSwitchedOff, isEnabled } from "@/lib/capabilities";
import { fromAcceptLanguage, pickLocale } from "@/lib/contacts/locale";
import { isJournalGuest, isOwner, journalReader } from "@/lib/contacts/session";
import { maskEmail, ownerShortName } from "@/lib/contacts/welcome";
import { dictionaryFor, localesFor, requestLocale, translateIn } from "@/lib/locales";
import { mailDisabledReason } from "@/lib/mail";
import { subjectPhone } from "@/lib/phone";
import { isPersonOn } from "@/lib/tripPeople";
import { lookup } from "./lookup";
import JoinFlow from "./JoinFlow";

import { journalPath } from "@/lib/journalPath";
export const dynamic = "force-dynamic";

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
      // B2533: the slim header C and the shared footer, same as every other
      // mid-task page — this one used to draw no frame at all.
      <PageShell slim>
        <NoticeShell
          inFrame
          lang={locale}
          title={translateIn(locale, "err.linkExpiredTitle")}
          body={translateIn(locale, "err.linkExpiredBodyShared")}
          actions={[{ href: "/", label: translateIn(locale, "err.goToStart") }]}
        />
      </PageShell>
    );
  }

  const owner = invite.owner;
  const locale = pickLocale(fromAcceptLanguage((await headers()).get("accept-language")), invite.locale, user.defaultLocale);
  const home = { href: journalPath(owner), label: translateIn(locale, "err.goToJournal", { title: user.title }) };

  // Following your own link is not a way of joining your own journal.
  if (await isOwner(owner)) {
    return (
      <PageShell slim>
        <NoticeShell
          inFrame
          lang={locale}
          title={translateIn(locale, "invite.ownerTitle")}
          body={translateIn(locale, "invite.ownerBody")}
          actions={[home]}
        />
      </PageShell>
    );
  }
  const reader = await journalReader(owner);
  const alreadyIn = trip ? await isPersonOn(trip, reader.email) : await isJournalGuest(owner);
  if (alreadyIn) {
    return (
      <PageShell slim>
        <NoticeShell
          inFrame
          lang={locale}
          title={translateIn(locale, "join.alreadyTitle")}
          body={translateIn(locale, "join.alreadyBody", { title: user.title })}
          actions={[home]}
        />
      </PageShell>
    );
  }

  const knownEmail = reader.email && !subjectPhone(reader.email) ? maskEmail(reader.email) : null;
  return (
    <PageShell slim>
      <div lang={locale} className="mx-auto w-full max-w-md px-4 py-8">
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
            // B2597: readers sign in by email only — no SMS channel here,
            // whatever this instance's own SMS transport (`isEnabled("sms")`)
            // is set up for elsewhere (the owner's own phone check).
            sms: false,
            whatsapp: isEnabled("whatsapp") && !hasSwitchedOff("whatsapp", owner),
            postcards: isEnabled("postcards", owner),
          }}
          dictionary={dictionaryFor(locale, "guide")}
          locale={locale}
          locales={localesFor(owner)}
          addressLookupEnabled={isEnabled("addressLookup", owner)}
        />
      </div>
    </PageShell>
  );
}
