"use client";

import Link from "next/link";
import { useI18n } from "@/components/LocaleProvider";
import { useNativeShell } from "@/components/nativeShell";
import RouteRecordSection from "@/components/studio/trip/RouteRecordSection";
import type { RecordingState } from "@/lib/gps/recorderState";

export type StripTrip = { id: string; title: string; start: string; end: string };

/** The six states the plan names, derived once from the server's own answer
 * rather than re-guessed per render — `studio-recording-strip.test.tsx`
 * exercises this directly, independent of the component below. */
export type StripState =
  | { kind: "homeFirst" }
  | { kind: "noReport" }
  | { kind: "off" }
  | { kind: "needsAlways" }
  | { kind: "silentStale" }
  | { kind: "recording" };

export function stripState(homeReady: boolean, recording: RecordingState | null): StripState {
  if (!homeReady) return { kind: "homeFirst" };
  if (!recording) return { kind: "noReport" };
  if (recording.state === "off") return { kind: "off" };
  if (recording.state === "silent" && recording.reason === "permission") return { kind: "needsAlways" };
  if (recording.state === "silent") return { kind: "silentStale" };
  return { kind: "recording" };
}

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
 * `recordingState()`, `recordedTrips()`' newest position and
 * `hasHomeZoneOrDeclined()`; the six states above are the whole of what it
 * can say, each with its own fix. In the iPhone app it hands off entirely to
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
  homeReady,
}: {
  username: string;
  trip: StripTrip | null;
  recording: RecordingState | null;
  newestPosition: string | undefined;
  homeReady: boolean;
}) {
  const native = useNativeShell();
  const { t, locale } = useI18n();

  if (!trip) return null;

  if (native) {
    return (
      <section className="rounded-2xl border border-line-quiet bg-surface-raised p-4">
        <RouteRecordSection username={username} trip={trip} homeZoneReady={homeReady} />
      </section>
    );
  }

  const state = stripState(homeReady, recording);
  const reportedAt = recording?.lastReport ? formatAgo(recording.lastReport, locale) : undefined;
  const newestAt = newestPosition ? formatAgo(newestPosition, locale) : undefined;

  return (
    <section className="rounded-2xl border border-line-quiet bg-surface-raised p-4" data-testid="recording-strip" data-state={state.kind}>
      {state.kind === "homeFirst" && (
        <>
          <p className="text-sm font-semibold text-ink-strong">{t("studio.record.needsHomeZone")}</p>
          <Link href="#private-places" className="mt-1 inline-block text-sm font-semibold text-ink-strong underline underline-offset-2">
            {t("studio.record.setHomeZone")}
          </Link>
        </>
      )}
      {state.kind === "noReport" && (
        <>
          <p className="text-sm font-semibold text-ink-strong">{t("studio.location.strip.noReport.title")}</p>
          <p className="mt-1 text-sm text-ink-secondary">{t("studio.location.strip.noReport.body")}</p>
        </>
      )}
      {state.kind === "off" && (
        <>
          <p className="text-sm font-semibold text-ink-strong">{t("studio.location.strip.off")}</p>
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
          <p className="text-sm font-semibold text-ink-strong">{t("studio.location.strip.recording")}</p>
          {reportedAt && <p className="mt-1 text-sm text-ink-secondary">{t("studio.location.strip.reportedAt", { at: reportedAt })}</p>}
          {newestAt && (
            <p className="mt-1 text-sm text-ink-secondary">{t("studio.location.strip.newestPosition", { at: newestAt })}</p>
          )}
        </>
      )}
    </section>
  );
}
