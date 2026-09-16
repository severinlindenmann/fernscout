"use client";

import { useEffect, useState } from "react";
import AskCard from "@/components/extract/AskCard";
import PhotoChips from "@/components/extract/PhotoChips";
import PhotoStrip, { type PhotoStripItem } from "@/components/extract/PhotoStrip";
import PhotoViewer, { type PhotoViewerItem } from "@/components/extract/PhotoViewer";
import StepIndicator from "@/components/extract/StepIndicator";
import { useI18n } from "@/components/LocaleProvider";
import type { TranslationKey } from "@/lib/i18n";
import { countDays } from "@/lib/extract/dayCount";
import type { DayGroup } from "@/lib/extract/group";
import type { Question } from "@/lib/extract/questions";
import type { PhotoRow, RunManifest } from "@/lib/staging/manifest";

/** How many photographs go into every day's strip on the board itself
 *  — the design's "a strip of five photograph tiles" (S5a). Tapping one
 *  still opens the viewer over the day's *whole* set, not just these five. */
const STRIP_COUNT = 5;

/** A thumbnail URL for one staged photograph — the same route every screen
 *  in this flow draws from, `app/api/helper/[user]/extract/thumb/[run]/[id]`. */
function thumbSrc(username: string, runId: string, photoId: string): string {
  return `/api/helper/${encodeURIComponent(username)}/extract/thumb/${encodeURIComponent(runId)}/${encodeURIComponent(photoId)}`;
}

type DayGroupWithPlace = DayGroup & {
  /** The run route's own reverse-geocoded read of this group's coordinate —
   *  `app/api/helper/[user]/extract/run/route.ts`, the same lookup that
   *  already went into a question's own sentence. `undefined` whenever the
   *  group has no coordinate at all (this is exactly when a "where were
   *  you" gap question exists for it) or offline geodata is not installed —
   *  never a second guess made up on this side of the wire. */
  placeName?: string;
};

type RunResponse = { manifest: RunManifest; groups: DayGroupWithPlace[]; questions: Record<string, Question[]> };

function keyFor(group: DayGroup): string {
  return group.undated ? "undated" : group.date;
}

/**
 * The design's three status pills (S5a) — B1803 Task 3.2.
 *
 * `"noPlace"` is not "has fewer answers than usual"; it is real: this day
 * still has an open gap question whose `fills` is `"location"`
 * (`lib/extract/questions.ts` only ever creates one when the group's own
 * coordinate is missing). Once that specific question is answered it drops
 * out of `open` and the status moves on — to `"told"` if nothing else was
 * outstanding, `"notYet"` otherwise.
 */
export type DayStatus = "told" | "noPlace" | "notYet";

export function statusFor(open: Pick<Question, "fills">[]): DayStatus {
  if (open.length === 0) return "told";
  return open.some((q) => q.fills === "location") ? "noPlace" : "notYet";
}

/**
 * The thin per-card progress bar (S5a) — how much of this day's *currently
 * known* question set is already answered. Real arithmetic on
 * `DayRow.answered` and the run route's own `open` list, never a step count
 * invented for the bar: a day can only ever have up to
 * `MAX_QUESTIONS_PER_DAY` questions in play at once, and this is the
 * fraction of them already put to bed.
 */
export function dayProgressPercent(answeredCount: number, openCount: number): number {
  const total = answeredCount + openCount;
  if (total <= 0) return 0;
  return Math.round((answeredCount / total) * 100);
}

/**
 * The design's primary button below the day list (S5a) — B1803 fix round 1.
 * "It names the next day worth doing" is binding per the per-screen spec and
 * design-v2.html:704, not a scope Phase 3's own three-bullet summary could
 * narrow away. The day it names has to be real: the first *dated* group (in
 * the run's own chronological order — `groupIntoDays` already sorts them,
 * the undated group always last) whose status is not `"told"`. The undated
 * group is never "the next day" — it has no weekday to name.
 */
export function nextDayToTell(
  days: { date: string; undated: boolean; status: DayStatus }[],
): string | undefined {
  return days.find((d) => !d.undated && d.status !== "told")?.date;
}

