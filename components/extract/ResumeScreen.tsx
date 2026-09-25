"use client";

import { useEffect, useState } from "react";
import ConfirmPanel from "@/components/ConfirmPanel";
import { useI18n } from "@/components/LocaleProvider";
import {
  countdownFor,
  segmentsFor,
  tickIntervalFor,
  urgencyFor,
  windowFractionFor,
  type CountdownTier,
  type Segment,
  type Urgency,
} from "@/lib/staging/countdown";
import type { RunManifest } from "@/lib/staging/manifest";
import {
  formatGigabytes,
  formatStagedBytes,
  JOURNAL_STAGING_MAX_BYTES,
  JOURNAL_STAGING_WARN_FRACTION,
} from "@/lib/validate/media";
import type { TranslationKey } from "@/lib/i18n";

/** What `GET .../studio/runs` hands back for one run — the manifest,
 *  unmodified (the route is read-only, see its own doc comment), plus how
 *  many days still have open questions. `daysLeftToTell` is computed on the
 *  server, not here: `groupIntoDays` reaches `lib/ingest/geo.ts` and
 *  `node:fs` through `lib/ingest/cluster.ts`, and a client bundle that
 *  imports it anyway fails to build outright. */
export type RunSummaryClient = RunManifest & { daysLeftToTell: number };

/** `t`/`tn` typed loosely here on purpose — the countdown composes several
 *  keys at runtime and the exact union isn't worth re-deriving in this
 *  file's own types. */
type Translate = ReturnType<typeof useI18n>["t"];
type TranslateN = ReturnType<typeof useI18n>["tn"];

/** One tier's numbers turned into words — "2 days, 3 hours left", "45
 *  minutes left", "about to be cleared". Composes the same
 *  count-pluralised-then-joined "Part" keys `PhotoPicker` already uses for
 *  "3 Fotos und 1 Datei", because no plural system here declines two counts
 *  in one key. */
function describe(tier: CountdownTier, t: Translate, tn: TranslateN): string {
  if (tier.unit === "now") return t("studio.photos.resume.countdown.now");

  if (tier.unit === "days") {
    const parts = [];
    if (tier.days > 0) {
      parts.push(tn("studio.photos.resume.countdown.daysPart", tier.days, { count: String(tier.days) }));
    }
    if (tier.hours > 0) {
      parts.push(tn("studio.photos.resume.countdown.hoursPart", tier.hours, { count: String(tier.hours) }));
    }
    return t("studio.photos.resume.countdown.left", { time: parts.join(` ${t("agent.andJoin")} `) });
  }

  if (tier.unit === "minutes") {
    return t("studio.photos.resume.countdown.left", {
      time: tn("studio.photos.resume.countdown.minutesPart", tier.minutes, { count: String(tier.minutes) }),
    });
  }

  return t("studio.photos.resume.countdown.left", {
    time: tn("studio.photos.resume.countdown.secondsPart", tier.seconds, { count: String(tier.seconds) }),
  });
}

const SEGMENT_LABEL_KEY: Record<Segment["unit"], TranslationKey> = {
  days: "studio.photos.resume.ticker.days",
  hours: "studio.photos.resume.ticker.hours",
  minutes: "studio.photos.resume.ticker.minutes",
  seconds: "studio.photos.resume.ticker.seconds",
};

/**
 * Digit-box colour, per the urgency ladder — tokens only, never a raw hex;
 * this feature has already shipped a literal in the wrong slot twice.
 *
 * **Only `coral-600` carries text here, never `yellow-*` or `coral-300`/
 * `coral-400`.** B1798 vetted exactly two brand hues to sit on this app's own
 * surfaces as *text* at 4.5:1 or better — `green-700` and `coral-600` — and
 * `test/contrast.test.ts` enforces it by banning every other accent as a
 * `text-` class outright. `yellow-300`/`400`/`600` and `coral-300`/`400` are
 * fill-only: real here as a background wash and a border, the same way the
 * design draft's own yellow and coral read as a tinted card rather than
 * coloured digits. `soon` therefore keeps the calm tier's ink text and adds
 * only the wash and the border; the ladder still reads as three visibly
 * different cards, just not through a third text hue that does not exist.
 */
const DIGIT_CLASS: Record<Urgency, string> = {
  calm: "border-line-quiet bg-surface-raised text-ink-strong",
  soon: "border-yellow-400/40 bg-yellow-400/15 text-ink-strong",
  urgent: "border-coral-400/40 bg-coral-400/15 text-coral-600",
  gone: "border-dashed border-line-quiet bg-transparent text-ink-faint",
};
const LABEL_CLASS: Record<Urgency, string> = {
  calm: "text-ink-faint",
  soon: "text-ink-muted",
  urgent: "text-coral-600",
  gone: "text-ink-faint",
};
const BAR_FILL_CLASS: Record<Urgency, string> = {
  calm: "bg-green-500",
  soon: "bg-yellow-400",
  urgent: "bg-coral-400",
  gone: "bg-transparent",
};

