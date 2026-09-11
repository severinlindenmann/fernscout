"use client";

import { useEffect, useRef, useState } from "react";
import BusyButton from "@/components/BusyButton";
import { useRouter } from "next/navigation";
import { BellRing, Mail, MessageCircle, Stamp } from "lucide-react";
import AddressLookupField from "./AddressLookupField";
import ContactManage, { type ManageContact } from "./ContactManage";
import CopyLine from "./CopyLine";
import CountryField from "./CountryField";
import TelField, { joinTel, splitTel } from "./TelField";
import { countryName, resolveCountry } from "@/lib/countries";
import type { ContactRelationship } from "@/lib/contacts/relationships";
import {
  LOCALE_LABEL,
  plural,
  telHintKey,
  translate,
  type TranslationKey,
} from "@/lib/i18n";
import type { Locale } from "@/lib/types";
import { isMessageable } from "@/lib/whatsapp/phone";

/**
 * Who is waiting, who is in, and when they last looked (C6).
 *
 * Boring on purpose, and used constantly. Everything the owner has to decide is
 * on one screen: how somebody arrived, which language they read in, what they
 * asked for, and — because they will be writing it on an envelope — where they
 * live. Approve, revoke, delete, and the two link shapes to hand out.
 *
 * The data arrives already fetched from the server component above, which did
 * the owner check. Every button goes back through `/api/contacts/admin`, which
 * does it again: a page that renders is not an authorisation.
 */

// The same field classes `ContactForm.tsx` uses, so the owner's own guest form
// looks like the one their guests fill in rather than like a different corner
// of the admin.
const FIELD =
  "mt-2 w-full rounded-xl border border-navy-200 bg-white px-4 py-3 text-lg text-navy-900";
