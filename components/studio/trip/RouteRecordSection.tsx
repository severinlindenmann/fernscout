"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import ConfirmPanel from "@/components/ConfirmPanel";
import { useI18n } from "@/components/LocaleProvider";
import {
  armRoute,
  disarmRoute,
  keepRecordingRoute,
  locationPermission,
  needsGpsTokenRefresh,
  openAppSettings,
  refreshGpsToken,
  requestLocationPermission,
  routeStatus,
  useNativeShell,
  type LocationPermission,
  type RouteRecordStatus,
} from "@/components/nativeShell";

const EYEBROW = "font-mono text-xs uppercase tracking-wide text-ink-secondary";
const BUTTON = "mt-3 min-h-11 rounded-full border border-line-strong px-5 text-base font-semibold text-ink-strong hover:bg-surface-subtle disabled:opacity-50";

function Switch({ on, disabled, busy, label, onChange }: { on: boolean; disabled?: boolean; busy?: boolean; label: string; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      onClick={onChange}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-40 ${on ? "bg-green-700" : "bg-line-prominent"}`}
    >
      <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-surface-raised shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

/**
 * "Record my route" — B2198. Below `TripEditFlow`'s Save bar because it
 * acts at once, the same reason `AddressSection` does not wait for Save
 * either. Rendered only when `useNativeShell()` is true — a browser never
 * sees this section at all, capability on or off, because the switch it
 * offers does nothing without the plugin behind it.
 *
 * All state lives on the phone (`LocationRecorder`'s `Recorder` singleton),
 * not the server — `status()` is asked fresh on mount, the only source of
 * truth this component has.
 */
export default function RouteRecordSection({
  username,
  trip,
  homeZoneReady,
}: {
  username: string;
  trip: { id: string; title: string; start: string; end: string };
  homeZoneReady: boolean;
}) {
  const native = useNativeShell();
  const { t, locale } = useI18n();
  const [status, setStatus] = useState<RouteRecordStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [permission, setPermission] = useState<LocationPermission | null>(null);
  /** The "Always" walkthrough — opened by the switch whenever iOS's
   *  permission is not already "Always", so nobody arms a recorder that
   *  would silently stop the moment they leave the app. */
  const [guide, setGuide] = useState(false);

  const refresh = useCallback(async () => {
    try {
      return await routeStatus(trip.id);
    } catch {
      // Outside the shell, or the plugin is not there yet — nothing to show.
      return undefined;
    }
  }, [trip.id]);

  /** Security review (2026-09-24), finding 2 — a fresh `write:gps` token is
   *  minted only while this trip is actually armed (native's own status
   *  says so), and only with under 7 days left on the one native already
   *  holds — `status.tokenExpiresAt`, never a token itself and never a
   *  locally-guessed value that starts `undefined` on every mount. Minting
   *  on a mere page visit, armed or not, would both spend a mint nobody
   *  asked for and revoke the token any other device's recorder was still
   *  using.
   *
   *  Second review (2026-09-24), same finding — `unauthorized` mints
   *  unconditionally, ignoring the 7-day threshold: the owner is on the
   *  page precisely because uploading stopped, and native's own `setToken`
   *  clears the error the moment a fresh one lands, so there is nothing to
   *  wait 7 days for. Returns whether it minted, so the caller knows to
   *  re-read status afterward. */
  const refreshTokenIfNeeded = useCallback(
    async (s: RouteRecordStatus): Promise<boolean> => {
      if (s.state === "error" && s.kind === "unauthorized") {
        return refreshGpsToken(username)
          .then(() => true)
          .catch(() => false);
      }
      const armed = s.state === "recording" || (s.state === "error" && s.kind === "whenInUseOnly");
      if (!armed) return false;
      if (!needsGpsTokenRefresh(s.tokenExpiresAt, Date.now())) return false;
      return refreshGpsToken(username)
        .then(() => true)
        .catch(() => false);
    },
    [username],
  );

  useEffect(() => {
    if (!native) return;
    let live = true;
    const load = async () => {
      const s = await refresh();
      if (!live || !s) return;
      setStatus(s);
      // Read again on every return to the page — the Settings app is where
      // "Always" gets granted once iOS's own prompt is spent.
      const p = await locationPermission().catch(() => null);
      if (live && p) setPermission(p);
      const minted = await refreshTokenIfNeeded(s);
      // A fresh mint may have cleared an `unauthorized` error natively
      // (`setToken` → `Recorder.clearAuthError()`) — read it back so the
      // section does not keep showing a resolved error.
      if (minted && live) {
        const s2 = await refresh();
        if (live && s2) setStatus(s2);
      }
    };
    void load();
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [native, refresh, refreshTokenIfNeeded]);

  if (!native) return null;

  async function withBusy(run: () => Promise<RouteRecordStatus>) {
    setBusy(true);
    try {
      setStatus(await run());
    } catch {
      // The plugin call itself failed (offline mint, denied prompt); status
      // stays as it was rather than guessing a new one.
    } finally {
      setBusy(false);
    }
  }

  // Security review (2026-09-24) second round, finding 1 — native shows a
  // confirmation before arming, substituting the real host/user itself
  // into this template; `{host}`/`{user}` are literal placeholders, not
  // interpolated here.
  const confirmCopy = {
    confirmTitle: t("studio.record.confirm.title", { title: trip.title }),
    confirmBody: t("studio.record.confirm.body"),
    confirmRecordLabel: t("studio.record.confirm.record"),
    confirmCancelLabel: t("studio.record.confirm.cancel"),
  };

  const arm = () =>
    withBusy(async () => {
      await refreshGpsToken(username);
      // Already translated here, not in Swift — Recorder stores these and
      // never hardcodes English (B2197).
      return armRoute({
        trip: trip.id,
        title: trip.title,
        start: trip.start,
        end: trip.end,
        user: username,
        stopBody: t("studio.record.notice.stopped", { title: trip.title }),
        unauthorizedBody: t("studio.record.notice.unauthorized"),
        ...confirmCopy,
      });
    });
  /** The switch: straight to arming when "Always" is already granted,
   *  otherwise the walkthrough first. */
  const startRecording = () => {
    if (permission?.status === "always") void arm();
    else setGuide(true);
  };
  const askPermission = async () => {
    setBusy(true);
    try {
      setPermission(await requestLocationPermission());
    } catch {
      // The plugin call failed — the walkthrough stays open as it was.
    } finally {
      setBusy(false);
    }
  };
  const alreadyArmed = status?.state === "recording" || status?.state === "error";
  const finishGuide = async () => {
    setGuide(false);
    if (alreadyArmed) {
      const s = await refresh();
      if (s) setStatus(s);
    } else {
      await arm();
    }
  };

  const decline = () => withBusy(() => disarmRoute(trip.id, true));
  const stop = () => withBusy(() => disarmRoute(trip.id, false));
  // A stop or a cooldown end clears the native credential (security review,
  // finding 4 — nothing stays armed to upload with) — Keep recording is
  // re-arming that trip, so it mints the same way `arm()` does.
  const keep = () =>
    withBusy(async () => {
      await refreshGpsToken(username);
      return keepRecordingRoute(trip.id, t("studio.record.notice.openEnded"), confirmCopy);
    });

  const fmt = (iso: string) =>
    new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  const fmtDate = (iso: string) => new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(new Date(iso));

  return (
    <section id="section-route" className="mt-8 border-t border-line-quiet pt-6">
      <h2 className={EYEBROW}>{t("studio.tripEdit.section.route")}</h2>

      {!status && <p className="mt-3 text-sm text-ink-secondary">{t("studio.record.loading")}</p>}

      {status?.state === "off" &&
        (homeZoneReady ? (
          <div className="mt-3">
            <div className="flex items-center gap-4">
              <Switch on={false} busy={busy} label={t("studio.record.switchLabel")} onChange={startRecording} />
              <span className="text-sm text-ink-strong">{t("studio.record.switchLabel")}</span>
            </div>
            <button type="button" disabled={busy} onClick={() => void decline()} className={BUTTON}>
              {t("studio.record.notThisTrip")}
            </button>
          </div>
        ) : (
          <p className="mt-3 text-sm text-ink-secondary">
            {t("studio.record.needsHomeZone")}{" "}
            <Link href={`/${username}/studio/location`} className="font-semibold text-ink-strong underline underline-offset-2">
              {t("studio.record.setHomeZone")}
            </Link>
          </p>
        ))}

      {status?.state === "declined" && <p className="mt-3 text-sm text-ink-secondary">{t("studio.record.declinedNote")}</p>}

      {status?.state === "recording" && (
        <div className="mt-3">
          <p className="text-sm text-ink-strong">
            {t("studio.record.recordingSince", { since: fmt(status.since) })}
            {status.lastUploadAt ? ` · ${t("studio.record.lastUpload", { at: fmt(status.lastUploadAt) })}` : ""}
          </p>
          <button type="button" disabled={busy} onClick={() => void stop()} className={BUTTON}>
            {t("studio.record.stop")}
          </button>
        </div>
      )}

      {status?.state === "stopped" && (
        <div className="mt-3">
          <p className="text-sm text-ink-strong">{t("studio.record.stoppedOn", { date: fmtDate(status.stoppedOn) })}</p>
          <button type="button" disabled={busy} onClick={() => void keep()} className={BUTTON}>
            {t("studio.record.keepRecording")}
          </button>
        </div>
      )}

      {status?.state === "error" && (
        <div className="mt-3 rounded-2xl border border-coral-300 bg-coral-100 px-4 py-3 text-sm text-ink-strong">
          {status.kind === "whenInUseOnly" && (
            <p>
              {t("studio.record.error.whenInUseOnly")}{" "}
              <button type="button" onClick={() => setGuide(true)} className="font-semibold underline underline-offset-2">
                {t("studio.record.access.fix")}
              </button>
            </p>
          )}
          {status.kind === "unauthorized" && <p>{t("studio.record.error.unauthorized")}</p>}
          {status.kind === "storageFull" && <p>{t("studio.record.error.storageFull")}</p>}
          {/* Security review (2026-09-24) second round, finding 2 — a kind
              this page does not name specifically (a bare 403, 429, …)
              still reads in words rather than as an empty box. */}
          {status.kind !== "whenInUseOnly" && status.kind !== "unauthorized" && status.kind !== "storageFull" && (
            <p>{t("studio.record.error.generic", { code: status.kind })}</p>
          )}
          {/* Same finding — every error state needs a way out, not only
              "recording" does. */}
          <button type="button" disabled={busy} onClick={() => void stop()} className={BUTTON}>
            {t("studio.record.stop")}
          </button>
        </div>
      )}

      {guide && permission && (
        <div className="mt-4">
          <LocationGuide
            permission={permission}
            busy={busy}
            doneLabel={alreadyArmed ? t("studio.record.permission.done") : t("studio.record.switchLabel")}
            onAsk={() => void askPermission()}
            onDone={() => void finishGuide()}
            onCancel={() => setGuide(false)}
          />
        </div>
      )}

      {!guide && permission && status && status.state !== "declined" && !(status.state === "error" && status.kind === "whenInUseOnly") && (
        <LocationAccessLine permission={permission} onFix={() => setGuide(true)} />
      )}
    </section>
  );
}

/** Where "Always" stands, always visible under the section — so the owner
 *  can see, and fix, why a route is not being recorded without first
 *  having to notice a gap on the map. */
function LocationAccessLine({ permission, onFix }: { permission: LocationPermission; onFix: () => void }) {
  const { t } = useI18n();
  if (permission.status === "always" && permission.precise) {
    return <p className="mt-4 text-sm text-ink-secondary">✓ {t("studio.record.access.always")}</p>;
  }
  if (permission.status === "always") {
    return (
      <p className="mt-4 text-sm text-ink-strong">
        {t("studio.record.access.imprecise")}{" "}
        <button type="button" onClick={() => void openAppSettings()} className="font-semibold underline underline-offset-2">
          {t("studio.record.openSettings")}
        </button>
      </p>
    );
  }
  return (
    <p className="mt-4 text-sm text-ink-strong">
      {t("studio.record.access.notAlways")}{" "}
      <button type="button" onClick={onFix} className="font-semibold underline underline-offset-2">
        {t("studio.record.access.fix")}
      </button>
    </p>
  );
}

/**
 * The walkthrough to "Always", in the page rather than left to iOS's own
 * wording: which button to tap in each of iOS's two prompts while they can
 * still be shown, and the exact Settings path once they cannot — iOS shows
 * the "Change to Always Allow" prompt only once per install.
 */
function LocationGuide({
  permission,
  busy,
  doneLabel,
  onAsk,
  onDone,
  onCancel,
}: {
  permission: LocationPermission;
  busy: boolean;
  doneLabel: string;
  onAsk: () => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const label = t("studio.record.permission.label");
  const steps = (keys: Parameters<typeof t>[0][]) => (
    <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-6 text-ink-body">
      {keys.map((key) => (
        <li key={key}>{t(key)}</li>
      ))}
    </ol>
  );

  if (permission.status === "restricted") {
    return <p className="text-sm text-ink-strong">{t("studio.record.permission.restricted")}</p>;
  }
  if (permission.status === "always") {
    return (
      <ConfirmPanel
        label={label}
        question={t("studio.record.permission.ready")}
        confirmLabel={doneLabel}
        busy={busy}
        onConfirm={onDone}
        onCancel={onCancel}
        cancelLabel={t("studio.record.permission.notNow")}
      />
    );
  }
  if (permission.canAskAlways) {
    return (
      <ConfirmPanel
        label={label}
        question={t("studio.record.permission.ask")}
        details={t("studio.record.permission.why")}
        confirmLabel={t("studio.record.permission.continue")}
        busy={busy}
        onConfirm={onAsk}
        onCancel={onCancel}
        cancelLabel={t("studio.record.permission.notNow")}
      >
        {steps(
          permission.status === "notDetermined"
            ? ["studio.record.permission.stepWhileUsing", "studio.record.permission.stepAlways"]
            : ["studio.record.permission.stepAlways"],
        )}
      </ConfirmPanel>
    );
  }
  return (
    <ConfirmPanel
      label={label}
      question={t("studio.record.permission.settings")}
      details={t("studio.record.permission.why")}
      confirmLabel={t("studio.record.openSettings")}
      busy={busy}
      onConfirm={() => void openAppSettings()}
      onCancel={onCancel}
      cancelLabel={t("studio.record.permission.notNow")}
    >
      {steps([
        "studio.record.permission.stepOpen",
        "studio.record.permission.stepLocation",
        "studio.record.permission.stepChooseAlways",
        "studio.record.permission.stepReturn",
      ])}
    </ConfirmPanel>
  );
}
