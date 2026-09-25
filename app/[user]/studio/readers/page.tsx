import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ReadersAdmin from "@/components/studio/readers/ReadersAdmin";
import InviteSection from "@/components/studio/readers/InviteSection";
import type { AdminContact } from "@/components/studio/readers/shared";
import StudioPage from "@/components/studio/StudioPage";
import { isOpenToApprovedGuest } from "@/lib/access";
import { isEnabled } from "@/lib/capabilities";
import { manageTokenFor } from "@/lib/contacts";
import { contactsWithReadGrant } from "@/lib/grants";
import { deviceCountByContact } from "@/lib/push";
import { EMPTY_ADDRESS } from "@/lib/contacts/crypto";
import { pickLocale } from "@/lib/contacts/locale";
import { relationshipsFor } from "@/lib/contacts/relationships";
import { isOwner } from "@/lib/contacts/session";

import { dictionaryFor, localesFor, requestLocale, translateIn } from "@/lib/locales";
import { readersModel } from "@/lib/readers/model";
import { readerState } from "@/lib/readers/split";
import { previewJournal } from "@/lib/studio/audiencePreview";
import { pendingTripRequestsFor, peopleOf } from "@/lib/tripPeople";
import { getTrips } from "@/lib/trips";
import { getUser } from "@/lib/users";
import { whatsappCountryCode } from "@/lib/contactNumber";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The owner's overview (C6) — the page the approval email links into. Lived
 * at `/[user]/contacts` until B2092 moved it into the studio, on the shell;
 * that address is now a permanent redirect here.
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
}: PageProps<"/[user]/studio/readers">) {
  const { user: username } = await params;
  // Which request the owner's approval mail was about — B319. Read
  // server-side, like `me.tsx`'s `?signin=` handling, rather than with
  // `useSearchParams` in the client component: that hook needs a `Suspense`
  // boundary this page has no other reason to add, and the id is nothing an
  // owner would ever type by hand, so there is no form to preserve across a
  // reload.
  const highlight = (await searchParams).contact;
  const user = getUser(username);
  if (!user) notFound();

  // **The reader's chosen language, not the journal's** — B469. This page read
  // `pickLocale(user.defaultLocale)` and therefore stayed in the journal's
  // default for an owner who had picked a different language in the switcher.
  // `/[user]/me` draws the same line and names it `uiLocale`:
  // `requestLocale()` is the person looking at the screen, `pickLocale(...)`
  // is a fact about somebody else — a contact's own language, which each
  // contact row still carries on its own (`contact.locale`, untouched below).
  const locale = pickLocale(await requestLocale());

  if (!(await isOwner(username))) {
    // On the studio shell since B2092 (the shape keeper allows no other
    // h1), saying the same thing NoticeShell did: sign in, or go back.
    return (
      <StudioPage
        username={username}
        group="people"
        title={translateIn(locale, "err.notSignedInTitle")}
        lede={translateIn(locale, "contact.adminSignIn")}
        back={false}
      >
        <a className="mt-4 inline-block text-sm font-semibold text-ink-strong underline underline-offset-2" href={`/${username}`}>
          {translateIn(locale, "err.goToJournal", { title: user.title })}
        </a>
      </StudioPage>
    );
  }

  const shell = {
    username,
    group: "people" as const,
    title: translateIn(locale, "contact.adminTitle"),
    lede: translateIn(locale, "contact.adminSubtitle"),
  };

  // Switched off: the owner is told why (the studio's rule), never a 404 —
  // the owner check above still comes first, so a stranger learns nothing.
  if (!isEnabled("contacts", username)) {
    return (
      <StudioPage
        {...shell}
        capabilityOff={{
          banner: translateIn(locale, "studio.readers.off.banner"),
          body: translateIn(locale, "studio.readers.off.body"),
        }}
      />
    );
  }

  // Notifications are a fact about a reader, not a consent the owner records —
  // B453. `null` where this journal has push off, so the card says nothing
  // about a channel it never offered rather than reporting a hard zero.
  const pushOn = isEnabled("push", username);
  const devices = pushOn ? await deviceCountByContact(username) : {};

  // B2133 — one model of who reads this journal, the same one the hub's
  // chip counts with. `listContacts` decrypts a postal address per contact,
  // so it is read once here and every row below comes from it.
  const model = await readersModel(username);
  const all = [...model.waitingOnYou, ...model.waitingOnThem, ...model.readingNow, ...model.revoked];
  if (model.own) all.push(model.own);

  // One read, two questions: the trips a buddy link can name, and whether
  // approving somebody opens anything at all (B300) — a `guest` trip is the
  // only kind an approval reaches. `getTrips` was already loaded here for
  // B281's writing-link selector; a second call would be the same answer,
  // fetched twice.
  const trips = getTrips(username);

  // The owner's own row — B621. The model already set it apart from the
  // readers; its manage token is derived (`manageTokenFor`), not stored.
  const ownEmail = model.own?.email ?? null;
  const ownRow = model.own ?? undefined;

  // B630 — the same three facts the gates themselves ask, read once each for
  // the whole page rather than per row. `peopleOf()` already merges a trip's
  // `people:` with its redeemed buddy-link rows; `contactsWithReadGrant` is
  // the one query `journalReader` asks per request, done here for every
  // contact at once so a row's tag can never disagree with what actually lets
  // that person in.
  const tripMemberships = await Promise.all(
    trips.map(async (trip) => ({ id: trip.id, title: trip.title, people: await peopleOf(trip) })),
  );
  const liveGrants = await contactsWithReadGrant(username, new Date());

  // B1301 — a request `claimTripPlace` wrote, that nothing has opened yet.
  // The normal case is a `pending` contact's first trip, already visible from
  // `via` below; the one this exists for is an *already-active* contact whose
  // later buddy link named a different trip, who would otherwise carry no
  // mark at all that something is waiting on them.
  const pendingTripIds = await pendingTripRequestsFor(username);
  const tripTitle = (id: string) => trips.find((trip) => trip.id === id)?.title ?? id;

  const contacts: AdminContact[] = all.map((contact) => ({
    id: contact.id,
    name: contact.name,
    email: contact.email,
    locale: contact.locale,
    status: contact.status,
    wantsEmailDigest: contact.wantsEmailDigest,
    wantsPostcard: contact.wantsPostcard,
    wantsWhatsapp: contact.wantsWhatsapp,
    // Decrypted here and nowhere else on the public side: the owner is the one
    // person besides its owner who is entitled to read it.
    postalAddress: contact.hasPostalAddress ? (contact.postalAddress ?? EMPTY_ADDRESS) : null,
    pushDevices: pushOn ? (devices[contact.id] ?? 0) : null,
    createdVia: contact.createdVia,
    createdAt: contact.createdAt,
    confirmedAt: contact.confirmedAt,
    lastSeenAt: contact.lastSeenAt,
    relationship: relationshipsFor(
      contact.email,
      ownEmail,
      tripMemberships,
      contact.status === "active" && liveGrants.has(contact.id),
    ),
    pendingTrips: (pendingTripIds.get(contact.id) ?? []).map(tripTitle),
  }));

  return (
    // StudioPage carries the header, the crumb back to the studio and the
    // bar (B2092) — the approval email lands here in a fresh tab, and those
    // are its way out. `ContactsAdmin` stays provider-free so the row tests
    // can render it alone.
    <StudioPage {...shell}>
      {/* B2133 — the invite flow's own page folded in as the first section. */}
      <InviteSection
        username={username}
        preview={previewJournal(username, "guest")}
        existing={all
          .filter((c) => c !== model.own)
          .map((c) => ({ name: c.name, email: c.email, state: readerState(c) }))}
      />
      <ReadersAdmin
        locales={localesFor(username)}
        dictionary={dictionaryFor(locale)}
        username={username}
        locale={locale}
        contacts={contacts}
        // `listInvitesWithLinks` rather than `listInvites` — B280 and B281.
        // The link an owner already sent is theirs to send again, and this is
        // the one place it is recovered: server-side, on a page behind
        // `isOwner`, exactly as the postal addresses above are.
        invites={model.invitations}
        // The trips a buddy link can name. From disk rather than a fetch: the
        // panel needs the list to render its own form, and a second answer
        // arriving later is a select that changes under the owner's cursor.
        trips={trips.map((trip) => ({ id: trip.id, title: trip.title }))}
        // B300, corrected by B638. Approving somebody opens every `guest`
        // trip in the journal — but a `public` trip needs no approval at all
        // and is already readable by anyone, guest or not. The question this
        // answers is "would an approved guest find anything to read", which
        // both kinds satisfy and only `private` fails; `listed` is excluded
        // on purpose, since it only narrows advertising (the sitemap, the
        // feed, the switcher) and never readability — an unlisted public
        // trip is still open to a guest who has its URL.
        hasGuestTrip={trips.some(isOpenToApprovedGuest)}
        // B319: the notification mail's own request, so the page can put it
        // in front of the owner rather than leave them to find it in a list.
        highlightId={typeof highlight === "string" ? highlight : undefined}
        // B360: a server with no postcard provider cannot act on a postal
        // address, so the form stops asking for one — `lib/capabilities.ts`
        // decides, same as everywhere else this reads.
        postcardsEnabled={isEnabled("postcards", username)}
        pushEnabled={pushOn}
        // B376: same reasoning, for the phone hint's own mention of WhatsApp.
        whatsappEnabled={isEnabled("whatsapp", username)}
        // B385: default a new guest's dialling code to the operator's own
        // fallback for a national number, when there is one.
        defaultCountryCode={whatsappCountryCode()}
        // B399: same server-ceiling-and-journal-opt-in check as everywhere
        // else this capability is read.
        addressLookupEnabled={isEnabled("addressLookup", username)}
        // B621. Their own details, first on the page — and the offer to make
        // the row when there is none, which is the state every journal
        // written before that ticket is in.
        own={
          ownRow
            ? {
                token: manageTokenFor(username, ownRow.id),
                contact: {
                  name: ownRow.name ?? "",
                  email: ownRow.email,
                  locale: pickLocale(ownRow.locale, user.defaultLocale),
                  status: ownRow.status,
                  wantsEmailDigest: ownRow.wantsEmailDigest,
                  wantsPostcard: ownRow.wantsPostcard,
                  wantsWhatsapp: ownRow.wantsWhatsapp,
                  address: ownRow.postalAddress ?? EMPTY_ADDRESS,
                },
              }
            : undefined
        }
        canAddOwn={!ownRow && Boolean(user.owner.email)}
      />
    </StudioPage>
  );
}
