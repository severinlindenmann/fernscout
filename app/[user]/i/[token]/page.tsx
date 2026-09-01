import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import ContactForm from "@/components/ContactForm";
import { isEnabled } from "@/lib/capabilities";
import { resolveInvite } from "@/lib/contacts/invites";
import NoticeShell from "@/components/NoticeShell";
import { fromAcceptLanguage, pickLocale } from "@/lib/contacts/locale";
import { getUser } from "@/lib/users";
import { dictionariesFor, localesFor, translateIn } from "@/lib/locales";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The personal link — `/{user}/i/<token>`.
 *
 * It opens **already in their language**, with their name in the greeting. That
 * is the whole feature: the reader this was built for is eighty-one, and a
 * language picker is a step at which they stop.
 *
 * ## Why forwarding it is harmless (decision 19)
 *
 * What the token supplies is two strings — a name and a language — and both go
 * straight into form fields the person sitting there can overwrite. It carries
 * no email address, so there is nothing to impersonate, and it creates no
 * grant, so there is nothing to inherit. Whoever opens it types their own
 * address, gets their own six-digit code, and becomes their own pending
 * contact. Forward it to forty people and the owner gets forty requests to
 * approve individually, which is exactly the intended behaviour.
 *
 * An expired, revoked or invented token used to fall back to the same form the
 * open link showed. There is no open link any more (B37) and the endpoint
 * behind the form refuses a submission without a live token, so that fallback
 * would now be a form that silently does nothing — the worst of both, since
 * whoever filled it in would wait for a reply that was never coming. It says
 * the link has stopped working instead, which is true and tells them what to
 * do, and it is still not a 404: the same reasoning as `/{user}/c/<token>`.
 */
export default async function InvitePage({ params }: PageProps<"/[user]/i/[token]">) {
  const { user: username, token } = await params;
  const user = getUser(username);
  if (!user || !isEnabled("contacts", username)) notFound();

  const invite = await resolveInvite(username, token);
  const accept = (await headers()).get("accept-language");
  const locale = pickLocale(invite?.locale, fromAcceptLanguage(accept), user.defaultLocale);

  if (!invite) {
    return (
      <NoticeShell
        lang={locale}
        title={translateIn(locale, "err.linkExpiredTitle")}
        body={translateIn(locale, "err.linkExpiredBody")}
        actions={[
          {
            href: `/${username}`,
            label: translateIn(locale, "err.goToJournal", { title: user.title }),
          },
        ]}
      />
    );
  }

  return (
    <ContactForm
      locales={localesFor(username)}
      dictionaries={dictionariesFor(username)}
      username={username}
      journalTitle={user.title}
      initialLocale={locale}
      initialName={invite.name ?? ""}
      // Passed back on submit so the owner can see which link somebody came
      // through — and, since B37, so the submission is accepted at all. It is
      // provenance and admissibility, never identity.
      inviteToken={token}
    />
  );
}
