"use client";

import { useEffect, useState } from "react";
import CopyLine from "./CopyLine";
import CountryField from "./CountryField";
import TelField, { joinTel, splitTel } from "./TelField";
import { LOCALE_LABEL, telHintKey, translate, type TranslationKey } from "@/lib/i18n";
import type { Locale } from "@/lib/types";

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

export type AdminAddress = {
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
  createdVia: string | null;
  createdAt: string;
  confirmedAt: string | null;
  lastSeenAt: string | null;
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
  // B37 removed the open guestbook. Rows written before it still say this, and
  // will forever.
  if (createdVia === "open") return t("contact.adminViaOpen");
  if (!createdVia.startsWith("invite:")) return createdVia;

  const invite = invites.find((candidate) => candidate.id === createdVia.slice("invite:".length));
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
function resendableInvite(createdVia: string | null, invites: AdminInvite[]): AdminInvite | null {
  if (!createdVia?.startsWith("invite:")) return null;
  const invite = invites.find((candidate) => candidate.id === createdVia.slice("invite:".length));
  if (!invite || invite.revokedAt) return null;
  if (invite.expiresAt && new Date(invite.expiresAt).getTime() < Date.now()) return null;
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

/** One person. Declared at module scope rather than inside the page component:
 * a component created during render is a new type on every keystroke, and
 * React throws away its state each time. */
function ContactRow({
  contact,
  via,
  canResend = false,
  t,
  busy,
  act,
  onEdit,
  highlighted = false,
}: {
  contact: AdminContact;
  /** How they came to be here, already in words — see `viaLabel`. Resolved by
   * the caller, which is where the invite list and the trip titles are. */
  via: string | null;
  /** Whether an invitation this contact hasn't opened yet can be mailed
   * again — B384. Only ever true for a `pending`, unconfirmed row; false for
   * anything else, including the ordinary case of nothing to resend. */
  canResend?: boolean;
  t: Translate;
  busy: boolean;
  act: (body: Record<string, unknown>) => void;
  onEdit: (contact: AdminContact) => void;
  /** This is the request the owner's approval mail was about — B319. Not a
   * different state, only a ring round an ordinary row: the button, the
   * data, everything else about it is identical to any other pending
   * contact. */
  highlighted?: boolean;
}) {
  // Owner-facing copy, not the guest form's first-person "Send me…" — this
  // list is read by the owner, about somebody else.
  const wants = [
    contact.wantsEmailDigest ? t("contact.adminWantsDigest") : null,
    contact.wantsPostcard ? t("contact.adminWantsPostcard") : null,
    contact.wantsWhatsapp ? t("contact.adminWantsWhatsapp") : null,
  ].filter(Boolean);

  const postal = contact.postalAddress;

  return (
    <li
      id={`contact-${contact.id}`}
      className={`rounded-2xl border bg-white p-5 ${
        highlighted ? "border-yellow-400 ring-2 ring-yellow-400" : "border-navy-200"
      }`}
    >
      <p className="font-display text-xl text-navy-900">{contact.name ?? contact.email}</p>
      <p className="text-base text-navy-700">{contact.email}</p>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm text-navy-600">
        <dt>{t("contact.language")}</dt>
        <dd>{contact.locale ? LOCALE_LABEL[contact.locale] : "—"}</dd>
        <dt>{t("contact.adminVia")}</dt>
        <dd>{via ?? "—"}</dd>
        <dt>{t("contact.adminLastSeen")}</dt>
        <dd>{contact.lastSeenAt?.slice(0, 10) ?? t("contact.adminNever")}</dd>
        <dt>{t(STATUS_KEY[contact.status])}</dt>
        <dd>{contact.confirmedAt?.slice(0, 10) ?? "—"}</dd>
        {wants.length > 0 && (
          <>
            <dt>{t("contact.adminWants")}</dt>
            <dd>{wants.join(" · ")}</dd>
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
                postal.country,
              ]
                .filter((line) => line !== "")
                .join(", ")}
            </dd>
          </>
        )}
        {postal?.tel && (
          <>
            <dt>{t("contact.tel")}</dt>
            <dd>{postal.tel}</dd>
          </>
        )}
      </dl>
      {canResend && (
        // Said before the click, honestly — B384's own acceptance line. This
        // is the only state that used to be a dead end: `confirmedAt` is
        // null, so the Approve button below never appears, and Edit/Delete
        // were the only thing left to press.
        <p className="mt-3 text-base text-navy-600">{t("contact.adminInvitePending")}</p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {canResend && (
          <button
            type="button"
            disabled={busy}
            onClick={() => act({ action: "resend", id: contact.id })}
            className="rounded-xl border border-navy-200 px-4 py-2 text-base text-navy-900 disabled:opacity-50"
          >
            {t("contact.adminResendInvite")}
          </button>
        )}
        {contact.status !== "active" && contact.confirmedAt && (
          <button
            type="button"
            disabled={busy}
            onClick={() => act({ action: "approve", id: contact.id })}
            className="rounded-xl bg-navy-900 px-4 py-2 text-base text-cream-50 disabled:opacity-50"
          >
            {t("contact.adminApprove")}
          </button>
        )}
        {contact.status === "active" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => act({ action: "revoke", id: contact.id })}
            className="rounded-xl border border-navy-200 px-4 py-2 text-base text-navy-900 disabled:opacity-50"
          >
            {t("contact.adminRevoke")}
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => onEdit(contact)}
          className="rounded-xl border border-navy-200 px-4 py-2 text-base text-navy-900 disabled:opacity-50"
        >
          {t("contact.adminEdit")}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => act({ action: "delete", id: contact.id })}
          className="rounded-xl border border-coral-400 px-4 py-2 text-base text-coral-600 disabled:opacity-50"
        >
          {t("contact.adminDelete")}
        </button>
      </div>
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
  // legacy `076 561 31 50`, or no record at all — is never guessed at.
  // `defaultCountryCode` only seeds a *brand-new* guest's blank number,
  // never a contact's actual (if unparseable) one — B385.
  const parsed = splitTel(tel);
  return {
    name: contact?.name ?? "",
    email: contact?.email ?? "",
    locale: contact?.locale ?? fallbackLocale,
    cc: parsed.cc || (contact === null && tel.trim() === "" ? (defaultCountryCode ?? "") : ""),
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
 * this journal never had before now. The *field* labels — name, email,
 * language, the address block — are lifted from `ContactForm.tsx` rather than
 * re-worded: they are person-neutral, and giving the two forms separate
 * copies of the same label is how they drift apart (the visibility vocabulary
 * did exactly that in W27). The two consent checkboxes and the address hint
 * are the opposite case: `ContactForm.tsx`'s copy for them is first-person
 * ("Send me…", "only if you'd like…"), written for the guest filling in their
 * own form, and reads as talking to the wrong person when it is the owner
 * typing on somebody else's behalf — so those three get their own
 * `contact.admin*` keys instead of reuse.
 *
 * One instance of this form exists on the page at a time — opened either by
 * the "Add a guest" toggle above the pending group, or by a row's own Edit
 * button, which is why it is `key`ed by the caller on the contact being
 * edited (or "new"): switching targets has to reset every field, not patch
 * over what the previous target left behind.
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
  t,
  busy,
  act,
  onClose,
  postcardsEnabled = true,
  whatsappEnabled = true,
  defaultCountryCode,
}: {
  /** The row being corrected, or `null` to add a new one. */
  contact: AdminContact | null;
  fallbackLocale: Locale;
  locales: string[];
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
  /** B376: whether this server can act on a WhatsApp update at all —
   * `isEnabled("whatsapp", username)`. Only changes the phone hint's wording. */
  whatsappEnabled?: boolean;
  /** B385: `whatsappCountryCode()`, seeding only a brand-new guest's blank
   * dialling code — see `fieldsFor`. */
  defaultCountryCode?: string;
}) {
  const editingId = contact?.id ?? null;
  const [form, setForm] = useState<GuestFields>(() =>
    fieldsFor(contact, fallbackLocale, defaultCountryCode),
  );
  const [error, setError] = useState<string | null>(null);

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
      const body = (await response?.json().catch(() => null)) as { error?: string } | null;
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
          {t("contact.name")}
        </label>
        <input
          id="guest-name"
          className={FIELD}
          value={form.name}
          onChange={(e) => field("name", e.target.value)}
        />
      </div>

      <div className="mt-4">
        <label className={LABEL} htmlFor="guest-email">
          {t("contact.email")}
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
          <p className="mt-2 text-base text-coral-600">{t("contact.adminEmailChangeWarning")}</p>
        )}
      </div>

      <div className="mt-4">
        <label className={LABEL} htmlFor="guest-locale">
          {t("contact.language")}
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
          onChange={(cc, national) => setForm((previous) => ({ ...previous, cc, tel: national }))}
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
          {t(postcardsEnabled ? "contact.adminAddressHint" : "contact.adminAddressHintNoPostcards")}
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
          <input
            id="guest-addr-line1"
            className={FIELD}
            value={form.line1}
            onChange={(e) => field("line1", e.target.value)}
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
        <label className="flex items-start gap-3 text-base text-navy-900">
          <input
            type="checkbox"
            className="mt-1 size-5"
            checked={form.wantsWhatsapp}
            onChange={(e) => field("wantsWhatsapp", e.target.checked)}
          />
          <span>{t("contact.adminWantsWhatsapp")}</span>
        </label>
      </div>

      {error && (
        <p role="alert" className="mt-4 text-base text-coral-600">
          {t(ERROR_KEY[error] ?? "contact.error")}
        </p>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded-xl bg-navy-900 px-4 py-3 text-base text-cream-50 disabled:opacity-50"
        >
          {t("contact.save")}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onClose}
          className="rounded-xl border border-navy-200 px-4 py-3 text-base text-navy-700 disabled:opacity-50"
        >
          {t("contact.adminGuestCancel")}
        </button>
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
  busy,
  act,
  onEdit,
  highlightId,
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
  busy: boolean;
  act: (body: Record<string, unknown>) => void;
  onEdit: (contact: AdminContact) => void;
  highlightId?: string;
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
              busy={busy}
              act={act}
              onEdit={onEdit}
              highlighted={contact.id === highlightId}
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
  const expired = invite.expiresAt !== null && invite.expiresAt <= new Date().toISOString();
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
          ? t("contact.adminInviteExpires", { date: invite.expiresAt.slice(0, 10) })
          : t("contact.adminInviteNoExpiry"),
  ].filter(Boolean);

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-navy-200 px-4 py-3">
      <span className="text-base">
        <span className={dead ? "text-navy-600" : "font-semibold text-navy-900"}>
          {t(INVITE_KIND_KEY[invite.kind])}
        </span>
        <span className="block text-sm text-navy-600">{detail.join(" · ")}</span>
      </span>
      {!dead && (
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
          <button
            type="button"
            disabled={busy}
            onClick={() => act({ action: "revoke-invite", id: invite.id })}
            className="rounded-lg border border-navy-200 px-3 py-1 text-sm text-navy-700 disabled:opacity-50"
          >
            {t("contact.adminRevokeLink")}
          </button>
        </span>
      )}
    </li>
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
  whatsappEnabled = true,
  defaultCountryCode,
}: {
  username: string;
  locale: Locale;
  /** The trips a writing link can name. Empty is a real state — a journal with
   * no trip yet can issue a reading link and nothing else. */
  trips?: { id: string; title: string }[];
  /**
   * Whether any trip in the journal is `visibility: guest` — the only kind an
   * approval actually opens (B300). A journal whose only trips are `private`
   * or `public` can still approve somebody; the approval just admits them to
   * nothing, which is worth saying before the owner acts on it rather than
   * after.
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
  /** B376: whether this server can act on a WhatsApp update at all —
   * `isEnabled("whatsapp", username)`, from the page. Same default reasoning. */
  whatsappEnabled?: boolean;
  /** B385: `whatsappCountryCode()` — passed through to `GuestForm`'s own
   * default, unrelated to whether WhatsApp itself is on. */
  defaultCountryCode?: string;
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
  const [formTarget, setFormTarget] = useState<"new" | AdminContact | null>(null);

  const t = (key: TranslationKey, vars?: Record<string, string>) =>
    translate(dictionary, key, vars);

  async function refresh() {
    const response = await fetch(
      `/api/contacts/admin?user=${encodeURIComponent(username)}`,
    ).catch(() => null);
    if (!response?.ok) return;
    const body = (await response.json()) as { contacts: AdminContact[]; invites: AdminInvite[] };
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

  const pending = contacts.filter((c) => c.status === "pending");
  const approved = contacts.filter((c) => c.status === "active");
  const other = contacts.filter((c) => c.status === "blocked");

  // Resolved here, where both lists are, and handed down — B321. The invites
  // are in this component's own state and are re-read by `refresh()`, so a row
  // says the right thing again after a link is revoked without anything having
  // to be re-fetched for it.
  const contactVia = (contact: AdminContact) => viaLabel(contact.createdVia, invites, trips, t);

  // Same lookup, different question — B384. Only ever true for a `pending`
  // row that has never confirmed: a confirmed or active row has nothing left
  // to resend, whatever its invite says.
  const contactCanResend = (contact: AdminContact) =>
    contact.status === "pending" &&
    !contact.confirmedAt &&
    resendableInvite(contact.createdVia, invites) !== null;

  // Put the highlighted request in view rather than merely marked — B319.
  // Runs once per id: `refresh()` after an approve or a revoke reloads every
  // row, and a highlighted request that the owner has just acted on should
  // stay visible without being re-scrolled to on every subsequent action.
  useEffect(() => {
    if (!highlightId) return;
    document.getElementById(`contact-${highlightId}`)?.scrollIntoView({ block: "center" });
  }, [highlightId]);

  return (
    // `id` and `tabIndex` are the target of the skip link the page's header
    // renders — without them the first thing in the tab order goes nowhere.
    <main id="main" tabIndex={-1} className="mx-auto w-full max-w-3xl px-6 py-12" lang={locale}>
      <h1 className="font-display text-3xl text-navy-900 sm:text-4xl">
        {t("contact.adminTitle")}
      </h1>
      <p className="mt-3 text-lg text-navy-700">{t("contact.adminSubtitle")}</p>

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
        {formTarget === null ? (
          <button
            type="button"
            onClick={() => setFormTarget("new")}
            className="rounded-xl bg-navy-900 px-4 py-3 text-base text-cream-50"
          >
            {t("contact.adminAddGuest")}
          </button>
        ) : (
          <GuestForm
            // Keyed on the target so switching from one row to another — or to
            // "new" — remounts the form instead of patching stale field values
            // from whoever was being edited before.
            key={formTarget === "new" ? "new" : formTarget.id}
            contact={formTarget === "new" ? null : formTarget}
            fallbackLocale={locale}
            locales={locales}
            t={t}
            busy={busy}
            act={act}
            onClose={() => setFormTarget(null)}
            defaultCountryCode={defaultCountryCode}
            postcardsEnabled={postcardsEnabled}
            whatsappEnabled={whatsappEnabled}
          />
        )}
      </div>

      <ContactGroup
        title={t("contact.adminPending")}
        via={contactVia}
        canResend={contactCanResend}
        rows={pending}
        t={t}
        busy={busy}
        act={act}
        onEdit={setFormTarget}
        highlightId={highlightId}
      />
      <ContactGroup
        title={t("contact.adminApproved")}
        via={contactVia}
        rows={approved}
        t={t}
        busy={busy}
        act={act}
        onEdit={setFormTarget}
        highlightId={highlightId}
      />
      {other.length > 0 && (
        <ContactGroup
          title={t("contact.adminOther")}
          via={contactVia}
          rows={other}
          t={t}
          busy={busy}
          act={act}
          onEdit={setFormTarget}
          highlightId={highlightId}
        />
      )}

      <section className="mt-14">
        <h2 className="font-display text-2xl text-navy-900">{t("contact.adminLinks")}</h2>

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
            const body = (await response.json()) as { invite?: { url?: string } };
            setFreshLink(body.invite?.url ?? null);
            setInviteName("");
            await refresh();
          }}
        >
          <p className="font-display text-xl text-navy-900">{t("contact.adminNewInvite")}</p>

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
                        : t(kind === "guest" ? "me.inviteGuestBody" : "me.inviteBuddyBody")}
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
          <label className="mt-4 block text-base font-medium text-navy-700" htmlFor="invite-locale">
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
          <button
            type="submit"
            disabled={busy || (inviteKind === "buddy" && trips.length === 0)}
            className="mt-5 rounded-xl bg-navy-900 px-4 py-3 text-base text-cream-50 disabled:opacity-50"
          >
            {t("contact.adminCreate")}
          </button>

          {inviteError && (
            <p role="alert" className="mt-4 text-base leading-7 text-coral-600">
              {inviteError}
            </p>
          )}

          {freshLink && (
            <div className="mt-5">
              <p className="text-base text-coral-600">{t("contact.adminInviteCopy")}</p>
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
