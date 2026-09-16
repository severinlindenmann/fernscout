"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PhotoStrip, { type PhotoStripItem } from "@/components/extract/PhotoStrip";
import PhotoViewer, { type PhotoViewerItem } from "@/components/extract/PhotoViewer";
import { useI18n } from "@/components/LocaleProvider";
import { photosForDate, undatedPhotos } from "@/lib/extract/dayCount";
import type { DayGroup } from "@/lib/extract/group";
import type { Question } from "@/lib/extract/questions";
import type { DayRow, PhotoRow, RunManifest } from "@/lib/staging/manifest";

/** The same thumbnail route every screen in this flow draws from. */
function thumbSrc(username: string, runId: string, photoId: string): string {
  return `/api/helper/${encodeURIComponent(username)}/extract/thumb/${encodeURIComponent(runId)}/${encodeURIComponent(photoId)}`;
}

type RunResponse = { manifest: RunManifest; groups: DayGroup[]; questions: Record<string, Question[]> };
type Person = { name: string; email: string };
type TripHeader = { title: string };

/**
 * S10a — "Read it back, fix anything, then publish" — B1751 Task 4.2,
 * rebuilt for B1803 Task 3.7.
 *
 * **This is not a second renderer.** Every day it names is a real entry
 * `lib/extract/commit.ts` already wrote, at the real slug
 * `POST .../extract/commit` recorded on `DayRow.entrySlug`. This screen
 * builds nothing of its own to preview — it links to
 * `/[user]/trips/[trip]/day/[slug]`, the same page anybody else reading this
 * journal will eventually see, draft banner and all. Editing wording is not
 * done here either: `/agent` is the journal's only editor (see AGENTS.md),
 * so the "Edit" link and "Keep editing" both go there rather than opening a
 * text box this screen would have to keep in sync with the real thing.
 *
 * **This never publishes, and cannot.** Nothing under this component ever
 * calls `.../day/publish` — that is `ReadyScreen`'s own button, one screen
 * further on, and it is the owner's own deliberate press there, never a
 * side effect of looking at a preview.
 *
 * **The summary line describes this run, not a guess at the whole trip.**
 * `committedDays` is the only thing this component reads a date span,
 * a day count and a photograph count from — an existing trip a person
 * chose to add into (Step 02's "add to a trip you have") may carry more
 * days than this run itself told, and inventing a trip-wide total neither
 * this manifest nor `groups` actually knows would be exactly the kind of
 * plausible-looking number AGENTS.md rules out. The trip's own **title**
 * is the one fact this screen cannot derive locally — a brand-new trip's
 * title is decided server-side (`titleFromSpan`) — so it is the one thing
 * fetched separately, from `GET .../trip?id=`, and its absence (a failed
 * fetch) never blocks the real days below from rendering.
 *
 * **"Draft" is not a guess either.** Every day this screen can possibly
 * name came out of `commitReadyDays`/`extract/commit`, which never
 * publishes (`test/extract-no-publish.test.ts`) — so every one of them is a
 * draft, unconditionally, for as long as this screen exists to show it.
 */
