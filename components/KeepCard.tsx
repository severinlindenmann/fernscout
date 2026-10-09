"use client";

import Link from "next/link";
import { useState } from "react";
import BusyButton from "@/components/BusyButton";
import { PILL_PRIMARY } from "@/components/landing/styles";
import { useI18n } from "@/components/LocaleProvider";
import type { HomeLink } from "@/lib/homeProbe";

const FIELD = "mt-3 min-h-11 rounded-xl border border-line-strong bg-surface-base px-4 py-2 focus-within:ring-2 focus-within:ring-blue-500";
const LABEL = "block font-mono text-[11px] uppercase tracking-[0.08em] text-ink-secondary";
const INPUT = "block w-full border-0 bg-transparent p-0 text-base text-ink-strong focus:outline-none focus:ring-0 quiet-inner-focus";

/**
 * "You're reading with a link" — keep the trip under your name (B-2962).
 *
 * Shown on `/me` and a journal's own `/@<user>/me` to a browser holding a live
 * trip link that its signed-in address does not already keep. Keeping files the
 * person as someone waiting for the owner's answer and opens nothing; the card
 * says so, and says the owner will see the name and address. Signed in already:
 * a name and a tick. Otherwise: a code to the address first.
 */
export default function KeepCard({ link, email }: { link: HomeLink; email: string | null }) {
  const { t, locale } = useI18n();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");
  const [dayMail, setDayMail] = useState(false);
  const [step, setStep] = useState<"form" | "code" | "done" | "removed">(link.kept ? "done" : "form");
  const [to, setTo] = useState(link.kept ? email : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    setBusy(true);
    setError(null);
    const res = await fetch(`${link.keepPath}/keep`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, token: link.token, name, locale, wantsDayMail: dayMail }),
    }).catch(() => null);
    const data = res ? ((await res.json().catch(() => null)) as Record<string, unknown> | null) : null;
    setBusy(false);
    if (!res?.ok || !data) {
      setError(t(res?.status === 401 && body.action === "verify" ? "tripKeep.wrongCode" : "tripKeep.failed"));
      return null;
    }
    return data;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (email) {
      const data = await post({ action: "join" });
      if (data?.removed) setStep("removed");
      else if (data?.kept) {
        setTo(typeof data.to === "string" ? data.to : email);
        setStep("done");
      }
    } else if (step === "form") {
      if (await post({ action: "send", email: address })) setStep("code");
    } else {
      const data = await post({ action: "verify", email: address, code });
      if (data?.removed) setStep("removed");
      else if (data?.kept) {
        setTo(typeof data.to === "string" ? data.to : address);
        setStep("done");
      }
    }
  }

  return (
    <section id="keep" aria-labelledby="keep-title" className="mt-6 scroll-mt-20 rounded-2xl border border-line-quiet bg-surface-raised p-5 sm:p-6">
      <h2 id="keep-title" className="font-display text-xl font-semibold text-ink-strong">
        {t("tripKeep.title")}
      </h2>
      <p className="mt-2 text-sm leading-6 text-ink-body">
        {t("tripKeep.gives", { trip: link.tripTitle, owner: link.ownerName })}
      </p>
      {step === "removed" ? (
        <p role="status" className="mt-4 font-semibold text-ink-strong">{t("tripKeep.removed", { owner: link.ownerName })}</p>
      ) : step === "done" ? (
        <div role="status" className="mt-4">
          <p className="font-semibold text-ink-strong">{t("tripKeep.done", { to: to ?? "" })}</p>
          <p className="mt-1 text-sm leading-6 text-ink-body">{t("tripKeep.doneBody")}</p>
        </div>
      ) : (
        <form onSubmit={(e) => void submit(e)} className="mt-4">
          <h3 className="font-semibold text-ink-strong">{t("tripKeep.heading")}</h3>
          <p className="mt-1 text-sm leading-6 text-ink-body">{t("tripKeep.note", { owner: link.ownerName })}</p>
          {step === "form" && (
            <>
              <div className={FIELD}>
                <label htmlFor="keep-name" className={LABEL}>{t("tripKeep.name")}</label>
                <input id="keep-name" name="name" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} className={INPUT} />
              </div>
              {email ? (
                <p className="mt-3 text-sm text-ink-secondary">{t("tripKeep.signedInAs", { email })}</p>
              ) : (
                <div className={FIELD}>
                  <label htmlFor="keep-email" className={LABEL}>{t("tripKeep.email")}</label>
                  <input id="keep-email" type="email" name="email" autoComplete="email" inputMode="email" required value={address} onChange={(e) => setAddress(e.target.value)} className={INPUT} />
                </div>
              )}
            </>
          )}
          {step === "code" && (
            <>
              <p className="mt-3 text-sm text-ink-body">{t("tripKeep.sentTo", { to: address })}</p>
              <div className={FIELD}>
                <label htmlFor="keep-code" className={LABEL}>{t("tripKeep.code")}</label>
                <input id="keep-code" name="code" autoComplete="one-time-code" inputMode="numeric" required autoFocus value={code} onChange={(e) => setCode(e.target.value)} className={INPUT} />
              </div>
            </>
          )}
          {step === "form" && (
            <label className="mt-3 flex min-h-11 items-center gap-3 text-base text-ink-body">
              <input type="checkbox" checked={dayMail} onChange={(e) => setDayMail(e.target.checked)} className="h-5 w-5" />
              {t("tripKeep.dayMail")}
            </label>
          )}
          {error && <p role="alert" className="mt-2 text-sm text-ink-body">{error}</p>}
          <BusyButton busy={busy} type="submit" className={`mt-3 w-full min-h-11 ${PILL_PRIMARY} disabled:opacity-50`}>
            {t(email ? "tripKeep.keep" : step === "form" ? "tripKeep.send" : "tripKeep.keep")}
          </BusyButton>
        </form>
      )}
      {link.signupEnabled && (
        <p className="mt-4 text-sm">
          <Link href="/" className="font-semibold text-ink-strong underline underline-offset-4">{t("tripKeep.start")}</Link>
        </p>
      )}
    </section>
  );
}
