/**
 * The page's one window onto the iPhone shell — B2113.
 *
 * The shell (B2104) is a Capacitor WebView loading the same pages as
 * Safari. Capacitor injects a bridge object into every page it loads, and
 * that object is the only way a page knows it is inside the app. Nothing on
 * the server changes for the shell; `lib/capabilities.ts` is about what the
 * *server* can do, and this is a fact about the client, so it lives beside
 * `pushSubscribe.ts` rather than there.
 *
 * Every native adapter is loaded on demand from here, behind `isNativeShell`,
 * so the web bundle a browser downloads carries none of the plugin code and
 * a browser never sees a call it cannot answer.
 */

import { registerPlugin } from "@capacitor/core";
import { useSyncExternalStore } from "react";

type Bridge = { isNativePlatform?: () => boolean };

export function isNativeShell(): boolean {
  if (typeof window === "undefined") return false;
  const bridge = (window as unknown as { Capacitor?: Bridge }).Capacitor;
  return bridge?.isNativePlatform?.() === true;
}

/**
 * `isNativeShell()` for a component's render — B2126. The server has no
 * idea which shell will show the page, so its snapshot is always `false`
 * and the client's is read once the bridge is there; that is what keeps a
 * page that hides something inside the shell from mismatching on the web.
 * The bridge never changes during a page's life, so there is nothing to
 * subscribe to.
 */
export function useNativeShell(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => isNativeShell(),
    () => false,
  );
}

/**
 * A touch the page can feel — B2324. Only these five, the motion study's
 * whole table: a light tap for a primary press, medium for confirming
 * something destructive, a plain tick for a chip/toggle selection, and the
 * two `success`/`error` kinds a sibling ticket (B2325) fires once the
 * server has actually answered.
 *
 * A no-op outside the shell (`isNativeShell()` false) and the plugin is
 * only ever imported from in here, so a browser's bundle never carries it.
 * Errors are swallowed — a missed buzz is never worth surfacing.
 */
export type HapticKind = "light" | "medium" | "selection" | "success" | "error";

export async function haptic(kind: HapticKind): Promise<void> {
  if (!isNativeShell()) return;
  try {
    const { Haptics, ImpactStyle, NotificationType } = await import("@capacitor/haptics");
    switch (kind) {
      case "light":
        await Haptics.impact({ style: ImpactStyle.Light });
        break;
      case "medium":
        await Haptics.impact({ style: ImpactStyle.Medium });
        break;
      case "selection":
        await Haptics.selectionChanged();
        break;
      case "success":
        await Haptics.notification({ type: NotificationType.Success });
        break;
      case "error":
        await Haptics.notification({ type: NotificationType.Error });
        break;
    }
  } catch {
    // Felt nothing; the tap or the write still happened.
  }
}

/** What the picker hands back per photograph, the part of it this uses. */
export type PickedPhoto = { name: string; mimeType: string; data?: string; modifiedAt?: number };

/**
 * A picked photograph as the `File` the upload step already sends — same
 * bytes, same name, same type, so `UploadStep` cannot tell the two doors
 * apart and the route behind it keeps the HEIC as the print master.
 *
 * `data` is base64 because that is how bytes cross the bridge. A file
 * without it (the plugin could not read it) is skipped rather than sent
 * empty.
 */
export function pickedToFile(picked: PickedPhoto): File | undefined {
  if (!picked.data) return undefined;
  const raw = atob(picked.data);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return new File([bytes], picked.name, { type: picked.mimeType, lastModified: picked.modifiedAt });
}

