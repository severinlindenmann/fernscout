"use client";

import { useState } from "react";
import BusyButton from "@/components/BusyButton";
import { useI18n } from "@/components/LocaleProvider";
import type { TranslationKey } from "@/lib/i18n";

/**
 * What this journal sends a model or the operator, and what a person can do
 * about each permission here — B723, and B1390 which merged this with what
 * used to be `SessionsConsent`'s own section.
 *
 * The two used to be two sections — a heading for "your conversations" and a
 * second one underneath, same chrome, for "what you've let the helper send"
 * — for what is underneath one subject: `lib/helper/consent.ts` keeps one
 * record per journal with one `agreedAt` and five scopes, `sessions` among
 * them. Splitting it in two meant each half hid on its own (an owner who had
 * never used the wizard saw "your conversations" alone, with nothing saying
 * the other four permissions existed at all), and the one dated line said
 * "last agreed on …" under the wrong heading for half of what it covered.
 *
 * **The merge is cosmetic, not mechanical — the asymmetry it used to draw as
 * two sections it now draws as two row shapes in one list.** `sessions`
 * **starts on** and is the only one with a real control here: a checkbox
 * that flips it either way, same route, same `scope`. The other four start
 * **off** and are granted only by the wizard's own question (B684) — this
 * page can only withdraw them, never grant them, so a granted row gets a
 * withdraw button and an ungranted row gets a static "not granted" note and
 * *no control at all*. A switch-shaped affordance on an ungranted row would
 * read as "flip this to grant it here", which is the wizard's asking job and
 * not this page's.
 */

type Scope = "words" | "photos" | "speech" | "statement";

const SCOPE_LABEL: Record<Scope, TranslationKey> = {
  words: "agent.helperConsentLabel",
  photos: "agent.photoConsentLabel",
  speech: "agent.speechConsentLabel",
  statement: "agent.statementConsentLabel",
};

/** One of the four one-way grants. `provider` is present exactly when
 *  `granted` is — a scope nobody has agreed to yet has nobody to name. */
export type ConsentRow = { scope: Scope; granted: boolean; provider?: string };

export default function HelperConsentList({
  username,
  agreedAt,
  rows: initial,
  sessionsShared,
}: {
  username: string;
  /** When this journal's consent record was last written — one instant for
   *  the whole file, not per scope (`lib/helper/consent.ts`). Absent when
   *  nobody has agreed to anything yet, which is when `rows` carries no
   *  granted entry either. */
  agreedAt?: string;
  /** The four one-way grants, always present — even ungranted, even on a
   *  journal that has never opened the wizard (B1390). Owner only: absent
   *  for everybody else, same as `helperConsent()` itself. */
  rows: ConsentRow[];
  /** Whether the operator may read this journal's conversations, or `null`
   *  where there is no helper on it to have any — B976. The only row here a
   *  buddy (on a trip's `people:`) sees; the four grants above are owner
   *  only. */
  sessionsShared: boolean | null;
}) {
  const { t, formatLongDate } = useI18n();
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState<Scope | "sessions" | null>(null);
  const [shared, setShared] = useState(sessionsShared ?? false);

  async function withdraw(scope: Scope) {
    setBusy(scope);
    const response = await fetch(`/api/helper/${encodeURIComponent(username)}/consent`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope }),
    }).catch(() => null);
    if (response?.ok) {
      setRows((prior) => prior.map((row) => (row.scope === scope ? { scope, granted: false } : row)));
    }
    setBusy(null);
  }

  async function setSessions(next: boolean) {
    setBusy("sessions");
    // Optimistic, and put back if the server disagrees: the switch is the
    // whole interaction and a checkbox that lags a round trip feels broken.
    setShared(next);
    const response = await fetch(`/api/helper/${encodeURIComponent(username)}/consent`, {
      method: next ? "POST" : "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: "sessions" }),
    }).catch(() => null);
    if (!response?.ok) setShared(!next);
    setBusy(null);
  }

  const hasGrants = rows.length > 0;

  return (
    <section className="mt-10 border-t border-navy-200 pt-6">
      <h2 className="font-display text-base font-semibold text-navy-800">
        {t("me.dataTitle")}
      </h2>
      <p className="mt-1 text-sm leading-6 text-navy-600">{t("me.dataLede")}</p>
      {/* The date belongs to the record, not to one half of it — it used to
          sit only under the "what you've let the helper send" heading, while
          the instant it names covers `sessions` too. Shown only when there
          is something below it the date could be about. */}
      {agreedAt && hasGrants && (
        <p className="mt-1 text-sm leading-6 text-navy-600">
          {t("me.consentBody", { date: formatLongDate(agreedAt.slice(0, 10)) })}
        </p>
      )}

      <ul className="mt-3 space-y-2">
        {/* `sessions` — the only row with a real control, since it is the
            only permission this page can both grant and withdraw. Absent
            where there is no helper on this journal to have any. */}
        {sessionsShared !== null && (
          <li className="rounded-xl border border-navy-200 bg-white px-4 py-3">
            <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
              <span className="text-sm text-navy-800">
                {t("me.sessionsShare")}
                <span className="block text-xs text-navy-500">
                  {t("me.sessionsOffNote")}
                </span>
              </span>
              <input
                type="checkbox"
                checked={shared}
                disabled={busy === "sessions"}
                onChange={(event) => void setSessions(event.target.checked)}
                className="h-5 w-5 shrink-0 rounded border-navy-300 text-navy-900"
              />
            </label>
          </li>
        )}

        {/* The four one-way grants — always a row each, granted or not, so
            the list reads as one settled fact table rather than one that
            reflows between zero and four entries (B1390). Owner only: `rows`
            is empty for everybody else. */}
        {rows.map((row) =>
          row.granted ? (
            <li
              key={row.scope}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-navy-200 bg-white px-4 py-3"
            >
              <span className="text-sm text-navy-800">
                {t(SCOPE_LABEL[row.scope])}
                <span className="block text-xs text-navy-500">
                  {t("me.consentProvider", { provider: row.provider ?? "" })}
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
          ) : (
            // No control at all — never a switch, not even a disabled one.
            // Nothing here can grant this, so nothing here offers to.
            <li
              key={row.scope}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-navy-300 bg-cream-50 px-4 py-3 text-navy-500"
            >
              <span className="text-sm">
                {t(SCOPE_LABEL[row.scope])}
                <span className="block text-xs">{t("me.consentNotGrantedNote")}</span>
              </span>
              <span className="rounded-full border border-navy-300 px-2.5 py-1 text-xs">
                {t("me.consentNotGranted")}
              </span>
            </li>
          ),
        )}
      </ul>
    </section>
  );
}
