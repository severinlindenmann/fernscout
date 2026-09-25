import type { ContactRelationship } from "@/lib/contacts/relationships";
import type { TranslationKey } from "@/lib/i18n";
import type { Locale } from "@/lib/types";

/** The readers page's shared vocabulary — split out of `ContactsAdmin.tsx`
 * by B2133 so each section component reads the same types and words. */

type AdminAddress = {
  name: string;
  line1: string;
  line2: string;
  postcode: string;
  city: string;
  country: string;
  tel: string;
};

export type AdminContact = {
  id: string;
  name: string | null;
  email: string;
  locale: Locale | null;
  status: "pending" | "active" | "blocked";
  wantsEmailDigest: boolean;
  wantsPostcard: boolean;
  wantsWhatsapp: boolean;
  postalAddress: AdminAddress | null;
  /**
   * How many devices this reader has subscribed to notifications — B453.
   *
   * `null` where the journal has push off, which is not the same as zero and
   * must not read as it: nothing is missing from a card that never offered the
   * channel. A number is a fact the owner can act on; `null` means say nothing.
   *
   * It is not a consent and cannot be edited here. A subscription is made by
   * the reader's own browser, on one device, behind a permission prompt — see
   * the note under the tick boxes in `GuestForm`.
   */
  pushDevices: number | null;
  createdVia: string | null;
  createdAt: string;
  confirmedAt: string | null;
  lastSeenAt: string | null;
  /** Owner, buddy (per trip) and guest — derived server-side from the same
   * checks the gates ask, never stored. See `relationshipsFor` — B630. */
  relationship: ContactRelationship;
  /**
   * Trip titles this contact has asked to join and nobody has granted yet —
   * B1301. Not the same list as `relationship.buddyOf`, which only ever
   * names a *live* place: this is what `pendingTripRequestsFor` still finds
   * with `granted_at: null`, and it is the one thing that can be true of an
   * already-`active` contact, when a later buddy link named a trip the
   * earlier approval never covered. Optional so a fixture built before this
   * existed still satisfies the type.
   */
  pendingTrips?: string[];
  /** B2291 — the mobile number as typed, when there is one. Optional so a
   * fixture built before the rebuild still satisfies the type. */
  phone?: string | null;
  /** B2294 — when an SMS code proved that number: a request whose number is
   * proved is the owner's to answer, like a confirmed address. */
  phoneProvenAt?: string | null;
  /** B2292 — the last channel the owner told them on, and when. */
  invitedVia?: string | null;
  invitedAt?: string | null;
  /** B2292 — when their welcome link was first opened. */
  welcomeOpenedAt?: string | null;
};

/**
 * One issued link, as the owner has to be able to read it — B97.
 *
 * `kind`, `tripId` and `expiresAt` were on `Invite` in the database and were
 * dropped by this type on the way to the screen, so a guest link and a buddy
 * link — neither of which carries a name or a language when it is issued from
 * the access panel, which is how they are normally issued — rendered as the
 * same row: `— · — · used 0 times`. One of them leads to somebody writing to a
 * trip, and this list is the only place either can be revoked.
 */
export type AdminInvite = {
  id: string;
  /** What the link leads to. `personal` and `guest` end at reading; only
   * `buddy` ends at write access to a trip. */
  kind: "personal" | "guest" | "buddy";
  /** The trip a `buddy` link joins. Null for every other kind. */
  tripId: string | null;
  name: string | null;
  locale: Locale | null;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  uses: number;
  /**
   * The link itself, for a row whose owner can still send it — B280.
   *
   * Null for a link issued before invite tokens were recoverable, one issued
   * while `CONTACTS_ENCRYPTION_KEY` was unset, and one that is revoked or
   * expired. Null means *no copy control*, not an empty one: a link that
   * cannot be sent again is the behaviour every link had until B280, and a
   * dead button explaining that is worse than no button.
   */
  url: string | null;
  /** B2293 — the short `/j/<code>` for the same link, shown and copied in
   * place of `url`. Null where it cannot be shown again (no contacts key). */
  joinUrl?: string | null;
  /** Still works: not stopped, not expired — decided on the server, where
   * the clock is (B2291). */
  live?: boolean;
};

/**
 * What each kind of link leads to, in the words the access panel already uses.
 *
 * `me.inviteGuestTitle` and `me.inviteBuddyTitle` are the strings the owner
 * read on the panel where they issued the link (B79). Reusing them rather than
 * writing a second vocabulary for the same two things is the point: an owner
 * who sent the wrong one is looking for the words they were shown when they
 * sent it.
 */
