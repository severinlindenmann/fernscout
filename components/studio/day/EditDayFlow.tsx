"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import DeleteDay from "@/components/DeleteDay";
import EditDay from "@/components/EditDay";
import DoneScreen from "@/components/studio/DoneScreen";
import { tripCalendar } from "@/components/studio/DateField";
import { useI18n } from "@/components/LocaleProvider";
import type { EditablePickerTrip, EditableDay } from "@/lib/studio/editDay";
import { cutEditPicker, editPickerHasMore } from "@/lib/studio/pickerCut";

/**
 * "Change a day" — B1831, spec §6. Two shapes on one route: E1, the picker,
 * and E2, `EditDay` itself — reused whole (its own doc comment) rather than
 * rebuilt, with `confirmBeforeSave` turned on for E3/E3✗ and the version it
 * read already captured for D12 (both inside `EditDay.tsx` itself, so both
 * doors — this flow and `StoryPager`'s in-place panel — get them for free).
 *
 * State is the URL, not this component: choosing a day in the picker is a
 * plain link to `?slug=…`, which re-runs the server page (`dynamic =
 * "force-dynamic"`) rather than a client-side fetch this component would
 * have to duplicate `dayForEdit` to perform. That is also what makes this
 * flow's own URL linkable and resumable (H5) with no extra work: the address
 * bar already names exactly what is on screen.
 *
 * B2073 — the page's `StudioPage` draws the frame and the one h1 ("Change a
 * day"); this draws the body. With a day chosen: the day's own title as the
 * heading under it, a Draft pill naming where publishing lives, the form with
 * its Save as the bar's one primary, and a note pointing the trip-level
 * questions at "Edit a trip". A save re-reads the page on the server
 * (`router.refresh`) and stays here, saying "Saved."; `EditDay` is keyed by
 * the day it was given, so the refreshed day mounts a fresh form (and a fresh
 * `If-Match` version) rather than one still holding the old read.
 */
