"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PhotoStrip, { type PhotoStripItem } from "@/components/extract/PhotoStrip";
import PhotoViewer, { type PhotoViewerItem } from "@/components/extract/PhotoViewer";
import { useI18n } from "@/components/LocaleProvider";
import type { DayGroup } from "@/lib/extract/group";
import type { Question } from "@/lib/extract/questions";
import type { DayRow, PhotoRow, RunManifest } from "@/lib/staging/manifest";

/** The same thumbnail route every screen in this flow draws from. */
function thumbSrc(username: string, runId: string, photoId: string): string {
  return `/api/helper/${encodeURIComponent(username)}/extract/thumb/${encodeURIComponent(runId)}/${encodeURIComponent(photoId)}`;
}

type RunResponse = { manifest: RunManifest; groups: DayGroup[]; questions: Record<string, Question[]> };
type Person = { name: string; email: string };

/**
 * The run's last screen — B1751, Task 4.2.
 *
 * **This is not a second renderer.** Every day it names is a real entry
 * `lib/extract/commit.ts` already wrote, at the real slug
 * `POST .../extract/commit` recorded on `DayRow.entrySlug`. This screen
 * builds nothing of its own to preview — it links to
 * `/[user]/trips/[trip]/day/[slug]`, the same page anybody else reading this
 * journal will eventually see, draft banner and all.
 *
 * **This never publishes, and cannot.** `app/api/helper/[user]/day/publish/
 * route.ts` is the owner's own call, made in words, from the agent room —
 * `DraftNotice` (rendered by the real day page this screen links to) already
 * says so. The most this screen does toward that is a link to `/agent`; see
 * `test/extract-no-publish.test.ts` for the grep this repo's reviewers would
 * otherwise have to run by hand.
 *
 * **A hero, and a strip per day — B1803 Task 1.3.** The hero is the first
 * photograph of the first day this run actually finished; a day with no
 * finished day before it gets none, rather than a placeholder. Each
 * finished day's own strip is the same run's real photographs for that
 * date, looked up the same way `DayBoard` does. Tapping any tile opens the
 * shared viewer over that day's whole set.
 *
 * **A day the person never told a story about is not invented one.** Only a
 * `DayRow` with both `committed` and `entrySlug` set — meaning
 * `commitReadyDays` actually finished it — gets a link. Everything else is
 * named honestly as not added, with the one true reason (`skippedGroups`
 * below), rather than shown as if it were part of the trip.
 */
export default function PreviewScreen({ username, runId }: { username: string; runId: string }) {
  const { t, tn } = useI18n();
  const [data, setData] = useState<RunResponse | null>(null);
  const [error, setError] = useState(false);
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
    } catch {
      setError(true);
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
        <p className="text-sm text-coral-600">{t("extract.preview.error")}</p>
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
  const undated = groups.find((g) => g.undated);
  const undatedCount = undated?.photoIds.length ?? 0;

  const photosById = new Map<string, PhotoRow>(manifest.photos.map((p) => [p.id, p]));
  const groupByDate = new Map<string, DayGroup>(groups.filter((g) => !g.undated).map((g) => [g.date, g]));

  function photosFor(date: string): PhotoRow[] {
    const group = groupByDate.get(date);
    if (!group) return [];
    return group.photoIds.map((id) => photosById.get(id)).filter((p): p is PhotoRow => Boolean(p));
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
  const heroPhoto = days.length > 0 ? photosFor(days[0].date)[0] : undefined;

  return (
    <div className="mt-4 flex flex-col gap-6">
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
          onSelect={(id) => openViewer(photosFor(days[0].date), id)}
        />
      )}

      <div>
        <h2 className="text-lg font-semibold text-ink-strong">{t("extract.preview.title")}</h2>

        {tripId && days.length > 0 ? (
          <>
            <p className="mt-2 text-sm text-ink-body">
              {tn("extract.preview.summary", days.length, { count: String(days.length) })}
            </p>
            <ul className="mt-2 flex flex-col gap-2">
              {days.map((d) => {
                const dayPhotos = photosFor(d.date);
                return (
                  <li key={d.date}>
                    <Link
                      href={`/${username}/trips/${tripId}/day/${d.entrySlug}`}
                      className="text-sm font-semibold text-ink-strong underline"
                    >
                      {d.date}
                    </Link>
                    {dayPhotos.length > 0 && (
                      <div className="mt-1">
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
            <Link
              href={`/${username}/trips/${tripId}`}
              className="mt-3 inline-flex min-h-11 items-center rounded-full border border-line-strong px-5 text-base font-semibold text-ink-strong"
            >
              {t("extract.preview.viewTrip")}
            </Link>
          </>
        ) : (
          <p className="mt-2 text-sm text-ink-body">{t("extract.preview.nothingAdded")}</p>
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
          {peopleError && <p className="mt-2 text-sm text-coral-600">{t("extract.preview.peopleError")}</p>}
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
