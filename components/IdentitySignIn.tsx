"use client";

import { useRef, useState } from "react";
import BusyButton from "@/components/BusyButton";
import { useReducedMotion } from "motion/react";
import { PRIMARY_BUTTON } from "@/components/LandingSections";
import { useI18n } from "@/components/LocaleProvider";
import EnvelopeFly from "@/components/EnvelopeFly";

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
  // The envelope — B753. `flying` mounts it; `flightId` gives each send its
  // own key so a second send while the first flight is still finishing
  // restarts it rather than reusing a component mid-animation. It lives on
  // the whole panel (below), not inside the email form alone, so a fast
  // response that flips `step` to "code" does not unmount it mid-flight.
  const reduceMotion = useReducedMotion();
  const [flying, setFlying] = useState(false);
  const [flightId, setFlightId] = useState(0);
  /**
   * Where the flight starts, in the panel's own coordinates — B762.
   *
   * The envelope is mounted against the panel rather than against the button,
   * because a fast response swaps the email form out and anything rendered
   * inside it is unmounted mid-flight. But it has to *leave from* the button,
   * or the gesture does not read as a consequence of pressing it. So the
   * button's centre is measured at send time and handed over; the panel is
   * the positioned ancestor either way.
   */
  const panelRef = useRef<HTMLElement | null>(null);
  const sendRef = useRef<HTMLButtonElement | null>(null);
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);

  async function requestCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Read the field the way the browser sees it, not the way React's
    // `onChange` last heard it — autofill (and some password managers) sets
    // `.value` without dispatching the event React listens for, which left
    // `email` at its initial "" forever and the button dead with a real
    // address already typed in (B787). `required` below is what stops a
    // truly empty submit, natively and with the browser's own message.
    const value = String(new FormData(event.currentTarget).get("email") ?? "");
    setEmail(value);
    setBusy(true);
    setUnavailable(false);
    // Starts on the send itself, independent of whatever the request answers
    // — a failed send still shows its error with nothing flying over it,
    // because this finishes on its own ~450ms clock rather than waiting for
    // the response. Skipped outright under reduced motion (B753).
    if (!reduceMotion) {
      const panel = panelRef.current?.getBoundingClientRect();
      const send = sendRef.current?.getBoundingClientRect();
      if (panel && send) {
        setOrigin({
          x: send.x - panel.x + send.width / 2,
          y: send.y - panel.y + send.height / 2,
        });
        setFlightId((id) => id + 1);
        setFlying(true);
      }
    }
    const response = await fetch("/api/auth/identity/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: value }),
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

  async function submitCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Same reasoning as `requestCode` above — read what the field actually
    // holds rather than trusting `code` to have followed autofill.
    const value = String(new FormData(event.currentTarget).get("code") ?? "").replace(
      /\D/g,
      "",
    );
    setCode(value);
    setBusy(true);
    setWrong(false);
    const response = await fetch("/api/auth/identity/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, code: value }),
    }).catch(() => null);

    if (response?.ok) {
      onDone();
      return;
    }
    setBusy(false);
    setWrong(true);
    setCode("");
  }

  return (
    <section
      ref={panelRef}
      className="relative mt-6 rounded-2xl border border-navy-200 bg-cream-50 p-5 sm:p-6"
    >
      {flying && origin && (
        <EnvelopeFly
          key={flightId}
          origin={origin}
          onDone={() => setFlying(false)}
        />
      )}
      <h2 className="font-display text-xl font-semibold text-navy-900">
        {t("home.signInTitle")}
      </h2>

      {unavailable ? (
        <p role="alert" className="mt-2 text-base leading-7 text-navy-700">
          {t("home.signInUnavailable")}
        </p>
      ) : step === "email" ? (
        <form onSubmit={requestCode}>
          <p className="mt-2 text-base leading-7 text-navy-700">
            {t("home.signInBody")}
          </p>
          {/* The inset label — B733's addendum. The label lives *inside* the
              bordered field rather than floating above it, which is most of
              why the mockup's version reads as one control rather than a
              label plus a box. Still a real `<label htmlFor>`, not a
              placeholder standing in for one. */}
          {/* One focus indicator, on the wrapper — B752. The ring alone is
              enough; a border colour change stacked on top of it read as a
              second, thicker edge with nothing between them. */}
          <div className="mt-4 min-h-11 rounded-xl border border-navy-300 bg-cream-50 px-4 py-2 focus-within:ring-2 focus-within:ring-blue-500">
            <label
              htmlFor="identity-email"
              className="block font-mono text-[11px] uppercase tracking-[0.08em] text-navy-600"
            >
              {t("me.signInEmail")}
            </label>
            <input
              id="identity-email"
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              // `.quiet-inner-focus` (app/globals.css) beats
              // app/globals.css:264's global `:focus-visible` rule for this
              // input only — the wrapper above is already showing focus, so
              // a second outline painted inside it read as a box within a
              // box (B752). A Tailwind `focus-visible:outline-none` utility
              // cannot do this: it lives in `@layer utilities`, and an
              // unlayered rule like the global one always wins over a
              // layered one regardless of specificity or order.
              className="block w-full border-0 bg-transparent p-0 text-base text-navy-900 focus:outline-none focus:ring-0 quiet-inner-focus"
            />
          </div>
          {/* `sendRef` is what the flight is measured from — B762. The
              envelope itself is mounted up at the panel, because a fast
              response swaps this form out and would unmount it mid-flight. */}
          {/* No `disabled={email === ""}` here any more — B787. That state
              can be wrong when autofill or a password manager sets the
              field's value without firing React's `onChange`, and a
              permanently disabled button then gives a person with a real
              address in the field nothing to press and no reason why. The
              field's own `required` is what refuses an actually-empty
              submit, natively, with the browser's own message pointing at
              it — which a disabled button cannot do at all. */}
          <BusyButton
            busy={busy}
            ref={sendRef}
            type="submit"
            className={`mt-4 w-full ${PRIMARY_BUTTON} disabled:opacity-50`}
            busyLabel={t("me.signInSending")}
          >
            {t("me.signInSend")}
          </BusyButton>
          {/* Quiet reassurance under the control — the real TTL, not a
              written-in "ten", so the sentence cannot outlive a change to
              CODE_TTL_MINUTES (B426). */}
          <p className="mt-3 text-center text-sm text-navy-600">
            {t("me.signInHint", { minutes: codeMinutes })}
          </p>
        </form>
      ) : (
        <form onSubmit={submitCode}>
          {/* The number comes from CODE_TTL_MS, not from the sentence — see
              CODE_TTL_MINUTES. This is a client component, so it is passed in
              rather than imported. */}
          <p className="mt-2 text-base leading-7 text-navy-700">
            {t("home.signInSent", { minutes: codeMinutes })}
          </p>
          <div className="mt-4 min-h-11 rounded-xl border border-navy-300 bg-cream-50 px-4 py-2 focus-within:ring-2 focus-within:ring-blue-500">
            <label
              htmlFor="identity-code"
              className="block font-mono text-[11px] uppercase tracking-[0.08em] text-navy-600"
            >
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
              // `minLength` is what makes "fewer than 6 digits" a submit the
              // browser itself refuses (B787) — `disabled={code.length < 6}`
              // read React state that autofill or a code-filling keyboard can
              // bypass entirely.
              minLength={6}
              maxLength={6}
              autoFocus
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              aria-describedby={wrong ? "identity-error" : undefined}
              aria-invalid={wrong ? true : undefined}
              className="block w-full border-0 bg-transparent p-0 font-mono text-2xl tracking-[0.3em] text-navy-900 focus:outline-none focus:ring-0 quiet-inner-focus"
            />
          </div>
          <p
            id="identity-error"
            role="alert"
            className="mt-3 text-base text-coral-600 empty:mt-0"
          >
            {wrong ? t("me.signInWrong") : ""}
          </p>
          <BusyButton
            busy={busy}
            type="submit"
            className={`mt-4 w-full ${PRIMARY_BUTTON} disabled:opacity-50`}
            busyLabel={t("me.signInSending")}
          >
            {t("me.signInSubmit")}
          </BusyButton>
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
