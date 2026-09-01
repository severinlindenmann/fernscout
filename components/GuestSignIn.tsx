"use client";

import { useState } from "react";
import { useI18n } from "@/components/LocaleProvider";

/**
 * The way back in, for somebody who has been here before.
 *
 * Until this existed there was none. A guest arrives through a token in an
 * email — `/{user}/i/<token>` or the manage link in a footer — and if that
 * email is gone, so is their access. The one page that exists to answer "what
 * can I see?" sent them to the guestbook to sign up again as though they were
 * a stranger, and on a journal with the guestbook switched off it sent them to
 * a 404. That is the reader this whole area was written for: the grandmother
 * who opens the site once a month and has lost the email.
 *
 * The endpoints were already here. Only the form was missing.
 *
 * Two steps, because the code arrives out of band. The first answers the same
 * way for every address — an address that has access and one that does not are
 * indistinguishable from out here, which is what stops this being a way to ask
 * who reads somebody's journal. Proving you own an address gets you a session;
 * what that session can *see* is decided separately, by whether the owner has
 * approved you.
 */
export default function GuestSignIn({
  username,
  codeMinutes,
  destination,
}: {
  username: string;
  /** How long the code lasts, from `CODE_TTL_MINUTES`. Passed rather than
   * imported: this is a client component and `lib/auth` is server-only. */
  codeMinutes: string;
  /**
   * Where the *button in the mail* should land, when this form is standing in
   * front of a particular page. The trip gate passes the path the reader
   * asked for; `/<user>/me` passes nothing, because the journal is already
   * where somebody signing in there wants to be.
   *
   * Only the link needs it. Typing the six digits never leaves this page —
   * see `submitCode` — so the code has nothing to carry the destination
   * across, and giving `/api/auth/verify` a redirect target would add a
   * second attacker-controlled one for no reader at all.
   */
  destination?: string;
}) {
  const { t } = useI18n();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState(false);

  async function requestCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    await fetch("/api/auth/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user: username, email, destination }),
    }).catch(() => {});
    setBusy(false);
    // Always forward, whatever came back. Stopping here for an address we do
    // not know would answer the question the uniform 202 exists to refuse.
    setStep("code");
  }

  async function submitCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setWrong(false);
    const response = await fetch("/api/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user: username, email, code }),
    }).catch(() => null);

    if (response?.ok) {
      // The session is a cookie the server set, and this page is rendered from
      // it — so a reload, not a router refresh. And a reload is why the code
      // path needs no destination: the reader never left the page they were
      // trying to open, so it re-renders as the thing they came for.
      window.location.reload();
      return;
    }
    setBusy(false);
    setWrong(true);
    setCode("");
  }

  const field =
    "mt-2 w-full rounded-xl border border-navy-200 bg-white px-4 py-3 text-base text-navy-900";
  const button =
    "mt-4 min-h-12 w-full rounded-xl bg-navy-900 px-4 py-3 text-lg font-medium text-cream-50 disabled:opacity-50";

  return (
    <section className="mt-6 rounded-2xl border border-navy-200 bg-white p-5 sm:p-6">
      <h2 className="font-display text-xl font-semibold text-navy-900">{t("me.signInTitle")}</h2>

      {step === "email" ? (
        <form onSubmit={requestCode}>
          <p className="mt-2 text-base leading-7 text-navy-700">{t("me.signInBody")}</p>
          <label htmlFor="signin-email" className="mt-4 block text-base font-medium text-navy-700">
            {t("me.signInEmail")}
          </label>
          <input
            id="signin-email"
            type="email"
            name="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={field}
          />
          <button type="submit" disabled={busy || email === ""} className={button}>
            {busy ? t("me.signInSending") : t("me.signInSend")}
          </button>
        </form>
      ) : (
        <form onSubmit={submitCode}>
          {/* The number comes from CODE_TTL_MS, not from the sentence — see
              CODE_TTL_MINUTES. This is a client component, so it is passed in
              rather than imported. */}
          <p className="mt-2 text-base leading-7 text-navy-700">
            {t("me.signInSent", { minutes: codeMinutes })}
          </p>
          <label htmlFor="signin-code" className="mt-4 block text-base font-medium text-navy-700">
            {t("me.signInCode")}
          </label>
          <input
            id="signin-code"
            name="code"
            // `one-time-code` is what lets a phone offer the code from the
            // message without the reader typing it out.
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            autoFocus
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            aria-describedby={wrong ? "signin-error" : undefined}
            aria-invalid={wrong ? true : undefined}
            className={`${field} font-mono text-2xl tracking-[0.3em]`}
          />
          <p id="signin-error" role="alert" className="mt-3 text-base text-coral-600 empty:mt-0">
            {wrong ? t("me.signInWrong") : ""}
          </p>
          <button type="submit" disabled={busy || code.length < 6} className={button}>
            {busy ? t("me.signInSending") : t("me.signInSubmit")}
          </button>
          <button
            type="button"
            onClick={() => {
              setStep("email");
              setCode("");
              setWrong(false);
            }}
            className="mt-3 min-h-11 text-base text-navy-600 underline underline-offset-4"
          >
            {t("me.signInAgain")}
          </button>
        </form>
      )}
    </section>
  );
}