/** The real weekday for a group's own date, in the reader's own language —
 *  `Intl.DateTimeFormat`, not a hand-maintained list of translated weekday
 *  names (`lib/extract/questions.ts` already has one, English-only, for a
 *  reason that does not apply here: this is one placeholder in an otherwise
 *  translated sentence, not a whole assembled sentence). Noon UTC, the same
 *  fixed instant `questionsForDay` reads its own weekday from, so the day
 *  cannot shift under a reader in a timezone behind or ahead of UTC. */
export function weekdayLabel(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(
    new Date(`${date}T12:00:00Z`),
  );
}

const BADGE_CLASS: Record<DayStatus, string> = {
  told: "border-green-500 bg-green-100 text-green-700",
  noPlace: "border-coral-400 bg-coral-100 text-coral-600",
  notYet: "border-line-faint bg-cream-100 text-ink-secondary",
};

/** A literal lookup rather than a template string, so every key `t()` can be
 *  asked for stays checked at compile time — `UploadStep`'s `STATE_KEY`. */
const STATUS_KEY: Record<DayStatus, TranslationKey> = {
  told: "extract.board.status.told",
  noPlace: "extract.board.status.noPlace",
  notYet: "extract.board.status.notYet",
};

/**
 * The day board — B1751, Task 2.3.
 *
 * **A workspace, not a wizard.** Every day the run's photographs grouped
 * into is listed at once, in any order the person wants to open them, each
 * with its own completeness badge. Nothing here advances a "step" or blocks
 * on an earlier day being finished — the design research's one structural
 * change, and the reason this is a flat list with a selection rather than a
 * `current` index moving through an array.
 *
 * "Done for now" simply leaves — every answer and every chip edit is already
 * saved by the time it is on screen (`onAnswer`/`onSave` below both await
 * their fetch before returning), so there is nothing a leave could lose and
 * nothing for it to confirm.
 */
