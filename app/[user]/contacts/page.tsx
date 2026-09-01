import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ContactsAdmin, { type AdminContact } from "@/components/ContactsAdmin";
import NoticeShell from "@/components/NoticeShell";
import { isEnabled } from "@/lib/capabilities";
import { listContacts } from "@/lib/contacts";
import { EMPTY_ADDRESS } from "@/lib/contacts/crypto";
import { listInvites } from "@/lib/contacts/invites";
import { pickLocale } from "@/lib/contacts/locale";
import { isOwner } from "@/lib/contacts/session";

import { dictionaryFor, localesFor, translateIn } from "@/lib/locales";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The owner's overview (C6) — the page the approval email links into.
 *
 * Guarded twice, on purpose. Here, so that nothing sensitive is ever rendered
 * for anybody else; and again inside `/api/contacts/admin`, so that a button
 * that somehow reached the wrong browser still cannot do anything. A page that
 * renders is not an authorisation.
 *
 * When the viewer is not the owner it says so in plain language rather than
 * returning a 404: the owner arriving from an email on a phone that has been
 * signed out needs to be told to sign in, not shown a dead end.
 */
export default async function ContactsAdminPage({ params }: PageProps<"/[user]/contacts">) {
  const { user: username } = await params;
  const user = getUser(username);
  if (!user || !isEnabled("contacts", username)) notFound();

  const locale = pickLocale(user.defaultLocale);

  if (!(await isOwner(username))) {
    return (
      <NoticeShell
        lang={locale}
        title={translateIn(locale, "err.notSignedInTitle")}
        body={translateIn(locale, "contact.adminSignIn")}
        actions={[
          {
            href: `/${username}`,
            label: translateIn(locale, "err.goToJournal", { title: user.title }),
          },
        ]}
      />
    );
  }

  const contacts: AdminContact[] = (await listContacts(username)).map((contact) => ({
    id: contact.id,
    name: contact.name,
    email: contact.email,
    locale: contact.locale,
    status: contact.status,
    wantsEmailDigest: contact.wantsEmailDigest,
    wantsPostcard: contact.wantsPostcard,
    // Decrypted here and nowhere else on the public side: the owner is the one
    // person besides its owner who is entitled to read it.
    postalAddress: contact.hasPostalAddress ? (contact.postalAddress ?? EMPTY_ADDRESS) : null,
    createdVia: contact.createdVia,
    createdAt: contact.createdAt,
    confirmedAt: contact.confirmedAt,
    lastSeenAt: contact.lastSeenAt,
  }));

  return (
    <ContactsAdmin
      locales={localesFor(username)}
      dictionary={dictionaryFor(locale)}
      username={username}
      locale={locale}
      contacts={contacts}
      invites={await listInvites(username)}
    />
  );
}
