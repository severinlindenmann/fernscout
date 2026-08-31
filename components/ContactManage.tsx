"use client";

import { useState } from "react";
import { LOCALE_LABEL, translate, type TranslationKey } from "@/lib/i18n";
import type { Locale } from "@/lib/types";

/**
 * "Your details" — the page every mail footer points at (C13).
 *
 * No login. The token in the URL is the whole credential, and everything on the
 * page acts on one row. It is also the delete path the data-protection sections
 * of the roadmap ask for, which is why "delete me completely" is a plain button
 * and not something you have to write an email about.
 *
 * Rendered in the reader's own language, taken from their record rather than
 * from the browser.
 */

export type ManageAddress = {
  name: string;
  line1: string;
  line2: string;
  postcode: string;
  city: string;
  country: string;
};

export type ManageContact = {
  name: string;
  email: string;
  locale: Locale;
  status: "pending" | "active" | "blocked";
  wantsEmailDigest: boolean;
  wantsPostcard: boolean;
  address: ManageAddress;
};

// No local focus ring: the global one in globals.css is blue-500, chosen
// because it is the single palette colour that clears 3:1 against every
// surface a control sits on. sky-500 is 2.73:1 on white and 2.63:1 on cream,
// so as a focus indicator it failed everywhere it was drawn.
const FIELD =
  "mt-2 w-full rounded-xl border border-navy-200 bg-white px-4 py-3 text-lg text-navy-900";
const LABEL = "block text-base font-medium text-navy-700";

const STATUS_KEY: Record<ManageContact["status"], TranslationKey> = {
  pending: "contact.statusPending",
  active: "contact.statusActive",
  blocked: "contact.statusBlocked",
};

export default function ContactManage({
  username,
  token,
  contact,
  locales,
  dictionary,
}: {
  username: string;
  /** The languages this journal offers, from its config. */
  locales: string[];
  dictionary: Record<string, string>;
  token: string;
  contact: ManageContact;
}) {
  const [locale, setLocale] = useState<Locale>(contact.locale);
  const [name, setName] = useState(contact.name);
  const [address, setAddress] = useState<ManageAddress>(contact.address);
  const [wantsDigest, setWantsDigest] = useState(contact.wantsEmailDigest);
  const [wantsPostcard, setWantsPostcard] = useState(contact.wantsPostcard);
  const [note, setNote] = useState<TranslationKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleted, setDeleted] = useState(false);

  const t = (key: TranslationKey, vars?: Record<string, string>) =>
    translate(dictionary, key, vars);

  async function post(body: Record<string, unknown>, done: TranslationKey) {
    setBusy(true);
    const response = await fetch("/api/contacts/manage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user: username, token, ...body }),
    }).catch(() => null);
    setBusy(false);
    setNote(response?.ok ? done : "contact.error");
    return Boolean(response?.ok);
  }

  if (deleted) {
    return (
      <main className="mx-auto w-full max-w-xl px-6 py-16" lang={locale}>
        <h1 className="font-display text-3xl text-navy-900">{t("contact.deleted")}</h1>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-xl px-6 py-12 sm:py-16" lang={locale}>
      <h1 className="font-display text-3xl leading-tight text-navy-900 sm:text-4xl">
        {t("contact.manageTitle")}
      </h1>
      <p className="mt-3 text-lg leading-relaxed text-navy-700">{t("contact.manageIntro")}</p>
      <p className="mt-2 text-base text-navy-600">
        {`${contact.email} — ${t(STATUS_KEY[contact.status])}`}
      </p>

      <form
        className="mt-8"
        onSubmit={async (event) => {
          event.preventDefault();
          await post(
            { action: "update", name, locale, address, wantsEmailDigest: wantsDigest, wantsPostcard },
            "contact.saved",
          );
        }}
      >
        <label className={LABEL} htmlFor="manage-name">
          {t("contact.name")}
        </label>
        <input
          id="manage-name"
          className={FIELD}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <div className="mt-6">
          <label className={LABEL} htmlFor="manage-locale">
            {t("contact.language")}
          </label>
          <select
            id="manage-locale"
            className={FIELD}
            value={locale}
            onChange={(e) => setLocale(e.target.value as Locale)}
          >
            {locales.map((option: string) => (
              <option key={option} value={option}>
                {LOCALE_LABEL[option]}
              </option>
            ))}
          </select>
        </div>

        <fieldset className="mt-8 rounded-2xl border border-navy-200 bg-cream-100 p-5">
          <legend className="px-2 font-display text-xl text-navy-900">
            {t("contact.address")}
          </legend>
          <p className="text-base text-navy-700">{t("contact.addressHint")}</p>
          {(
            [
              ["name", "contact.addrName"],
              ["line1", "contact.addrLine1"],
              ["line2", "contact.addrLine2"],
              ["postcode", "contact.addrPostcode"],
              ["city", "contact.addrCity"],
              ["country", "contact.addrCountry"],
            ] as [keyof ManageAddress, TranslationKey][]
          ).map(([field, key]) => (
            <div className="mt-4" key={field}>
              <label className={LABEL} htmlFor={`manage-${field}`}>
                {t(key)}
              </label>
              <input
                id={`manage-${field}`}
                className={FIELD}
                value={address[field]}
                onChange={(e) =>
                  setAddress((previous) => ({ ...previous, [field]: e.target.value }))
                }
              />
            </div>
          ))}
        </fieldset>

        <div className="mt-8 space-y-4">
          <label className="flex items-start gap-3 text-lg text-navy-900">
            <input
              type="checkbox"
              className="mt-1.5 size-5"
              checked={wantsDigest}
              onChange={(e) => setWantsDigest(e.target.checked)}
            />
            <span>{t("contact.wantsDigest")}</span>
          </label>
          <label className="flex items-start gap-3 text-lg text-navy-900">
            <input
              type="checkbox"
              className="mt-1.5 size-5"
              checked={wantsPostcard}
              onChange={(e) => setWantsPostcard(e.target.checked)}
            />
            <span>{t("contact.wantsPostcard")}</span>
          </label>
        </div>

        {note && (
          <p role="status" className="mt-6 text-base text-navy-700">
            {t(note)}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="mt-8 w-full rounded-xl bg-navy-900 px-4 py-4 text-lg font-medium text-cream-50 disabled:opacity-50"
        >
          {busy ? t("contact.working") : t("contact.save")}
        </button>
      </form>

      <hr className="my-10 border-navy-200" />

      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          const ok = await post({ action: "unsubscribe" }, "contact.unsubscribed");
          if (ok) {
            setWantsDigest(false);
            setWantsPostcard(false);
          }
        }}
        className="w-full rounded-xl border border-navy-200 px-4 py-3 text-lg text-navy-900"
      >
        {t("contact.unsubscribe")}
      </button>

      <p className="mt-8 text-base text-navy-600">{t("contact.deleteHint")}</p>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          const ok = await post({ action: "delete" }, "contact.deleted");
          if (ok) setDeleted(true);
        }}
        className="mt-3 w-full rounded-xl border border-coral-400 px-4 py-3 text-lg text-coral-600"
      >
        {t("contact.deleteMe")}
      </button>
    </main>
  );
}
