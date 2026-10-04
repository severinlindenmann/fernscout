"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import BusyButton from "@/components/BusyButton";
import { useI18n } from "@/components/LocaleProvider";

/** B2844: how long "Send a new code" stays locked. UI only; the server's own
 *  limits still decide, and their messages are the caller's to show. */
const RESEND_LOCK_SECONDS = 60;

const SenderContext = createContext("Fernscout");

/** The address the code mail comes from, seeded once by the root layout from
 *  the mail layer (`mailSenderAddress`), so no caller threads it through. */
export function MailSenderProvider({ address, children }: { address: string; children: React.ReactNode }) {
  return <SenderContext.Provider value={address}>{children}</SenderContext.Provider>;
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/**
 * The "check your email" state shared by the home sign-in, the signup wizard's
 * email step and the guest sign-in: the address, six code boxes, where the
 * mail comes from and where it hides, a resend timer and a way back.
 *
 * Controlled — the caller owns `code` (and empties it on a wrong code) and its
 * own submit. `hedged` is for doors that must not confirm a mail was sent to
 * an address (a journal's guest sign-in, an invite-only signup).
 */
export default function CodeWaitPanel({
  id,
  email,
  minutes,
  hedged,
  code,
  onCodeChange,
  onSubmit,
  onResend,
  onWrongAddress,
  busy,
  errorText,
  buttonClassName,
}: {
  /** Id of the first box (its label target). */
  id: string;
  email: string;
  minutes: string;
  hedged?: boolean;
  code: string;
  onCodeChange: (digits: string) => void;
  /** Called with six digits: on the sixth typed or pasted, or the button. */
  onSubmit: (digits: string) => void;
  onResend: () => void | Promise<unknown>;
  onWrongAddress: () => void;
  busy: boolean;
  errorText?: string | null;
  buttonClassName: string;
}) {
  const { t } = useI18n();
  const sender = useContext(SenderContext);
  const [left, setLeft] = useState(RESEND_LOCK_SECONDS);
  const [resending, setResending] = useState(false);
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const locked = left > 0;
  useEffect(() => {
    if (!locked) return;
    const timer = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [locked]);

  function change(i: number, raw: string) {
    let digits = raw.replace(/\D/g, "");
    // Overtyping a filled box leaves two digits; the new one is the last.
    if (digits.length === 2) digits = digits.slice(1);
    const next = (code.slice(0, i) + digits).slice(0, 6);
    onCodeChange(next);
    boxes.current[Math.min(next.length, 5)]?.focus();
    if (next.length === 6 && next !== code) onSubmit(next);
  }

  async function resend() {
    setResending(true);
    try {
      await onResend();
    } finally {
      setResending(false);
      setLeft(RESEND_LOCK_SECONDS);
    }
  }

  const link = "min-h-11 text-base text-ink-secondary underline underline-offset-4";
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        // What the boxes hold, not what React last heard (B787).
        const value = new FormData(event.currentTarget).getAll("code").join("").replace(/\D/g, "");
        onCodeChange(value);
        onSubmit(value);
      }}
    >
      <p className="mt-2 break-words text-base leading-7 text-ink-body">
        {t(hedged ? "codeWait.sentIf" : "codeWait.sent", { email })}
      </p>
      <p className="mt-1 text-sm leading-6 text-ink-secondary">{t("codeWait.valid", { minutes })}</p>
      <div role="group" aria-label={t("me.signInCode")} className="mt-4 flex gap-2">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <input
            key={i}
            id={i === 0 ? id : undefined}
            ref={(node) => {
              boxes.current[i] = node;
            }}
            name="code"
            // `one-time-code` on the first box is what lets a phone offer the
            // code from the message; it fills all six through `change`.
            autoComplete={i === 0 ? "one-time-code" : "off"}
            inputMode="numeric"
            pattern="[0-9]"
            required
            autoFocus={i === 0}
            disabled={busy}
            aria-label={t("codeWait.digit", { n: String(i + 1) })}
            aria-invalid={errorText ? true : undefined}
            value={code[i] ?? ""}
            onChange={(e) => change(i, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Backspace" && !code[i] && i > 0) {
                onCodeChange(code.slice(0, i - 1));
                boxes.current[i - 1]?.focus();
              }
            }}
            className="h-12 min-w-0 flex-1 rounded-xl border border-line-strong bg-surface-base text-center font-mono text-2xl text-ink-strong focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        ))}
      </div>
      <p role="alert" className="mt-3 text-base text-coral-600 empty:mt-0">
        {errorText ?? ""}
      </p>
      <BusyButton busy={busy} type="submit" className={buttonClassName} busyLabel={t("me.signInSending")}>
        {t("me.signInSubmit")}
      </BusyButton>
      <ol className="mt-5 list-decimal space-y-1 pl-5 text-sm leading-6 text-ink-secondary">
        <li>{t("codeWait.stepFrom", { sender })}</li>
        <li>{t("codeWait.stepSpam")}</li>
        <li>{t("codeWait.stepNotSpam")}</li>
      </ol>
      <p className="mt-3 text-sm leading-6 text-ink-secondary">{t("codeWait.iphone")}</p>
      <p className="mt-3 flex flex-wrap items-center gap-x-4 text-base text-ink-secondary">
        <button type="button" onClick={onWrongAddress} className={link}>
          {t("codeWait.wrongAddress")}
        </button>
        <button
          type="button"
          onClick={() => void resend()}
          disabled={locked || resending}
          className={`${link} disabled:no-underline disabled:opacity-60`}
        >
          {locked ? t("codeWait.resendIn", { time: clock(left) }) : t("codeWait.resend")}
        </button>
      </p>
    </form>
  );
}
