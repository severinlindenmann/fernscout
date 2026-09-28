"use client";

import { useState } from "react";
import { useI18n } from "@/components/LocaleProvider";
import SubmitError from "@/components/studio/SubmitError";
import { formatBytes } from "@/components/studio/inbox/InboxTile";
import type { TripWaitingGroup } from "@/lib/studio/inbox";

import { journalPath } from "@/lib/journalPath";
/**
 * "Waiting for a day in <trip>" — B2207.
 *
 * A photograph filed onto a trip with a declined day (`storeTripPhoto`,
 * `lib/api/v2/media.ts`) sits on disk under `trips/<id>/media/`, referenced
 * by no day, and until this existed it was invisible anywhere in the studio:
 * `InboxHub.tsx`'s own "waiting" section only ever reads
 * `content/<user>/inbox/`, a different folder entirely.
 *
 * A **narrower** tile than `InboxTile.tsx`'s, on purpose. That component's
 * checkbox, bulk-select and move-sheet machinery are all built around files
 * that can go *back* to a flat, undated bucket — `moveInboxFileToDay`/
 * `moveInboxFileFromDay` (`lib/inbox.ts`). A day-less trip photo has no such
 * bucket to return to: it already belongs to this one trip, on disk, and the
 * only question left is which of *this trip's own* days it goes on. So the
 * whole interaction is one choice — a day, from a list narrowed to this
 * trip — rather than the six-way move sheet the flat inbox needs. There is
 * also, deliberately, no delete here: unlike an inbox file, this bytes-on-
 * disk photograph is a stored upload with its own print-master original
 * (AGENTS.md), and this ticket's acceptance is "moving it onto a day
 * attaches it" — inventing a delete path for it is a separate decision this
 * component does not make.
 *
 * The thumbnail is the ordinary served media URL, not a dedicated thumbnail
 * route the way `InboxTile.tsx`'s is: the file already sits under
 * `trips/<id>/media/`, so `/<user>/media/<trip>/<file>?w=` is what
 * `app/at/[user]/media/[...path]/route.ts` already serves it as, and that route
 * answers it `private` until a gallery names it (`labelOf`) — an owner-only
 * cookie session (this page) reads it fine; nobody else can.
 */
export default function TripWaitingSection({
  username,
  groups,
}: {
  username: string;
  groups: TripWaitingGroup[];
}) {
  const { t, formatShortDate } = useI18n();
  const [rows, setRows] = useState(groups);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState("");

  const visible = rows.filter((group) => group.rows.length > 0);
  if (visible.length === 0) return null;

  async function attach(tripId: string, filename: string) {
    const key = `${tripId}:${filename}`;
    const slug = chosen[key];
    if (!slug) return;
    setBusyKey(key);
    setError("");
    try {
      const res = await fetch(`/api/helper/${encodeURIComponent(username)}/trip/waiting/attach`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trip: tripId, file: filename, slug }),
      });
      if (!res.ok) {
        setError(t("studio.inbox.tripWaiting.attachFailed"));
        return;
      }
      setRows((was) =>
        was.map((group) =>
          group.tripId === tripId ? { ...group, rows: group.rows.filter((row) => row.id !== filename) } : group,
        ),
      );
    } catch {
      setError(t("studio.inbox.tripWaiting.attachFailed"));
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <>
      {visible.map((group) => (
        <section key={group.tripId} className="mt-6">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
            {t("studio.inbox.tripWaiting.heading", { trip: group.tripTitle })}
          </h2>
          <ul className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
            {group.rows.map((row) => {
              const key = `${group.tripId}:${row.id}`;
              const src = `${journalPath(encodeURIComponent(username))}/media/${encodeURIComponent(group.tripId)}/${encodeURIComponent(row.id)}`;
              return (
                <li key={key} className="rounded-xl border border-line-quiet bg-surface-raised p-3">
                  <div className="flex items-start gap-3">
                    <span className="relative block h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-surface-muted">
                      {/* eslint-disable-next-line @next/next/no-img-element -- a private, owner-only derivative under the trip's own media path, unreferenced until attached — same reasoning InboxTile.tsx's own thumbnail gives. */}
                      <img
                        src={`${src}?w=200`}
                        alt=""
                        width={64}
                        height={64}
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-cover"
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink-strong">{row.name}</span>
                      <span className="block text-xs text-ink-secondary">{formatBytes(row.bytes)}</span>
                    </span>
                  </div>
                  {group.days.length > 0 ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <select
                        className="min-h-9 rounded-lg border border-line-strong bg-surface-raised px-2 text-sm text-ink-strong"
                        value={chosen[key] ?? ""}
                        onChange={(e) => setChosen((was) => ({ ...was, [key]: e.target.value }))}
                        aria-label={t("studio.inbox.tripWaiting.chooseDay")}
                      >
                        <option value="">{t("studio.inbox.tripWaiting.chooseDay")}</option>
                        {group.days.map((day) => (
                          <option key={day.slug} value={day.slug}>
                            {formatShortDate(day.date)} — {day.title}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={!chosen[key] || busyKey === key}
                        onClick={() => attach(group.tripId, row.id)}
                        className="min-h-9 rounded-full bg-action-strong px-3 text-sm font-semibold text-on-action disabled:opacity-50"
                      >
                        {t("studio.inbox.tripWaiting.putOnDay")}
                      </button>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-ink-secondary">{t("studio.inbox.tripWaiting.noDays")}</p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <SubmitError message={error} />
    </>
  );
}
