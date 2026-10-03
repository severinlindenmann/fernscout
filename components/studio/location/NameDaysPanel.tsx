"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import BusyButton from "@/components/BusyButton";
import { useI18n } from "@/components/LocaleProvider";
import SubmitError from "@/components/studio/SubmitError";

export type NameDayRow = { date: string; place: string; published: boolean };

/**
 * "Days without a place" — B2303. One row per existing day that names no
 * place, with the place the owner's own history gives it. Ticked by default,
 * a published day not (filling it changes what readers see); one explicit
 * tap writes the ticked ones. The server recomputes each place — what is
 * sent is only which dates.
 */
export default function NameDaysPanel({ username, tripId, rows }: { username: string; tripId: string; rows: NameDayRow[] }) {
  const { t, tn, formatLongDate } = useI18n();
  const router = useRouter();
  const [ticked, setTicked] = useState(() => new Set(rows.filter((r) => !r.published).map((r) => r.date)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filled, setFilled] = useState<number | null>(null);

  async function fill() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/helper/${encodeURIComponent(username)}/gps/name-days`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trip: tripId, dates: [...ticked] }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: true; filled?: string[] } | null;
      if (!res.ok || !json?.ok) {
        setError(t("studio.location.nameDays.error"));
        return;
      }
      setFilled(json.filled?.length ?? 0);
      router.refresh();
    } catch {
      setError(t("studio.location.nameDays.error"));
    } finally {
      setBusy(false);
    }
  }

  if (rows.length === 0) {
    return filled ? (
      <p role="status" className="mt-2 text-sm text-ink-strong">
        {tn("studio.location.nameDays.done", filled, { count: String(filled) })}
      </p>
    ) : null;
  }

  return (
    <section id="name-days" className="mt-6 rounded-2xl border border-line-quiet bg-surface-raised p-4">
      <h3 className="text-base font-semibold text-ink-strong">{t("studio.location.nameDays.heading")}</h3>
      <p className="mt-1 text-sm text-ink-secondary">{t("studio.location.nameDays.intro")}</p>
      <ul className="mt-2 border-t border-line-quiet">
        {rows.map((r) => (
          <li key={r.date} className="border-b border-line-quiet">
            <label className="flex min-h-12 items-center gap-3 py-1">
              <input
                type="checkbox"
                className="h-5 w-5 accent-green-700"
                checked={ticked.has(r.date)}
                onChange={() =>
                  setTicked((prev) => {
                    const next = new Set(prev);
                    if (!next.delete(r.date)) next.add(r.date);
                    return next;
                  })
                }
              />
              <span className="flex-1 text-sm">
                <span className="font-semibold text-ink-strong">{formatLongDate(r.date)}</span>
                {r.published && (
                  <span className="ml-2 rounded-full bg-surface-neutral px-2 py-0.5 text-xs font-bold text-ink-secondary">
                    {t("studio.location.nameDays.published")}
                  </span>
                )}
                <br />
                <span className="text-ink-body">{r.place}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {rows.some((r) => r.published) && (
        <p className="mt-2 text-xs text-ink-secondary">{t("studio.location.nameDays.publishedNote")}</p>
      )}
      <BusyButton
        type="button"
        busy={busy}
        disabled={ticked.size === 0}
        onClick={fill}
        className="mt-4 min-h-12 w-full rounded-full bg-yellow-400 text-base font-bold text-yellow-950 hover:bg-yellow-300 disabled:cursor-not-allowed disabled:bg-surface-neutral-strong disabled:text-ink-secondary"
      >
        {tn("studio.location.nameDays.cta", ticked.size, { count: String(ticked.size) })}
      </BusyButton>
      <SubmitError message={error} />
    </section>
  );
}
