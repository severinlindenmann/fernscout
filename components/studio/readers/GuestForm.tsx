"use client";

import { useEffect, useRef, useState } from "react";
import BusyButton from "@/components/BusyButton";
import AddressLookupField from "@/components/AddressLookupField";
import CountryField from "@/components/CountryField";
import TelField, { joinTel, splitTel } from "@/components/TelField";
import { LOCALE_LABEL, telHintKey, type TranslationKey } from "@/lib/i18n";
import type { Locale } from "@/lib/types";
import type { AdminContact, Translate } from "./shared";

// The same field classes `ContactForm.tsx` uses, so the owner's own guest form
// looks like the one their guests fill in rather than like a different corner
// of the admin.
const FIELD =
  "mt-2 w-full rounded-xl border border-line-quiet bg-surface-raised px-4 py-3 text-lg text-ink-strong";
const LABEL = "block text-base font-medium text-ink-body";

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
      className="mt-4 rounded-2xl border border-line-quiet bg-surface-subtle p-5"
    >
      <p className="font-display text-xl text-ink-strong">
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
          <p role="alert" className="mt-2 text-base text-coral-600">
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
        <p className="mt-2 text-base text-ink-secondary">
          {t(telHintKey("admin", postcardsEnabled, whatsappEnabled))}
        </p>
      </div>

      {/* B383 — the address book is the owner's own, not the postal
          system's: unlike ContactForm's reader-facing gate, this fieldset
          stays up whether or not a print provider is configured, because the
          route already stores whatever is typed here regardless (see
          app/api/contacts/admin/route.ts's "create" case). Only the postcard
          *consent* checkbox below stays behind `postcardsEnabled`. */}
      <fieldset className="mt-6 rounded-2xl border border-line-quiet bg-surface-raised p-5">
        <legend className="px-2 font-display text-lg text-ink-strong">
          {t("contact.address")}
        </legend>
        <p className="text-base text-ink-body">
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
        <label className="flex items-start gap-3 text-base text-ink-strong">
          <input
            type="checkbox"
            className="mt-1 size-5"
            checked={form.wantsEmailDigest}
            onChange={(e) => field("wantsEmailDigest", e.target.checked)}
          />
          <span>{t("contact.adminWantsDigest")}</span>
        </label>
        {postcardsEnabled && (
          <label className="flex items-start gap-3 text-base text-ink-strong">
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
          <label className="flex items-start gap-3 text-base text-ink-strong">
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
          <p className="rounded-xl bg-surface-subtle px-4 py-3 text-sm text-ink-body">
            <span className="font-medium text-ink-strong">
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
          className="rounded-xl bg-action-strong px-4 py-3 text-base text-on-action disabled:opacity-50"
        >
          {t("contact.save")}
        </BusyButton>
        <BusyButton
          busy={busy}
          type="button"
          onClick={onClose}
          className="rounded-xl border border-line-quiet px-4 py-3 text-base text-ink-body disabled:opacity-50"
        >
          {t("contact.adminGuestCancel")}
        </BusyButton>
      </div>
    </form>
  );
}
