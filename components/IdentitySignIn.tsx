"use client";

import { useState } from "react";
import { useI18n } from "@/components/LocaleProvider";

/**
 * The way in, from the front door — B426.
 *
 * B411 gave the root page something to show a signed-in reader and no way for
 * anybody to become one. The credential existed, the endpoints existed, and
 * the only doors to them were the API itself and signing in to a journal at
 * `/<user>/me` — which issues an identity as a side effect, and which you have
 * to already know the name of a journal to reach. Somebody opening
 * fernscout.ch got the pitch and no alternative, whether or not they owned a
 * journal on it.
 *
 * Two steps, because the code arrives out of band. `GuestSignIn` is the same
 * shape one level down and the fields are deliberately identical; what differs
 * is the sentence and the endpoint.
 *
 * ## Why this one may say "a code is on its way" without qualification
 *
 * `GuestSignIn` says *if that address has access* — a journal's sign-in is a
 * question about who reads that journal, and an answer that distinguished a
 * known address from an unknown one would be a way to ask. Here there is no
 * such question: an identity is issued to any address that can prove itself,
 * because it authorises nothing on its own. What it opens is worked out per
 * journal, afterwards, from grants nobody can see from out here. So the
 * hedge would be pure noise — and worse, it would suggest the code depends on
 * something the reader might not have.
 */
export default function IdentitySignIn({
  codeMinutes,
  onDone,
}: {
  /** How long the code lasts, from `CODE_TTL_MINUTES`. Passed rather than
   * imported: this is a client component and `lib/auth` is server-only. */
  codeMinutes: string;
  /** Called once the cookie is set, so the page can show what it opened. */
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  async function requestCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setUnavailable(false);
    const response = await fetch("/api/auth/identity/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    }).catch(() => null);
    setBusy(false);

    /**
     * The two refusals that are about the *server* rather than the address,
     * and so may be shown.
     *
     * 404 is the capability switched off; 503 is mail not configured. Neither
     * says anything about who reads anything, and both leave somebody staring
     * at a code field for a code that is never coming if they are swallowed.
     * Every other answer — including a rate limit — forwards, because the
     * uniform 202 is what stops this becoming a way to ask which addresses
     * exist.
     */
    if (response && (response.status === 404 || response.status === 503)) {
      setUnavailable(true);
      return;
    }
    setStep("code");
  }

  async function submitCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setWrong(false);
    const response = await fetch("/api/auth/identity/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, code }),
    }).catch(() => null);

    if (response?.ok) {
      onDone();
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
      <h2 className="font-display text-xl font-semibold text-navy-900">{t("home.signInTitle")}</h2>

      {unavailable ? (
        <p role="alert" className="mt-2 text-base leading-7 text-navy-700">
          {t("home.signInUnavailable")}
        </p>
      ) : step === "email" ? (
        <form onSubmit={requestCode}>
          <p className="mt-2 text-base leading-7 text-navy-700">{t("home.signInBody")}</p>
          <label htmlFor="identity-email" className="mt-4 block text-base font-medium text-navy-700">
            {t("me.signInEmail")}
          </label>
          <input
            id="identity-email"
            type="email"
            name="email"
            autoComplete="email"
            required
            autoFocus
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
            {t("home.signInSent", { minutes: codeMinutes })}
          </p>
          <label htmlFor="identity-code" className="mt-4 block text-base font-medium text-navy-700">
            {t("me.signInCode")}
          </label>
          <input
            id="identity-code"
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
            aria-describedby={wrong ? "identity-error" : undefined}
            aria-invalid={wrong ? true : undefined}
            className={`${field} font-mono text-2xl tracking-[0.3em]`}
          />
          <p id="identity-error" role="alert" className="mt-3 text-base text-coral-600 empty:mt-0">
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