export default function DayBoard({
  username,
  runId,
  consentedSpeech,
  speechProvider,
  onLeave,
  onLoaded,
}: {
  username: string;
  runId: string;
  consentedSpeech: boolean;
  speechProvider: string;
  onLeave: () => void;
  /** Fired after every successful load, including the first one — B1751
   *  Task 4.3. `GET .../extract/run` carries the same `extendOnTouch` call
   *  it always has, so this is how `ExtractFlow` learns what a resumed
   *  run's clock actually did the moment this board first asked the server
   *  for it, without this component knowing anything about resuming. */
  onLoaded?: (manifest: RunManifest) => void;
}) {
  const { t, tn, locale } = useI18n();
  const [data, setData] = useState<RunResponse | null>(null);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ items: PhotoViewerItem[]; index: number } | null>(null);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, runId]);

  async function load() {
    setError(false);
    try {
      const res = await fetch(`/api/helper/${encodeURIComponent(username)}/extract/run?run=${encodeURIComponent(runId)}`);
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as RunResponse;
      setData(json);
      onLoaded?.(json.manifest);
    } catch {
      setError(true);
    }
  }

  async function patchPhoto(photoId: string, patch: Record<string, string>) {
    const res = await fetch(`/api/helper/${encodeURIComponent(username)}/extract/run`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ run: runId, photoId, ...patch }),
    });
    if (!res.ok) throw new Error(String(res.status));
    await load();
  }

  async function answerQuestion(group: DayGroup, question: Question, answer: string) {
    const res = await fetch(`/api/helper/${encodeURIComponent(username)}/extract/day`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        run: runId,
        date: group.date,
        questionId: question.id,
        answer,
        // The "where were you" gap question's answer is also the day's own
        // location, not just prose — nothing else in this flow sets it.
        ...(question.fills === "location" ? { location: answer } : {}),
      }),
    });
    if (!res.ok) throw new Error(String(res.status));
    await load();
  }

  /** The follow-up screen's own "Skip" (S7c) — B1803 Task 3.5. Closes the
   *  question out without inventing an answer nobody gave; see the route's
   *  own comment on why `skip: true` appends nothing to `words`. */
  async function skipQuestion(group: DayGroup, question: Question) {
    const res = await fetch(`/api/helper/${encodeURIComponent(username)}/extract/day`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ run: runId, date: group.date, questionId: question.id, answer: "", skip: true }),
    });
    if (!res.ok) throw new Error(String(res.status));
    await load();
  }

  if (error) {
    return (
      <div className="mt-4">
        <p className="text-sm text-red-700">{t("extract.board.error")}</p>
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
    return <p className="mt-4 text-sm text-ink-secondary">{t("extract.board.loading")}</p>;
  }

  const { manifest, groups, questions } = data;
  const photosById = new Map<string, PhotoRow>(manifest.photos.map((p) => [p.id, p]));
  // The day board's own progress metric — B1803 Task 2.1, fix round 1. Not
  // "which screen", this workspace has no screens to be one of; "days told"
  // out of the run's own real day count. The undated group is real work —
  // it still gets its own card below — but it is not a day, in neither the
  // numerator nor the denominator: `FoundStep` already promised a day count
  // with `countDays` (`lib/extract/dayCount.ts`), and this board must not say a
  // different number a screen later.
  const daysTold = groups.filter(
    (group) => !group.undated && statusFor(questions[keyFor(group)] ?? []) === "told",
  ).length;
  const daysTotal = countDays(groups);
  const nextDate = nextDayToTell(
    groups.map((group) => ({
      date: group.date,
      undated: group.undated,
      status: statusFor(questions[keyFor(group)] ?? []),
    })),
  );

  return (
    <div className="mt-4">
      <StepIndicator
        total={daysTotal}
        current={daysTold}
        label={tn("extract.step.daysTold", daysTotal, { current: String(daysTold), total: String(daysTotal) })}
      />
      <ul className="divide-y divide-line-faint rounded-xl border border-line-strong">
        {groups.map((group, groupIndex) => {
          const key = keyFor(group);
          const open = questions[key] ?? [];
          const state = statusFor(open);
          const isSelected = selected === key;
          const answeredCount = manifest.days.find((d) => d.date === group.date)?.answered.length ?? 0;
          // The person's own free-text answer to the "where were you" gap
          // question wins nothing over the automatic read — the two never
          // coexist. That question only exists when `group.placeName` could
          // never have been computed (`group.lat === undefined`), so
          // whichever of the two is present is simply the one this day
          // actually has.
          const place = group.placeName ?? manifest.days.find((d) => d.date === group.date)?.location;
          const photoCount = group.photoIds.length;
          // No weather field exists anywhere in this run's own data
          // (`RunManifest`/`DayRow`/`DayGroup`) — it is looked up later, once
          // a day is committed into the journal proper
          // (`lib/dayReadiness.ts`'s own weather read, past this flow). An
          // empty field beats a confident wrong one, so the summary line
          // below never carries a temperature or a condition this run has
          // not actually seen.
          const summary = place
            ? tn("extract.board.summary.withPlace", photoCount, { place, count: String(photoCount) })
            : tn("extract.board.summary.noPlace", photoCount, { count: String(photoCount) });
          return (
            <li key={key} className={isSelected ? "rounded-lg ring-2 ring-yellow-300" : undefined}>
              <button
                type="button"
                onClick={() => setSelected(selected === key ? null : key)}
                className={`flex min-h-14 w-full items-center justify-between gap-3 px-4 py-2 text-left ${
                  isSelected ? "rounded-t-lg border border-b-0 border-yellow-600" : ""
                }`}
                aria-expanded={selected === key}
              >
                <span className="text-sm font-semibold text-ink-strong">
                  {group.undated ? t("extract.board.undated") : group.date}
                </span>
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold ${BADGE_CLASS[state]}`}>
                  {t(STATUS_KEY[state])}
                </span>
              </button>
              <p className="truncate px-4 pb-2 text-xs text-ink-secondary">{summary}</p>
              {state !== "told" && (
                <div className="mx-4 mb-2 h-1 overflow-hidden rounded-full bg-line-faint">
                  <div
                    className="h-full rounded-full bg-yellow-400"
                    style={{ width: `${dayProgressPercent(answeredCount, open.length)}%` }}
                  />
                </div>
              )}

              {group.photoIds.length > 0 && (
                <div className="px-4 pb-3">
                  <PhotoStrip
                    size="strip"
                    columns={STRIP_COUNT}
                    photos={group.photoIds.slice(0, STRIP_COUNT).map(
                      (id): PhotoStripItem => {
                        const photo = photosById.get(id);
                        return {
                          id,
                          kind: photo?.kind ?? "image",
                          src: thumbSrc(username, runId, id),
                          alt: photo?.filename ?? id,
                        };
                      },
                    )}
                    onSelect={(tappedId) => {
                      const items = group.photoIds
                        .map((id) => photosById.get(id))
                        .filter((p): p is PhotoRow => Boolean(p))
                        .map(
                          (p): PhotoViewerItem => ({
                            id: p.id,
                            kind: p.kind,
                            src: thumbSrc(username, runId, p.id),
                          }),
                        );
                      const startIndex = items.findIndex((it) => it.id === tappedId);
                      setViewer({ items, index: Math.max(0, startIndex) });
                    }}
                  />
                </div>
              )}

              {selected === key && (
                <div className="border-t border-line-faint px-4 py-3">
                  <div className="flex flex-col gap-2">
                    {group.photoIds.map((id) => {
                      const photo = photosById.get(id);
                      if (!photo) return null;
                      return (
                        <PhotoChips
                          key={id}
                          username={username}
                          runId={runId}
                          photo={photo}
                          onSave={(patch) => patchPhoto(id, patch)}
                        />
                      );
                    })}
                  </div>

                  <div className="mt-3 flex flex-col gap-2">
                    {open.length === 0 ? (
                      <p className="text-sm text-ink-secondary">{t("extract.board.doneDay")}</p>
                    ) : (
                      open.map((question, questionIndex) => (
                        <AskCard
                          key={question.id}
                          question={question}
                          dayIndex={group.undated ? undefined : groupIndex + 1}
                          dayTotal={group.undated ? undefined : daysTotal}
                          questionIndex={questionIndex + 1}
                          questionTotal={open.length}
                          date={group.undated ? undefined : group.date}
                          username={username}
                          consentedSpeech={consentedSpeech}
                          speechProvider={speechProvider}
                          photos={group.photoIds
                            .map((id) => photosById.get(id))
                            .filter((p): p is PhotoRow => Boolean(p))
                            .map((p) => ({ id: p.id, kind: p.kind, src: thumbSrc(username, runId, p.id), alt: p.filename }))}
                          onAnswer={(text) => answerQuestion(group, question, text)}
                          onSkip={() => skipQuestion(group, question)}
                          onDone={() => setSelected(null)}
                        />
                      ))
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {/* The design's primary action (S5a) — real, not a queue: naming the
       *  next untold day is a suggestion, not a requirement, hence "Any
       *  order you like" right beneath it rather than a forced sequence. */}
      {nextDate ? (
        <>
          <button
            type="button"
            onClick={() => setSelected(nextDate)}
            className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-full bg-yellow-400 px-5 text-base font-semibold text-yellow-950 transition-colors hover:bg-yellow-300"
          >
            {t("extract.board.tellMeAbout", { weekday: weekdayLabel(nextDate, locale) })}
          </button>
          <p className="mt-2 text-xs text-ink-secondary">{t("extract.board.anyOrder")}</p>
        </>
      ) : (
        <p className="mt-4 text-sm text-ink-secondary">{t("extract.board.allTold")}</p>
      )}

      <button
        type="button"
        onClick={onLeave}
        className="mt-4 inline-flex min-h-11 items-center rounded-full border border-line-strong px-5 text-base font-semibold text-ink-strong"
      >
        {t("extract.board.leave")}
      </button>
      {/* R31 — every answer above is already saved, so this promise is true
       *  the moment it is printed: the resume screen (B1751 Task 4.3) is
       *  what "come back to it" now actually does. */}
      <p className="mt-2 text-xs text-ink-secondary">{t("extract.flow.left")}</p>

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