/**
 * Open the phone's own photo picker and return the originals.
 *
 * `skipTranscoding` is why this exists: through `<input type="file">` iOS
 * generates a JPEG at pick time and the HEIC original never leaves the
 * phone (B1750). The official camera plugin transcodes too; this one hands
 * the file over as it is. Photographs only — a clip is tens of megabytes,
 * and base64 across the bridge is the plugin's own documented crash; videos
 * keep using the `<input>`, which B1750 showed delivers them intact.
 *
 * ponytail: base64 over the bridge, a few MB per photograph; a native
 * multipart upload from the file path is the upgrade if a 300-photo import
 * turns out to stall.
 *
 * Cancelling the picker is an answer, not an error: an empty list.
 */
export async function pickNativePhotos(): Promise<File[]> {
  const { FilePicker } = await import("@capawesome/capacitor-file-picker");
  try {
    const { files } = await FilePicker.pickImages({ skipTranscoding: true, readData: true });
    return files.map(pickedToFile).filter((file): file is File => file !== undefined);
  } catch (error) {
    if (error instanceof Error && /cancel/i.test(error.message)) return [];
    throw error;
  }
}

/**
 * The share extension's credential — B2175. `ShareInbox` is the app's own
 * plugin (`ios/App/App/ShareInboxPlugin.swift`); it stores what the studio
 * mints and says whether one is there. Only reachable inside the shell, and
 * only called from there, so the web bundle never asks for it.
 */
type ShareInboxStatus = { connected: boolean; user?: string; base?: string; expiresAt?: string };
type ShareInboxPlugin = {
  connect(options: { base: string; user: string; token: string; expiresAt: string }): Promise<ShareInboxStatus>;
  status(): Promise<ShareInboxStatus>;
  disconnect(): Promise<ShareInboxStatus>;
  /** The raw `GET …/trips` body, kept for the share sheet's picker. */
  cacheTrips(options: { json: string }): Promise<void>;
};
const ShareInbox = registerPlugin<ShareInboxPlugin>("ShareInbox");

export function shareInboxStatus(): Promise<ShareInboxStatus> {
  return ShareInbox.status();
}

/**
 * Mint the owner's own seven-day agent token through the two doors the
 * agent handover already uses — `POST /api/auth/<user>/handover` with the
 * cookie, then `POST /api/auth/handover` with that credential — and hand it
 * to the extension. The same token an agent would hold, made by the same
 * calls, revocable on the same keys page; nothing new is minted for the
 * phone. Refreshed whenever the studio opens in the shell with fewer than
 * three days left, so a phone that opens the app now and then stays
 * connected without anybody noticing.
 */
export async function connectShareInbox(username: string): Promise<ShareInboxStatus> {
  const minted = await fetch(`/api/auth/${encodeURIComponent(username)}/handover`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!minted.ok) throw new Error(`handover ${minted.status}`);
  const { handover } = (await minted.json()) as { handover: string };
  const exchanged = await fetch("/api/auth/handover", {
    method: "POST",
    headers: { authorization: `Bearer ${handover}` },
  });
  if (!exchanged.ok) throw new Error(`exchange ${exchanged.status}`);
  const { token, expiresAt } = (await exchanged.json()) as { token: string; expiresAt: string };
  const status = await ShareInbox.connect({ base: window.location.origin, user: username, token, expiresAt });
  // The trip list too, so the share sheet has its rows before the first
  // share ever — B2206. Best effort: the sheet refreshes it itself.
  await fetch(`/api/v2/${encodeURIComponent(username)}/trips?limit=200`, { headers: { authorization: `Bearer ${token}` } })
    .then((r) => (r.ok ? r.text() : null))
    .then((json) => (json ? ShareInbox.cacheTrips({ json }) : undefined))
    .catch(() => undefined);
  return status;
}

