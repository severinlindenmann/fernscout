"use client";

import { useI18n } from "@/components/LocaleProvider";
import { useNativeShell } from "@/components/nativeShell";
import RouteRecordSection from "@/components/studio/trip/RouteRecordSection";
import type { RecordingState } from "@/lib/gps/recorderState";

export type StripTrip = { id: string; title: string; start: string; end: string };

/** The five states the plan names, derived once from the server's own answer
 * rather than re-guessed per render — `studio-recording-strip.test.tsx`
 * exercises this directly, independent of the component below. */
export type StripState =
  | { kind: "noReport" }
  | { kind: "off" }
  | { kind: "needsAlways" }
  | { kind: "silentStale" }
  | { kind: "recording" };

export function stripState(recording: RecordingState | null): StripState {
  if (!recording) return { kind: "noReport" };
  if (recording.state === "off") return { kind: "off" };
  if (recording.state === "silent" && recording.reason === "permission") return { kind: "needsAlways" };
  if (recording.state === "silent") return { kind: "silentStale" };
  return { kind: "recording" };
}

/** One tone per state, so what needs attention reads before a word does:
 * green recording, grey off or not yet set up, cream waiting on the owner,
 * coral silent. */
const TONE: Record<StripState["kind"], { box: string; dot: string }> = {
  recording: { box: "border-green-100 bg-green-100/60", dot: "bg-green-700" },
  off: { box: "border-line-quiet bg-surface-neutral", dot: "bg-ink-faint" },
  noReport: { box: "border-line-quiet bg-surface-neutral", dot: "bg-ink-faint" },
  needsAlways: { box: "border-line-quiet bg-surface-subtle", dot: "bg-yellow-600" },
  silentStale: { box: "border-coral-100 bg-coral-50", dot: "bg-coral-600" },
};

/** "3 minutes ago", "2 hours ago", "yesterday" — relative, never a bare
 * instant: the two times this strip shows (the phone's own last report and
 * the newest stored position) are meant to be compared at a glance, which an
 * absolute clock time does not do as well. */
function formatAgo(iso: string, locale: string): string {
  const ms = Date.now() - Date.parse(iso);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const minutes = Math.round(ms / 60_000);
  if (Math.abs(minutes) < 60) return rtf.format(-minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(-hours, "hour");
  return rtf.format(-Math.round(hours / 24), "day");
}

/**
 * "Your routes" recording strip — B2563 T2. Server-fed from
 * `recordingState()` and `recordedTrips()`' newest position; the five states
 * above are the whole of what it can say, each with its own fix. In the
 * iPhone app it hands off entirely to
 * `RouteRecordSection` — the trip's own existing switch, arm/disarm and
 * "Always" walkthrough — rather than inventing a second native bridge; a
 * browser only ever shows the state and the words "on your iPhone", and
 * sends nothing to the phone.
 */
export default function RecordingStrip({
  username,
  trip,
  recording,
  newestPosition,
}: {
  username: string;
  trip: StripTrip | null;
  recording: RecordingState | null;
  newestPosition: string | undefined;
}) {
  const native = useNativeShell();
  const { t, locale } = useI18n();

  if (!trip) return null;

  if (native) {
    return (
      <section className="rounded-2xl border border-line-quiet bg-surface-raised p-4">
        <RouteRecordSection username={username} trip={trip} />
      </section>
    );
  }

  const state = stripState(recording);
  const reportedAt = recording?.lastReport ? formatAgo(recording.lastReport, locale) : undefined;
  const newestAt = newestPosition ? formatAgo(newestPosition, locale) : undefined;

  return (
    <section
      className={`flex gap-3 rounded-2xl border p-4 ${TONE[state.kind].box}`}
      data-testid="recording-strip"
      data-state={state.kind}
    >
      <span aria-hidden className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${TONE[state.kind].dot}`} />
      <div className="min-w-0">
      {state.kind === "noReport" && (
        <>
          <p className="text-sm font-semibold text-ink-strong">{t("studio.location.strip.noReport.title")}</p>
          <p className="mt-1 text-sm text-ink-secondary">{t("studio.location.strip.noReport.body")}</p>
        </>
      )}
      {state.kind === "off" && (
        <>
          <p className="text-sm font-semibold text-ink-strong">{t("studio.location.strip.off")} · {trip.title}</p>
          <p className="mt-1 text-sm text-ink-secondary">{t("studio.location.strip.changeOnPhone")}</p>
        </>
      )}
      {state.kind === "needsAlways" && (
        <>
          <p className="text-sm font-semibold text-ink-strong">{t("studio.location.strip.needsAlways")}</p>
          <p className="mt-1 text-sm text-ink-secondary">{t("studio.record.error.whenInUseOnly.steps")}</p>
          <p className="mt-1 text-sm text-ink-secondary">{t("studio.location.strip.changeOnPhone")}</p>
        </>
      )}
      {state.kind === "silentStale" && (
        <>
          <p className="text-sm font-semibold text-ink-strong">{t("studio.location.strip.silent")}</p>
          <p className="mt-1 text-sm text-ink-secondary">{t("studio.location.strip.silentBody")}</p>
          <p className="mt-1 text-sm text-ink-secondary">{t("studio.location.strip.changeOnPhone")}</p>
        </>
      )}
      {state.kind === "recording" && (
        <>
          <p className="text-sm font-semibold text-ink-strong">{t("studio.location.strip.recording")} · {trip.title}</p>
          {reportedAt && <p className="mt-1 text-sm text-ink-secondary">{t("studio.location.strip.reportedAt", { at: reportedAt })}</p>}
          <p className="mt-1 text-sm text-ink-secondary">
            {newestAt ? t("studio.location.strip.newestPosition", { at: newestAt }) : t("studio.location.strip.noPosition")}
          </p>
        </>
      )}
      </div>
    </section>
  );
}
