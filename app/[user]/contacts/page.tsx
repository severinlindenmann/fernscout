import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ContactsAdmin, { type AdminContact } from "@/components/ContactsAdmin";
import NoticeShell from "@/components/NoticeShell";
import PageHeader from "@/components/PageHeader";
import { isEnabled } from "@/lib/capabilities";
import { listContacts } from "@/lib/contacts";
import { EMPTY_ADDRESS } from "@/lib/contacts/crypto";
import { listInvitesWithLinks } from "@/lib/contacts/invites";
import { pickLocale } from "@/lib/contacts/locale";
import { isOwner } from "@/lib/contacts/session";

import { dictionaryFor, localesFor, translateIn } from "@/lib/locales";
import { serverSite } from "@/lib/site";
import { getTrips } from "@/lib/trips";
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
export default async function ContactsAdminPage({
  params,
  searchParams,
}: PageProps<"/[user]/contacts">) {
  const { user: username } = await params;
  // Which request the owner's approval mail was about — B319. Read
  // server-side, like `me.tsx`'s `?signin=` handling, rather than with
  // `useSearchParams` in the client component: that hook needs a `Suspense`
  // boundary this page has no other reason to add, and the id is nothing an
  // owner would ever type by hand, so there is no form to preserve across a
  // reload.
  const highlight = (await searchParams).contact;
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

  // One read, two questions: the trips a buddy link can name, and whether
  // approving somebody opens anything at all (B300) — a `guest` trip is the
  // only kind an approval reaches. `getTrips` was already loaded here for
  // B281's writing-link selector; a second call would be the same answer,
  // fetched twice.
  const trips = getTrips(username);

  return (
    // The header is the way back, and this page needs one more than most: it is
    // where the approval email lands, so the owner arrives in a fresh tab with
    // no history behind it and, until B271, nothing on the page pointing at the
    // journal. Every other page under `app/[user]/` already mounts it, so the
    // exit is the one the owner has been taught to use rather than a "back"
    // link invented here — and it brings the language switcher and the skip
    // link with it. `useTrip()` is null on this route, which is exactly what
    // makes the journal's title in it link to the journal.
    //
    // Composed here rather than inside `ContactsAdmin` because the header needs
    // the layout's providers and the component is rendered without them by
    // `test/guest-list-links.test.tsx`, which is about the copy on the rows and
    // has no business standing up a journal to read it.
    <div className="min-h-screen">
      <PageHeader />
      <ContactsAdmin
        locales={localesFor(username)}
        dictionary={dictionaryFor(locale)}
        username={username}
        locale={locale}
        contacts={contacts}
        // `listInvitesWithLinks` rather than `listInvites` — B280 and B281.
        // The link an owner already sent is theirs to send again, and this is
        // the one place it is recovered: server-side, on a page behind
        // `isOwner`, exactly as the postal addresses above are.
        invites={await listInvitesWithLinks(username, serverSite().url)}
        // The trips a buddy link can name. From disk rather than a fetch: the
        // panel needs the list to render its own form, and a second answer
        // arriving later is a select that changes under the owner's cursor.
        trips={trips.map((trip) => ({ id: trip.id, title: trip.title }))}
        // B300. Approving somebody opens every `guest` trip in the journal —
        // and nothing else. If none exists, that approval opens nothing at
        // all, and the owner needs to be told before they act on it rather
        // than discover it from a family member's dead-end.
        hasGuestTrip={trips.some((trip) => trip.visibility === "guest")}
        // B319: the notification mail's own request, so the page can put it
        // in front of the owner rather than leave them to find it in a list.
        highlightId={typeof highlight === "string" ? highlight : undefined}
      />
    </div>
  );
}