/**
 * Mint the owner's `write:gps` token — B2204, the credential a route
 * recorder holds instead of the share extension's journal-wide one.
 *
 * One call, `POST /api/auth/<user>/gps-token`, reached with the owner's own
 * cookie the same way `connectShareInbox` reaches `.../handover` — the
 * studio page is open in the shell's WebView, which carries the cookie, so
 * no `Authorization` header is sent and none is needed. There is no
 * exchange step here the way there is for the share token: this credential
 * is minted for 30 days up front (`GPS_TOKEN_TTL_DAYS`, `lib/auth/index.ts`)
 * and goes straight into its own Keychain item on the Swift side — that
 * wiring is B2196/B2198's, not this function's; this only gets the token
 * out of the server and into the caller's hands.
 *
 * The Swift plugin that stores it does not exist yet — that is a later
 * ticket. This function is the whole of B2204's client side: mint, and
 * hand back what was minted.
 */
export async function mintGpsToken(username: string): Promise<{ token: string; expiresAt: string }> {
  const minted = await fetch(`/api/auth/${encodeURIComponent(username)}/gps-token`, {
    method: "POST",
  });
  if (!minted.ok) throw new Error(`gps-token ${minted.status}`);
  const { token, expiresAt } = (await minted.json()) as { token: string; expiresAt: string };
  return { token, expiresAt };
}

export function disconnectShareInbox(): Promise<ShareInboxStatus> {
  return ShareInbox.disconnect();
}

/**
 * The native route recorder's own state for one trip — B2196/B2198. The
 * `Recorder` singleton (AppDelegate-owned, `ios/App/App/Recorder.swift`) is
 * the source of truth; `LocationRecorderPlugin.swift` is a thin proxy onto
 * it, the same shape `ShareInboxPlugin` is onto `ShareCredentialStore`.
 */
export type RouteRecordStatus =
  | { state: "off" }
  | { state: "declined" }
  | { state: "recording"; since: string; lastUploadAt?: string; openEnded: boolean; tokenExpiresAt?: string }
  | { state: "stopped"; stoppedOn: string }
  /** `kind` is a plain `string`, not a closed union — B2196 security review
   *  (2026-09-24) second round, finding 2. `Recorder`'s upload handler can
   *  now record any HTTP error code the server sent (`"whenInUseOnly"`,
   *  `"unauthorized"`, `"storageFull"`, or a passthrough like `"429"`), and
   *  the section renders a generic message for anything it does not name
   *  specifically rather than an empty box. */
  | { state: "error"; kind: string; since?: string; tokenExpiresAt?: string };

/** A notice this JS side already translated (`site/locales/*.json` via
 *  `useI18n()`) and handed to a native call to store or fire — B2197's
 *  "native never hardcodes English". */
type NativeNotice = { id: string; url: string; body: string; at: string };
export type NotificationPermission = "granted" | "denied" | "unknown";

/**
 * The native confirmation `arm`/`keepRecording` show before anything starts
 * — B2196 security review (2026-09-24) second round, finding 1. `body` is a
 * template with `{host}` and `{user}` placeholders; native fills them in
 * from the values it will actually use (never from a pre-filled string this
 * side supplies), so what the owner reads on the dialog is what the
 * recording will actually do.
 */
export type ArmConfirmCopy = {
  confirmTitle: string;
  confirmBody: string;
  confirmRecordLabel: string;
  confirmCancelLabel: string;
};

