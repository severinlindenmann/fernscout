"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/components/LocaleProvider";
import type { DayGroup } from "@/lib/extract/group";
import type { Question } from "@/lib/extract/questions";
import type { DayRow, RunManifest } from "@/lib/staging/manifest";

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
  const undated = groups.find((g) => g.undated);
  const undatedCount = undated?.photoIds.length ?? 0;

  return (
    <div className="mt-4 flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-ink-strong">{t("extract.preview.title")}</h2>

        {tripId && days.length > 0 ? (
          <>
            <p className="mt-2 text-sm text-ink-body">
              {tn("extract.preview.summary", days.length, { count: String(days.length) })}
            </p>
            <ul className="mt-2 flex flex-col gap-1">
              {days.map((d) => (
                <li key={d.date}>
                  <Link
                    href={`/${username}/trips/${tripId}/day/${d.entrySlug}`}
                    className="text-sm font-semibold text-ink-strong underline"
                  >
                    {d.date}
                  </Link>
                </li>
              ))}
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
          {peopleError && <p className="mt-2 text-sm text-red-700">{t("extract.preview.peopleError")}</p>}
          {people && (
            <p className="mt-2 text-sm text-ink-secondary">
              {tn("extract.preview.peopleAdded", people.length, { count: String(people.length) })}
            </p>
          )}
        </div>
      )}
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
