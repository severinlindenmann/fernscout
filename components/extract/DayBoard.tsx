"use client";

import { useEffect, useState } from "react";
import AskCard from "@/components/extract/AskCard";
import PhotoChips from "@/components/extract/PhotoChips";
import { useI18n } from "@/components/LocaleProvider";
import type { TranslationKey } from "@/lib/i18n";
import type { DayGroup } from "@/lib/extract/group";
import type { Question } from "@/lib/extract/questions";
import type { PhotoRow, RunManifest } from "@/lib/staging/manifest";

type RunResponse = { manifest: RunManifest; groups: DayGroup[]; questions: Record<string, Question[]> };

function keyFor(group: DayGroup): string {
  return group.undated ? "undated" : group.date;
}

type Completeness = "new" | "started" | "ready";

function completenessFor(group: DayGroup, manifest: RunManifest, openCount: number): Completeness {
  if (openCount === 0) return "ready";
  const answered = manifest.days.find((d) => d.date === group.date)?.answered.length ?? 0;
  return answered > 0 ? "started" : "new";
}

const BADGE_CLASS: Record<Completeness, string> = {
  new: "border-line-faint text-ink-secondary",
  started: "border-amber-400 bg-amber-100 text-amber-800",
  ready: "border-green-500 bg-green-100 text-green-800",
};

/** A literal lookup rather than a template string, so every key `t()` can be
 *  asked for stays checked at compile time — `UploadStep`'s `STATE_KEY`. */
const STATUS_KEY: Record<Completeness, TranslationKey> = {
  new: "extract.board.status.new",
  started: "extract.board.status.started",
  ready: "extract.board.status.ready",
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
}: {
  username: string;
  runId: string;
  consentedSpeech: boolean;
  speechProvider: string;
  onLeave: () => void;
}) {
  const { t, tn } = useI18n();
  const [data, setData] = useState<RunResponse | null>(null);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

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

  return (
    <div className="mt-4">
      <ul className="divide-y divide-line-faint rounded-xl border border-line-strong">
        {groups.map((group) => {
          const key = keyFor(group);
          const open = questions[key] ?? [];
          const state = completenessFor(group, manifest, open.length);
          return (
            <li key={key}>
              <button
                type="button"
                onClick={() => setSelected(selected === key ? null : key)}
                className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-2 text-left"
                aria-expanded={selected === key}
              >
                <span className="text-sm font-semibold text-ink-strong">
                  {group.undated ? t("extract.board.undated") : group.date}
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-xs text-ink-secondary">
                    {tn("extract.board.photoCount", group.photoIds.length, { count: String(group.photoIds.length) })}
                  </span>
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${BADGE_CLASS[state]}`}>
                    {t(STATUS_KEY[state])}
                  </span>
                </span>
              </button>

              {selected === key && (
                <div className="border-t border-line-faint px-4 py-3">
                  <div className="flex flex-col gap-2">
                    {group.photoIds.map((id) => {
                      const photo = photosById.get(id);
                      if (!photo) return null;
                      return (
                        <div key={id} className="flex flex-wrap items-center gap-2">
                          <span className="min-w-0 truncate text-xs text-ink-secondary" title={photo.filename}>
                            {photo.filename}
                          </span>
                          <PhotoChips photo={photo} onSave={(patch) => patchPhoto(id, patch)} />
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-3 flex flex-col gap-2">
                    {open.length === 0 ? (
                      <p className="text-sm text-ink-secondary">{t("extract.board.doneDay")}</p>
                    ) : (
                      open.map((question) => (
                        <AskCard
                          key={question.id}
                          question={question}
                          username={username}
                          consentedSpeech={consentedSpeech}
                          speechProvider={speechProvider}
                          onAnswer={(text) => answerQuestion(group, question, text)}
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

      <button
        type="button"
        onClick={onLeave}
        className="mt-4 inline-flex min-h-11 items-center rounded-full border border-line-strong px-5 text-base font-semibold text-ink-strong"
      >
        {t("extract.board.leave")}
      </button>
    </div>
  );
}
