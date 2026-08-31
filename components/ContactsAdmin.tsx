"use client";

import { useState } from "react";
import { LOCALE_LABEL, translate, type TranslationKey } from "@/lib/i18n";
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
  postalAddress: AdminAddress | null;
  createdVia: string | null;
  createdAt: string;
  confirmedAt: string | null;
  lastSeenAt: string | null;
};

export type AdminInvite = {
  id: string;
  name: string | null;
  locale: Locale | null;
  createdAt: string;
  revokedAt: string | null;
  uses: number;
};

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
  t,
  busy,
  act,
  onEdit,
}: {
  contact: AdminContact;
  t: Translate;
  busy: boolean;
  act: (body: Record<string, unknown>) => void;
  onEdit: (contact: AdminContact) => void;
}) {
  // Owner-facing copy, not the guest form's first-person "Send me…" — this
  // list is read by the owner, about somebody else.
  const wants = [
    contact.wantsEmailDigest ? t("contact.adminWantsDigest") : null,
    contact.wantsPostcard ? t("contact.adminWantsPostcard") : null,
  ].filter(Boolean);

  const postal = contact.postalAddress;

  return (
    <li className="rounded-2xl border border-navy-200 bg-white p-5">
      <p className="font-display text-xl text-navy-900">{contact.name ?? contact.email}</p>
      <p className="text-base text-navy-700">{contact.email}</p>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm text-navy-600">
        <dt>{t("contact.language")}</dt>
        <dd>{contact.locale ? LOCALE_LABEL[contact.locale] : "—"}</dd>
        <dt>{t("contact.adminVia")}</dt>
        <dd>{contact.createdVia ?? "—"}</dd>
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
            <dt>{t("contact.adminPostcardTo")}</dt>
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
      <div className="mt-4 flex flex-wrap gap-2">
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
  tel: string;
  addressName: string;
  line1: string;
  line2: string;
  postcode: string;
  city: string;
  country: string;
  wantsEmailDigest: boolean;
  wantsPostcard: boolean;
};

function fieldsFor(contact: AdminContact | null, fallbackLocale: Locale): GuestFields {
  const postal = contact?.postalAddress;
  return {
    name: contact?.name ?? "",
    email: contact?.email ?? "",
    locale: contact?.locale ?? fallbackLocale,
    tel: postal?.tel ?? "",
    addressName: postal?.name ?? "",
    line1: postal?.line1 ?? "",
    line2: postal?.line2 ?? "",
    postcode: postal?.postcode ?? "",
    city: postal?.city ?? "",
    country: postal?.country ?? "",
    wantsEmailDigest: contact?.wantsEmailDigest ?? false,
    wantsPostcard: contact?.wantsPostcard ?? false,
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
function GuestForm({
  contact,
  fallbackLocale,
  locales,
  t,
  busy,
  act,
  onClose,
}: {
  /** The row being corrected, or `null` to add a new one. */
  contact: AdminContact | null;
  fallbackLocale: Locale;
  locales: string[];
  t: Translate;
  busy: boolean;
  act: (body: Record<string, unknown>) => Promise<Response | null>;
  onClose: () => void;
}) {
  const editingId = contact?.id ?? null;
  const [form, setForm] = useState<GuestFields>(() => fieldsFor(contact, fallbackLocale));
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
      address: {
        name: form.addressName,
        line1: form.line1,
        line2: form.line2,
        postcode: form.postcode,
        city: form.city,
        country: form.country,
        tel: form.tel,
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
        <input
          id="guest-tel"
          className={FIELD}
          type="tel"
          value={form.tel}
          onChange={(e) => field("tel", e.target.value)}
        />
      </div>

      <fieldset className="mt-6 rounded-2xl border border-navy-200 bg-white p-5">
        <legend className="px-2 font-display text-lg text-navy-900">
          {t("contact.address")}
        </legend>
        <p className="text-base text-navy-700">{t("contact.adminAddressHint")}</p>

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
          <input
            id="guest-addr-country"
            className={FIELD}
            value={form.country}
            onChange={(e) => field("country", e.target.value)}
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
        <label className="flex items-start gap-3 text-base text-navy-900">
          <input
            type="checkbox"
            className="mt-1 size-5"
            checked={form.wantsPostcard}
            onChange={(e) => field("wantsPostcard", e.target.checked)}
          />
          <span>{t("contact.adminWantsPostcard")}</span>
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
  t,
  busy,
  act,
  onEdit,
}: {
  title: string;
  rows: AdminContact[];
  t: Translate;
  busy: boolean;
  act: (body: Record<string, unknown>) => void;
  onEdit: (contact: AdminContact) => void;
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
              t={t}
              busy={busy}
              act={act}
              onEdit={onEdit}
              key={contact.id}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

export default function ContactsAdmin({
  username,
  locale,
  locales,
  dictionary,
  contacts: initialContacts,
  invites: initialInvites,
  openLink,
}: {
  username: string;
  locale: Locale;
  /** The languages this journal offers, from its config. */
  locales: string[];
  dictionary: Record<string, string>;
  contacts: AdminContact[];
  invites: AdminInvite[];
  openLink: string;
}) {
  const [contacts, setContacts] = useState(initialContacts);
  const [invites, setInvites] = useState(initialInvites);
  const [inviteName, setInviteName] = useState("");
  const [inviteLocale, setInviteLocale] = useState<Locale>(locale);
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

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12" lang={locale}>
      <h1 className="font-display text-3xl text-navy-900 sm:text-4xl">
        {t("contact.adminTitle")}
      </h1>
      <p className="mt-3 text-lg text-navy-700">{t("contact.adminSubtitle")}</p>

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
          />
        )}
      </div>

      <ContactGroup
        title={t("contact.adminPending")}
        rows={pending}
        t={t}
        busy={busy}
        act={act}
        onEdit={setFormTarget}
      />
      <ContactGroup
        title={t("contact.adminApproved")}
        rows={approved}
        t={t}
        busy={busy}
        act={act}
        onEdit={setFormTarget}
      />
      {other.length > 0 && (
        <ContactGroup
          title={t("contact.adminOther")}
          rows={other}
          t={t}
          busy={busy}
          act={act}
          onEdit={setFormTarget}
        />
      )}

      <section className="mt-14">
        <h2 className="font-display text-2xl text-navy-900">{t("contact.adminLinks")}</h2>

        <p className="mt-4 text-base font-medium text-navy-700">{t("contact.adminOpenLink")}</p>
        <p className="text-base text-navy-600">{t("contact.adminOpenLinkHint")}</p>
        <code className="mt-2 block break-all rounded-xl bg-cream-100 p-3 text-sm text-navy-900">
          {openLink}
        </code>

        <form
          className="mt-8 rounded-2xl border border-navy-200 p-5"
          onSubmit={async (event) => {
            event.preventDefault();
            const response = await act({
              action: "invite",
              name: inviteName,
              locale: inviteLocale,
            });
            if (!response?.ok) return;
            const body = (await response.json()) as { url?: string };
            setFreshLink(body.url ?? null);
            setInviteName("");
          }}
        >
          <p className="font-display text-xl text-navy-900">{t("contact.adminNewInvite")}</p>
          <label className="mt-4 block text-base font-medium text-navy-700" htmlFor="invite-name">
            {t("contact.adminInviteFor")}
          </label>
          <input
            id="invite-name"
            className="mt-2 w-full rounded-xl border border-navy-200 bg-white px-4 py-3 text-lg"
            value={inviteName}
            onChange={(e) => setInviteName(e.target.value)}
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
            disabled={busy}
            className="mt-5 rounded-xl bg-navy-900 px-4 py-3 text-base text-cream-50 disabled:opacity-50"
          >
            {t("contact.adminCreate")}
          </button>

          {freshLink && (
            <div className="mt-5">
              <p className="text-base text-coral-600">{t("contact.adminInviteCopy")}</p>
              <code className="mt-2 block break-all rounded-xl bg-cream-100 p-3 text-sm text-navy-900">
                {freshLink}
              </code>
            </div>
          )}
        </form>

        {invites.length > 0 && (
          <ul className="mt-6 space-y-2">
            {invites.map((invite) => (
              <li
                key={invite.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-navy-200 px-4 py-3"
              >
                <span className="text-base text-navy-900">
                  {`${invite.name ?? "—"} · ${invite.locale ? LOCALE_LABEL[invite.locale] : "—"} · ${t("contact.adminInviteUses", { count: String(invite.uses) })}`}
                </span>
                {!invite.revokedAt && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => act({ action: "revoke-invite", id: invite.id })}
                    className="rounded-lg border border-navy-200 px-3 py-1 text-sm text-navy-700 disabled:opacity-50"
                  >
                    {t("contact.adminRevokeLink")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