type LocationRecorderPlugin = {
  /** No `base` here — B2196 security review (2026-09-24), finding 1.
   *  `LocationRecorderPlugin.nativeBase()` derives it from Capacitor's own
   *  `bridge.config.appStartServerURL`, never from anything JS supplies, so
   *  a compromised WebView cannot point the recorder's uploads at a server
   *  of its own choosing. */
  arm(
    options: {
      trip: string;
      title: string;
      start: string;
      end: string;
      user: string;
      stopBody: string;
      unauthorizedBody: string;
    } & ArmConfirmCopy,
  ): Promise<RouteRecordStatus>;
  disarm(options: { trip: string; decline?: boolean }): Promise<RouteRecordStatus>;
  status(options: { trip: string }): Promise<RouteRecordStatus>;
  keepRecording(options: { trip: string; openEndedBody: string } & ArmConfirmCopy): Promise<RouteRecordStatus>;
  /** The write:gps token (B2204), stored in the recorder's own Keychain
   *  item — never the share extension's. */
  setToken(options: { token: string; expiresAt: string }): Promise<void>;
  /** Trip ids currently armed or declined, for the hub's before-trip
   *  scheduling effect (B2197) to know which future trips still need one. */
  armedTrips(): Promise<{ armed: string[]; declined: string[] }>;
  /** `UIApplication.openSettingsURLString` — the "While using" only error's
   *  Settings link (B2198), a native call because a plain `app-settings:`
   *  anchor is not reliable inside a WKWebView. */
  openSettings(): Promise<void>;
  /** B2197's before-trip notices — replaces every pending one with exactly
   *  this set. `at` is an ISO date, computed by `lib/gps/notify.ts`'s
   *  `beforeTripNoticeTime`; native never computes a fire time itself. */
  scheduleBeforeTrip(options: { trips: NativeNotice[] }): Promise<void>;
  notificationPermissionStatus(): Promise<{ status: NotificationPermission }>;
  requestNotificationPermission(): Promise<{ status: NotificationPermission }>;
};
const LocationRecorder = registerPlugin<LocationRecorderPlugin>("LocationRecorder");

export function routeStatus(trip: string): Promise<RouteRecordStatus> {
  return LocationRecorder.status({ trip });
}

export function armRoute(
  options: {
    trip: string;
    title: string;
    start: string;
    end: string;
    user: string;
    stopBody: string;
    unauthorizedBody: string;
  } & ArmConfirmCopy,
): Promise<RouteRecordStatus> {
  return LocationRecorder.arm(options);
}

export function disarmRoute(trip: string, decline = false): Promise<RouteRecordStatus> {
  return LocationRecorder.disarm({ trip, decline });
}

export function keepRecordingRoute(
  trip: string,
  openEndedBody: string,
  confirm: ArmConfirmCopy,
): Promise<RouteRecordStatus> {
  return LocationRecorder.keepRecording({ trip, openEndedBody, ...confirm });
}

export function armedOrDeclinedTrips(): Promise<{ armed: string[]; declined: string[] }> {
  return LocationRecorder.armedTrips();
}

export function openAppSettings(): Promise<void> {
  return LocationRecorder.openSettings();
}

export function scheduleBeforeTripNotices(trips: NativeNotice[]): Promise<void> {
  return LocationRecorder.scheduleBeforeTrip({ trips });
}

export function notificationPermissionStatus(): Promise<{ status: NotificationPermission }> {
  return LocationRecorder.notificationPermissionStatus();
}

export function requestNotificationPermission(): Promise<{ status: NotificationPermission }> {
  return LocationRecorder.requestNotificationPermission();
}

/** Fewer than this many days left on the `write:gps` token and it is worth
 *  minting a fresh one — same margin `ShareInboxConnect`'s
 *  `REFRESH_BEFORE_MS` uses for the share credential. */
export const GPS_TOKEN_REFRESH_BEFORE_MS = 7 * 24 * 60 * 60 * 1000;

/** Pure so B2198's "refresh on every foreground when under 7 days remain"
 *  is testable with no clock, no plugin and no network. */
export function needsGpsTokenRefresh(expiresAtIso: string | undefined, nowMs: number): boolean {
  if (!expiresAtIso) return true;
  const left = new Date(expiresAtIso).getTime() - nowMs;
  return !(left >= GPS_TOKEN_REFRESH_BEFORE_MS);
}

/** Mint a fresh `write:gps` token (B2204) and hand it to the recorder's own
 *  Keychain item. Minting needs the owner's cookie, which only the studio
 *  page holds — this is why the refresh happens from here rather than
 *  natively. */
export async function refreshGpsToken(username: string): Promise<{ token: string; expiresAt: string }> {
  const minted = await mintGpsToken(username);
  await LocationRecorder.setToken(minted);
  return minted;
}
