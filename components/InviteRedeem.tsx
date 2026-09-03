"use client";

import { useState } from "react";
import { LOCALE_LABEL, translate, type TranslationKey } from "@/lib/i18n";
import type { Locale } from "@/lib/types";

/**
 * Redeeming a guest or a buddy link — B33.
 *
 * The guestbook (`ContactForm`) asks for a name, an address, a phone number
 * and two consents, because it *is* the guestbook: it is where somebody signs
 * up for postcards and a digest. This asks for two things and refuses to ask
 * for a third — **a name, and an address it can prove** — because being let
 * into somebody's journal needs nothing else, and a redemption that quietly
 * rewrote a reader's postal address or unticked their digest would be a form
 * doing something nobody asked it to.
 *
 * Each of the two is skipped when it is already known:
 *
 * - Signed in to this journal already, and the address is proved. The whole
 *   screen collapses to one button — no email box, no six digits, no second
 *   mail. Somebody who already has a journal on this instance and is reading
 *   this one is the expected case, not the edge case.
 * - Known here already, and the name on file stands. It is shown, and it can
 *   be corrected, and leaving it alone changes nothing.
 *
 * What it never does is tell somebody they are in. Redeeming is asking; the
 * last screen says so in those words, because a form that appears to succeed
 * and then goes quiet leaves people waiting for a reply that never comes.
 */

type Step = "form" | "confirm" | "code" | "waiting" | "in";

const FIELD =
  "mt-2 w-full rounded-xl border border-navy-200 bg-white px-4 py-3 text-lg text-navy-900";
const LABEL = "block text-base font-medium text-navy-700";
const BUTTON =
  "mt-8 inline-flex min-h-12 w-full items-center justify-center rounded-full bg-yellow-400 px-6 text-lg font-semibold text-yellow-950 transition-colors hover:bg-yellow-300 disabled:opacity-60 sm:w-auto";