/**
 * The digits, boxed and coloured — B1806. Purely presentational: every
 * number and every colour decision comes from `segmentsFor`/`urgencyFor` in
 * `lib/staging/countdown.ts`, so there is exactly one clock, not a second one
 * hiding in this component's own thresholds.
 *
 * `aria-hidden` — the existing `describe()` sentence just above this in the
 * card is the accessible, tested text for the same fact; the boxes are a
 * second, purely visual reading of it; and a screen reader stepping through
 * four separate digit boxes plus a colon between each would be a worse
 * experience than the one sentence it already gets.
 */
function Ticker({
  tier,
  ms,
  fraction,
  t,
}: {
  tier: CountdownTier;
  ms: number;
  fraction: number;
  t: Translate;
}) {
  const urgency = urgencyFor(tier);
  const segments = segmentsFor(tier, ms);
  // The pulse is stingy: the last minute only, the seconds box only, off
  // entirely under `prefers-reduced-motion` (handled in app/globals.css —
  // `.fs-ticker-pulse` is removed outright by that media query, not just
  // slowed).
  const pulsing = urgency === "urgent" && ms > 0 && ms < 60_000;

  return (
    <div className="mt-2" aria-hidden="true">
      <div className="flex items-end gap-1">
        {segments.map((seg, i) => (
          <div key={seg.unit} className="flex items-end gap-1">
            {i > 0 && <span className="pb-4 font-mono text-sm text-ink-faint">:</span>}
            <span className="flex flex-col items-center gap-0.5">
              <span
                className={`min-w-10 rounded-md border px-1.5 py-1 text-center font-mono text-lg font-semibold tabular-nums ${DIGIT_CLASS[urgency]} ${
                  pulsing && seg.unit === "seconds" ? "fs-ticker-pulse" : ""
                }`}
              >
                {String(seg.value).padStart(2, "0")}
              </span>
              <span className={`font-mono text-[10px] uppercase tracking-wide ${LABEL_CLASS[urgency]}`}>
                {t(SEGMENT_LABEL_KEY[seg.unit])}
              </span>
            </span>
          </div>
        ))}
      </div>
      <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-line-faint">
        <div
          className={`h-full rounded-full ${BAR_FILL_CLASS[urgency]}`}
          style={{ width: `${fraction * 100}%` }}
        />
      </div>
    </div>
  );
}

/**
 * "You left this half-finished" — B1751 Task 4.3. Shown by `ExtractFlow`
 * instead of minting a new run whenever `GET .../studio/runs` finds one
 * already live for this owner.
 *
 * **The countdown ticks, at the rate its own precision needs — B1805.**
 * `now` is one piece of state shared by the whole list rather than one timer
 * per run: every tick recomputes each run's tier from its own `expiresAt`
 * (never cached at mount, so a list re-fetched after an extension reflects
 * the new deadline for free) and reschedules itself for whichever run needs
 * the next update soonest. A list showing only "2 days left" reschedules
 * itself a minute out; one showing seconds reschedules every second — never
 * the other way around.
 *
 * **This list still states facts, and claims no extension.** Each card's own
 * countdown is exactly `run.expiresAt` — true whether the run has been
 * warned or not, and true whether it has already been extended or not,
 * because it names nothing more than what is already on the manifest. The
 * three-sentence "here is what just happened to your clock" framing — no
 * hurry yet / you just got extended / no further extension — belongs to the
 * run that was actually picked, not to a list somebody may only be glancing
 * at: `ExtractFlow` renders it once, right after `Continue`, above whichever
 * screen the resumed run lands on.
 *
 * Above the fold, in every case: finished days already belong to the
 * journal and are unaffected by anything on this screen or by the run
 * itself expiring — the sentence somebody reading a deletion clock needs
 * first, not last.
 *
 * **Destroying a run is the rare action, not the ordinary one.** It sits as
 * a small text link under the (real, weighted) Continue button rather than
 * a second button beside it, and goes through `ConfirmPanel` — this
 * repository forbids `window.confirm` outright — naming what is lost (the
 * staged photographs) and what is not (`studio.photos.resume.onlyAdded`, reused
 * rather than a fourth copy of the same sentence this feature already
 * carries three of).
 */
