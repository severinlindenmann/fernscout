"use client";

import { useState } from "react";
import BusyButton from "@/components/BusyButton";
import { useI18n } from "@/components/LocaleProvider";
import type { TranslationKey } from "@/lib/i18n";

/**
 * Every model-facing consent this journal has granted, and a button to take
 * each back — B723.
 *
 * `docs/plans/2026-09-07-web-helper-agent.md` §6 asked for this to live here;
 * B684 put the only withdraw button inside the wizard's own step-4 panel
 * instead, which is the panel that *asked*, and not where a person looks
 * afterwards. This is that second place — read-only except for the button,
 * because what was actually agreed to and who it names is `AgentWizard`'s
 * question to ask, not this page's to re-decide.
 *
 * `sessions` is left out on purpose: it is not a "your words go to a model"
 * promise like the other four, it starts on rather than off, and it already
 * has its own control just below this one (`SessionsConsent`) with wording
 * that says so. Listing it here too would be the same switch drawn twice,
 * disagreeing the day their copy diverges.
 */

type Scope = "words" | "photos" | "speech" | "statement";

const SCOPE_LABEL: Record<Scope, TranslationKey> = {
  words: "agent.helperConsentLabel",
  photos: "agent.photoConsentLabel",
  speech: "agent.speechConsentLabel",
  statement: "agent.statementConsentLabel",
};

export type ConsentRow = { scope: Scope; provider: string };

export default function HelperConsentList({
  username,
  agreedAt,
  rows: initial,
}: {
  username: string;
  /** When this journal's consent record was last written — one instant for
   *  the whole file, not per scope (`lib/helper/consent.ts`). */
  agreedAt: string;
  rows: ConsentRow[];
}) {
  const { t } = useI18n();
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState<Scope | null>(null);

  async function withdraw(scope: Scope) {
    setBusy(scope);
    const response = await fetch(`/api/helper/${encodeURIComponent(username)}/consent`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope }),
    }).catch(() => null);
    if (response?.ok) setRows((prior) => prior.filter((row) => row.scope !== scope));
    setBusy(null);
  }

  if (rows.length === 0) return null;

  return (
    <section className="mt-10 border-t border-navy-200 pt-6">
      <h2 className="font-display text-base font-semibold text-navy-800">
        {t("me.consentTitle")}
      </h2>
      <p className="mt-1 text-sm leading-6 text-navy-600">
        {t("me.consentBody", { date: new Date(agreedAt).toLocaleDateString() })}
      </p>
      <ul className="mt-3 space-y-2">
        {rows.map((row) => (
          <li
            key={row.scope}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-navy-200 bg-white px-4 py-3"
          >
            <span className="text-sm text-navy-800">
              {t(SCOPE_LABEL[row.scope])}
              <span className="block text-xs text-navy-500">
                {t("me.consentProvider", { provider: row.provider })}
              </span>
            </span>
            <BusyButton
              busy={busy === row.scope}
              type="button"
              onClick={() => void withdraw(row.scope)}
              className="min-h-11 rounded-lg border border-navy-200 px-3 py-1 text-sm text-navy-700 disabled:opacity-50"
            >
              {t("agent.helperWithdraw")}
            </BusyButton>
          </li>
        ))}
      </ul>
    </section>
  );
}