export default function EditDayFlow({
  username,
  picker,
  chosenSlug,
  editable,
}: {
  username: string;
  picker: EditablePickerTrip[];
  /** Present when `?slug=` named something `dayForEdit` could not find —
   *  distinguishes "nothing chosen yet" from "that link is stale" (E1's own
   *  honest failure). */
  chosenSlug?: string;
  editable: EditableDay | null;
}) {
  const { t, formatLongDate } = useI18n();
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);

  // B1881 — filters entries, not days: a query matches an entry's own
  // title or its date, and a day group survives only if one of its entries
  // still does, so a second entry sharing a date its sibling does not match
  // is not dragged along for free.
  //
  // B1954 — filters the *full* `picker`, never the trimmed one: a search is
  // somebody looking for a specific day, not browsing, and the trim below
  // exists only for the untyped, nothing-searched-yet view.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return picker;
    return picker
      .map((trip) => ({
        ...trip,
        days: trip.days
          .map((day) => ({
            ...day,
            entries: day.entries.filter((e) => e.title.toLowerCase().includes(q) || day.date.includes(q)),
          }))
          .filter((day) => day.entries.length > 0),
      }))
      .filter((trip) => trip.days.length > 0 || trip.tripTitle.toLowerCase().includes(q));
  }, [picker, query]);

  // B1954 — searching or "Show more" both mean "the full list", untyped and
  // uncut is the two-trips-two-entries view.
  const searching = query.trim().length > 0;
  const visible = searching || showAll ? filtered : cutEditPicker(picker);
  const hasMore = !searching && !showAll && editPickerHasMore(picker);

  if (editable) return <ChosenDay username={username} editable={editable} picker={picker} />;

  return (
    <>
      {chosenSlug && (
        <div className="mt-3 rounded-xl border border-coral-300 bg-coral-50 px-4 py-3 text-sm text-ink-body">
          {t("studio.day.edit.notFound")}
        </div>
      )}

      {picker.length === 0 ? (
        <p className="mt-4 text-sm text-ink-secondary">{t("studio.day.edit.noDays")}</p>
      ) : (
        <>
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

          {visible.every((trip) => trip.days.length === 0) && (
            <p className="mt-4 text-sm text-ink-secondary">{t("studio.day.edit.noMatches")}</p>
          )}

          {visible.map(
            (trip) =>
              trip.days.length > 0 && (
                <div key={trip.tripId} className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">{trip.tripTitle}</p>
                  {trip.days.map((day) => (
                    // B1881 — one row per entry, not per day: several
                    // entries may share a date (D3), each with its own
                    // title and time, grouped under the date here rather
                    // than collapsed into one row that only names the
                    // lead entry and edits every entry on the date at once.
                    <div key={day.date} className="mt-2">
                      {day.entries.length > 1 && (
                        <p className="mt-1 text-xs text-ink-secondary">{formatLongDate(day.date, { year: true })}</p>
                      )}
                      <ul className="mt-1 divide-y divide-line-faint rounded-xl border border-line-strong">
                        {day.entries.map((entry) => (
                          <li key={entry.slug}>
                            <a
                              href={`/${encodeURIComponent(username)}/studio/day/edit?slug=${encodeURIComponent(entry.slug)}`}
                              className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-surface-subtle"
                            >
                              <span className="text-ink-strong">
                                {entry.title}
                                {entry.time && <>{" "}<span className="ml-1 text-xs text-ink-secondary">{entry.time}</span></>}
                              </span>
                              <span className="flex items-center gap-2 text-ink-secondary">
                                {day.entries.length === 1 && formatLongDate(day.date, { year: true })}
                                <em className={entry.status === "draft" ? "not-italic font-semibold text-ink-strong" : "not-italic text-ink-faint"}>
                                  {entry.status === "draft" ? t("studio.day.edit.statusDraft") : t("studio.day.edit.statusPublished")}
                                </em>
                              </span>
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              ),
          )}

          {hasMore && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="mt-4 min-h-11 rounded-full border border-line-strong px-5 text-sm font-semibold text-ink-body hover:bg-surface-subtle"
            >
              {t("studio.day.picker.showMore")}
            </button>
          )}
        </>
      )}
    </>
  );
}

/** E2 — one day chosen. Its own component so the picker (E1) never needs
 *  the router. */
function ChosenDay({ username, editable, picker }: { username: string; editable: EditableDay; picker: EditablePickerTrip[] }) {
  const { t, formatLongDate } = useI18n();
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const [queued, setQueued] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const viewUrl = `/${encodeURIComponent(username)}/trips/${encodeURIComponent(editable.tripId)}/day/${encodeURIComponent(editable.day.lead.slug)}`;
  const title = editable.day.lead.title || formatLongDate(editable.day.date, { year: true });
  if (deleted) {
    return (
      <DoneScreen
        username={username}
        done={t("studio.delete.done", { title })}
        next={[
          { title: t("studio.deleted.title"), href: `/${encodeURIComponent(username)}/studio/day/deleted`, label: t("studio.deleted.title") },
          {
            title: t("studio.hub.item.changeDay.title"),
            href: `/${encodeURIComponent(username)}/studio/day/edit`,
            label: t("studio.day.edit.backToPicker"),
          },
        ]}
      />
    );
  }
  return (
    <>
      <a href={`/${encodeURIComponent(username)}/studio/day/edit`} className="mt-1 inline-block text-sm font-semibold text-ink-body underline underline-offset-2">
        {t("studio.day.edit.backToPicker")}
      </a>
      <h2 className="mt-3 font-display text-lg font-semibold text-ink-strong">{title}</h2>
      <p className="text-sm text-ink-secondary">{editable.tripTitle}</p>
      {/* B2058 — a fact, not a prompt: this form has no publishing, so
          the pill says where a draft is published from and offers nothing
          to press here. */}
      {editable.day.lead.draft ? (
        <p data-draft-pill className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-secondary">
          <span className="rounded-full border border-yellow-300 bg-yellow-50 px-2.5 py-0.5 text-xs font-bold text-yellow-900">
            {t("studio.day.edit.statusDraft")}
          </span>
          <a
            href={`/${encodeURIComponent(username)}/studio/day/publish?day=${encodeURIComponent(editable.day.lead.slug)}&trip=${encodeURIComponent(editable.tripId)}`}
            className="font-medium text-ink-strong underline underline-offset-2"
          >
            {t("studio.day.edit.draftPublishFrom")}
          </a>
        </p>
      ) : (
        /* E4 — a way to see the day as a reader would, which neither this
           panel nor `OwnerTools` draws. A draft's pill already links there. */
        <a href={viewUrl} className="mt-2 inline-block text-sm font-semibold text-ink-body underline underline-offset-2">
          {t("studio.day.edit.openOnSite")}
        </a>
      )}

      <EditDay
        key={JSON.stringify(editable.day)}
        username={username}
        tripId={editable.tripId}
        day={editable.day}
        currencies={editable.currencies}
        calendar={tripCalendar(picker, { id: editable.tripId, start: editable.tripStart, end: editable.tripEnd })}
        confirmBeforeSave
        inStudioBar
        saved={saved}
        queued={queued}
        onSaved={(info) => {
          setSaved(true);
          setQueued(!!info?.queued);
          // A queued save has nothing new on the server yet — refreshing
          // would only re-read the same document this save was refused a
          // connection to write, and offline that fetch itself would fail.
          if (!info?.queued) router.refresh();
        }}
        onClose={() => {
          router.push(`/${encodeURIComponent(username)}/studio/day/edit`);
        }}
      />

      <div className="mt-8 rounded-xl border border-line-faint bg-surface-subtle px-4 py-3 text-sm text-ink-body">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[.06em] text-ink-secondary">
          {t("studio.day.edit.thisTrip")}
        </p>
        <p className="mt-1">
          {t("studio.day.edit.tripNote")}{" "}
          <a
            href={`/${encodeURIComponent(username)}/studio/trip?trip=${encodeURIComponent(editable.tripId)}`}
            className="font-semibold text-ink-strong underline underline-offset-2"
          >
            {t("studio.hub.item.tripEdit.title")} →
          </a>
        </p>
      </div>

      {/* B2259 — last and quiet, below everything the page is for. */}
      <DeleteDay
        username={username}
        day={{ tripId: editable.tripId, slug: editable.day.lead.slug, title, published: !editable.day.lead.draft }}
        onDone={() => setDeleted(true)}
      />
    </>
  );
}