export default function ResumeScreen({
  username,
  runs,
  storage,
  onContinue,
  onStartNew,
  onDestroyed,
}: {
  username: string;
  runs: RunSummaryClient[];
  /** This journal's whole staging footprint — B1807. `undefined` while
   *  `ExtractFlow`'s own fetch is still in flight; the summary bar simply
   *  stays hidden until it has a real figure, the same as it does for a
   *  journal that never approaches the ceiling. */
  storage?: { usedBytes: number; runs: number };
  onContinue: (run: RunSummaryClient) => void;
  onStartNew: () => void;
  /** Called once a run is actually gone from disk, so the caller can drop it
   *  from whatever list it is holding. */
  onDestroyed: (runId: string) => void;
}) {
  const { t, tn, locale } = useI18n();
  const [now, setNow] = useState(() => new Date());
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  // One shared timer for the whole list — not one per run — rescheduling
  // itself at whichever run's tier needs the soonest update. `setTimeout`
  // rather than `setInterval` because the needed delay changes as a run
  // crosses a tier boundary (days → minutes → seconds) and a fixed interval
  // cannot speed itself up.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    function tick() {
      const at = new Date();
      setNow(at);
      const next = Math.min(
        ...runs.map((run) => tickIntervalFor(countdownFor(run.expiresAt, at))).filter((ms) => ms > 0),
      );
      if (Number.isFinite(next)) timer = setTimeout(tick, next);
    }
    tick();
    return () => clearTimeout(timer);
  }, [runs]);

  async function destroy(runId: string) {
    setBusy(true);
    setFailed(false);
    const res = await fetch(
      `/api/helper/${encodeURIComponent(username)}/studio/run?run=${encodeURIComponent(runId)}`,
      { method: "DELETE" },
    ).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setFailed(true);
      return;
    }
    setConfirming(null);
    onDestroyed(runId);
  }

  return (
    <div className="mt-4">
      <p className="text-sm text-ink-body">{t("studio.photos.resume.title")}</p>
      <p className="mt-1 text-xs text-ink-secondary">{t("studio.photos.resume.onlyAdded")}</p>

      {/* One figure for the whole journal, not one per run — the ceiling is
       *  per journal (B1807), so repeating the same total on every card
       *  below would say nothing a single line here does not already say.
       *  Shown only once it is worth mentioning, and — because a person
       *  refused an upload for exactly this reason lands here to fix it —
       *  the destroy control on every card below is the answer, not a
       *  dead end. */}
      {storage !== undefined &&
        storage.usedBytes >= JOURNAL_STAGING_MAX_BYTES * JOURNAL_STAGING_WARN_FRACTION && (
          <div className="mt-3 rounded-xl border border-line-strong px-4 py-2.5">
            <p className="text-sm text-ink-secondary">
              {tn("studio.photos.resume.storage.bar", storage.runs, {
                used: formatStagedBytes(storage.usedBytes, locale),
                limit: formatGigabytes(JOURNAL_STAGING_MAX_BYTES, locale),
                count: String(storage.runs),
              })}
            </p>
            <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-line-faint">
              <div
                className="h-full rounded-full bg-yellow-400"
                style={{
                  width: `${Math.min(100, (storage.usedBytes / JOURNAL_STAGING_MAX_BYTES) * 100)}%`,
                }}
              />
            </div>
          </div>
        )}

      <ul className="mt-3 divide-y divide-line-faint rounded-xl border border-line-strong">
        {runs.map((run) => {
          const live = run.photos.filter((p) => !p.dropped).length;
          const left = run.daysLeftToTell;
          const tier = countdownFor(run.expiresAt, now);
          const ms = Date.parse(run.expiresAt) - now.getTime();
          const fraction = windowFractionFor(run, now);
          return (
            <li key={run.runId} className="px-4 py-3">
              <p className="text-sm font-semibold text-ink-strong">{run.createdAt.slice(0, 10)}</p>
              <p className="mt-1 text-xs text-ink-secondary">
                {tn("studio.photos.board.photoCount", live, { count: String(live) })}
                {" · "}
                {tn("studio.photos.resume.daysLeft", left, { count: String(left) })}
              </p>
              <Ticker tier={tier} ms={ms} fraction={fraction} t={t} />
              <p className="mt-1 text-xs text-ink-secondary">{describe(tier, t, tn)}</p>
              <button
                type="button"
                onClick={() => onContinue(run)}
                className="mt-2 inline-flex min-h-11 items-center rounded-full bg-action-strong px-5 text-base font-semibold text-on-action"
              >
                {t("studio.photos.resume.continue")}
              </button>

              {confirming === run.runId ? (
                <div className="mt-2">
                  <ConfirmPanel
                    label={t("studio.photos.resume.countdown.destroyButton")}
                    question={tn("studio.photos.resume.countdown.destroyQuestion", live, { count: String(live) })}
                    details={t("studio.photos.resume.onlyAdded")}
                    confirmLabel={t("studio.photos.resume.countdown.destroyConfirm")}
                    tone="destructive"
                    busyLabel={t("studio.photos.resume.countdown.destroyBusy")}
                    busy={busy}
                    error={failed ? t("studio.photos.resume.countdown.destroyFailed") : undefined}
                    onConfirm={() => void destroy(run.runId)}
                    onCancel={() => {
                      setConfirming(null);
                      setFailed(false);
                    }}
                  />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setConfirming(run.runId);
                    setFailed(false);
                  }}
                  className="mt-2 block text-xs font-semibold text-coral-600 underline underline-offset-2 hover:opacity-75"
                >
                  {t("studio.photos.resume.countdown.destroyButton")}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={onStartNew}
        className="mt-4 inline-flex min-h-11 items-center rounded-full border border-line-strong px-5 text-base font-semibold text-ink-strong"
      >
        {t("studio.photos.resume.startNew")}
      </button>
    </div>
  );
}
