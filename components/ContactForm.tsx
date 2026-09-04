"use client";

import { useState } from "react";
import { codeConfirmErrorKey } from "@/lib/contacts/codeConfirmError";
import { LOCALE_LABEL, translate, type TranslationKey } from "@/lib/i18n";
import type { Locale } from "@/lib/types";

/**
 * The guestbook (C11).
 *
 * One screen, big type, in their language. Written for a reader in their
 * seventies on a phone, so: no account, no password, no progress bar, and the
 * word "register" nowhere on it. They write their name, they write their
 * address, they press one button.
 *
 * Two things it does *not* do, both on purpose:
 *
 * - It does not read the locale from `LocaleProvider`. The language is decided
 *   on the server — from the invite token, then `?lang=`, then
 *   `Accept-Language` — and passed in as a prop, so the first paint is already
 *   right. Adopting a locale after hydration would show a German grandmother an
 *   English form for half a second, which is exactly the friction the personal
 *   link exists to remove.
 * - It does not treat the name it was given as identity. A forwarded link
 *   prefills the greeting and nothing else; whoever is sitting there types
 *   their own address and gets their own code.
 *
 * It is reached from one place — `/{user}/i/<token>`, a link the owner issued
 * for a named person. There was a second, open address for it and it is gone
 * (B37): the form granted nothing, but offering it to anybody who found a
 * username advertised a way in the owner had never offered.
 */

type Step = "form" | "code" | "done";

// No local focus ring: the global one in globals.css is blue-500, chosen
// because it is the single palette colour that clears 3:1 against every
// surface a control sits on. sky-500 is 2.73:1 on white and 2.63:1 on cream,
// so as a focus indicator it failed everywhere it was drawn.
const FIELD =
  "mt-2 w-full rounded-xl border border-navy-200 bg-white px-4 py-3 text-lg text-navy-900";
const LABEL = "block text-base font-medium text-navy-700";

