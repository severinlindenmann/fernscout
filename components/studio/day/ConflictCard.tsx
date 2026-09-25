"use client";

import { useState } from "react";
import { useI18n } from "@/components/LocaleProvider";
import { keepPhoneVersion, keepServerVersion, openOutboxStore, type DayEditConflict } from "@/lib/outbox";

/** The fields "Change a day" can actually send, in the order the panel shows
 *  them — the same subset `EditDay.tsx`'s own `changedFieldsAgainst` reads,
 *  minus `media` (a gallery diff, not a line of words to compare). */
const FIELDS = [
  { key: "title", label: "edit.title" },
  { key: "time", label: "edit.time" },
  { key: "location", label: "edit.place" },
  { key: "content", label: "edit.text" },
] as const;

/**
 * D3 — a `day.edit` queued while offline whose replay came back 409
 * `stale_document`: the phone's own words and what the server holds now,
 * side by side, and nothing is written until the owner picks one. Reached
 * from the pill's own "N needs a decision" and, once B2331 wires it in,
 * from the day itself.
 */
export default function ConflictCard({
  conflict,
  onResolved,
}: {
  conflict: DayEditConflict;
  onResolved: () => void;
}) {
  const { t, locale } = useI18n();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const rows = FIELDS.filter((f) => typeof conflict.phonePatch[f.key] === "string");
  const time = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

  async function keepPhone() {
    setBusy(true);
    setFailed(false);
    const ok = await keepPhoneVersion(openOutboxStore(), conflict);
    setBusy(false);
    if (ok) onResolved();
    else setFailed(true);
  }

  async function keepServer() {
    setBusy(true);
    await keepServerVersion(openOutboxStore(), conflict);
    setBusy(false);
    onResolved();
  }

  return (
    <section
      aria-label={t("studio.conflicts.heading")}
      className="mt-3 rounded-xl border border-coral-300 bg-coral-50 p-3"
    >
      <p className="font-display text-sm font-semibold text-ink-strong">{t("studio.conflicts.heading")}</p>
      <p className="mt-1 text-sm text-ink-body">{t("studio.conflicts.body")}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold text-ink-secondary">
            {t("studio.conflicts.thisPhone", { time: time(conflict.createdAt) })}
          </p>
          {rows.map((f) => (
            <p key={f.key} className="mt-1 text-sm text-ink-body">
              <span className="font-semibold">{t(f.label)}: </span>
              {String(conflict.phonePatch[f.key])}
            </p>
          ))}
        </div>
        <div>
          {/* ponytail: the day document carries no per-field "last changed"
             timestamp of its own, so "now" (this screen's own render) is
             what is shown rather than inventing one — the server's version
             is current as of at least this moment either way. A real
             modified-at on the day doc if a future ticket needs it exact. */}
          <p className="text-xs font-semibold text-ink-secondary">
            {t("studio.conflicts.onServer", { time: time(new Date().toISOString()) })}
          </p>
          {rows.map((f) => (
            <p key={f.key} className="mt-1 text-sm text-ink-body">
              <span className="font-semibold">{t(f.label)}: </span>
              {String(conflict.serverDoc?.[f.key] ?? "")}
            </p>
          ))}
        </div>
      </div>
      {failed && (
        <p role="alert" className="mt-2 text-sm text-coral-600">
          {t("studio.conflicts.keepPhoneFailed")}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void keepPhone()}
          className="min-h-11 rounded-full bg-yellow-400 px-4 text-xs font-semibold text-yellow-950 transition-colors hover:bg-yellow-300 disabled:opacity-50"
        >
          {t("studio.conflicts.keepPhone")}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void keepServer()}
          className="min-h-11 rounded-full border border-line-strong px-4 text-xs font-semibold text-ink-body transition-colors hover:bg-surface-subtle disabled:opacity-50"
        >
          {t("studio.conflicts.keepServer")}
        </button>
      </div>
    </section>
  );
}