export default function InviteRedeem({
  username,
  journalTitle,
  kind,
  tripTitle,
  token,
  initialLocale,
  locales,
  dictionaries,
  knownEmail,
  initialName,
  alreadyIn,
}: {
  username: string;
  journalTitle: string;
  kind: "guest" | "buddy";
  /** The trip a buddy link joins, for saying which one they are being asked
   * onto. Null for a guest link, which is journal-wide by design. */
  tripTitle: string | null;
  token: string;
  initialLocale: Locale;
  locales: string[];
  dictionaries: Record<string, Record<string, string>>;
  /** The address on a session **for this journal**. Its presence is what turns
   * the form into a single button; it is never sent to the server, which reads
   * the session itself. */
  knownEmail: string | null;
  initialName: string;
  /** They already hold everything this link leads to. */
  alreadyIn: boolean;
}) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const [step, setStep] = useState<Step>(
    alreadyIn ? "in" : knownEmail ? "confirm" : "form",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TranslationKey | null>(null);
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");

  const t = (key: TranslationKey, vars?: Record<string, string>) =>
    translate(dictionaries[locale] ?? dictionaries.en ?? {}, key, vars);

  const what = kind === "buddy" ? (tripTitle ?? journalTitle) : journalTitle;

  async function redeem(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!knownEmail) {
      if (name.trim() === "") return setError("contact.needName");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
        return setError("contact.needEmail");
      }
    }

    setBusy(true);
    const response = await fetch("/api/contacts/redeem", {
      method: "POST",
      headers: { "content-type": "application/json" },
      // No email when the session carries one: the server reads it off the
      // cookie, and a body that could name an address would be a way of
      // confirming somebody else's.
      body: JSON.stringify({ user: username, token, kind, name, locale, ...(knownEmail ? {} : { email }) }),
    }).catch(() => null);
    setBusy(false);

    if (!response) return setError("contact.error");
    if (response.status === 429) return setError("contact.tooMany");
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (body.error === "invalid_email") return setError("contact.needEmail");
      if (body.error === "invalid_name") return setError("contact.needName");
      return setError("contact.error");
    }

    const body = (await response.json().catch(() => ({}))) as { status?: string };
    if (body.status === "expired") return setError("invite.expired");
    if (body.status === "in") return setStep("in");
    if (body.status === "waiting") return setStep("waiting");
    setStep("code");
  }

  /** The same six digits and the same endpoint the guestbook uses — one code
   * mechanism for the whole site. */
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
      setCode("");
      return setError("contact.codeWrong");
    }
    const body = (await response.json()) as { status?: string };
    setStep(body.status === "active" ? "in" : "waiting");
  }

  return (
    <main className="mx-auto w-full max-w-xl px-6 py-12 sm:py-16" lang={locale}>
      <h1 className="font-display text-3xl leading-tight text-navy-900 sm:text-4xl">
        {step === "in"
          ? t("invite.inTitle")
          : step === "waiting"
            ? t("invite.waitingTitle")
            : step === "code"
              ? t("contact.codeTitle")
              : kind === "buddy"
                ? t("invite.buddyTitle", { what })
                : t("invite.guestTitle", { title: journalTitle })}
      </h1>

      {(step === "form" || step === "confirm") && (
        <form onSubmit={redeem} noValidate>
          <p className="mt-3 text-lg leading-relaxed text-navy-700">
            {kind === "buddy"
              ? t("invite.buddyIntro", { what, title: journalTitle })
              : t("invite.guestIntro", { title: journalTitle })}
          </p>

          {step === "confirm" ? (
            <p className="mt-6 rounded-2xl border border-navy-200 bg-cream-100 p-5 text-lg text-navy-800">
              {t("invite.confirmAs", { email: knownEmail ?? "" })}
            </p>
          ) : (
            <>
              <div className="mt-8">
                <label className={LABEL} htmlFor="invite-name">
                  {t("contact.name")}
                </label>
                <input
                  id="invite-name"
                  className={FIELD}
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="mt-6">
                <label className={LABEL} htmlFor="invite-email">
                  {t("contact.email")}
                </label>
                <input
                  id="invite-email"
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
                <label className={LABEL} htmlFor="invite-locale">
                  {t("contact.language")}
                </label>
                <select
                  id="invite-locale"
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
            </>
          )}

          <p className="mt-6 text-base leading-relaxed text-navy-600">{t("invite.notYet")}</p>

          {error && <p className="mt-6 text-lg text-red-700">{t(error)}</p>}
          <button className={BUTTON} disabled={busy} type="submit">
            {step === "confirm" ? t("invite.confirmSubmit") : t("invite.submit")}
          </button>
        </form>
      )}

      {step === "code" && (
        <form onSubmit={submitCode} noValidate>
          <p className="mt-3 text-lg leading-relaxed text-navy-700">
            {t("contact.codeIntro", { email })}
          </p>
          <div className="mt-8">
            <label className={LABEL} htmlFor="invite-code">
              {t("contact.code")}
            </label>
            <input
              id="invite-code"
              className={`${FIELD} tracking-[0.4em]`}
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
          {error && <p className="mt-6 text-lg text-red-700">{t(error)}</p>}
          <button className={BUTTON} disabled={busy} type="submit">
            {t("contact.codeSubmit")}
          </button>
        </form>
      )}

      {step === "waiting" && (
        <p className="mt-5 text-xl leading-8 text-navy-700">
          {t("invite.waitingBody", { title: journalTitle })}
        </p>
      )}

      {step === "in" && (
        <>
          <p className="mt-5 text-xl leading-8 text-navy-700">
            {t("invite.inBody", { title: journalTitle })}
          </p>
          <a
            className="mt-9 inline-flex min-h-12 items-center justify-center rounded-full bg-yellow-400 px-6 text-lg font-semibold text-yellow-950 transition-colors hover:bg-yellow-300"
            href={`/${username}`}
          >
            {t("err.goToJournal", { title: journalTitle })}
          </a>
        </>
      )}
    </main>
  );
}
