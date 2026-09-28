"use client";

import { useState } from "react";
import Link from "next/link";
import BusyButton from "@/components/BusyButton";
import { useI18n } from "@/components/LocaleProvider";
// B2531: the kit's yellow pill; the square button is retired.
import { PILL_PRIMARY } from "@/components/landing/styles";

/**
 * The `/invite` form — B2507.
 *
 * One field, on purpose: an address is the only fact the operator needs to
 * add somebody with the existing "Allow this address" button in `/admin`.
 * The confirmation after submitting is the same for a new address, one
 * already requested, or one already invited — `lib/inviteRequest.ts`'s
 * route never tells the caller which, so this component cannot either.
 */
export default function InviteRequestForm() {
  const { t, locale } = useI18n();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [wrong, setWrong] = useState<string | null>(null);

  if (done) {
    return <p className="mt-6 text-sm text-ink-body">{t("inviteRequest.done")}</p>;
  }

  async function submit() {
    setBusy(true);
    setWrong(null);
    try {
      const res = await fetch("/api/invite-request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, locale }),
      });
      if (!res.ok) {
        const said = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        setWrong(typeof said.message === "string" ? said.message : t("inviteRequest.error"));
        return;
      }
      setDone(true);
    } catch {
      setWrong(t("inviteRequest.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="mt-6 flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label className="block min-w-0 flex-1 text-sm text-ink-body">
        {t("inviteRequest.emailLabel")}
        <input
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          className="mt-1 w-full max-w-full rounded-lg border border-line-quiet bg-surface-raised px-3 py-2 text-ink-strong"
        />
      </label>
      <BusyButton
        busy={busy}
        type="submit"
        disabled={!email.includes("@")}
        className={`w-full sm:w-auto ${PILL_PRIMARY} disabled:opacity-50`}
        busyLabel={t("inviteRequest.sending")}
      >
        {t("inviteRequest.submitCta")}
      </BusyButton>
      {wrong ? <p className="w-full text-sm text-coral-600">{wrong}</p> : null}
      <p className="w-full text-sm text-ink-body">
        {t("inviteRequest.consent")}{" "}
        <Link href="/legal#privacy" className="underline">
          {t("inviteRequest.consentLink")}
        </Link>
      </p>
    </form>
  );
}
