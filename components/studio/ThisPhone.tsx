"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/components/LocaleProvider";
import {
  connectShareInbox,
  disconnectShareInbox,
  locationPermission,
  openAppSettings,
  useNativeShell,
  useStandalone,
  type LocationPermission,
} from "@/components/nativeShell";
import { journalPath } from "@/lib/journalPath";
import { useShareInboxAutoConnect } from "@/components/studio/ShareInboxConnect";
import { KEPT_CHANGED } from "@/components/KeepTrip";
import { clearKeptCaches } from "@/lib/keepCache";

/**
 * The phone's own switches, in one place on the owner's /me — B2208.
 *
 * Shown inside the iPhone shell, and — for the cache row only — in the
 * home-screen web app. A desktop browser has nothing here: no extension to
 * switch, no phone to keep a trip on. The kept trips themselves are listed,
 * with their own switches, by `OfflineTrips` further up the same page, for
 * every reader rather than only the owner.
 *
 * Everything on it is local to this device. *Clear cache* empties what the
 * service worker keeps for offline reading, kept trips included, and is
 * never a sign-out: the personal cache and the cookie stay.
 */
function mb(bytes: number): string {
  return `${Math.round(bytes / 1e6)} MB`;
}

export function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <li className="flex min-h-14 items-center gap-4 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-base text-ink-strong">{label}</div>
        {hint && <div className="text-sm text-ink-secondary">{hint}</div>}
      </div>
      {children}
    </li>
  );
}

export function Switch({ on, disabled, busy, label, onChange }: { on: boolean; disabled?: boolean; busy?: boolean; label: string; onChange: () => void }) {
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

function SharingRow({ username }: { username: string }) {
  const { t } = useI18n();
  const auto = useShareInboxAutoConnect(username);
  const [pressed, setPressed] = useState<"busy" | "on" | "off" | "failed" | null>(null);
  const state = pressed ?? auto;
  const on = state === "on";

  async function toggle() {
    setPressed("busy");
    try {
      if (on) await disconnectShareInbox();
      else await connectShareInbox(username);
      setPressed(on ? "off" : "on");
    } catch {
      setPressed("failed");
    }
  }

  const hint =
    state === "busy"
      ? t("studio.thisPhone.shareBusy")
      : state === "failed"
        ? t("studio.thisPhone.shareFailed")
        : on
          ? t("me.phone.on")
          : t("me.phone.off");
  return (
    <Row label={t("me.phone.sharing")} hint={hint}>
      <Switch on={on} busy={state === "busy" || state === "unknown"} label={t("me.phone.sharing")} onChange={() => void toggle()} />
    </Row>
  );
}

/** "Record where I go" — the switch itself is per trip on the routes page
 * (`RouteRecordSection`), so this row links there and says what iOS
 * currently allows, which is the one thing that page cannot fix by itself. */
function RecordRow({ username }: { username: string }) {
  const { t } = useI18n();
  const [permission, setPermission] = useState<LocationPermission["status"] | null>(null);
  useEffect(() => {
    void locationPermission().then((p) => setPermission(p.status), () => undefined);
  }, []);
  return (
    <li>
      <Link href={journalPath(username, "/studio/location")} className="flex min-h-14 items-center gap-4 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-base text-ink-strong">{t("me.phone.gps")}</div>
          {permission && <div className="text-sm text-ink-secondary">{t(`me.phone.location.${permission}`)}</div>}
        </div>
        <span aria-hidden className="text-ink-faint">›</span>
      </Link>
    </li>
  );
}

/** Microphone and camera are WebView permissions, asked by iOS the first
 * time a page uses them. Only a definite answer is shown; anything else
 * reads as "asked when you first need it" rather than a guess. */
function MediaRow({ name, label, ask }: { name: "microphone" | "camera"; label: string; ask: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<PermissionState | null>(null);
  useEffect(() => {
    navigator.permissions
      ?.query({ name: name as PermissionName })
      .then((s) => setState(s.state), () => undefined);
  }, [name]);
  const hint = state === "granted" ? t("me.phone.allowed") : state === "denied" ? t("me.phone.denied") : ask;
  return <Row label={label} hint={hint}>{null}</Row>;
}

export default function ThisPhone({ username, routeRecording = false }: { username: string; routeRecording?: boolean }) {
  const { t } = useI18n();
  const native = useNativeShell();
  const standalone = useStandalone();
  const [clear, setClear] = useState<{ state: "idle" } | { state: "busy" } | { state: "done"; freed: number }>({ state: "idle" });

  if (!native && !standalone) return null;

  async function clearCache() {
    setClear({ state: "busy" });
    const { freed } = await clearKeptCaches();
    // `OfflineTrips` reads its switches from the same caches; tell it.
    window.dispatchEvent(new Event(KEPT_CHANGED));
    setClear({ state: "done", freed });
  }

  return (
    <section className="mt-6">
      <h2 className="font-display text-xl font-semibold text-ink-strong">{native ? t("me.phone.titleIphone") : t("me.phone.title")}</h2>
      <ul className="mt-3 divide-y divide-line-quiet overflow-hidden rounded-2xl border border-line-quiet bg-surface-raised">
        {native && <SharingRow username={username} />}
        {native && routeRecording && <RecordRow username={username} />}
        {native && <MediaRow name="microphone" label={t("me.phone.microphone")} ask={t("me.phone.microphoneAsk")} />}
        {native && <MediaRow name="camera" label={t("me.phone.camera")} ask={t("me.phone.cameraAsk")} />}
        {native && (
          <Row label={t("me.phone.settings")} hint={t("me.phone.settingsBody")}>
            <button
              type="button"
              onClick={() => void openAppSettings()}
              className="min-h-11 rounded-full border border-line-quiet px-4 text-sm font-semibold text-ink-body transition-colors hover:border-line-prominent"
            >
              {t("studio.record.openSettings")}
            </button>
          </Row>
        )}
        <Row label={t("me.phone.clear")} hint={clear.state === "done" ? t("me.phone.cleared", { size: mb(clear.freed) }) : t("me.phone.clearBody")}>
          <button
            type="button"
            onClick={() => void clearCache()}
            disabled={clear.state === "busy"}
            className="min-h-11 rounded-full border border-line-quiet px-4 text-sm font-semibold text-ink-body transition-colors hover:border-line-prominent disabled:opacity-50"
          >
            {clear.state === "busy" ? t("me.phone.clearing") : t("me.phone.clear")}
          </button>
        </Row>
      </ul>
    </section>
  );
}
