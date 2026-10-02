"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMemo, useState } from "react";
import ConfirmPanel from "@/components/ConfirmPanel";
import { DeleteDayConfirm } from "@/components/DeleteDay";
import { useI18n } from "@/components/LocaleProvider";
import DoneScreen from "@/components/studio/DoneScreen";
import { useOnline } from "@/components/studio/useOnline";
import type { PublishRow } from "@/lib/studio/publishDay";

import { journalPath } from "@/lib/journalPath";
/** More rows than this and the list gets a search box. */
const SEARCH_FROM = 8;

/**
 * "Publish a day" — B2140, narrowed by B2677 to the take-down list and
 * confirm only: a draft's own "Publish…" now opens Preview
 * (`/studio/day/preview?trip=&date=`, `PreviewDayFlow`), which does the
 * blank-declining, who-reads and who-is-told work this screen used to carry
 * for a publish. What is left here is `?list=published` — the days already
 * on the site — and, once one is chosen by `?day=&trip=`, one `ConfirmPanel`
 * for taking it down. Nothing is written until that confirm is pressed; the
 * write is the owner's cookie door (`/api/web/.../days/<slug>/unpublish`).
 */
export default function PublishDayFlow({
  username,
  rows,
  chosen,
  missing,
  takeDown,
}: {
  username: string;
  rows: PublishRow[];
  chosen: PublishRow | null;
  /** `?day=` named something that is not in `rows` (already published, gone,
   *  or — since B2677 — a draft, which is never reached through this screen
   *  any more). */
  missing: boolean;
  takeDown: boolean;
}) {
  const { t, tn, formatLongDate } = useI18n();
  const router = useRouter();
  const online = useOnline();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // The row as it was published: after the refresh the server no longer
  // lists it as a draft, so `chosen` comes back empty.
  const [done, setDone] = useState<PublishRow | null>(null);
  // B2259 — the row whose "Delete…" is asking, and the one just deleted.
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<PublishRow | null>(null);

  const base = `${journalPath(encodeURIComponent(username))}/studio/day/publish`;
  const listHref = takeDown ? `${base}?list=published` : base;
  const dayHref = (row: PublishRow) =>
    `${journalPath(encodeURIComponent(username))}/trips/${encodeURIComponent(row.tripId)}/day/${encodeURIComponent(row.slug)}`;
  // B2677 — a draft row's "Publish…" opens Preview (every part of that date,
  // stacked) rather than this page's own chosen-row flow, which stays for
  // taking an already-published day down only. `?day=&trip=` still resolves
  // `chosen` below for that take-down case.
  const chooseHref = (row: PublishRow) =>
    takeDown
      ? `${base}?day=${encodeURIComponent(row.slug)}&trip=${encodeURIComponent(row.tripId)}&list=published`
      : `${journalPath(encodeURIComponent(username))}/studio/day/preview?trip=${encodeURIComponent(row.tripId)}&date=${encodeURIComponent(row.date)}`;

  /** An untitled day is called by its date, as a person says it. */
  const nameOf = (row: PublishRow) => row.title || formatLongDate(row.date);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => `${r.title} ${r.tripTitle} ${r.date}`.toLowerCase().includes(q));
  }, [rows, query]);

  async function commit(row: PublishRow) {
    setBusy(true);
    setError(undefined);
    // B2677 — publishing itself (parts, who is told) moved to Preview;
    // `chosen` only ever arrives here for a take-down, which takes no body.
    const url = `/api/web/${encodeURIComponent(username)}/trips/${encodeURIComponent(row.tripId)}/days/${encodeURIComponent(row.slug)}/unpublish`;
    const response = await fetch(url, { method: "POST" }).catch(() => null);
    setBusy(false);
    if (response?.ok) {
      // B2549 — the day's own page (and the drafts/published lists) have to
      // stop showing its pre-publish state.
      router.refresh();
      return setDone(row);
    }
    setError(response?.status === 422 ? t("studio.publish.incomplete") : t("studio.publish.failed"));
  }

  const deletedHref = `${journalPath(encodeURIComponent(username))}/studio/day/deleted`;
  if (deleted) {
    return (
      <DoneScreen
        username={username}
        done={t("studio.delete.done", { title: nameOf(deleted) })}
        next={[
          { title: t("studio.deleted.title"), href: deletedHref, label: t("studio.deleted.title") },
          {
            title: t(takeDown ? "studio.publish.anotherDown" : "studio.publish.another"),
            href: listHref,
            label: t(takeDown ? "studio.publish.anotherDown" : "studio.publish.another"),
          },
        ]}
      />
    );
  }

  // B2677 — "done" here is take-down only now: a draft's own publish moment
  // is Preview's (`PreviewDayFlow`), which renders B2678's `PublishedDay`
  // directly rather than this screen.
  if (done) {
    return (
      <DoneScreen
        username={username}
        done={t("studio.publish.doneDown", { title: nameOf(done) })}
        next={[
          { title: nameOf(done), href: dayHref(done), label: t("studio.day.done.openDay") },
          { title: t("studio.publish.anotherDown"), href: listHref, label: t("studio.publish.anotherDown") },
        ]}
      />
    );
  }

  // B2677 — `chosen` only ever arrives here for a take-down now (a draft's
  // own "Publish…" goes straight to Preview, above); this is the one
  // confirm screen left for the opposite direction, "take a day down".
  if (chosen) {
    return (
      <>
        <Link href={listHref} className="mt-1 inline-block text-sm font-semibold text-ink-body underline underline-offset-2">
          {t("studio.publish.backToPublished")}
        </Link>
        <h2 className="mt-3 font-display text-lg font-semibold text-ink-strong">{nameOf(chosen)}</h2>
        <p className="text-sm text-ink-secondary">
          {chosen.tripTitle} · {formatLongDate(chosen.date)} · {tn("studio.publish.photos", chosen.photos, { count: String(chosen.photos) })}
        </p>
        <Link href={dayHref(chosen)} className="mt-2 inline-block text-sm font-semibold text-ink-body underline underline-offset-2">
          {t("studio.publish.preview")}
        </Link>

        <div className="mt-4">
          {/* B2330 — a take-down is never queued either; same stance as a
              publish always took here. */}
          {!online ? (
            <div className="rounded-2xl border border-line-strong p-4 opacity-60">
              <p className="text-sm leading-6 text-ink-body">{t("edit.takeDownQuestion", { title: nameOf(chosen) })}</p>
              <button type="button" disabled className="mt-3 min-h-11 cursor-not-allowed rounded-full bg-surface-neutral-strong px-5 text-base font-semibold text-ink-secondary">
                {t("edit.takeDownConfirm")}
              </button>
              <p className="mt-2 text-sm text-ink-secondary">{t("studio.publish.offline")}</p>
            </div>
          ) : (
            <ConfirmPanel
              label={t("edit.takeDown")}
              question={t("edit.takeDownQuestion", { title: nameOf(chosen) })}
              confirmLabel={t("edit.takeDownConfirm")}
              busyLabel={t("studio.publish.busyDown")}
              tone="destructive"
              busy={busy}
              error={error}
              onConfirm={() => void commit(chosen)}
              onCancel={() => router.push(listHref)}
            />
          )}
        </div>
      </>
    );
  }

  return (
    <>
      {missing && (
        <div className="mt-3 rounded-xl border border-coral-300 bg-coral-50 px-4 py-3 text-sm text-ink-body">
          {t("studio.publish.notFound")}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="mt-4 rounded-xl bg-surface-subtle px-4 py-3 text-sm text-ink-secondary">
          {t(takeDown ? "studio.publish.nonePublished" : "studio.publish.noDrafts")}
        </p>
      ) : (
        <>
          {rows.length > SEARCH_FROM && (
            <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-ink-secondary">
              {t("studio.day.edit.searchLabel")}
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("studio.day.edit.searchPlaceholder")}
                className="mt-1 block min-h-11 w-full rounded-xl border border-line-strong bg-surface-base px-3 text-sm text-ink-body"
              />
            </label>
          )}
          {visible.length === 0 && <p className="mt-4 text-sm text-ink-secondary">{t("studio.day.edit.noMatches")}</p>}
          <ul className="mt-4 divide-y divide-line-faint rounded-xl border border-line-strong">
            {visible.map((row) => (
              <li key={`${row.tripId}/${row.slug}`} data-publish-row className="px-4 py-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <Link href={chooseHref(row)} className="min-w-0 flex-1 hover:underline">
                    <span className="block font-semibold text-ink-strong">{nameOf(row)}</span>
                    <span className="block text-xs text-ink-secondary">
                      {row.tripTitle} · {row.date} · {tn("studio.publish.photos", row.photos, { count: String(row.photos) })}
                    </span>
                  </Link>
                  <span className="flex flex-none flex-col items-end gap-1">
                    {!takeDown && (
                      <Link href={chooseHref(row)} className="font-semibold text-ink-body underline underline-offset-2">
                        {t("studio.publish.shareRow")}
                      </Link>
                    )}
                    <Link href={dayHref(row)} className="text-ink-secondary underline underline-offset-2">
                      {t("studio.publish.previewShort")}
                    </Link>
                    <button
                      type="button"
                      data-delete-day
                      onClick={() => setDeleting(`${row.tripId}/${row.slug}`)}
                      className="font-semibold text-coral-600 underline underline-offset-2"
                    >
                      {t("studio.delete.button")}
                    </button>
                  </span>
                </div>
                {deleting === `${row.tripId}/${row.slug}` && (
                  <div className="mt-3">
                    <DeleteDayConfirm
                      username={username}
                      day={{ tripId: row.tripId, slug: row.slug, title: nameOf(row), published: takeDown }}
                      onDone={() => setDeleted(row)}
                      onCancel={() => setDeleting(null)}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      <Link
        href={takeDown ? base : `${base}?list=published`}
        className="mt-6 inline-block text-sm font-semibold text-ink-body underline underline-offset-2"
      >
        {t(takeDown ? "studio.publish.toDrafts" : "studio.publish.toTakeDown")}
      </Link>
    </>
  );
}
