"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/components/LocaleProvider";
import {
  armedOrDeclinedTrips,
  notificationPermissionStatus,
  openAppSettings,
  requestNotificationPermission,
  routeStatus,
  useNativeShell,
  type NotificationPermission,
  type RouteRecordStatus,
} from "@/components/nativeShell";
import { beforeTripNoticeTime, nextOpenEndedReminder, stopNoticeTime } from "@/lib/gps/notify";
import { journalPath } from "@/lib/journalPath";

export type PlanTrip = { id: string; title: string; start: string; end: string };
type Row = { trip: PlanTrip; kind: "recording" | "recordsFrom" | "notDecided" | "declined"; status: RouteRecordStatus };

const BUTTON = "mt-3 min-h-11 rounded-full border border-line-strong px-5 text-base font-semibold text-ink-strong hover:bg-surface-subtle";
const PILL = "shrink-0 rounded-full px-2 py-0.5 text-xs font-bold";

/** Today as YYYY-MM-DD, device-local — the same clock the notices use. */
function todayISO(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * "Recording plan" — B2301. Native-only: armed, declined and open-ended exist
 * only in the iPhone recorder, so a browser has no source and shows nothing.
 * Current, future and open-ended trips, one row each; every time comes from
 * `lib/gps/notify.ts`, the same math the notices are scheduled with, and no
 * row lists a time that cannot happen (armed trips have no before-trip
 * notice, unarmed ones no stop notice). With notifications off no time is
 * promised at all.
 */
export default function RecordingPlan({ username, trips }: { username: string; trips: readonly PlanTrip[] }) {
  const native = useNativeShell();
  const { t, locale } = useI18n();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (!native) return;
    let live = true;
    const load = async () => {
      const now = Date.now();
      const today = todayISO(now);
      const { armed, declined } = await armedOrDeclinedTrips().catch(() => ({ armed: [] as string[], declined: [] as string[] }));
      const shown = trips.filter((tr) => tr.end >= today || armed.includes(tr.id));
      const out: Row[] = [];
      for (const trip of shown) {
        const status = await routeStatus(trip.id).catch((): RouteRecordStatus => ({ state: "off" }));
        const isArmed = armed.includes(trip.id) || status.state === "recording";
        const kind: Row["kind"] = declined.includes(trip.id)
          ? "declined"
          : isArmed
            ? trip.start > today
              ? "recordsFrom"
              : "recording"
            : "notDecided";
        out.push({ trip, kind, status });
      }
      const p = await notificationPermissionStatus().then((r) => r.status).catch((): NotificationPermission => "unknown");
      if (!live) return;
      setRows(out);
      setNow(now);
      setPermission(p);
    };
    void load();
    const onVisible = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [native, trips]);

  // A tap on a notice lands on /studio/location#trip-<id>. The rows only exist
  // after the plugin answers, so the browser's own jump has nothing to find.
  useEffect(() => {
    if (!rows) return;
    const el = window.location.hash.startsWith("#trip-") ? document.getElementById(decodeURIComponent(window.location.hash.slice(1))) : null;
    el?.scrollIntoView({ block: "center" });
    el?.focus();
  }, [rows]);

  if (!native || !rows || rows.length === 0) return null;

  const fmt = (ms: number) => new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(ms));
  const fmtDate = (iso: string) => new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(new Date(`${iso}T00:00:00`));
  const granted = permission === "granted";

  /** The one notice this row will (or, with notifications off, would) send. */
  function notice({ trip, kind, status }: Row): { at: number; text: string; would: string; every?: boolean } | null {
    if (kind === "declined") return null;
    if (kind === "notDecided") {
      const at = beforeTripNoticeTime(now, trip);
      return at === null ? null : { at, text: t("studio.record.notice.beforeTrip", { title: trip.title }), would: "studio.location.plan.wouldAsk" };
    }
    if (status.state === "recording" && status.openEnded) {
      return { at: nextOpenEndedReminder(Date.parse(status.since), now), text: t("studio.record.notice.openEnded"), would: "studio.location.plan.wouldRemind", every: true };
    }
    const at = stopNoticeTime(trip);
    return at > now ? { at, text: t("studio.record.notice.stopped", { title: trip.title }), would: "studio.location.plan.wouldStop" } : null;
  }

  return (
    <section className="rounded-2xl border border-line-quiet bg-surface-raised p-4" aria-labelledby="recording-plan-h">
      <h2 id="recording-plan-h" className="font-display text-base font-semibold text-ink-strong">{t("studio.location.plan.heading")}</h2>
      <p className="mt-1 text-sm text-ink-secondary">{t("studio.location.plan.lede")}</p>
      {granted ? (
        <p className="mt-3 text-sm text-ink-strong">✓ {t("studio.location.plan.notifOn")}</p>
      ) : (
        <div role="status" className="mt-3 rounded-2xl border border-amber-300 bg-amber-100 px-4 py-3 text-sm text-ink-strong">
          <p className="font-semibold">{t("studio.location.plan.offTitle")}</p>
          <p className="mt-1">{t("studio.location.plan.offBody")}</p>
          <button
            type="button"
            className={BUTTON}
            onClick={() =>
              permission === "denied"
                ? void openAppSettings()
                : void requestNotificationPermission().then((r) => setPermission(r.status)).catch(() => {})
            }
          >
            {permission === "denied" ? t("studio.record.openSettings") : t("studio.record.notice.allowButton")}
          </button>
        </div>
      )}
      <ul className={`mt-3 divide-y divide-line-quiet border-t border-line-quiet ${granted ? "" : "opacity-70"}`}>
        {rows.map((row) => {
          const n = notice(row);
          return (
            <li key={row.trip.id} id={`trip-${row.trip.id}`} tabIndex={-1} className="py-3 outline-offset-2">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate font-semibold text-ink-strong">{row.trip.title}</span>
                <span className={`${PILL} ${row.kind === "recording" ? "bg-green-100 text-green-700" : "bg-surface-subtle text-ink-secondary"}`}>
                  {row.kind === "recording" && t("studio.location.strip.recording")}
                  {row.kind === "recordsFrom" && t("studio.location.plan.recordsFrom", { date: fmtDate(row.trip.start) })}
                  {row.kind === "notDecided" && t("studio.location.plan.notDecided")}
                  {row.kind === "declined" && t("studio.record.notThisTrip")}
                </span>
              </div>
              <p className={`mt-1 text-sm ${granted ? "text-ink-body" : "text-ink-secondary"}`}>
                {!n && t("studio.location.plan.noNotice")}
                {n && granted && (n.every ? t("studio.location.plan.everyWeek", { at: fmt(n.at) }) + " — “" + n.text + "”" : t("studio.location.plan.noticeAt", { at: fmt(n.at), text: n.text }))}
                {n && !granted && t(n.would as "studio.location.plan.wouldAsk", { at: fmt(n.at) })}
              </p>
              {row.kind === "notDecided" && (
                <a
                  href={`${journalPath(username)}/studio/trip?trip=${encodeURIComponent(row.trip.id)}#section-route`}
                  className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-ink-strong underline underline-offset-2"
                >
                  {t("studio.location.plan.turnOn")}
                </a>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-ink-secondary">{t("studio.location.plan.pastNote")}</p>
    </section>
  );
}
