"use client";

import { useState } from "react";
import BusyButton from "@/components/BusyButton";
import { useI18n } from "@/components/LocaleProvider";

export type DeletedRow = {
  id: string;
  tripId: string;
  tripTitle: string;
  title: string;
  date: string;
  deletedAt: string;
  daysLeft: number;
  wasShared: boolean;
};

const ERRORS: Record<string, "studio.deleted.taken" | "studio.deleted.gone"> = {
  slug_taken: "studio.deleted.taken",
  unknown_deleted_day: "studio.deleted.gone",
};

/**
 * "Recently deleted" — B2259. Restore is a plain button, not a confirm: it
 * is reversible and reaches nobody (the day comes back as a draft). The
 * line that replaces a restored row says so, and links to the day.
 */
export default function RecentlyDeleted({ username, rows }: { username: string; rows: DeletedRow[] }) {
  const { t, tn, formatLongDate } = useI18n();
  const [busy, setBusy] = useState<string | null>(null);
  const [restored, setRestored] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function restore(row: DeletedRow) {
    setBusy(row.id);
    setErrors((e) => ({ ...e, [row.id]: "" }));
    const url = `/api/web/${encodeURIComponent(username)}/deleted-days/${encodeURIComponent(row.tripId)}/${encodeURIComponent(row.id)}/restore`;
    const response = await fetch(url, { method: "POST" }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as { error?: string; href?: string } | null;
    setBusy(null);
    if (response?.ok && body?.href) return setRestored((r) => ({ ...r, [row.id]: body.href as string }));
    setErrors((e) => ({ ...e, [row.id]: t(ERRORS[body?.error ?? ""] ?? "studio.deleted.failed") }));
  }

  if (rows.length === 0) {
    return <p className="mt-4 rounded-xl bg-surface-subtle px-4 py-3 text-sm text-ink-secondary">{t("studio.deleted.empty")}</p>;
  }

  return (
    <ul className="mt-4 divide-y divide-line-faint rounded-xl border border-line-strong">
      {rows.map((row) => {
        const name = row.title || formatLongDate(row.date);
        return (
          <li key={row.id} data-deleted-row className="px-4 py-3 text-sm">
            {restored[row.id] ? (
              <p role="status" className="text-ink-body">
                {t("studio.deleted.restored", { title: name })}{" "}
                <a href={restored[row.id]} className="font-semibold underline underline-offset-2">
                  {t("studio.deleted.open")}
                </a>
              </p>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-ink-strong">{name}</span>
                    <span className="block text-xs text-ink-secondary">
                      {t("studio.deleted.row", { trip: row.tripTitle, date: formatLongDate(row.deletedAt) })} ·{" "}
                      {tn("studio.deleted.left", row.daysLeft, { count: String(row.daysLeft) })}
                      {row.wasShared && <> · {t("studio.deleted.wasShared")}</>}
                    </span>
                  </span>
                  <BusyButton
                    type="button"
                    busy={busy === row.id}
                    onClick={() => void restore(row)}
                    className="min-h-11 flex-none rounded-full border border-line-strong px-4 font-semibold text-ink-strong hover:bg-surface-subtle disabled:opacity-50"
                  >
                    {busy === row.id ? t("studio.deleted.restoring") : t("studio.deleted.restore")}
                  </BusyButton>
                </div>
                {errors[row.id] && (
                  <p role="alert" className="mt-2 text-sm text-coral-600">
                    {errors[row.id]}
                  </p>
                )}
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}
