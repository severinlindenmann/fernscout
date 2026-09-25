"use client";

import { useEffect, useState } from "react";
import {
  armedOrDeclinedTrips,
  notificationPermissionStatus,
  requestNotificationPermission,
  scheduleBeforeTripNotices,
  useNativeShell,
  type NotificationPermission,
} from "@/components/nativeShell";
import { useI18n } from "@/components/LocaleProvider";
import type { TranslationKey } from "@/lib/i18n";
import { beforeTripNoticeTime, tripsNeedingBeforeNotice, type NoticeTrip } from "@/lib/gps/notify";

type T = (key: TranslationKey, vars?: Record<string, string>) => string;

const BUTTON = "mt-3 min-h-11 rounded-full border border-line-strong px-5 text-base font-semibold text-ink-strong hover:bg-surface-subtle disabled:opacity-50";

async function dueTrips(trips: readonly NoticeTrip[]): Promise<NoticeTrip[]> {
  const { armed, declined } = await armedOrDeclinedTrips().catch(() => ({ armed: [], declined: [] }));
  return tripsNeedingBeforeNotice(Date.now(), trips, new Set([...armed, ...declined]));
}

async function scheduleAll(username: string, due: readonly NoticeTrip[], t: T): Promise<void> {
  await scheduleBeforeTripNotices(
    due.map((trip) => ({
      id: trip.id,
      url: `/${username}/studio/trip?trip=${encodeURIComponent(trip.id)}`,
      body: t("studio.record.notice.beforeTrip", { title: trip.title }),
      at: new Date(beforeTripNoticeTime(Date.now(), trip) ?? Date.now()).toISOString(),
    })),
  );
}

/**
 * The hub's before-trip notice — B2197. Entirely native now: `t()` here
 * supplies the one translated string this needs, `lib/gps/notify.ts` is
 * still the one place a fire time is computed, and
 * `LocationRecorder.scheduleBeforeTrip` (`ios/App/App/Recorder.swift`)
 * does the actual `UNUserNotificationCenter` call — no
 * `@capacitor/local-notifications`, and so no dependency this session
 * could not install.
 *
 * Permission is asked only from an explicit "Allow reminders" tap here,
 * never silently — B2197's "asked... with a sentence of context" read as
 * real UI, not a comment beside a `requestAuthorization` call. Once
 * granted, every later load just (re)schedules the current due set with no
 * further prompt.
 */
export default function ScheduleRouteNotices({ username, trips }: { username: string; trips: readonly NoticeTrip[] }) {
  const native = useNativeShell();
  const { t } = useI18n();
  const [due, setDue] = useState<NoticeTrip[]>([]);
  const [permission, setPermission] = useState<NotificationPermission>("unknown");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!native) return;
    let live = true;
    (async () => {
      const [d, p] = await Promise.all([
        dueTrips(trips),
        notificationPermissionStatus()
          .then((r) => r.status)
          .catch((): NotificationPermission => "unknown"),
      ]);
      if (!live) return;
      setDue(d);
      setPermission(p);
      if (p === "granted") await scheduleAll(username, d, t);
    })();
    return () => {
      live = false;
    };
  }, [native, username, trips, t]);

  if (!native || due.length === 0 || permission !== "unknown") return null;

  return (
    <div role="status" className="mt-4 rounded-2xl border border-line-prominent bg-surface-raised px-4 py-3 text-sm text-ink-strong">
      <p>{t("studio.record.notice.permissionAsk")}</p>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void requestNotificationPermission()
            .then(async (r) => {
              setPermission(r.status);
              if (r.status === "granted") await scheduleAll(username, due, t);
            })
            .finally(() => setBusy(false));
        }}
        className={BUTTON}
      >
        {t("studio.record.notice.allowButton")}
      </button>
    </div>
  );
}
