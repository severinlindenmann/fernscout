"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Smartphone } from "lucide-react";
import BusyButton from "@/components/BusyButton";
import { useI18n } from "@/components/LocaleProvider";
import { PILL_PRIMARY, TEXT_LINK } from "@/components/landing/styles";

const LANGUAGES = ["en", "de", "hu"] as const;

/**
 * "Get the iPhone app" — B2341.
 *
 * Sign-ups are closed and there is no App Store link yet, so this is a
 * waitlist rather than a button to nowhere. Three states, decided by the
 * server (`app/page.tsx`, from `lib/appWaitlist.ts` and
 * `lib/capabilities.ts`'s `iosApp` note) and never guessed at here:
 *
 * - `storeUrl` set: a plain link, no form.
 * - unset and `waitlistAvailable`: the inline form below.
 * - neither: this component renders nothing, which is also what a fresh,
 *   unconfigured self-hosted clone renders — AGENTS.md's closed-by-default
 *   rule.
 *
 * B2529: the first two are one quiet line under the hero's buttons — a
 * phone, "Also for iPhone", and the link or the waitlist — not a pill that
 * competes with them. The form opens in place of the line.
 */
export default function AppWaitlistDoor({
  storeUrl,
  waitlistAvailable,
}: {
  storeUrl?: string;
  waitlistAvailable: boolean;
}) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [language, setLanguage] = useState<string>(
    (LANGUAGES as readonly string[]).includes(locale) ? locale : "en",
  );
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [wrong, setWrong] = useState<string | null>(null);

  const line = (action: ReactNode) => (
    <p className="flex flex-wrap items-center gap-x-2 text-[15px] text-ink-secondary">
      <Smartphone className="h-4 w-4 flex-none" aria-hidden />
      <span>{t("appWaitlist.line")}</span>
      <span aria-hidden>·</span>
      {action}
    </p>
  );
  const action = `inline-flex min-h-11 items-center gap-1 ${TEXT_LINK}`;

  if (storeUrl) {
    return line(
      <Link href={storeUrl} className={action}>
        {t("appWaitlist.storeCta")}
        <span aria-hidden>→</span>
      </Link>,
    );
  }

  if (!waitlistAvailable) return null;

  if (done) {
    return <p className="text-sm text-ink-body">{t("appWaitlist.done")}</p>;
  }

  if (!open) {
    return line(
      <button type="button" onClick={() => setOpen(true)} className={action}>
        {t("appWaitlist.openCta")}
        <span aria-hidden>→</span>
      </button>,
    );
  }

  async function submit() {
    setBusy(true);
    setWrong(null);
    try {
      const res = await fetch("/api/app-waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, locale: language }),
      });
      if (!res.ok) {
        const said = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        setWrong(typeof said.message === "string" ? said.message : t("appWaitlist.error"));
        return;
      }
      setDone(true);
    } catch {
      setWrong(t("appWaitlist.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label className="block min-w-0 text-sm text-ink-body">
        {t("appWaitlist.emailLabel")}
        <input
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          className="mt-1 w-64 max-w-full rounded-lg border border-line-quiet bg-surface-raised px-3 py-2 text-ink-strong"
        />
      </label>
      <label className="block text-sm text-ink-body">
        {t("appWaitlist.languageLabel")}
        <select
          value={language}
          onChange={(event) => setLanguage(event.target.value)}
          className="mt-1 rounded-lg border border-line-quiet bg-surface-raised px-3 py-2 text-ink-strong"
        >
          {LANGUAGES.map((code) => (
            <option key={code} value={code}>
              {t(`appWaitlist.language.${code}` as Parameters<typeof t>[0])}
            </option>
          ))}
        </select>
      </label>
      <BusyButton
        busy={busy}
        type="submit"
        disabled={!email.includes("@")}
        className={`${PILL_PRIMARY} disabled:opacity-50`}
        busyLabel={t("appWaitlist.sending")}
      >
        {t("appWaitlist.submitCta")}
      </BusyButton>
      {wrong ? <p className="w-full text-sm text-coral-600">{wrong}</p> : null}
      {/* The privacy page names consent as the basis for this list — the
          form has to actually say what the address is for (B2472, C8). */}
      <p className="w-full text-sm text-ink-body">
        {t("appWaitlist.consent")}{" "}
        <Link href="/legal#privacy" className="underline">
          {t("appWaitlist.consentLink")}
        </Link>
      </p>
    </form>
  );
}
