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

export type AdminAddress = {
  name: string;
  line1: string;
  line2: string;
  postcode: string;
  city: string;
  country: string;
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

type Translate = (key: TranslationKey, vars?: Record<string, string>) => string;

/** One person. Declared at module scope rather than inside the page component:
 * a component created during render is a new type on every keystroke, and
 * React throws away its state each time. */
function ContactRow({
  contact,
  t,
  busy,
  act,
}: {
  contact: AdminContact;
  t: Translate;
  busy: boolean;
  act: (body: Record<string, unknown>) => void;
}) {
  const wants = [
    contact.wantsEmailDigest ? t("contact.wantsDigest") : null,
    contact.wantsPostcard ? t("contact.wantsPostcard") : null,
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
          onClick={() => act({ action: "delete", id: contact.id })}
          className="rounded-xl border border-coral-400 px-4 py-2 text-base text-coral-600 disabled:opacity-50"
        >
          {t("contact.adminDelete")}
        </button>
      </div>
    </li>
  );
}

function ContactGroup({
  title,
  rows,
  t,
  busy,
  act,
}: {
  title: string;
  rows: AdminContact[];
  t: Translate;
  busy: boolean;
  act: (body: Record<string, unknown>) => void;
}) {
  return (
    <section className="mt-10">
      <h2 className="font-display text-2xl text-navy-900">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-base text-navy-600">{t("contact.adminNone")}</p>
      ) : (
        <ul className="mt-4 space-y-4">
          {rows.map((contact) => (
            <ContactRow contact={contact} t={t} busy={busy} act={act} key={contact.id} />
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

      <ContactGroup title={t("contact.adminPending")} rows={pending} t={t} busy={busy} act={act} />
      <ContactGroup title={t("contact.adminApproved")} rows={approved} t={t} busy={busy} act={act} />
      {other.length > 0 && (
        <ContactGroup title={t("contact.adminOther")} rows={other} t={t} busy={busy} act={act} />
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
