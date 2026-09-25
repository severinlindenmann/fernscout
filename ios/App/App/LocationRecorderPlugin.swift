import Foundation
import Capacitor
import UIKit

/// The page's one native call for route recording — B2196/B2198. A thin
/// proxy onto `Recorder.shared`, the same shape `ShareInboxPlugin` is onto
/// `ShareCredentialStore`: nothing here owns `CLLocationManager` or the
/// buffer, and nothing here depends on the WebView being loaded, because
/// `Recorder` does not either.
@objc(LocationRecorderPlugin)
public class LocationRecorderPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LocationRecorderPlugin"
    public let jsName = "LocationRecorder"
    public var pluginMethods: [CAPPluginMethod] {
        var methods: [CAPPluginMethod] = [
            CAPPluginMethod(name: "arm", returnType: CAPPluginReturnPromise),
            CAPPluginMethod(name: "disarm", returnType: CAPPluginReturnPromise),
            CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
            CAPPluginMethod(name: "keepRecording", returnType: CAPPluginReturnPromise),
            CAPPluginMethod(name: "setToken", returnType: CAPPluginReturnPromise),
            CAPPluginMethod(name: "armedTrips", returnType: CAPPluginReturnPromise),
            CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise),
            CAPPluginMethod(name: "scheduleBeforeTrip", returnType: CAPPluginReturnPromise),
            CAPPluginMethod(name: "notificationPermissionStatus", returnType: CAPPluginReturnPromise),
            CAPPluginMethod(name: "requestNotificationPermission", returnType: CAPPluginReturnPromise),
        ]
        #if DEBUG
        methods.append(CAPPluginMethod(name: "debugForceCooldown", returnType: CAPPluginReturnPromise))
        #endif
        return methods
    }

    private func reply(_ call: CAPPluginCall, _ s: Recorder.StatusReply) {
        var body: [String: Any] = ["state": s.state]
        if let since = s.since { body["since"] = since }
        if let lastUploadAt = s.lastUploadAt { body["lastUploadAt"] = lastUploadAt }
        if s.state == "recording" { body["openEnded"] = s.openEnded }
        if let stoppedOn = s.stoppedOn { body["stoppedOn"] = stoppedOn }
        if let kind = s.errorKind { body["kind"] = jsErrorKind(kind) }
        // Security review (2026-09-24), finding 2 — the write:gps token's
        // own expiry, never the token itself, so the studio page can decide
        // whether to refresh without minting on every mount.
        if let tokenExpiresAt = s.tokenExpiresAt { body["tokenExpiresAt"] = tokenExpiresAt }
        call.resolve(body)
    }

    private func jsErrorKind(_ native: String) -> String {
        switch native {
        case "when_in_use_only": return "whenInUseOnly"
        case "unauthorized": return "unauthorized"
        case "storage_full": return "storageFull"
        default: return native
        }
    }

    /// The server this recorder ever talks to — B2196's security review
    /// (2026-09-24, finding 1). **Never taken from the JS call**: any
    /// script running in the WebView (a compromised plugin, an XSS) could
    /// otherwise `arm({ base: "https://evil" })` and have the recorder
    /// exfiltrate positions to an attacker's own server in the background,
    /// with the owner never seeing a network tab. `bridge.config
    /// .appStartServerURL` is Capacitor's own resolved server URL — the one
    /// `capacitor.config.json` named at build/sync time — and is not
    /// reachable from JS at all. `https` is required except in a `DEBUG`
    /// build talking to a local `http://` dev server (`CAPACITOR_SERVER_URL`,
    /// per `run-the-ios-app`); that branch is compiled out of Release.
    ///
    /// Capacitor's plugin call API in this version carries no per-call frame
    /// origin to check against (no `WKFrameInfo` on `CAPPluginCall`), so a
    /// call from an iframe inside the app's own page cannot be distinguished
    /// from one from the top frame here — noted rather than silently
    /// skipped, since the finding asked for it "if cheap".
    private func nativeBase() -> String? {
        guard let url = bridge?.config.appStartServerURL else { return nil }
        #if DEBUG
        if url.scheme == "http" { return trimmedTrailingSlash(url.absoluteString) }
        #endif
        guard url.scheme == "https" else { return nil }
        return trimmedTrailingSlash(url.absoluteString)
    }

    private func trimmedTrailingSlash(_ s: String) -> String {
        s.hasSuffix("/") ? String(s.dropLast()) : s
    }

    /// Second review (2026-09-24), finding 1 — `arm`/`keepRecording` both
    /// present this before anything starts. `user` still arrives from JS
    /// (there is nowhere native to derive a journal name from), so the
    /// owner needs a chance to see and refuse it: a compromised page could
    /// otherwise pair its own valid `write:gps` token (via `setToken`) with
    /// `arm({ user: "attacker" })` and quietly redirect the recording into
    /// an attacker's own journal on the *real* server — `base` alone being
    /// pinned natively (see `nativeBase()`) does not catch that, since the
    /// request is still perfectly legitimate from the server's point of
    /// view. `host` and `user` in the message are substituted by native
    /// into JS's translated template, never trusted pre-filled from JS, so
    /// what the owner reads is what `Recorder` will actually use.
    ///
    /// A swapped token alone, with the real `user`, is harmless on its own:
    /// `requireJournalOwner` (`lib/api/v2/auth.ts`) refuses a token whose
    /// session does not own the `user` in the URL, so an attacker's own
    /// token can only ever write to the attacker's own journal, never the
    /// owner's.
    private func confirmAndRun(
        call: CAPPluginCall,
        host: String,
        user: String,
        onConfirm: @escaping () -> Void
    ) {
        guard let title = call.getString("confirmTitle"), let bodyTemplate = call.getString("confirmBody"),
              let recordLabel = call.getString("confirmRecordLabel"), let cancelLabel = call.getString("confirmCancelLabel") else {
            call.reject("confirmTitle, confirmBody, confirmRecordLabel and confirmCancelLabel are required")
            return
        }
        let body = bodyTemplate
            .replacingOccurrences(of: "{host}", with: host)
            .replacingOccurrences(of: "{user}", with: user)
        DispatchQueue.main.async {
            let alert = UIAlertController(title: title, message: body, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: cancelLabel, style: .cancel) { [weak self] _ in
                guard let self, let trip = call.getString("trip") else { return }
                self.reply(call, Recorder.shared.status(trip: trip))
            })
            alert.addAction(UIAlertAction(title: recordLabel, style: .default) { _ in onConfirm() })
            // Presented from the key window's own top-most view controller
            // rather than `bridge.presentVC` — in testing, `presentVC`
            // could silently no-op even with a live bridge and view
            // controller, where walking `presentedViewController` from the
            // key window's root reliably shows the alert.
            var top = UIApplication.shared.windows.first(where: { $0.isKeyWindow })?.rootViewController
            while let presented = top?.presentedViewController { top = presented }
            top?.present(alert, animated: true)
        }
    }

    @objc func arm(_ call: CAPPluginCall) {
        guard let trip = call.getString("trip"), let title = call.getString("title"),
              let start = call.getString("start"), let end = call.getString("end"),
              let user = call.getString("user"),
              let stopBody = call.getString("stopBody"), let unauthorizedBody = call.getString("unauthorizedBody") else {
            call.reject("trip, title, start, end, user, stopBody and unauthorizedBody are required")
            return
        }
        guard let base = nativeBase(), let host = URL(string: base)?.host else {
            call.reject("no https server is configured for this build")
            return
        }
        confirmAndRun(call: call, host: host, user: user) {
            Recorder.shared.arm(trip: trip, title: title, start: start, end: end, user: user, base: base, stopBody: stopBody, unauthorizedBody: unauthorizedBody)
            self.reply(call, Recorder.shared.status(trip: trip))
        }
    }

    @objc func disarm(_ call: CAPPluginCall) {
        guard let trip = call.getString("trip") else {
            call.reject("trip is required")
            return
        }
        Recorder.shared.disarm(trip: trip, decline: call.getBool("decline") ?? false)
        reply(call, Recorder.shared.status(trip: trip))
    }

    @objc func status(_ call: CAPPluginCall) {
        guard let trip = call.getString("trip") else {
            call.reject("trip is required")
            return
        }
        reply(call, Recorder.shared.status(trip: trip))
    }

    @objc func keepRecording(_ call: CAPPluginCall) {
        guard let trip = call.getString("trip"), let openEndedBody = call.getString("openEndedBody") else {
            call.reject("trip and openEndedBody are required")
            return
        }
        // The same confirmation `arm` shows — Keep recording is re-arming a
        // stopped trip, not a read-only status check (second review,
        // finding 1). `user`/`base` come from what is already stored for
        // this trip, never resupplied by this call.
        guard let known = Recorder.shared.lookup(trip: trip), let host = URL(string: known.base)?.host else {
            call.reject("nothing to keep recording for this trip")
            return
        }
        confirmAndRun(call: call, host: host, user: known.user) {
            Recorder.shared.keepRecording(trip: trip, openEndedBody: openEndedBody)
            self.reply(call, Recorder.shared.status(trip: trip))
        }
    }

    @objc func setToken(_ call: CAPPluginCall) {
        guard let token = call.getString("token"), let expiresAt = call.getString("expiresAt") else {
            call.reject("token and expiresAt are required")
            return
        }
        _ = GpsCredentialStore.save(GpsCredential(token: token, expiresAt: expiresAt))
        // Second review (2026-09-24), finding 2 — a fresh token is exactly
        // what resolves an `unauthorized` error; clear it here rather than
        // leaving the page wedged until the next successful upload.
        Recorder.shared.clearAuthError()
        call.resolve()
    }

    @objc func armedTrips(_ call: CAPPluginCall) {
        let (armed, declined) = Recorder.shared.armedTripIds()
        call.resolve(["armed": armed, "declined": declined])
    }

    @objc func openSettings(_ call: CAPPluginCall) {
        Recorder.shared.openSettings()
        call.resolve()
    }

    /// `trips`: `[{id, url, body, at}]`, `at` an ISO 8601 string — the fire
    /// time `lib/gps/notify.ts`'s `beforeTripNoticeTime` computed. Replaces
    /// every pending before-trip notice with exactly this set.
    @objc func scheduleBeforeTrip(_ call: CAPPluginCall) {
        guard let raw = call.getArray("trips", JSObject.self) else {
            call.reject("trips is required")
            return
        }
        let iso = ISO8601DateFormatter()
        let trips: [(id: String, url: String, body: String, at: Date)] = raw.compactMap { row in
            guard let id = row["id"] as? String, let url = row["url"] as? String,
                  let body = row["body"] as? String, let atString = row["at"] as? String,
                  let at = iso.date(from: atString) else { return nil }
            return (id: id, url: url, body: body, at: at)
        }
        Recorder.shared.scheduleBeforeTrip(trips: trips)
        call.resolve()
    }

    @objc func notificationPermissionStatus(_ call: CAPPluginCall) {
        Recorder.shared.notificationPermissionStatus { status in
            call.resolve(["status": status])
        }
    }

    @objc func requestNotificationPermission(_ call: CAPPluginCall) {
        Recorder.shared.requestNotificationPermission { status in
            call.resolve(["status": status])
        }
    }

    #if DEBUG
    /// Test-only — B2196 security review (2026-09-24), functional finding
    /// 6's Simulator verification. Compiled out of Release with the rest of
    /// `Recorder.debugForceCooldown()`.
    @objc func debugForceCooldown(_ call: CAPPluginCall) {
        Recorder.shared.debugForceCooldown()
        call.resolve()
    }
    #endif
}
