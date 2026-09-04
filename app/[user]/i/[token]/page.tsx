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

  // A **buddy** token pasted here reads as a dead link, and that is the honest
  // answer (B33). This form is the guestbook: it asks for a postal address and
  // two consents, and it records nothing about a trip — so filling it in would
  // silently turn "come along on the trip" into "add me to the mailing list",
  // and the endpoint behind it refuses such a token anyway. The buddy link has
  // its own address, `/{user}/invite/buddy/<token>`, and the kind is in the
  // path precisely so that the two cannot be confused.
  if (!invite || invite.kind === "buddy") {
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
      // B360: a server with no postcard provider cannot act on a postal
      // address, so the form stops asking for one.
      postcardsEnabled={isEnabled("postcards", username)}
      // B376: same reasoning, for the phone hint's own mention of WhatsApp.
      whatsappEnabled={isEnabled("whatsapp", username)}
    />
  );
}