const LABEL = "block text-base font-medium text-navy-700";

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
function tripLabel(trips: { id: string; title: string }[], id: string): string {
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
function viaLabel(
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
  if (!createdVia.startsWith("invite:")) return createdVia;

  const invite = invites.find(
    (candidate) => candidate.id === createdVia.slice("invite:".length),
  );
  if (!invite) return t("contact.adminViaInvite");
  const kind = t(INVITE_KIND_KEY[invite.kind]);
  return invite.kind === "buddy" && invite.tripId
    ? `${kind} · ${t("contact.adminInviteTrip", { trip: tripLabel(trips, invite.tripId) })}`
    : kind;
}

/**
 * Whether a still-unconfirmed row has a live invite behind it to resend —
 * B384. `viaLabel` above already does the same `invite:<id>` lookup, for a
 * sentence rather than an aliveness check; kept separate because the two
 * callers want different things out of one row and neither is a special case
 * of the other.
 */
function resendableInvite(
  createdVia: string | null,
  invites: AdminInvite[],
): AdminInvite | null {
  if (!createdVia?.startsWith("invite:")) return null;
  const invite = invites.find(
    (candidate) => candidate.id === createdVia.slice("invite:".length),
  );
  if (!invite || invite.revokedAt) return null;
  if (invite.expiresAt && new Date(invite.expiresAt).getTime() < Date.now())
    return null;
  return invite;
}

const STATUS_KEY: Record<AdminContact["status"], TranslationKey> = {
  pending: "contact.statusPending",
  active: "contact.statusActive",
  blocked: "contact.statusBlocked",
};

/** What `create` and `update` can answer with — six entries, four carrying
 * owner-facing copy. `needEmail` and `needAddress` are shared with the public
 * form verbatim — neither reads as talking to the wrong person. `invalid_name`'s
 * public wording ("write your name") does, so it gets its own owner-facing copy
 * instead, alongside the three errors only this form can produce:
 * `blocked_contact` (an address the owner shown the door), `email_taken` (the
 * address already belongs to a different contact on the list) and
 * `contact_exists` (`create` refusing to rewrite somebody already on the
 * list). */
const ERROR_KEY: Record<string, TranslationKey> = {
  invalid_name: "contact.adminNeedName",
  invalid_email: "contact.needEmail",
  invalid_address: "contact.needAddress",
  blocked_contact: "contact.adminBlockedContact",
  email_taken: "contact.adminEmailTaken",
  contact_exists: "contact.adminContactExists",
};

type Translate = (key: TranslationKey, vars?: Record<string, string>) => string;
/** The same, for a string that has a `<key>.one` beside it. */
type Count = (
  key: TranslationKey,
  count: number,
  vars?: Record<string, string>,
) => string;

/**
 * The props `GuestForm` needs beyond the contact it is editing — B1094.
 *
 * Bundled so a row can be handed everything the form needs in one prop
 * rather than threading eight of them individually through `ContactGroup`
 * and `ContactRow`, which otherwise carry them only to pass them on.
 */
type GuestFormEnv = {
  fallbackLocale: Locale;
  locales: string[];
  username: string;
  t: Translate;
  busy: boolean;
  act: (body: Record<string, unknown>) => Promise<Response | null>;
  postcardsEnabled: boolean;
  pushEnabled: boolean;
  whatsappEnabled: boolean;
  defaultCountryCode?: string;
  addressLookupEnabled: boolean;
  onClose: () => void;
};

/**
 * One channel this reader is on — B453.
 *
 * A chip rather than a line of the list, and two words rather than the
 * sentence. The sentences live in the tick boxes, where each one is a consent
 * being given and reads as one; here they were three of them joined with a
 * dot, which turned the most scannable fact about a person — how they hear
 * from this journal — into the least scannable thing on the card.
 *
 * Only what somebody actually asked for is shown. A row of greyed-out chips
 * for the channels they declined would say the same thing in colour alone,
 * which is not something everyone can read.
 */
function Channel({ icon: Icon, label }: { icon: typeof Mail; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-navy-200 bg-cream-100 px-2.5 py-1 text-sm text-navy-900">
      <Icon className="h-3.5 w-3.5 text-navy-600" aria-hidden />
      {label}
    </span>
  );
}

/** One person. Declared at module scope rather than inside the page component:
 * a component created during render is a new type on every keystroke, and
 * React throws away its state each time. */
function ContactRow({
  contact,
  via,
  canResend = false,
  t,
  tn,
  busy,
  act,
  onEdit,
  onApprove,
  highlighted = false,
  locale,
  locales,
  defaultCountryCode,
  approvedTrips,
  editing = false,
  guestFormEnv,
}: {
  contact: AdminContact;
  /** How they came to be here, already in words — see `viaLabel`. Resolved by
   * the caller, which is where the invite list and the trip titles are. */
  via: string | null;
  /** For the device count, which is the one number on this card. */
  tn: Count;
  /** Whether an invitation this contact hasn't opened yet can be mailed
   * again — B384. Only ever true for a `pending`, unconfirmed row; false for
   * anything else, including the ordinary case of nothing to resend. */
  canResend?: boolean;
  t: Translate;
  busy: boolean;
  act: (body: Record<string, unknown>) => void;
  onEdit: (contact: AdminContact) => void;
  /** B244 — Approve is the one button here that has something to report
   * back, so it goes through its own handler instead of the fire-and-forget
   * `act` every other button uses. */
  onApprove: (contact: AdminContact) => void;
  /** The admin's own locale — B402: what `postal.country` is named in, the
   * same way `CountryField` names it in the form's own locale. */
  locale: Locale;
  /** The journal's own languages, for `resolveCountry` — a legacy row may
   * have been typed in any of them. */
  locales: string[];
  /** This is the request the owner's approval mail was about — B319. Not a
   * different state, only a ring round an ordinary row: the button, the
   * data, everything else about it is identical to any other pending
   * contact. */
  highlighted?: boolean;
  /** B385/B389: `whatsappCountryCode()` — the operator's own configured
   * fallback for a national number. Used to tell whether the number on this
   * row is currently messageable at all. */
  defaultCountryCode?: string;
  /**
   * B244 — what the last approve click on *this* contact opened, kept in the
   * parent rather than here: a successful approve moves the row from the
   * pending group to the approved one, which is a different `<ContactGroup>`
   * subtree and would unmount a note held in this component's own state
   * before anybody read it. `undefined` means nobody has just pressed
   * Approve; `[]` is a real answer — "opened nothing" — and must not read as
   * that same "nothing to say" case.
   */
  approvedTrips?: string[];
  /**
   * Whether this is the row the owner pressed Edit on — B1094. `GuestForm`
   * used to render once, above every group, regardless of which row's edit
   * button opened it — which put the form off-screen for anything but the
   * first few contacts. Rendering it in the card being edited removes the
   * distance instead of compensating for it, the way `EditDay` sits under
   * the day it corrects (B980).
   */
  editing?: boolean;
  /** Everything `GuestForm` needs beyond the contact — present exactly when
   * `editing` is, so a row that is not being edited pays nothing for it. */
  guestFormEnv?: GuestFormEnv;
}) {
  // Owner-facing copy, not the guest form's first-person "Send me…" — this
  // list is read by the owner, about somebody else.
  const channels = [
    contact.wantsEmailDigest
      ? { icon: Mail, label: t("contact.adminChannelEmail") }
      : null,
    contact.wantsPostcard
      ? { icon: Stamp, label: t("contact.adminChannelPostcard") }
      : null,
    contact.wantsWhatsapp
      ? { icon: MessageCircle, label: t("contact.adminChannelWhatsapp") }
      : null,
  ].filter((channel) => channel !== null);

  const postal = contact.postalAddress;

  // B1301 — an already-`active` contact whose later buddy link named a trip
  // the earlier approval never covered. `relationship.buddyOf` only lists a
  // *live* place, so this is the one thing that still needs a decision from
  // a row that otherwise reads as fully settled.
  const pendingTrips = contact.status === "active" ? (contact.pendingTrips ?? []) : [];

  // B630 — what this person actually is to the journal, said in words rather
  // than left for the owner to work out from a status and a "via" line. More
  // than one can be true at once, and each is said rather than one winning.
  const tags: string[] = [];
  if (contact.relationship.owner) tags.push(t("contact.relationOwner"));
  if (contact.relationship.buddyOf.length === 1) {
    tags.push(
      t("contact.relationBuddyOne", {
        trip: contact.relationship.buddyOf[0].title,
      }),
    );
  } else if (contact.relationship.buddyOf.length > 1) {
    tags.push(
      t("contact.relationBuddyCount", {
        count: String(contact.relationship.buddyOf.length),
      }),
    );
  }
  if (contact.relationship.guest) tags.push(t("contact.relationGuest"));

  return (
    <li
      id={`contact-${contact.id}`}
      className={`rounded-2xl border bg-white p-5 ${
        highlighted
          ? "border-yellow-400 ring-2 ring-yellow-400"
          : "border-navy-200"
      }`}
    >
      <p className="font-display text-xl text-navy-900">
        {contact.name ?? contact.email}
      </p>
      <p className="text-base text-navy-700">{contact.email}</p>
      {tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {tags.map((label) => (
            <span
              key={label}
              className="inline-flex items-center rounded-full border border-navy-200 bg-cream-100 px-2.5 py-1 text-sm text-navy-900"
            >
              {label}
            </span>
          ))}
        </div>
      )}
      {/* What this person hears from, before anything about them. It is the
          question the owner opens this page with — B453. */}
      {channels.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {channels.map((channel) => (
            <Channel
              icon={channel.icon}
              label={channel.label}
              key={channel.label}
            />
          ))}
        </div>
      )}
      {/* Labels in the quiet grey, values in the ink. One weight for both is
          what made this a wall: everything on the card asked for the same
          amount of attention, so none of it got any. `navy-500` is a
          border-and-label token — see apply-the-brand — and the values it
          labels are `navy-900`. */}
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm text-navy-900">
        <dt className="text-navy-500">{t("contact.language")}</dt>
        <dd>{contact.locale ? LOCALE_LABEL[contact.locale] : "—"}</dd>
        <dt className="text-navy-500">{t("contact.adminVia")}</dt>
        <dd>{via ?? "—"}</dd>
        <dt className="text-navy-500">{t("contact.adminLastSeen")}</dt>
        <dd>{contact.lastSeenAt?.slice(0, 10) ?? t("contact.adminNever")}</dd>
        <dt className="text-navy-500">{t(STATUS_KEY[contact.status])}</dt>
        <dd>{contact.confirmedAt?.slice(0, 10) ?? "—"}</dd>
        {/* The fourth channel, and the only one that is state rather than
            consent — B453. Absent, not zero, where this journal has push off:
            `null` means the channel was never offered here. */}
        {contact.pushDevices !== null && (
          <>
            <dt className="text-navy-500">{t("contact.adminPush")}</dt>
            <dd
              className={
                contact.pushDevices === 0 ? "text-navy-500" : undefined
              }
            >
              {contact.pushDevices === 0
                ? t("contact.adminPushNone")
                : tn("contact.adminPushDevices", contact.pushDevices, {
                    count: String(contact.pushDevices),
                  })}
            </dd>
          </>
        )}
        {postal && (
          <>
            {/* B383 — this row is the owner's own address book, not a
                postcard destination: the tick above is the postcard
                consent, this is the address on file whether or not one was
                ever asked for. Reuses `contact.address` rather than the
                postcard-specific label. */}
            <dt>{t("contact.address")}</dt>
            <dd>
              {[
                postal.name,
                postal.line1,
                postal.line2,
                `${postal.postcode} ${postal.city}`.trim(),
                // B398 stores an ISO2 code once a row is saved through the
                // picker; named back out in the admin's own locale the same
                // way CountryField does. A legacy row resolveCountry can't
                // place (or an ISO2 Intl.DisplayNames won't name) shows
                // exactly the string on disk — never a blank.
                (() => {
                  const iso2 = resolveCountry(postal.country, locales);
                  return iso2 ? countryName(iso2, locale) : postal.country;
                })(),
              ]
                .filter((line) => line !== "")
                .join(", ")}
            </dd>
          </>
        )}
        {postal?.tel && (
          <>
            <dt>{t("contact.tel")}</dt>
            <dd>
              {postal.tel}
              {/* B389 — a number `toE164` cannot parse (no `+`, no configured
                  default country) is silently skipped by the WhatsApp send
                  loop; say so here rather than let it read like every other
                  number on the page. */}
              {!isMessageable(postal.tel, defaultCountryCode) && (
                <span className="ml-2 text-navy-500">
                  {t("contact.telNotMessageable")}
                </span>
              )}
            </dd>
          </>
        )}
      </dl>
      {canResend && (
        // Said before the click, honestly — B384's own acceptance line. This
        // is the only state that used to be a dead end: `confirmedAt` is
        // null, so the Approve button below never appears, and Edit/Delete
        // were the only thing left to press.
        <p className="mt-3 text-base text-navy-600">
          {t("contact.adminInvitePending")}
        </p>
      )}
      {pendingTrips.length > 0 && (
        // B1301 — the whole reason this note exists: an already-active
        // contact is otherwise indistinguishable from one with nothing
        // waiting on them, and the Approve button below is what a
        // pending-but-unconfirmed row shows instead.
        <p className="mt-3 text-base text-navy-600">
          {pendingTrips.length === 1
            ? t("contact.adminPendingTripOne", { trip: pendingTrips[0] })
            : t("contact.adminPendingTripCount", { trips: pendingTrips.join(", ") })}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {canResend && (
          <BusyButton
            busy={busy}
            type="button"
            onClick={() => act({ action: "resend", id: contact.id })}
            className="rounded-xl border border-navy-200 px-4 py-2 text-base text-navy-900 disabled:opacity-50"
          >
            {t("contact.adminResendInvite")}
          </BusyButton>
        )}
        {((contact.status !== "active" && contact.confirmedAt) || pendingTrips.length > 0) && (
          <BusyButton
            busy={busy}
            type="button"
            onClick={() => onApprove(contact)}
            className="rounded-xl bg-navy-900 px-4 py-2 text-base text-cream-50 disabled:opacity-50"
          >
            {t("contact.adminApprove")}
          </BusyButton>
        )}
        {/* B244 — the strongest thing this click does, said rather than left
            for the owner to infer from the row changing colour. Absent
            unless this contact was just approved this page-load; `[]` still
            renders, with its own "opened nothing" sentence, rather than
            silently saying nothing at all. */}
        {approvedTrips && (
          <p className="mt-2 w-full text-base text-navy-700">
            {approvedTrips.length === 0
              ? t("contact.adminApprovedNoTrip")
              : t("contact.adminApprovedTrips", {
                  trips: approvedTrips.join(", "),
                })}
          </p>
        )}
        {contact.status === "active" && (
          <BusyButton
            busy={busy}
            type="button"
            onClick={() => act({ action: "revoke", id: contact.id })}
            className="rounded-xl border border-navy-200 px-4 py-2 text-base text-navy-900 disabled:opacity-50"
          >
            {t("contact.adminRevoke")}
          </BusyButton>
        )}
        <BusyButton
          busy={busy}
          type="button"
          onClick={() => onEdit(contact)}
          className="rounded-xl border border-navy-200 px-4 py-2 text-base text-navy-900 disabled:opacity-50"
        >
          {t("contact.adminEdit")}
        </BusyButton>
        <BusyButton
          busy={busy}
          type="button"
          onClick={() => act({ action: "delete", id: contact.id })}
          className="rounded-xl border border-coral-400 px-4 py-2 text-base text-coral-600 disabled:opacity-50"
        >
          {t("contact.adminDelete")}
        </BusyButton>
      </div>
      {/* B1094 — the edit form for this exact row, in place, rather than off
          the top of the page. `key`ed on the contact id so switching from one
          row's edit button to another's remounts rather than patching stale
          field values from whoever was being edited before. */}
      {editing && guestFormEnv && (
        <GuestForm
          key={contact.id}
          contact={contact}
          fallbackLocale={guestFormEnv.fallbackLocale}
          locales={guestFormEnv.locales}
          username={guestFormEnv.username}
          t={guestFormEnv.t}
          busy={guestFormEnv.busy}
          act={guestFormEnv.act}
          onClose={guestFormEnv.onClose}
          postcardsEnabled={guestFormEnv.postcardsEnabled}
          pushEnabled={guestFormEnv.pushEnabled}
          whatsappEnabled={guestFormEnv.whatsappEnabled}
          defaultCountryCode={guestFormEnv.defaultCountryCode}
          addressLookupEnabled={guestFormEnv.addressLookupEnabled}
        />
      )}
    </li>
  );
}

/** The fields the owner's own guest form holds — name, contact details, an
 * address, and the two consent checkboxes. Declared at module scope like
 * `ContactRow` above it, for the same reason. */
type GuestFields = {
  name: string;
  email: string;
  locale: string;
  /** The dialling code, held apart from `tel` for the same reason
   * `ContactForm` keeps its own `cc` state (B385): re-parsing it from `tel`
   * on every render would lose the selection the moment the digits are
   * cleared. */
  cc: string;
  tel: string;
  addressName: string;
  line1: string;
  line2: string;
  postcode: string;
  city: string;
  country: string;
  wantsEmailDigest: boolean;
  wantsPostcard: boolean;
  wantsWhatsapp: boolean;
};

function fieldsFor(
  contact: AdminContact | null,
  fallbackLocale: Locale,
  defaultCountryCode?: string,
): GuestFields {
  const postal = contact?.postalAddress;
  const tel = postal?.tel ?? "";
  // Reading an existing row back into the form: a leading `+<cc>` this
  // picker recognises splits into the two parts, and anything else — a
  // legacy `076 000 00 00`, or no record at all — is never guessed at.
  // `defaultCountryCode` only seeds a *brand-new* guest's blank number,
  // never a contact's actual (if unparseable) one — B385.
  const parsed = splitTel(tel);
  return {
    name: contact?.name ?? "",
    email: contact?.email ?? "",
    locale: contact?.locale ?? fallbackLocale,
    cc:
      parsed.cc ||
      (contact === null && tel.trim() === "" ? (defaultCountryCode ?? "") : ""),
    tel: parsed.national,
    addressName: postal?.name ?? "",
    line1: postal?.line1 ?? "",
    line2: postal?.line2 ?? "",
    postcode: postal?.postcode ?? "",
    city: postal?.city ?? "",
    country: postal?.country ?? "",
    wantsEmailDigest: contact?.wantsEmailDigest ?? false,
    wantsPostcard: contact?.wantsPostcard ?? false,
    wantsWhatsapp: contact?.wantsWhatsapp ?? false,
  };
}

/**
 * The owner's own entry into the guest list (W37) — the create-a-contact form
 * this journal never had before now. The *address block*'s labels are lifted
 * from `ContactForm.tsx` rather than re-worded: they are person-neutral
 * ("Postal address", "Postcode"), and giving the two forms separate copies of
 * the same label is how they drift apart (the visibility vocabulary did
 * exactly that in W27). Name, email and language are the opposite case —
 * `ContactForm.tsx`'s copy for them ("Your name", "Write to me in") is
 * first-person, written for the guest filling in their own form, and reads as
 * asking the owner for their *own* details when it is the owner typing on
 * somebody else's behalf (B1281) — so those three, and the two consent
 * checkboxes and the address hint, get their own `contact.admin*` keys
 * instead of reuse.
 *
 * One instance of this form exists on the page at a time — opened either by
 * the "Add a guest" toggle above the pending group, or by a row's own Edit
 * button, which since B1094 renders the form in that row rather than here:
 * switching targets has to reset every field, not patch over what the
 * previous target left behind, which is why each is `key`ed on the contact
 * being edited (or, above the pending group, mounts only for "new").
 *
 * No field here can *choose* `status` — that is `updateContactByOwner`'s
 * rule. Changing the email of an already-active contact still moves it back
 * to `pending` and clears its grants, same as `revokeContact`; that is not an
 * escalation this form could cause, only the one de-escalation the address
 * change makes necessary.
 */
// Exported only so a test can render the owner's guest form directly —
// `formTarget` is client-side state with no prop to open it, and this suite
// has no DOM environment to click the toggle that would. Not part of the
// module's public surface otherwise.
export function GuestForm({
  contact,
  fallbackLocale,
  locales,
  username,
  t,
  busy,
  act,
  onClose,
  postcardsEnabled = true,
  pushEnabled = false,
  whatsappEnabled = true,
  defaultCountryCode,
  addressLookupEnabled = false,
}: {
  /** The row being corrected, or `null` to add a new one. */
  contact: AdminContact | null;
  fallbackLocale: Locale;
  locales: string[];
  /** For the address lookup proxy's own capability check — B399. Every
   * other caller in this form already has `username` in scope; this is the
   * one prop `GuestForm` did not need until now. */
  username: string;
  t: Translate;
  busy: boolean;
  act: (body: Record<string, unknown>) => Promise<Response | null>;
  onClose: () => void;
  /** B360, narrowed by B383: gates only the postcard *consent* checkbox now
   * — absent, not merely explained, when this server cannot send a postcard
   * (`lib/capabilities.ts` decides). The address fieldset itself stays up
   * regardless: this is the owner's own address book, and the route stores
   * whatever is typed here whether or not a postcard was ever asked for.
   * Defaults to shown, so the one existing caller in
   * `test/contact-tel-hint.test.tsx` (which predates this capability check)
   * keeps rendering the checkbox it asserts against. */
  postcardsEnabled?: boolean;
  /** Whether this journal offers notifications at all. Off, the note below the
   * tick boxes describes a channel that does not exist here. */
  pushEnabled?: boolean;
  /** B376: whether this server can act on a WhatsApp update at all —
   * `isEnabled("whatsapp", username)`. Changes the phone hint's wording, and
   * — since B378 — gates the checkbox itself: offering it on a journal where
   * nothing will ever send there tells the owner something untrue. A row
   * that already carries `wantsWhatsapp: true` from before the switch was
   * turned off keeps it — this hides what is offered, not what is stored. */
  whatsappEnabled?: boolean;
  /** B385: `whatsappCountryCode()`, seeding only a brand-new guest's blank
   * dialling code — see `fieldsFor`. */
  defaultCountryCode?: string;
  /** B399: `isEnabled("addressLookup", username)`, from the page. */
  addressLookupEnabled?: boolean;
}) {
  const editingId = contact?.id ?? null;
  const [form, setForm] = useState<GuestFields>(() =>
    fieldsFor(contact, fallbackLocale, defaultCountryCode),
  );
  const [error, setError] = useState<string | null>(null);
  const nameFieldRef = useRef<HTMLInputElement>(null);

  // B1094 — focus lands inside the form the moment it opens, whichever
  // button opened it. Rendering the form in place (rather than off-screen
  // above the button, which is what B1094 fixed) already puts it on screen;
  // this is what tells a screen-reader user something happened, and — for
  // the row furthest down a long list — is what scrolls it into view at all.
  useEffect(() => {
    nameFieldRef.current?.focus();
  }, []);

  // Changing the email of an already-active contact knocks them back to
  // `pending` and drops their access grant (`updateContactByOwner`,
  // deliberately) — correct, but silent otherwise. Warned here rather than
  // discovered afterwards.
  const emailChanged =
    contact?.status === "active" &&
    form.email.trim().toLowerCase() !== contact.email.trim().toLowerCase();

  function field<K extends keyof GuestFields>(key: K, value: GuestFields[K]) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const response = await act({
      action: editingId ? "update" : "create",
      ...(editingId ? { id: editingId } : {}),
      name: form.name,
      email: form.email,
      locale: form.locale,
      wantsEmailDigest: form.wantsEmailDigest,
      wantsPostcard: form.wantsPostcard,
      wantsWhatsapp: form.wantsWhatsapp,
      address: {
        name: form.addressName,
        line1: form.line1,
        line2: form.line2,
        postcode: form.postcode,
        city: form.city,
        country: form.country,
        tel: joinTel(form.cc, form.tel),
      },
    });
    if (!response?.ok) {
      const body = (await response?.json().catch(() => null)) as {
        error?: string;
      } | null;
      // `ERROR_KEY` above: two shared with the public form, four owner-only.
      setError(body?.error ?? "unknown");
      return;
    }
    setError(null);
    onClose();
  }

  return (
    <form
      onSubmit={submit}
      className="mt-4 rounded-2xl border border-navy-200 bg-cream-100 p-5"
    >
      <p className="font-display text-xl text-navy-900">
        {t(editingId ? "contact.adminEditGuest" : "contact.adminAddGuest")}
      </p>

      <div className="mt-4">
        <label className={LABEL} htmlFor="guest-name">
          {t("contact.adminGuestName")}
        </label>
        <input
          id="guest-name"
          ref={nameFieldRef}
          className={FIELD}
          value={form.name}
          onChange={(e) => field("name", e.target.value)}
        />
      </div>

      <div className="mt-4">
        <label className={LABEL} htmlFor="guest-email">
          {t("contact.adminGuestEmail")}
        </label>
        <input
          id="guest-email"
          className={FIELD}
          type="email"
          inputMode="email"
          value={form.email}
          onChange={(e) => field("email", e.target.value)}
        />
        {emailChanged && (
          <p className="mt-2 text-base text-coral-600">
            {t("contact.adminEmailChangeWarning")}
          </p>
        )}
      </div>

      <div className="mt-4">
        <label className={LABEL} htmlFor="guest-locale">
          {t("contact.adminGuestLanguage")}
        </label>
        <select
          id="guest-locale"
          className={FIELD}
          value={form.locale}
          onChange={(e) => field("locale", e.target.value)}
        >
          {locales.map((option: string) => (
            <option key={option} value={option}>
              {LOCALE_LABEL[option]}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-4">
        <label className={LABEL} htmlFor="guest-tel">
          {`${t("contact.tel")} (${t("contact.optional")})`}
        </label>
        <TelField
          id="guest-tel"
          cc={form.cc}
          national={form.tel}
          onChange={(cc, national) =>
            setForm((previous) => ({ ...previous, cc, tel: national }))
          }
          labelCountry={t("contact.telCountry")}
          searchPlaceholder={t("contact.telSearchPlaceholder")}
          noMatches={t("contact.telNoMatches")}
          locale={form.locale}
        />
        <p className="mt-2 text-base text-navy-600">
          {t(telHintKey("admin", postcardsEnabled, whatsappEnabled))}
        </p>
      </div>

      {/* B383 — the address book is the owner's own, not the postal
          system's: unlike ContactForm's reader-facing gate, this fieldset
          stays up whether or not a print provider is configured, because the
          route already stores whatever is typed here regardless (see
          app/api/contacts/admin/route.ts's "create" case). Only the postcard
          *consent* checkbox below stays behind `postcardsEnabled`. */}
      <fieldset className="mt-6 rounded-2xl border border-navy-200 bg-white p-5">
        <legend className="px-2 font-display text-lg text-navy-900">
          {t("contact.address")}
        </legend>
        <p className="text-base text-navy-700">
          {t(
            postcardsEnabled
              ? "contact.adminAddressHint"
              : "contact.adminAddressHintNoPostcards",
          )}
        </p>

        <div className="mt-4">
          <label className={LABEL} htmlFor="guest-addr-name">
            {t("contact.addrName")}
          </label>
          <input
            id="guest-addr-name"
            className={FIELD}
            value={form.addressName}
            onChange={(e) => field("addressName", e.target.value)}
          />
        </div>
        <div className="mt-4">
          <label className={LABEL} htmlFor="guest-addr-line1">
            {t("contact.addrLine1")}
          </label>
          <AddressLookupField
            id="guest-addr-line1"
            className={FIELD}
            value={form.line1}
            onChange={(value) => field("line1", value)}
            onPick={(suggestion) =>
              setForm((previous) => ({
                ...previous,
                line1: suggestion.line1,
                postcode: suggestion.postcode,
                city: suggestion.city,
                country: suggestion.country,
              }))
            }
            enabled={addressLookupEnabled}
            username={username}
            locale={form.locale}
            label={t("contact.addrLine1")}
            attribution={t("contact.addressLookupAttribution")}
            unavailable={t("contact.addressLookupUnavailable")}
          />
        </div>
        <div className="mt-4">
          <label className={LABEL} htmlFor="guest-addr-line2">
            {`${t("contact.addrLine2")} (${t("contact.optional")})`}
          </label>
          <input
            id="guest-addr-line2"
            className={FIELD}
            value={form.line2}
            onChange={(e) => field("line2", e.target.value)}
          />
        </div>
        <div className="mt-4 flex gap-4">
          <div className="w-1/3">
            <label className={LABEL} htmlFor="guest-addr-postcode">
              {t("contact.addrPostcode")}
            </label>
            <input
              id="guest-addr-postcode"
              className={FIELD}
              value={form.postcode}
              onChange={(e) => field("postcode", e.target.value)}
            />
          </div>
          <div className="flex-1">
            <label className={LABEL} htmlFor="guest-addr-city">
              {t("contact.addrCity")}
            </label>
            <input
              id="guest-addr-city"
              className={FIELD}
              value={form.city}
              onChange={(e) => field("city", e.target.value)}
            />
          </div>
        </div>
        <div className="mt-4">
          <label className={LABEL} htmlFor="guest-addr-country">
            {t("contact.addrCountry")}
          </label>
          <CountryField
            id="guest-addr-country"
            value={form.country}
            locales={locales}
            onChange={(code) => field("country", code)}
            label={t("contact.addrCountry")}
            searchPlaceholder={t("contact.addrCountrySearchPlaceholder")}
            noMatches={t("contact.addrCountryNoMatches")}
            locale={form.locale}
          />
        </div>
      </fieldset>

      <div className="mt-6 space-y-4">
        <label className="flex items-start gap-3 text-base text-navy-900">
          <input
            type="checkbox"
            className="mt-1 size-5"
            checked={form.wantsEmailDigest}
            onChange={(e) => field("wantsEmailDigest", e.target.checked)}
          />
          <span>{t("contact.adminWantsDigest")}</span>
        </label>
        {postcardsEnabled && (
          <label className="flex items-start gap-3 text-base text-navy-900">
            <input
              type="checkbox"
              className="mt-1 size-5"
              checked={form.wantsPostcard}
              onChange={(e) => field("wantsPostcard", e.target.checked)}
            />
            <span>{t("contact.adminWantsPostcard")}</span>
          </label>
        )}
        {whatsappEnabled && (
          <label className="flex items-start gap-3 text-base text-navy-900">
            <input
              type="checkbox"
              className="mt-1 size-5"
              checked={form.wantsWhatsapp}
              onChange={(e) => field("wantsWhatsapp", e.target.checked)}
            />
            <span>{t("contact.adminWantsWhatsapp")}</span>
          </label>
        )}
        {/*
          The fourth channel, said rather than offered — B453.

          There is no tick box here and there must not be one: a push
          subscription is made by the reader's own browser, on one device,
          behind a permission prompt nobody else can answer. An owner ticking a
          box would be recording a wish that nothing acts on. What they need
          instead is to know the channel exists, that it is the reader's to
          switch on, and the one condition that makes it look broken — an
          iPhone that has not added the site to the Home Screen, where the API
          is simply absent. The card above says whether it worked.
        */}
        {pushEnabled && (
          <p className="rounded-xl bg-cream-100 px-4 py-3 text-sm text-navy-700">
            <span className="font-medium text-navy-900">
              {t("contact.adminPush")}
            </span>{" "}
            {t("contact.adminPushHint")}
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-4 text-base text-coral-600">
          {t(ERROR_KEY[error] ?? "contact.error")}
        </p>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        <BusyButton
          busy={busy}
          type="submit"
          className="rounded-xl bg-navy-900 px-4 py-3 text-base text-cream-50 disabled:opacity-50"
        >
          {t("contact.save")}
        </BusyButton>
        <BusyButton
          busy={busy}
          type="button"
          onClick={onClose}
          className="rounded-xl border border-navy-200 px-4 py-3 text-base text-navy-700 disabled:opacity-50"
        >
          {t("contact.adminGuestCancel")}
        </BusyButton>
      </div>
    </form>
  );
}

function ContactGroup({
  title,
  rows,
  via,
  canResend,
  t,
  tn,
  busy,
  act,
  onEdit,
  onApprove,
  highlightId,
  locale,
  locales,
  defaultCountryCode,
  approvedTripsByContact,
  editingId,
  guestFormEnv,
}: {
  title: string;
  rows: AdminContact[];
  /** Passed down rather than the invite list and the trips, so the three
   * groups share one resolution and neither row component has to know that
   * provenance is stored as an id. */
  via: (contact: AdminContact) => string | null;
  /** Same shape, for `resendableInvite` — B384. Optional because only the
   * pending group has any use for it; the other two never render a row that
   * could answer true. */
  canResend?: (contact: AdminContact) => boolean;
  t: Translate;
  tn: Count;
  busy: boolean;
  act: (body: Record<string, unknown>) => void;
  onEdit: (contact: AdminContact) => void;
  /** B244 — see `ContactRow`'s own note. */
  onApprove: (contact: AdminContact) => void;
  highlightId?: string;
  /** B402 — see `ContactRow`'s own note on both of these. */
  locale: Locale;
  locales: string[];
  /** B389 — see `ContactRow`'s own note. */
  defaultCountryCode?: string;
  /** B244 — see `ContactRow`'s own note. Keyed by contact id, so only the row
   * just approved renders anything different. */
  approvedTripsByContact?: Record<string, string[]>;
  /** B1094 — the contact id whose edit form should render in place, or
   * `null` when nobody's editing (or "Add a guest" is open instead, which
   * renders above every group rather than in one). */
  editingId?: string | null;
  /** B1094 — see `ContactRow`'s own note. */
  guestFormEnv?: GuestFormEnv;
}) {
  return (
    <section className="mt-10">
      <h2 className="font-display text-2xl text-navy-900">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-base text-navy-600">{t("contact.adminNone")}</p>
      ) : (
        <ul className="mt-4 space-y-4">
          {rows.map((contact) => (
            <ContactRow
              contact={contact}
              via={via(contact)}
              canResend={canResend?.(contact) ?? false}
              t={t}
              tn={tn}
              busy={busy}
              act={act}
              onEdit={onEdit}
              onApprove={onApprove}
              highlighted={contact.id === highlightId}
              locale={locale}
              locales={locales}
              defaultCountryCode={defaultCountryCode}
              approvedTrips={approvedTripsByContact?.[contact.id]}
              editing={contact.id === editingId}
              guestFormEnv={guestFormEnv}
              key={contact.id}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * One issued link, said in full — B97.
 *
 * Two things have to be legible without opening anything, because this list is
 * the only place a link can be revoked and revoking is irreversible: **which
 * kind it is**, and **whether it still works**. The cost of guessing wrong is
 * asymmetric — kill the reading link by mistake and the family cannot ask to
 * read; leave the writing link alive and a stranger can join a trip.
 *
 * A dead link — revoked, or past its expiry — says so and is offered no
 * button. Both are already refused by `resolveInvite`, so a control that
 * claimed to do something to one would be noise over a link that is already
 * nothing.
 */
function InviteRow({
  invite,
  trips,
  t,
  busy,
  act,
}: {
  invite: AdminInvite;
  /** For naming a buddy link's trip as the owner named it — see `tripLabel`. */
  trips: { id: string; title: string }[];
  t: Translate;
  busy: boolean;
  act: (body: Record<string, unknown>) => void;
}) {
  // Compared as ISO strings, which is what the column stores and what sorts
  // correctly — the same comparison `lib/grants.ts` makes for a grant.
  const expired =
    invite.expiresAt !== null && invite.expiresAt <= new Date().toISOString();
  const dead = invite.revokedAt !== null || expired;

  const detail = [
    // The trip is the whole difference between this row and the one above it,
    // so it comes first on a buddy link.
    // The title rather than the id, the same as the contact rows above — B321.
    // Two lists on one page naming one trip two different ways is a difference
    // the owner has to decode, and the id is what they were never shown: the
    // form that made this link offered them a dropdown of titles.
    invite.kind === "buddy"
      ? t("contact.adminInviteTrip", {
          trip: invite.tripId ? tripLabel(trips, invite.tripId) : "—",
        })
      : null,
    // The owner's own note. Second, and before the counters, because it is the
    // only thing that tells two rows of the same kind apart — which is what
    // the owner is actually deciding between when they reach for revoke. It
    // was blank on every link until B281, because the form that collected it
    // made a `personal` link and the two kinds an owner hands out were made by
    // a form that collected neither.
    invite.name,
    invite.locale ? LOCALE_LABEL[invite.locale] : null,
    t("contact.adminInviteUses", { count: String(invite.uses) }),
    invite.revokedAt
      ? t("contact.adminInviteRevoked")
      : expired
        ? t("contact.adminInviteExpired")
        : invite.expiresAt
          ? t("contact.adminInviteExpires", {
              date: invite.expiresAt.slice(0, 10),
            })
          : t("contact.adminInviteNoExpiry"),
  ].filter(Boolean);

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-navy-200 px-4 py-3">
      <span className="text-base">
        <span
          className={dead ? "text-navy-600" : "font-semibold text-navy-900"}
        >
          {t(INVITE_KIND_KEY[invite.kind])}
        </span>
        <span className="block text-sm text-navy-600">
          {detail.join(" · ")}
        </span>
      </span>
      {!dead && (
        <span className="flex flex-col items-end gap-2">
          {/* B934: the button above was the only route to this link — a phone
              whose clipboard write is refused (no secure context, permission
              denied, an old browser) left the owner nothing to select, on the
              one page B280 built specifically to show a lost link again. The
              value is now on screen too, selectable by hand, the same way
              `freshLink` below and `InviteToRead` already show one — so the
              button is a shortcut rather than the only way in, matching the
              rule the rest of this codebase follows for a live credential. */}
          {invite.url && (
            <code className="block max-w-full break-all rounded-lg bg-cream-100 px-2 py-1 text-xs text-navy-900">
              {invite.url}
            </code>
          )}
          <span className="flex flex-wrap items-center gap-2">
            {/* B280 and B281: send the same link again rather than issuing a
                second one for the same audience. Absent, not disabled, when
                there is no recoverable token — see `AdminInvite.url`. */}
            {invite.url && (
              <CopyLine
                value={invite.url}
                label={t("contact.adminCopyLink")}
                copiedLabel={t("contact.adminCopiedLink")}
                // The URL is a credential, so it is deliberately not recited as
                // the accessible name the way `CopyLine`'s default would — B199
                // is the precedent. What it copies is said in words instead, and
                // the note beside it is what identifies which link this is —
                // when there is one. B358: an unnamed link used to fill the gap
                // with an em-dash placeholder, so the name ended "— —".
                name={
                  invite.name
                    ? t("contact.adminCopyLinkNamed", {
                        kind: t(INVITE_KIND_KEY[invite.kind]),
                        name: invite.name,
                      })
                    : t("contact.adminCopyLinkKind", {
                        kind: t(INVITE_KIND_KEY[invite.kind]),
                      })
                }
              />
            )}
            <BusyButton
              busy={busy}
              type="button"
              onClick={() => act({ action: "revoke-invite", id: invite.id })}
              className="rounded-lg border border-navy-200 px-3 py-1 text-sm text-navy-700 disabled:opacity-50"
            >
              {t("contact.adminRevokeLink")}
            </BusyButton>
          </span>
        </span>
      )}
    </li>
  );
}

/**
 * The button that gives the owner a contact row of their own — B619.
 *
 * Everything on this page that lets a person edit their own name, telephone
 * and postal address is `ContactManage`, and it needs a row. The owner never
 * had one, so the only reader of this page who could not change anything
 * about themselves was the person whose journal it is — and a postcard, which
 * is addressed by contact id, could not be sent to them at all.
 *
 * One button rather than a form: the row is made empty and the form that
 * appears in its place is the one everybody else already gets. Nothing is
 * mailed and nothing has to be confirmed, because the session that pressed
 * this is already signed in as the address the row is for.
 *
 * It lives on this page rather than `/{user}/me` since B621: their own row is
 * one more entry in the address book, next to everybody else's.
 */
function AddOwnDetails({
  username,
  t,
  onAdded,
}: {
  username: string;
  t: (key: TranslationKey) => string;
  /** The panel's own `refresh()`. `router.refresh()` alone re-renders the
   * server component, and the contact and invite lists below are `useState`
   * seeded once from its props — so without this the new row appears in the
   * card and nowhere else until a reload. */
  onAdded: () => Promise<void>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function add() {
    setBusy(true);
    setFailed(false);
    const response = await fetch("/api/contacts/admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user: username, action: "self" }),
    }).catch(() => null);
    setBusy(false);
    if (!response?.ok) {
      setFailed(true);
      return;
    }
    // The row now exists, so the server renders the edit form in this
    // section's place — and the lists below re-read themselves, because
    // their copy of the contacts is client state.
    await onAdded();
    router.refresh();
  }

  return (
    <div className="mt-3">
      <BusyButton
        busy={busy}
        type="button"
        onClick={add}
        className="inline-flex min-h-11 w-fit items-center rounded-full border border-navy-700 px-5 text-base font-semibold text-navy-900 transition-colors hover:bg-cream-100 disabled:opacity-50"
      >
        {t("me.detailsAddSelf")}
      </BusyButton>
      {failed && (
        <p className="mt-2 text-sm text-coral-600">{t("me.journalFailed")}</p>
      )}
    </div>
  );
}

export default function ContactsAdmin({
  username,
  locale,
  locales,
  dictionary,
  contacts: initialContacts,
  invites: initialInvites,
  trips = [],
  hasGuestTrip,
  highlightId,
  postcardsEnabled = true,
  pushEnabled = false,
  whatsappEnabled = true,
  defaultCountryCode,
  addressLookupEnabled = false,
  own,
  canAddOwn = false,
}: {
  username: string;
  locale: Locale;
  /** The trips a writing link can name. Empty is a real state — a journal with
   * no trip yet can issue a reading link and nothing else. */
  trips?: { id: string; title: string }[];
  /**
   * Whether an approved guest could read any trip in the journal at all —
   * `visibility: guest` (what an approval itself opens, B300) or
   * `visibility: public` (already open to everyone, approval or not). Only a
   * journal whose every trip is `private` leaves an approval opening nothing,
   * which is worth saying before the owner acts on it rather than after
   * (B638: a fully public journal was wrongly told it had nothing to open).
   */
  hasGuestTrip: boolean;
  /** The languages this journal offers, from its config. */
  locales: string[];
  dictionary: Record<string, string>;
  contacts: AdminContact[];
  invites: AdminInvite[];
  /**
   * The request the owner's approval mail (`notifyOwnerOfRequest`) was
   * about — B319. From the page's own `?contact=` query string, so the
   * button in that mail opens the queue with this one already in front of
   * the owner rather than merely at the top of a list they still have to
   * find.
   */
  highlightId?: string;
  /** B360: whether this server can act on a postcard request at all —
   * `isEnabled("postcards", username)`, from the page. Defaults to shown, the
   * same reasoning as `GuestForm`'s own default below. */
  postcardsEnabled?: boolean;
  /** Whether this journal offers notifications at all. Off, the note below the
   * tick boxes describes a channel that does not exist here. */
  pushEnabled?: boolean;
  /** B376: whether this server can act on a WhatsApp update at all —
   * `isEnabled("whatsapp", username)`, from the page. Same default reasoning. */
  whatsappEnabled?: boolean;
  /** B385: `whatsappCountryCode()` — passed through to `GuestForm`'s own
   * default, unrelated to whether WhatsApp itself is on. */
  defaultCountryCode?: string;
  /** B399: `isEnabled("addressLookup", username)`, from the page. */
  addressLookupEnabled?: boolean;
  /**
   * The owner's own row, when they have one — B621, moved here from
   * `/{user}/me`. Present and `canAddOwn` false is the ordinary state once
   * they have pressed the button once.
   */
  own?: { token: string; contact: ManageContact };
  /** Whether to offer to make one. True only for an owner who has none: a
   * guest gets a row by being invited and approved, which is the whole of
   * `lib/contacts`, and a button here would be a way around it. */
  canAddOwn?: boolean;
}) {
  const [contacts, setContacts] = useState(initialContacts);
  const [invites, setInvites] = useState(initialInvites);
  const [inviteName, setInviteName] = useState("");
  const [inviteLocale, setInviteLocale] = useState<Locale>(locale);
  // `guest` first because it is the one that belongs in a family group chat.
  // Defaulting to `buddy` would put write access one un-read radio button
  // away, which is the mistake B97 is about, made earlier.
  const [inviteKind, setInviteKind] = useState<"guest" | "buddy">("guest");
  const [inviteTrip, setInviteTrip] = useState(trips[0]?.id ?? "");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [freshLink, setFreshLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // `null`: closed. `"new"`: the "Add a guest" toggle. Otherwise the row being
  // corrected. One form on the page at a time, so opening a second target
  // replaces whichever was open rather than stacking a second copy of it.
  const [formTarget, setFormTarget] = useState<"new" | AdminContact | null>(
    null,
  );

  const t = (key: TranslationKey, vars?: Record<string, string>) =>
    translate(dictionary, key, vars);
  const tn = (
    key: TranslationKey,
    count: number,
    vars?: Record<string, string>,
  ) => plural(dictionary, key, count, vars);

  async function refresh() {
    const response = await fetch(
      `/api/contacts/admin?user=${encodeURIComponent(username)}`,
    ).catch(() => null);
    if (!response?.ok) return;
    const body = (await response.json()) as {
      contacts: AdminContact[];
      invites: AdminInvite[];
    };
    setContacts(body.contacts);
    setInvites(body.invites);
  }

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    const response = await fetch("/api/contacts/admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user: username, ...body }),
    }).catch(() => null);
    setBusy(false);
    await refresh();
    return response;
  }

  // B244 — keyed by contact id rather than a single "last approved" slot, so
  // approving a second row does not erase what the first one's note said.
  const [approvedTripsByContact, setApprovedTripsByContact] = useState<
    Record<string, string[]>
  >({});

  async function approve(contact: AdminContact) {
    const response = await act({ action: "approve", id: contact.id });
    const body = (await response?.json().catch(() => null)) as {
      tripsOpened?: string[];
    } | null;
    if (!body) return;
    setApprovedTripsByContact((previous) => ({
      ...previous,
      [contact.id]: body.tripsOpened ?? [],
    }));
  }

  /**
   * Everybody but the owner — B621.
   *
   * Their own row is the card at the top of this page, with the form that
   * edits it. Listed again among "who reads along" it is both a duplicate and
   * a lie in two places: `Revoke` would take a grant that is not what gives
   * them access (`owner.email` in config.json is), and `Delete` offers to
   * remove "their access" when it would only throw away their address. The
   * same reasoning as the two buttons `ContactManage` hides from them.
   */
  const others = own
    ? contacts.filter((c) => c.email !== own.contact.email)
    : contacts;
  const pending = others.filter((c) => c.status === "pending");
  const approved = others.filter((c) => c.status === "active");
  const other = others.filter((c) => c.status === "blocked");

  // Resolved here, where both lists are, and handed down — B321. The invites
  // are in this component's own state and are re-read by `refresh()`, so a row
  // says the right thing again after a link is revoked without anything having
  // to be re-fetched for it.
  const contactVia = (contact: AdminContact) =>
    viaLabel(contact.createdVia, invites, trips, t);

  // Same lookup, different question — B384. Only ever true for a `pending`
  // row that has never confirmed: a confirmed or active row has nothing left
  // to resend, whatever its invite says.
  const contactCanResend = (contact: AdminContact) =>
    contact.status === "pending" &&
    !contact.confirmedAt &&
    resendableInvite(contact.createdVia, invites) !== null;

  // B1094 — which row (if any) should render its own edit form in place,
  // and what that form needs beyond the contact it is editing. `null` when
  // nothing is being edited, and also when "Add a guest" is open instead —
  // that form still renders above every group, at the button it always
  // opened at (see the ticket's own constraint).
  const editingId =
    formTarget !== null && formTarget !== "new" ? formTarget.id : null;
  const guestFormEnv: GuestFormEnv | undefined = editingId
    ? {
        fallbackLocale: locale,
        locales,
        username,
        t,
        busy,
        act,
        postcardsEnabled,
        pushEnabled,
        whatsappEnabled,
        defaultCountryCode,
        addressLookupEnabled,
        onClose: () => setFormTarget(null),
      }
    : undefined;

  // Put the highlighted request in view rather than merely marked — B319.
  // Runs once per id: `refresh()` after an approve or a revoke reloads every
  // row, and a highlighted request that the owner has just acted on should
  // stay visible without being re-scrolled to on every subsequent action.
  useEffect(() => {
    if (!highlightId) return;
    document
      .getElementById(`contact-${highlightId}`)
      ?.scrollIntoView({ block: "center" });
  }, [highlightId]);

  return (
    // `id` and `tabIndex` are the target of the skip link the page's header
    // renders — without them the first thing in the tab order goes nowhere.
    <main
      id="main"
      tabIndex={-1}
      className="mx-auto w-full max-w-3xl px-6 py-12"
      lang={locale}
    >
      <h1 className="font-display text-3xl text-navy-900 sm:text-4xl">
        {t("contact.adminTitle")}
      </h1>
      <p className="mt-3 text-lg text-navy-700">{t("contact.adminSubtitle")}</p>

      {/*
        The owner's own row — B621, moved off `/{user}/me`. First, because it
        is the one entry in this book that is theirs: what a postcard to
        themselves is addressed to, and where a day reaches them.
      */}
      {(own || canAddOwn) && (
        <section className="mt-8 rounded-2xl border border-navy-200 bg-white p-5 sm:p-6">
          <h2 className="font-display text-xl font-semibold text-navy-900">
            {t("me.details")}
          </h2>
          <p className="mt-2 text-base leading-7 text-navy-600">
            {t("me.detailsBodyOwner")}
          </p>
          {own ? (
            <details className="mt-3">
              <summary className="inline-flex min-h-11 w-fit cursor-pointer list-none items-center rounded-full border border-navy-700 px-5 text-base font-semibold text-navy-900 transition-colors hover:bg-cream-100 [&::-webkit-details-marker]:hidden">
                {t("me.editDetails")}
              </summary>
              <div className="mt-4 border-t border-navy-200">
                <ContactManage
                  className="pt-4"
                  locales={locales}
                  dictionary={dictionary}
                  username={username}
                  token={own.token}
                  contact={own.contact}
                  defaultCountryCode={defaultCountryCode}
                  addressLookupEnabled={addressLookupEnabled}
                  isOwner
                />
              </div>
            </details>
          ) : (
            <AddOwnDetails username={username} t={t} onAdded={refresh} />
          )}
        </section>
      )}

      {/* B300. Said here, ahead of the pending list and its approve buttons
          below, and it stays visible after an approval too — nothing about
          this journal changes when a contact does. The people who most need
          it are the ones about to click Approve for the first time, thinking
          it shares the journey rather than the journal. Coral, like the draft
          and test notices: yellow is the brand's own colour and reads as
          decoration, not a warning — see docs/branding/BRAND.md. */}
      {!hasGuestTrip && (
        <p className="mt-6 rounded-xl border-2 border-coral-600 bg-coral-300 px-4 py-3 text-base text-navy-900">
          {t("contact.adminNoGuestTrip")}
        </p>
      )}

      <div className="mt-8">
        {formTarget === null && (
          <button
            type="button"
            onClick={() => setFormTarget("new")}
            className="rounded-xl bg-navy-900 px-4 py-3 text-base text-cream-50"
          >
            {t("contact.adminAddGuest")}
          </button>
        )}
        {/* B1094 — "Add a guest" keeps opening here, where its own button is.
            Editing an existing contact no longer renders here at all: it
            renders inline in that contact's own card, below, so a row deep
            in a long group does not put its form off-screen above this
            button. */}
        {formTarget === "new" && (
          <GuestForm
            contact={null}
            fallbackLocale={locale}
            locales={locales}
            username={username}
            t={t}
            busy={busy}
            act={act}
            onClose={() => setFormTarget(null)}
            defaultCountryCode={defaultCountryCode}
            postcardsEnabled={postcardsEnabled}
            pushEnabled={pushEnabled}
            whatsappEnabled={whatsappEnabled}
            addressLookupEnabled={addressLookupEnabled}
          />
        )}
      </div>

      <ContactGroup
        title={t("contact.adminPending")}
        via={contactVia}
        canResend={contactCanResend}
        rows={pending}
        t={t}
        tn={tn}
        busy={busy}
        act={act}
        onEdit={setFormTarget}
        onApprove={approve}
        highlightId={highlightId}
        locale={locale}
        locales={locales}
        defaultCountryCode={defaultCountryCode}
        approvedTripsByContact={approvedTripsByContact}
        editingId={editingId}
        guestFormEnv={guestFormEnv}
      />
      <ContactGroup
        title={t("contact.adminApproved")}
        via={contactVia}
        rows={approved}
        t={t}
        tn={tn}
        busy={busy}
        act={act}
        onEdit={setFormTarget}
        onApprove={approve}
        highlightId={highlightId}
        locale={locale}
        locales={locales}
        defaultCountryCode={defaultCountryCode}
        approvedTripsByContact={approvedTripsByContact}
        editingId={editingId}
        guestFormEnv={guestFormEnv}
      />
      {other.length > 0 && (
        <ContactGroup
          title={t("contact.adminOther")}
          via={contactVia}
          rows={other}
          t={t}
          tn={tn}
          busy={busy}
          act={act}
          onEdit={setFormTarget}
          onApprove={approve}
          highlightId={highlightId}
          locale={locale}
          locales={locales}
          defaultCountryCode={defaultCountryCode}
          approvedTripsByContact={approvedTripsByContact}
          editingId={editingId}
          guestFormEnv={guestFormEnv}
        />
      )}

      <section className="mt-14">
        <h2 className="font-display text-2xl text-navy-900">
          {t("contact.adminLinks")}
        </h2>

        {/* There was a second block here: the open link, one per journal,
            offered for pasting into a group chat. It is gone (B37) — a journal
            no longer advertises a way in its owner never offered — and this
            section is now the one way anybody arrives: a link issued for a
            named person, which still only lets them ask. */}
        <form
          className="mt-8 rounded-2xl border border-navy-200 p-5"
          onSubmit={async (event) => {
            event.preventDefault();
            setInviteError(null);
            setBusy(true);
            // `POST /api/v1/{user}/invites` rather than the panel's own admin
            // route: that route's `invite` action made a `personal` link and
            // nothing else, and this one already owns the rules — a buddy
            // link needs a trip, a guest link must not name one, the trip has
            // to exist, and every link is dated. B281.
            const response = await fetch(`/api/v1/${username}/invites`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                kind: inviteKind,
                ...(inviteKind === "buddy" ? { trip: inviteTrip } : {}),
                name: inviteName,
                locale: inviteLocale,
              }),
            }).catch(() => null);
            setBusy(false);

            if (!response?.ok) {
              // The route explains itself in `message`; showing that rather
              // than a generic failure is the difference between "try again"
              // and "you asked for a trip link without naming a trip".
              const body = (await response?.json().catch(() => null)) as {
                message?: string;
              } | null;
              setInviteError(body?.message ?? t("contact.adminInviteFailed"));
              return;
            }
            const body = (await response.json()) as {
              invite?: { url?: string };
            };
            setFreshLink(body.invite?.url ?? null);
            setInviteName("");
            await refresh();
          }}
        >
          <p className="font-display text-xl text-navy-900">
            {t("contact.adminNewInvite")}
          </p>

          {/* Which door, first, because it changes what the rest of the form
              means — and said in the same words the row below will use, so an
              owner who picks "a link for someone to write" recognises the row
              it produces. A reading link goes in a family group chat; a
              writing link does not, which is why the sentence under each is
              part of the control rather than a tooltip. */}
          <fieldset className="mt-4">
            <legend className={LABEL}>{t("contact.adminInviteKind")}</legend>
            {(["guest", "buddy"] as const).map((kind) => {
              // A writing link names a trip, and `POST /invites` refuses one
              // that names nothing. So a journal with no trip cannot make this
              // kind at all — and it is said here, on the option itself,
              // rather than after the owner has chosen it. A control you can
              // select that then explains why it will not work is the dead
              // button this project's capability rule exists to avoid.
              const unavailable = kind === "buddy" && trips.length === 0;
              return (
                <label
                  key={kind}
                  className={`mt-2 flex gap-3 rounded-xl border border-navy-200 p-4 ${
                    unavailable ? "bg-cream-100" : "bg-white"
                  }`}
                >
                  <input
                    type="radio"
                    name="invite-kind"
                    value={kind}
                    checked={inviteKind === kind}
                    disabled={unavailable}
                    onChange={() => setInviteKind(kind)}
                    className="mt-1.5 h-5 w-5 shrink-0"
                  />
                  <span>
                    <span
                      className={`block text-lg font-semibold ${
                        unavailable ? "text-navy-600" : "text-navy-900"
                      }`}
                    >
                      {t(INVITE_KIND_KEY[kind])}
                    </span>
                    <span className="block text-base leading-7 text-navy-700">
                      {unavailable
                        ? t("contact.adminInviteNoTrips")
                        : t(
                            kind === "guest"
                              ? "me.inviteGuestBody"
                              : "me.inviteBuddyBody",
                          )}
                    </span>
                  </span>
                </label>
              );
            })}
          </fieldset>

          {/* Which trip, once there is a choice to make and the owner has
              asked for the kind that needs one. */}
          {inviteKind === "buddy" && trips.length > 0 && (
            <>
              <label className={`${LABEL} mt-4`} htmlFor="invite-trip">
                {t("contact.adminInviteWhichTrip")}
              </label>
              <select
                id="invite-trip"
                className={FIELD}
                value={inviteTrip}
                onChange={(e) => setInviteTrip(e.target.value)}
              >
                {trips.map((trip) => (
                  <option key={trip.id} value={trip.id}>
                    {trip.title}
                  </option>
                ))}
              </select>
            </>
          )}

          {/* The owner's own note, and the reason this field exists at all:
              two links of the same kind are otherwise one row repeated, and
              this list is the only place either can be revoked (B97). Asked
              as "what is this for" rather than "who is it for" — a link
              forwarded round a family is for a family, not a person, and
              `name` was never an identity. */}
          <label className={`${LABEL} mt-4`} htmlFor="invite-name">
            {t("contact.adminInviteNote")}
          </label>
          <input
            id="invite-name"
            className={FIELD}
            value={inviteName}
            onChange={(e) => setInviteName(e.target.value)}
            placeholder={t("contact.adminInviteNotePlaceholder")}
          />
          <label
            className="mt-4 block text-base font-medium text-navy-700"
            htmlFor="invite-locale"
          >
            {t("contact.language")}
          </label>
          <select
            id="invite-locale"
            className="mt-2 w-full rounded-xl border border-navy-200 bg-white px-4 py-3 text-lg"
            value={inviteLocale}
            onChange={(e) => setInviteLocale(e.target.value as Locale)}
          >
            {locales.map((option: string) => (
              <option key={option} value={option}>
                {LOCALE_LABEL[option]}
              </option>
            ))}
          </select>
          <BusyButton
            busy={busy}
            type="submit"
            disabled={inviteKind === "buddy" && trips.length === 0}
            className="mt-5 rounded-xl bg-navy-900 px-4 py-3 text-base text-cream-50 disabled:opacity-50"
          >
            {t("contact.adminCreate")}
          </BusyButton>

          {inviteError && (
            <p role="alert" className="mt-4 text-base leading-7 text-coral-600">
              {inviteError}
            </p>
          )}

          {freshLink && (
            <div className="mt-5">
              <p className="text-base text-coral-600">
                {t("contact.adminInviteCopy")}
              </p>
              <code className="mt-2 block break-all rounded-xl bg-cream-100 p-3 text-sm text-navy-900">
                {freshLink}
              </code>
              <div className="mt-3">
                <CopyLine
                  value={freshLink}
                  label={t("contact.adminCopyLink")}
                  copiedLabel={t("contact.adminCopiedLink")}
                  name={t("contact.adminCopyLink")}
                />
              </div>
            </div>
          )}
        </form>

        {invites.length > 0 && (
          <ul className="mt-6 space-y-2">
            {invites.map((invite) => (
              <InviteRow
                key={invite.id}
                invite={invite}
                trips={trips}
                t={t}
                busy={busy}
                act={act}
              />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