export default function ContactForm({
  username,
  journalTitle,
  initialLocale,
  locales,
  dictionaries,
  initialName = "",
  inviteToken,
}: {
  username: string;
  journalTitle: string;
  initialLocale: Locale;
  /** The languages this journal offers, from its config. */
  locales: string[];
  /** Strings for every language this form offers, keyed by code. The form
   * switches language without a round trip, so it needs them all up front. */
  dictionaries: Record<string, Record<string, string>>;
  initialName?: string;
  /** Required since B37: the endpoint refuses a submission without a live
   * invite token, so a form rendered without one could only ever lie to the
   * person filling it in. */
  inviteToken: string;
}) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const [step, setStep] = useState<Step>("form");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TranslationKey | null>(null);

  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState("");
  const [wantsDigest, setWantsDigest] = useState(true);
  const [wantsPostcard, setWantsPostcard] = useState(false);
  const [address, setAddress] = useState({
    name: "",
    line1: "",
    line2: "",
    postcode: "",
    city: "",
    country: "",
    tel: "",
  });
  const [code, setCode] = useState("");
  const [manage, setManage] = useState<string | null>(null);
  const [approved, setApproved] = useState(false);

  const t = (key: TranslationKey, vars?: Record<string, string>) =>
    translate(dictionaries[locale] ?? dictionaries.en ?? {}, key, vars);

  function setAddressField(field: keyof typeof address, value: string) {
    setAddress((previous) => ({ ...previous, [field]: value }));
    // Somebody typing a street plainly wants the postcard; ticking the box for
    // them saves a step, and it stays a box they can untick.
    if (value.trim() !== "") setWantsPostcard(true);
  }

  // A phone number is not a postal address, and giving one is not asking for
  // a postcard — unlike `setAddressField` above, typing a `tel` must never
  // tick that box for them.
  function setTel(value: string) {
    setAddress((previous) => ({ ...previous, tel: value }));
  }

  async function submitDetails(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (name.trim() === "") return setError("contact.needName");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      return setError("contact.needEmail");
    }
    if (
      wantsPostcard &&
      (address.line1.trim() === "" || address.city.trim() === "" || address.country.trim() === "")
    ) {
      return setError("contact.needAddress");
    }

    setBusy(true);
    const response = await fetch("/api/contacts/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        user: username,
        name,
        email,
        locale,
        locales,
        invite: inviteToken,
        wantsEmailDigest: wantsDigest,
        wantsPostcard,
        // The phone number is always sent; the postal address only comes
        // along when the postcard box is ticked — never `null`, so a `tel`
        // typed in without wanting a postcard is not silently dropped.
        address: wantsPostcard
          ? address
          : {
              name: "",
              line1: "",
              line2: "",
              postcode: "",
              city: "",
              country: "",
              tel: address.tel,
            },
      }),
    }).catch(() => null);
    setBusy(false);

    if (!response) return setError("contact.error");
    if (response.status === 429) return setError("contact.tooMany");
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (body.error === "invalid_email") return setError("contact.needEmail");
      if (body.error === "invalid_name") return setError("contact.needName");
      if (body.error === "invalid_address") return setError("contact.needAddress");
      return setError("contact.error");
    }
    setStep("code");
  }

  async function submitCode(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const response = await fetch("/api/contacts/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user: username, email, code }),
    }).catch(() => null);
    setBusy(false);

    if (!response) return setError("contact.error");
    if (response.status === 429) return setError("contact.tooMany");
    if (!response.ok) {
      // Only a rejected code (401) is worth retyping — see codeConfirmError.ts.
      if (response.status === 401) setCode("");
      return setError(codeConfirmErrorKey(response.status));
    }
    const body = (await response.json()) as { manageUrl?: string; status?: string };
    setManage(body.manageUrl ?? null);
    // Whether this person is already a reader. The *request* endpoint answers
    // the same 202 to everybody on purpose — otherwise the form is a way of
    // asking who else is on the list — but by this point they have proved they
    // own the address, so telling them the truth reveals nothing they did not
    // already have. Somebody who was waved in months ago and filled the form
    // in again was being told to wait for an approval they already had.
    setApproved(body.status === "active");
    setStep("done");
  }

  return (
    <main className="mx-auto w-full max-w-xl px-6 py-12 sm:py-16" lang={locale}>
      {step === "form" && (
        <form onSubmit={submitDetails} noValidate>
          <h1 className="font-display text-3xl leading-tight text-navy-900 sm:text-4xl">
            {initialName ? t("contact.greeting", { name: initialName }) : t("contact.title")}
          </h1>
          <p className="mt-3 text-lg leading-relaxed text-navy-700">{t("contact.intro")}</p>

          <div className="mt-8">
            <label className={LABEL} htmlFor="contact-name">
              {t("contact.name")}
            </label>
            <input
              id="contact-name"
              className={FIELD}
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="mt-6">
            <label className={LABEL} htmlFor="contact-email">
              {t("contact.email")}
            </label>
            <input
              id="contact-email"
              className={FIELD}
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <p className="mt-2 text-base text-navy-600">{t("contact.emailHint")}</p>
          </div>

          <div className="mt-6">
            <label className={LABEL} htmlFor="contact-locale">
              {t("contact.language")}
            </label>
            <select
              id="contact-locale"
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

          <div className="mt-6">
            <label className={LABEL} htmlFor="contact-tel">
              {`${t("contact.tel")} (${t("contact.optional")})`}
            </label>
            <input
              id="contact-tel"
              className={FIELD}
              type="tel"
              autoComplete="tel"
              value={address.tel}
              onChange={(e) => setTel(e.target.value)}
            />
            <p className="mt-2 text-base text-navy-600">{t("contact.telHint")}</p>
          </div>

          <fieldset className="mt-10 rounded-2xl border border-navy-200 bg-cream-100 p-5">
            <legend className="px-2 font-display text-xl text-navy-900">
              {t("contact.address")}
            </legend>
            <p className="text-base text-navy-700">{t("contact.addressHint")}</p>

            <div className="mt-4">
              <label className={LABEL} htmlFor="addr-name">
                {t("contact.addrName")}
              </label>
              <input
                id="addr-name"
                className={FIELD}
                value={address.name}
                onChange={(e) => setAddressField("name", e.target.value)}
              />
            </div>
            <div className="mt-4">
              <label className={LABEL} htmlFor="addr-line1">
                {t("contact.addrLine1")}
              </label>
              <input
                id="addr-line1"
                className={FIELD}
                autoComplete="address-line1"
                value={address.line1}
                onChange={(e) => setAddressField("line1", e.target.value)}
              />
            </div>
            <div className="mt-4">
              <label className={LABEL} htmlFor="addr-line2">
                {`${t("contact.addrLine2")} (${t("contact.optional")})`}
              </label>
              <input
                id="addr-line2"
                className={FIELD}
                autoComplete="address-line2"
                value={address.line2}
                onChange={(e) => setAddressField("line2", e.target.value)}
              />
            </div>
            <div className="mt-4 flex gap-4">
              <div className="w-1/3">
                <label className={LABEL} htmlFor="addr-postcode">
                  {t("contact.addrPostcode")}
                </label>
                <input
                  id="addr-postcode"
                  className={FIELD}
                  autoComplete="postal-code"
                  value={address.postcode}
                  onChange={(e) => setAddressField("postcode", e.target.value)}
                />
              </div>
              <div className="flex-1">
                <label className={LABEL} htmlFor="addr-city">
                  {t("contact.addrCity")}
                </label>
                <input
                  id="addr-city"
                  className={FIELD}
                  autoComplete="address-level2"
                  value={address.city}
                  onChange={(e) => setAddressField("city", e.target.value)}
                />
              </div>
            </div>
            <div className="mt-4">
              <label className={LABEL} htmlFor="addr-country">
                {t("contact.addrCountry")}
              </label>
              <input
                id="addr-country"
                className={FIELD}
                autoComplete="country-name"
                value={address.country}
                onChange={(e) => setAddressField("country", e.target.value)}
              />
            </div>
          </fieldset>

          {/* Two questions, two boxes. "Write to me" and "post me something"
              have different consequences and are never answered at once. */}
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

          {error && (
            <p role="alert" className="mt-6 text-base text-coral-600">
              {t(error)}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mt-8 w-full rounded-xl bg-navy-900 px-4 py-4 text-lg font-medium text-cream-50 disabled:opacity-50"
          >
            {busy ? t("contact.working") : t("contact.submit")}
          </button>
        </form>
      )}

      {step === "code" && (
        <form onSubmit={submitCode}>
          <h1 className="font-display text-3xl leading-tight text-navy-900 sm:text-4xl">
            {t("contact.codeTitle")}
          </h1>
          <p className="mt-3 text-lg leading-relaxed text-navy-700">
            {t("contact.codeIntro", { email })}
          </p>
          <label className={`${LABEL} mt-8`} htmlFor="contact-code">
            {t("contact.code")}
          </label>
          <input
            id="contact-code"
            className={`${FIELD} tracking-[0.4em]`}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          />
          {error && (
            <p role="alert" className="mt-6 text-base text-coral-600">
              {t(error)}
            </p>
          )}
          <button
            type="submit"
            disabled={busy || code.length < 6}
            className="mt-8 w-full rounded-xl bg-navy-900 px-4 py-4 text-lg font-medium text-cream-50 disabled:opacity-50"
          >
            {busy ? t("contact.working") : t("contact.codeSubmit")}
          </button>
        </form>
      )}

      {step === "done" && (
        <div>
          <h1 className="font-display text-3xl leading-tight text-navy-900 sm:text-4xl">
            {t(approved ? "contact.welcomeBackTitle" : "contact.doneTitle")}
          </h1>
          <p className="mt-3 text-lg leading-relaxed text-navy-700">
            {t(approved ? "contact.welcomeBackBody" : "contact.doneBody", {
              title: journalTitle,
            })}
          </p>
          {approved && (
            <p className="mt-6 text-base">
              <a
                className="text-navy-900 underline decoration-sky-500 decoration-2 underline-offset-2"
                href={`/${username}`}
              >
                {t("contact.startReading", { title: journalTitle })}
              </a>
            </p>
          )}
          {manage && (
            <p className="mt-6 text-base">
              <a
              className="text-navy-900 underline decoration-sky-500 decoration-2 underline-offset-2"
              href={manage}
            >
                {t("contact.manageLink")}
              </a>
            </p>
          )}
        </div>
      )}

      {/* No header on this page either — somebody who followed the link into a
          journal they have not joined yet still needs a way into it. Written
          out rather than sharing `BackToJournal`, because this form carries
          its own language picker and the link has to follow it, not the
          cookie the rest of the site reads. */}
      <p className="mt-12 border-t border-navy-200 pt-6 text-sm">
        <a
          href={`/${username}`}
          className="text-navy-600 underline-offset-4 hover:text-navy-900 hover:underline"
        >
          ← {t("nav.toJournal", { title: journalTitle })}
        </a>
      </p>
    </main>
  );
}