const INVITE_KIND_KEY: Record<AdminInvite["kind"], TranslationKey> = {
  personal: "contact.adminInvitePersonalTitle",
  guest: "me.inviteGuestTitle",
  buddy: "me.inviteBuddyTitle",
};

/**
 * A trip as the owner named it, rather than as the URL spells it — B321.
 *
 * Both lists on this page identify a trip, and both had only its id to hand:
 * the invite row printed `asien-2025` and the contact row printed nothing at
 * all. The titles are already a prop on this component, because the form that
 * makes a buddy link offers them in a dropdown — so the owner picks a trip by
 * title and is then shown the id everywhere afterwards.
 *
 * Falls back to the id, which is right rather than merely safe: a trip deleted
 * or renamed since the link was issued has no title to find, and the id is
 * still what the invite is bound to.
 */
export function tripLabel(trips: { id: string; title: string }[], id: string): string {
  return trips.find((trip) => trip.id === id)?.title ?? id;
}

/**
 * How somebody came to be on this list, in words — B321.
 *
 * `createdVia` is provenance the database keeps for the code's benefit:
 * `invite:<id>` | `open` | `owner` (lib/db/schema.ts). The row printed it
 * verbatim, so the owner's answer to "came via" was a UUID — the same UUID for
 * everybody who used one link, which made three people from one family link
 * look like three unrelated strings.
 *
 * The useful half is what the *link* was, and for a buddy link **which trip**:
 * that is the difference between somebody who reads the journal and somebody
 * who may write days into a named trip, and it is the most important fact
 * about a contact row. The vocabulary is the invite list's own
 * (`INVITE_KIND_KEY`), for the reason that table gives — an owner looking at a
 * row wants the words they were shown when they sent the link.
 *
 * A link that is not in the list still renders a sentence rather than falling
 * back to the id. `listInvites` returns every row the owner has, revoked and
 * expired included, so this is the rare case rather than the common one; when
 * it happens, "an invite link" is true and a UUID is not more informative.
 */
export function viaLabel(
  createdVia: string | null,
  invites: AdminInvite[],
  trips: { id: string; title: string }[],
  t: Translate,
): string | null {
  if (!createdVia) return null;
  if (createdVia === "owner") return t("contact.adminViaOwner");
  // B621 — the owner's own row, made by the button on this page. It is
  // filtered out of the lists below, so this only shows on a row written
  // before that filter or read some other way; a raw `owner-self` on screen
  // would be a code where a sentence belongs.
  if (createdVia === "owner-self") return t("contact.adminViaSelf");
  // B37 removed the open guestbook. Rows written before it still say this, and
  // will forever.
  if (createdVia === "open") return t("contact.adminViaOpen");
  // B601 — they were already signed in, met a trip they may not read, and
  // pressed the button on the gate. Not an invite this owner ever issued,
  // which is exactly what the row has to say.
  if (createdVia === "asked") return t("contact.adminViaAsked");
  // B2092 — the rest of the vocabulary `created_via` holds, each as the
  // sentence the owner would say; anything newer than this list is left
  // unsaid rather than printed as the code it is.
  if (createdVia === "owner-import") return t("contact.adminViaImport");
  if (createdVia === "owner-grant") return t("contact.adminViaGrant");
  if (createdVia === "self:traveller") return t("contact.adminViaTraveller");
  if (!createdVia.startsWith("invite:")) return null;

  const invite = invites.find(
    (candidate) => candidate.id === createdVia.slice("invite:".length),
  );
  if (!invite) return t("contact.adminViaInvite");
  const kind = t(INVITE_KIND_KEY[invite.kind]);
  return invite.kind === "buddy" && invite.tripId
    ? `${kind} · ${t("contact.adminInviteTrip", { trip: tripLabel(trips, invite.tripId) })}`
    : kind;
}

export type Translate = (key: TranslationKey, vars?: Record<string, string>) => string;
/** The same, for a string that has a `<key>.one` beside it. */
export type Count = (
  key: TranslationKey,
  count: number,
  vars?: Record<string, string>,
) => string;


/**
 * "Invited — not opened yet" (B2291): somebody the owner added (or invited
 * from an import) who has not opened their welcome link or been seen since —
 * plus the rows a link filed that never proved anything. Everything else
 * `readingNow` holds is "Reading along".
 */
export function notOpenedYet(contact: AdminContact): boolean {
  return (
    contact.status === "active" &&
    (contact.createdVia === "owner" || contact.createdVia === "owner-import") &&
    !contact.welcomeOpenedAt &&
    !contact.lastSeenAt
  );
}
