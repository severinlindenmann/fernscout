"use client";

import { useEffect, useState } from "react";
import ConfirmPanel from "@/components/ConfirmPanel";
import { useI18n } from "@/components/LocaleProvider";

type MonthsResponse = { ok?: true; monthsHeld?: string[]; error?: string };
type PurgeResponse = { ok?: true; monthsDeleted?: string[]; monthsHeld?: string[]; error?: string };

/**
 * The standalone purge door — B1843 addendum. A separate small panel rather
 * than a step inside `LocationFlow.tsx`: this is not part of importing
 * anything, it is the owner reaching for what is already on the server, any
 * time, whether or not a fresh import is in progress. Calls
 * `app/api/helper/[user]/gps/route.ts` (cookie, this page's own door); an
 * agent has the same thing over `DELETE /api/v2/{user}/gps`.
 *
 * Names months, never a fix — the same rule the route it calls follows.
 */
export default function GpsPurgePanel({ username }: { username: string }) {
  const { t, tn, locale } = useI18n();
  const [months, setMonths] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [all, setAll] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [done, setDone] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch(`/api/helper/${encodeURIComponent(username)}/gps`);
    const json = (await res.json().catch(() => null)) as MonthsResponse | null;
    setMonths(json?.ok ? (json.monthsHeld ?? []) : []);
  }

  useEffect(() => {
    // The fetch itself is async, so `refresh` never sets state synchronously
    // inside this effect body.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username]);

  function toggle(month: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(month)) next.delete(month);
      else next.add(month);
      return next;
    });
  }

  function monthLabel(month: string): string {
    // `YYYY-MM` → a long month and year, in the reader's own locale. Nothing
    // below the month: the store keeps no day-level grouping worth naming.
    const [year, m] = month.split("-").map(Number);
    return new Intl.DateTimeFormat(locale, { year: "numeric", month: "long" }).format(
      new Date(Date.UTC(year, m - 1, 1)),
    );
  }

  async function confirmPurge() {
    setBusy(true);
    setError(undefined);
    try {
      const body = all ? { all: true } : { months: [...selected] };
      const res = await fetch(`/api/helper/${encodeURIComponent(username)}/gps`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => null)) as PurgeResponse | null;
      if (!res.ok || !json?.ok) {
        setError(t("studio.location.purge.error"));
        return;
      }
      setMonths(json.monthsHeld ?? []);
      setSelected(new Set());
      setAll(false);
      setConfirming(false);
      setDone(t("studio.location.purge.done"));
    } catch {
      setError(t("studio.location.purge.error"));
    } finally {
      setBusy(false);
    }
  }

  if (months === null) return null;

  const chosenCount = all ? months.length : selected.size;
  const canDelete = all ? months.length > 0 : selected.size > 0;

  return (
    <div className="mt-6 rounded-2xl border border-line-quiet p-4">
      <h2 className="font-display text-base font-semibold text-ink-strong">
        {t("studio.location.purge.heading")}
      </h2>
      <p className="mt-1 text-sm text-ink-body">{t("studio.location.purge.intro")}</p>

      {months.length === 0 ? (
        <p className="mt-3 text-sm text-ink-secondary">{t("studio.location.purge.emptyState")}</p>
      ) : (
        <>
          <div className="mt-3 flex flex-col gap-2">
            {months.map((month) => (
              <label key={month} className="flex items-center gap-2 text-sm text-ink-body">
                <input
                  type="checkbox"
                  checked={all || selected.has(month)}
                  disabled={all}
                  onChange={() => toggle(month)}
                />
                {monthLabel(month)}
              </label>
            ))}
            <label className="mt-2 flex items-center gap-2 text-sm font-semibold text-ink-strong">
              <input
                type="checkbox"
                checked={all}
                onChange={(e) => {
                  setAll(e.target.checked);
                  setSelected(new Set());
                }}
              />
              {t("studio.location.purge.all")}
            </label>
          </div>

          {!confirming && (
            <button
              type="button"
              disabled={!canDelete}
              onClick={() => setConfirming(true)}
              className="mt-3 min-h-11 rounded-full border border-coral-600 px-4 text-sm font-semibold text-coral-600 hover:bg-coral-50 disabled:opacity-40"
            >
              {t("studio.location.purge.trigger")}
            </button>
          )}

          {confirming && (
            <div className="mt-3">
              <ConfirmPanel
                label={t("studio.location.purge.trigger")}
                question={
                  all
                    ? t("studio.location.purge.confirm.questionAll")
                    : tn("studio.location.purge.confirm.question", chosenCount, { count: String(chosenCount) })
                }
                details={t("studio.location.purge.confirm.details")}
                confirmLabel={t("studio.location.purge.confirm.button")}
                busy={busy}
                error={error}
                tone="destructive"
                onConfirm={() => void confirmPurge()}
                onCancel={() => setConfirming(false)}
              />
            </div>
          )}
        </>
      )}

      {done && <p className="mt-3 text-sm text-ink-body">{done}</p>}
    </div>
  );
}