export default function PreviewScreen({
  username,
  runId,
  onBack,
}: {
  username: string;
  runId: string;
  /** Present only when a screen further on (`ReadyScreen`) is what led
   *  here — renders the back arrow the design's own navbar carries. Absent
   *  when this is reached on its own, e.g. directly from a test. */
  onBack?: () => void;
}) {
  const { t, tn, locale, formatShortDate, formatLongDate } = useI18n();
  const [data, setData] = useState<RunResponse | null>(null);
  const [error, setError] = useState(false);
  const [trip, setTrip] = useState<TripHeader | null | undefined>(undefined);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [people, setPeople] = useState<Person[] | null>(null);
  const [peopleBusy, setPeopleBusy] = useState(false);
  const [peopleError, setPeopleError] = useState(false);
  const [viewer, setViewer] = useState<{ items: PhotoViewerItem[]; index: number } | null>(null);

  async function load() {
    setError(false);
    try {
      const res = await fetch(
        `/api/helper/${encodeURIComponent(username)}/extract/run?run=${encodeURIComponent(runId)}`,
      );
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as RunResponse;
      setData(json);
      if (json.manifest.tripId) void loadTrip(json.manifest.tripId);
    } catch {
      setError(true);
    }
  }

  async function loadTrip(tripId: string) {
    try {
      const res = await fetch(`/api/helper/${encodeURIComponent(username)}/trip?id=${encodeURIComponent(tripId)}`);
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as TripHeader;
      setTrip(json);
    } catch {
      setTrip(null);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, runId]);

  async function addPerson(tripId: string) {
    setPeopleBusy(true);
    setPeopleError(false);
    try {
      const res = await fetch(`/api/helper/${encodeURIComponent(username)}/trip/people`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trip: tripId, person: name.trim(), email: email.trim() }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; people?: Person[] } | null;
      if (!res.ok || !json?.ok) throw new Error(String(res.status));
      setPeople(json.people ?? null);
      setName("");
      setEmail("");
    } catch {
      setPeopleError(true);
    } finally {
      setPeopleBusy(false);
    }
  }

  if (error) {
    return (
      <div className="mt-4">
        <p className="text-sm text-red-700">{t("extract.preview.error")}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-2 inline-flex min-h-11 items-center rounded-full border border-line-strong px-5 text-base font-semibold text-ink-strong"
        >
          {t("err.retry")}
        </button>
      </div>
    );
  }

  if (!data) {
    return <p className="mt-4 text-sm text-ink-secondary">{t("extract.preview.loading")}</p>;
  }

  const { manifest, groups } = data;
  const tripId = manifest.tripId;
  const days = committedDays(manifest);
  const skipped = skippedGroups(manifest, groups);
  // Only photographs with no date from either source — B1803 final review,
  // finding 3. The server's undated *group* is built from `takenAt` alone,
  // so a photograph the person dated by hand on the board is still in it
  // while `commitDay` has already moved it into the journal; counting the
  // group here printed "wasn't added either" about a photograph that was.
  const undatedCount = undatedPhotos(manifest.photos).length;

  /** The same rule `lib/extract/commit.ts` moved them by, not the server's
   *  `takenAt` clustering this screen used to read. */
  function photosFor(date: string): PhotoRow[] {
    return photosForDate(manifest.photos, date);
  }

  function openViewer(photos: PhotoRow[], tappedId: string) {
    const items: PhotoViewerItem[] = photos.map((p) => ({
      id: p.id,
      kind: p.kind,
      src: thumbSrc(username, runId, p.id),
    }));
    const index = Math.max(0, items.findIndex((it) => it.id === tappedId));
    setViewer({ items, index });
  }

  // The trip's hero — the first photograph of the first day this run
  // actually finished. Absent (never a placeholder) when nothing did.
  const sortedDays = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const heroPhoto = sortedDays.length > 0 ? photosFor(sortedDays[0].date)[0] : undefined;
  const totalPhotos = sortedDays.reduce((sum, d) => sum + photosFor(d.date).length, 0);
  const partyNames = (manifest.partyNames ?? []).filter((n) => n.trim() !== "");

  // The summary line — every fragment already fully localized, joined by
  // neutral punctuation rather than one sentence with several
  // interpolations (the reason `lib/extract/questions.ts` gives for taking
  // the opposite approach there does not apply to independent facts like
  // these, only to grammatically dependent ones).
  const summaryParts: string[] = [];
  if (sortedDays.length > 0) {
    summaryParts.push(
      t("extract.preview.dateRange", {
        start: formatShortDate(sortedDays[0].date),
        end: formatShortDate(sortedDays[sortedDays.length - 1].date),
        year: sortedDays[0].date.slice(0, 4),
      }),
    );
    summaryParts.push(tn("extract.preview.dayCount", sortedDays.length, { count: String(sortedDays.length) }));
  }
  if (totalPhotos > 0) {
    summaryParts.push(tn("extract.preview.photoCount", totalPhotos, { count: String(totalPhotos) }));
  }
  if (partyNames.length > 0) {
    summaryParts.push(t("extract.preview.peopleLine", {
        // The reader's own language — B1803 final review, finding 7. A
        // locale-less `Intl.ListFormat` joins with "and" for a German
        // reader.
        names: new Intl.ListFormat(locale, { type: "conjunction" }).format(partyNames),
      }));
  }

  return (
    <div className="mt-4 flex flex-col gap-6">
      <div className="flex items-center justify-between">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="text-sm font-semibold text-ink-strong"
            aria-label={t("extract.preview.header")}
          >
            ← {t("extract.preview.header")}
          </button>
        ) : (
          <span />
        )}
        <Link href="/agent" className="text-sm font-semibold text-ink-strong underline">
          {t("extract.preview.edit")}
        </Link>
      </div>

      {heroPhoto && (
        <PhotoStrip
          size="hero"
          columns={1}
          photos={[
            {
              id: heroPhoto.id,
              kind: heroPhoto.kind,
              src: thumbSrc(username, runId, heroPhoto.id),
              alt: heroPhoto.filename,
            },
          ]}
          onSelect={(id) => openViewer(photosFor(sortedDays[0].date), id)}
        />
      )}

      <div>
        {tripId && days.length > 0 && (
          <div className="flex items-center gap-2">
            <h2 className="min-w-0 truncate font-display text-lg font-semibold text-ink-strong">
              {trip === undefined ? "…" : (trip?.title ?? tripId)}
            </h2>
            <span className="shrink-0 rounded-full border border-line-strong px-2 py-0.5 text-xs font-semibold text-ink-secondary">
              {t("extract.preview.draft")}
            </span>
          </div>
        )}
        {trip === null && <p className="mt-1 text-xs text-ink-secondary">{t("extract.preview.tripLoadError")}</p>}
        {summaryParts.length > 0 && (
          <p className="mt-1 text-sm text-ink-secondary">{summaryParts.join(" · ")}</p>
        )}

        {tripId && days.length > 0 ? (
          <ul className="mt-4 flex flex-col gap-4">
            {sortedDays.map((d) => {
              const dayPhotos = photosFor(d.date);
              return (
                <li key={d.date} className="rounded-2xl border border-line-faint bg-surface-raised p-3">
                  <Link
                    href={`/${username}/trips/${tripId}/day/${d.entrySlug}`}
                    className="flex min-w-0 items-center gap-2"
                  >
                    <span className="min-w-0 truncate text-sm font-semibold text-ink-strong">
                      {formatLongDate(d.date)}
                      {d.location ? ` · ${d.location}` : ""}
                    </span>
                    <span className="ml-auto shrink-0 rounded-full border border-line-strong px-2 py-0.5 text-xs font-semibold text-ink-secondary">
                      {t("extract.preview.edit")}
                    </span>
                  </Link>
                  {d.words && <p className="mt-2 text-sm text-ink-body">{d.words}</p>}
                  {dayPhotos.length > 0 && (
                    <div className="mt-2">
                      <PhotoStrip
                        size="strip"
                        columns={5}
                        photos={dayPhotos.slice(0, 5).map(
                          (p): PhotoStripItem => ({
                            id: p.id,
                            kind: p.kind,
                            src: thumbSrc(username, runId, p.id),
                            alt: p.filename,
                          }),
                        )}
                        onSelect={(id) => openViewer(dayPhotos, id)}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-ink-body">{t("extract.preview.nothingAdded")}</p>
        )}

        {tripId && days.length > 0 && (
          <Link
            href={`/${username}/trips/${tripId}`}
            className="mt-3 inline-flex min-h-11 items-center rounded-full border border-line-strong px-5 text-base font-semibold text-ink-strong"
          >
            {t("extract.preview.viewTrip")}
          </Link>
        )}

        {skipped.length > 0 && (
          <p className="mt-3 text-sm text-ink-secondary">
            {tn("extract.preview.skipped", skipped.length, { count: String(skipped.length) })}
          </p>
        )}
        {undatedCount > 0 && (
          <p className="mt-1 text-sm text-ink-secondary">
            {tn("extract.preview.undatedSkipped", undatedCount, { count: String(undatedCount) })}
          </p>
        )}

        {tripId && days.length > 0 && (
          <p className="mt-3 text-sm text-ink-body">
            {t("extract.preview.publishHint")}{" "}
            <Link href="/agent" className="font-semibold underline">
              {t("extract.preview.openAgent")}
            </Link>
          </p>
        )}

        <Link
          href="/agent"
          className="mt-3 inline-flex min-h-11 items-center rounded-full border border-line-strong px-5 text-base font-semibold text-ink-strong"
        >
          {t("extract.preview.keepEditing")}
        </Link>
      </div>

      {tripId && (
        <div>
          <h3 className="text-base font-semibold text-ink-strong">{t("extract.preview.peopleTitle")}</h3>
          <p className="mt-1 text-sm text-ink-secondary">{t("extract.preview.peopleHint")}</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void addPerson(tripId);
            }}
            className="mt-2 flex flex-wrap items-center gap-2"
          >
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("extract.preview.namePlaceholder")}
              className="min-h-11 rounded-full border border-line-strong px-4 text-sm"
            />
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              placeholder={t("extract.preview.emailPlaceholder")}
              className="min-h-11 rounded-full border border-line-strong px-4 text-sm"
            />
            <button
              type="submit"
              disabled={peopleBusy || !name.trim() || !email.trim()}
              className="inline-flex min-h-11 items-center rounded-full bg-yellow-400 px-5 text-base font-semibold text-yellow-950 transition-colors hover:bg-yellow-300 disabled:opacity-50"
            >
              {peopleBusy ? t("extract.preview.adding") : t("extract.preview.addPerson")}
            </button>
          </form>
          {peopleError && <p className="mt-2 text-sm text-red-700">{t("extract.preview.peopleError")}</p>}
          {people && (
            <p className="mt-2 text-sm text-ink-secondary">
              {tn("extract.preview.peopleAdded", people.length, { count: String(people.length) })}
            </p>
          )}
        </div>
      )}

      <PhotoViewer
        items={viewer?.items ?? []}
        index={viewer ? viewer.index : null}
        onClose={() => setViewer(null)}
        onPrev={() =>
          setViewer((v) => (v ? { ...v, index: (v.index - 1 + v.items.length) % v.items.length } : v))
        }
        onNext={() => setViewer((v) => (v ? { ...v, index: (v.index + 1) % v.items.length } : v))}
      />
    </div>
  );
}

/** Every day this run actually finished — `commitDay` moved its
 *  photographs and `POST .../extract/commit` recorded the real slug it
 *  handed off to. Pulled out of the component so it is checkable without a
 *  DOM: a `DayRow` missing either flag names a day this screen must not
 *  link, because there is nothing real behind the link yet. */
export function committedDays(manifest: RunManifest): DayRow[] {
  return manifest.days.filter((d): d is DayRow & { entrySlug: string } => Boolean(d.committed && d.entrySlug));
}

/** Every dated group this run never finished — still has an open question,
 *  so `commitReadyDays` (`CreditsScreen.tsx`) skipped it on purpose rather
 *  than committing a day nobody told a story about. Named here, not invented
 *  away: the person sees exactly what was left and why, never a day that
 *  looks finished when it is not. */
export function skippedGroups(manifest: RunManifest, groups: DayGroup[]): DayGroup[] {
  const committed = new Set(committedDays(manifest).map((d) => d.date));
  return groups.filter((g) => !g.undated && !committed.has(g.date));
}
