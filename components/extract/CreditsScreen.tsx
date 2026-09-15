"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/components/LocaleProvider";
import { creditsForPhotos } from "@/lib/helper/credits";
import type { DayGroup } from "@/lib/extract/group";
import type { Question } from "@/lib/extract/questions";
import type { RunManifest } from "@/lib/staging/manifest";

type RunResponse = { manifest: RunManifest; groups: DayGroup[]; questions: Record<string, Question[]> };

function keyFor(group: DayGroup): string {
  return group.undated ? "undated" : group.date;
}

/**
 * Commit every day of this run whose questions are all answered — the free
 * path, exported so `ExtractFlow` can call it directly with the `credits`
 * capability off, when this whole screen never mounts at all (see the doc
 * comment below). Fetches its own copy of the run rather than taking one as
 * an argument, so the two callers need agree on nothing but a run id.
 *
 * The undated group is skipped — it has no real date to commit into until
 * the person sets each photograph's own date individually, which this
 * function has no way to do on their behalf.
 */
export async function commitReadyDays(username: string, runId: string): Promise<void> {
  const res = await fetch(`/api/helper/${encodeURIComponent(username)}/extract/run?run=${encodeURIComponent(runId)}`);
  if (!res.ok) throw new Error(String(res.status));
  const { groups, questions } = (await res.json()) as RunResponse;
  for (const group of groups) {
    if (group.undated) continue;
    const open = questions[keyFor(group)] ?? [];
    if (open.length > 0) continue;
    const commit = await fetch(`/api/helper/${encodeURIComponent(username)}/extract/commit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ run: runId, date: group.date }),
    });
    if (!commit.ok) throw new Error(String(commit.status));
  }
}

/**
 * One free sample, then the ask — B1751, Task 4.1.
 *
 * Mounted once by `ExtractFlow` after `DayBoard`'s "Done for now", and only
 * when this instance charges for anything at all — `credits` is a real
 * number here, never null, because `ExtractFlow` is what decides whether
 * this screen exists (with the `credits` capability off it skips straight
 * to the free build, so the screen is *absent*, not a broken button).
 *
 * **Everything priced here comes from `creditsForPhotos`**, the same pure
 * function `extract/enrich`'s route imports to actually charge — never a
 * number typed into this component, which is how a screen and a charge
 * drift apart within a month.
 *
 * **The free path is a real path.** Both buttons end the same way, at
 * `commitReadyDays` — the only difference the paid one makes is asking
 * `extract/enrich` to write a caption onto every photograph first. A day
 * whose questions are all answered is committed whichever button was
 * pressed; the person's own words are what makes a day ready, not the
 * spend.
 */
export default function CreditsScreen({
  username,
  runId,
  credits,
  onDone,
}: {
  username: string;
  runId: string;
  /** This journal's balance. Never null — see the doc comment above. */
  credits: number;
  onDone: () => void;
}) {
  const { t, tn } = useI18n();
  const [data, setData] = useState<RunResponse | null>(null);
  const [sample, setSample] = useState<string | null>(null);
  const [busy, setBusy] = useState<"build" | "spend" | null>(null);
  const [error, setError] = useState(false);

  async function takeSample(photoId: string) {
    try {
      const res = await fetch(`/api/helper/${encodeURIComponent(username)}/extract/sample`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ run: runId, photoId }),
      });
      // A 409 means somebody else already took this run's one sample — not
      // an error, just nothing new to show.
      if (res.ok) {
        const json = (await res.json()) as { caption: string };
        if (json.caption) setSample(json.caption);
      }
    } catch {
      // A missed sample costs nothing and is not worth a state of its own —
      // the rest of the screen still works without it.
    }
  }

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

  // Fetching the run on mount, the same shape DayBoard's own `load` already
  // uses; both eslint-disables below are the same accepted shape this
  // codebase already uses at every other network-on-mount effect (see e.g.
  // `components/TripCountdown.tsx`).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, runId]);

  // The one free sample, requested once `data` has actually loaded — a
  // second `useEffect` rather than a call from inside `load` itself, so the
  // sample request is *derived from* the loaded run rather than fired from
  // inside another effect's own async body.
  useEffect(() => {
    if (!data || data.manifest.sampleTakenFor) return;
    const firstPhoto = data.manifest.photos.find((p) => p.kind === "image" && !p.dropped);
    if (!firstPhoto) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void takeSample(firstPhoto.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  async function buildFree() {
    setBusy("build");
    setError(false);
    try {
      await commitReadyDays(username, runId);
      onDone();
    } catch {
      setError(true);
    } finally {
      setBusy(null);
    }
  }

  async function spendAndBuild() {
    setBusy("spend");
    setError(false);
    try {
      const res = await fetch(`/api/helper/${encodeURIComponent(username)}/extract/enrich`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ run: runId }),
      });
      if (!res.ok) throw new Error(String(res.status));
      await commitReadyDays(username, runId);
      onDone();
    } catch {
      setError(true);
    } finally {
      setBusy(null);
    }
  }

  if (!data) {
    return (
      <div className="mt-4">
        <p className="text-sm text-ink-secondary">
          {error ? t("extract.credits.error") : t("extract.board.loading")}
        </p>
        {error && (
          <button
            type="button"
            onClick={() => void load()}
            className="mt-2 inline-flex min-h-11 items-center rounded-full border border-line-strong px-5 text-base font-semibold text-ink-strong"
          >
            {t("err.retry")}
          </button>
        )}
      </div>
    );
  }

  const photoCount = data.manifest.photos.filter((p) => p.kind === "image" && !p.dropped).length;
  const total = creditsForPhotos(photoCount);
  const busyAny = busy !== null;

  return (
    <div className="mt-4 flex flex-col gap-3">
      {sample && (
        <div className="rounded-xl border border-line-faint p-3">
          <p className="text-xs font-semibold text-ink-secondary">{t("extract.credits.sampleLabel")}</p>
          <p className="mt-1 text-sm italic text-ink-body">&ldquo;{sample}&rdquo;</p>
        </div>
      )}

      {total > 0 && (
        <div className="rounded-xl border border-line-strong p-4">
          <p className="text-sm text-ink-body">
            {tn("extract.credits.price", total, { total: String(total) })}{" "}
            {tn("extract.credits.forPhotos", photoCount, { count: String(photoCount) })}
          </p>
          <p className="mt-1 text-sm text-ink-secondary">
            {t("extract.credits.balance", { balance: String(credits) })}
          </p>
          {/* Above the button, and not in small print — the price of the
           *  owner's no-refund rule. See the file's own doc comment. */}
          <p data-testid="tied-to-run" className="mt-3 text-sm font-semibold text-ink-strong">
            {t("extract.credits.tiedToRun")}
          </p>
          <button
            type="button"
            data-testid="extract-spend-button"
            disabled={busyAny || credits < total}
            onClick={() => void spendAndBuild()}
            className="mt-2 inline-flex min-h-11 items-center rounded-full bg-yellow-400 px-5 text-base font-semibold text-yellow-950 transition-colors hover:bg-yellow-300 disabled:opacity-50"
          >
            {busy === "spend" ? t("extract.credits.spending") : tn("extract.credits.spend", total, { total: String(total) })}
          </button>
        </div>
      )}

      <button
        type="button"
        disabled={busyAny}
        onClick={() => void buildFree()}
        className="inline-flex min-h-11 items-center rounded-full border border-line-strong px-5 text-base font-semibold text-ink-strong transition-colors hover:bg-surface-subtle disabled:opacity-50"
      >
        {busy === "build" ? t("extract.flow.building") : t("extract.credits.buildFree")}
      </button>

      {error && (
        <p role="status" className="text-sm text-red-700">
          {t("extract.credits.error")}
        </p>
      )}
    </div>
  );
}
