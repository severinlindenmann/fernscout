import Foundation
import CoreLocation
import UIKit
import UserNotifications

/// Per-trip state this recorder tracks, the whole of what `armedTrips()` and
/// each trip's own `status()` are built from.
private struct ArmedTrip: Codable {
    let title: String
    let start: String // YYYY-MM-DD
    let end: String // YYYY-MM-DD
    let user: String
    let base: String
    let armedAt: String // ISO 8601
    var openEnded: Bool
    /// Already translated by the studio page (`site/locales/*.json` via
    /// `useI18n()`), handed in at `arm()` and stored so a background
    /// upload's 401 — which has no JS running to ask — can still post the
    /// notice in the owner's own language.
    let stopBody: String
    let unauthorizedBody: String
}

/// One recorded fix, the buffer's own line shape — B2196.
/// `[epochSeconds, lat, lon]`, matching the `fixes` import format exactly so
/// nothing has to reshape it before it is sent.
private struct Fix {
    let t: Int
    let lat: Double
    let lon: Double
    var jsonLine: String { "[\(t),\(lat),\(lon)]" }
}

/// The whole of B2196: one singleton, owned by `AppDelegate`, that arms
/// itself against a trip's dates, tracks location in the background with no
/// timer (iOS gives a background app none), buffers fixes to disk and
/// uploads them in snapshots. Never depends on the WebView — it is created
/// in `didFinishLaunchingWithOptions`, which can run with no page loaded at
/// all after a background relaunch.
final class Recorder: NSObject {
    static let shared = Recorder()

    private let manager = CLLocationManager()
    /// The last fix seen, whatever service delivered it — where a pause
    /// drops the resume fence.
    private var lastLocation: CLLocation?
    /// Whether standard (GPS) updates are running right now. Off while the
    /// phone sits still; the low-power services below wake it back up.
    private var moving = false
    private var backgroundTask: UIBackgroundTaskIdentifier = .invalid

    // MARK: - UserDefaults-backed state

    private static let appGroup = ShareCredentialStore.appGroup
    private var defaults: UserDefaults? { UserDefaults(suiteName: Self.appGroup) }
    private static let armedKey = "recorder-armed-trips" // [tripId: ArmedTrip] JSON
    private static let declinedKey = "recorder-declined-trips" // [tripId] JSON
    private static let stoppedKey = "recorder-stopped-trips" // [tripId: ISO date] JSON
    private static let lastUploadKey = "recorder-last-upload" // ISO 8601
    private static let lastErrorKey = "recorder-last-error" // "unauthorized" | "storage_full" | other
    /// Second review (2026-09-24), finding 5 — whether the "Open Fernscout
    /// to resume uploading" notice has already been posted for the current
    /// 401 streak, so it fires once rather than every ~30 minutes.
    private static let unauthorizedNoticePostedKey = "recorder-unauthorized-notice-posted"

    private var armed: [String: ArmedTrip] {
        get { decode(defaults?.data(forKey: Self.armedKey)) ?? [:] }
        set { defaults?.set(try? JSONEncoder().encode(newValue), forKey: Self.armedKey) }
    }
    private var declined: Set<String> {
        get { Set((decode(defaults?.data(forKey: Self.declinedKey)) as [String]?) ?? []) }
        set { defaults?.set(try? JSONEncoder().encode(Array(newValue)), forKey: Self.declinedKey) }
    }
    /// Security review (2026-09-24), functional finding 6 — stores the
    /// whole trip, not just the date it stopped on, so **Keep recording**
    /// (D3) can re-arm it after the cooldown without the caller having to
    /// resupply title/dates/user. `stoppedOn` itself is never persisted
    /// here: it is deterministic from `end` (two days after, D2), computed
    /// in `status()` the same way `applyStopRule` computes it to decide
    /// whether to stop in the first place — one formula, not two copies of it.
    private var stopped: [String: ArmedTrip] {
        get { decode(defaults?.data(forKey: Self.stoppedKey)) ?? [:] }
        set { defaults?.set(try? JSONEncoder().encode(newValue), forKey: Self.stoppedKey) }
    }
    private var lastUpload: Date? {
        get { (defaults?.string(forKey: Self.lastUploadKey)).flatMap { ISO8601DateFormatter().date(from: $0) } }
        set { defaults?.set(newValue.map { ISO8601DateFormatter().string(from: $0) }, forKey: Self.lastUploadKey) }
    }
    private var lastError: String? {
        get { defaults?.string(forKey: Self.lastErrorKey) }
        set { defaults?.set(newValue, forKey: Self.lastErrorKey) }
    }
    /// Whether iOS's one-time "Change to Always Allow" prompt has already
    /// been spent. iOS shows it at most once per install; after that the
    /// only way to "Always" is the Settings app, so the studio page offers
    /// Settings instead of a button that would silently do nothing.
    private static let alwaysAskedKey = "recorder-always-asked"
    private var alwaysAsked: Bool {
        get { defaults?.bool(forKey: Self.alwaysAskedKey) ?? false }
        set { defaults?.set(newValue, forKey: Self.alwaysAskedKey) }
    }
    private var unauthorizedNoticePosted: Bool {
        get { defaults?.bool(forKey: Self.unauthorizedNoticePostedKey) ?? false }
        set { defaults?.set(newValue, forKey: Self.unauthorizedNoticePostedKey) }
    }

    private func decode<T: Decodable>(_ data: Data?) -> T? {
        guard let data else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }

    // MARK: - Setup, called from AppDelegate

    /// Configures the manager and, if any trip is armed, starts updates.
    /// Safe to call more than once — `didFinishLaunching` is the only
    /// caller, but a defensive re-entry costs nothing.
    func start() {
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        manager.distanceFilter = 100
        // Travel mixes walking, trains and cars — `.other` keeps iOS's
        // automatic pause from tuning itself to any one of them.
        manager.activityType = .other
        manager.allowsBackgroundLocationUpdates = manager.authorizationStatus == .authorizedAlways
        // No blue status-bar pill while recording in the background: the
        // recorder runs quietly for the whole trip, the way a location
        // timeline does, rather than looking like an app held open. This
        // only affects "Always" — with "While using", iOS shows the pill
        // regardless, and `status()` already reports that as
        // `when_in_use_only` so the studio can send the owner to Settings.
        manager.showsBackgroundLocationIndicator = false
        manager.pausesLocationUpdatesAutomatically = manager.authorizationStatus == .authorizedAlways
        applyStopRule()
        if !armed.isEmpty { beginTracking() }
    }

    // MARK: - Timeline-style tracking

    /// How a location timeline stays on all day without the phone showing
    /// an app held open or draining its battery: three low-power services
    /// that keep running — and relaunch the app — even after it is swiped
    /// away (significant location changes, visits, and a small fence around
    /// where the phone last settled), with GPS itself running only between
    /// "left a place" and "stopped somewhere". All three need "Always".
    private func beginTracking() {
        manager.startMonitoringSignificantLocationChanges()
        manager.startMonitoringVisits()
        startMoving()
    }

    private func endTracking() {
        moving = false
        manager.stopUpdatingLocation()
        manager.stopMonitoringSignificantLocationChanges()
        manager.stopMonitoringVisits()
        clearResumeFence()
    }

    /// Left a place — trace the road with GPS until the phone settles again.
    private func startMoving() {
        clearResumeFence()
        moving = true
        manager.startUpdatingLocation()
    }

    /// Stopped somewhere — GPS off, and a 150 m fence around the spot so
    /// leaving it restarts GPS within a minute or so instead of waiting for
    /// the next significant change (~500 m) or visit departure (minutes).
    private func settle(at coordinate: CLLocationCoordinate2D) {
        moving = false
        manager.stopUpdatingLocation()
        clearResumeFence()
        let fence = CLCircularRegion(center: coordinate, radius: 150, identifier: Self.resumeFenceId)
        fence.notifyOnExit = true
        fence.notifyOnEntry = false
        manager.startMonitoring(for: fence)
    }

    private static let resumeFenceId = "recorder-resume"

    private func clearResumeFence() {
        for region in manager.monitoredRegions where region.identifier == Self.resumeFenceId {
            manager.stopMonitoring(for: region)
        }
    }

    /// One fix into the buffer, if any armed trip's window covers it.
    private func record(at time: Date, _ coordinate: CLLocationCoordinate2D) {
        guard withinAnyArmedWindow(time) else { return }
        appendFix(Fix(t: Int(time.timeIntervalSince1970), lat: coordinate.latitude, lon: coordinate.longitude))
        maybeUpload()
    }

    // MARK: - Location permission

    struct PermissionReply {
        /// "always" | "whenInUse" | "denied" | "restricted" | "notDetermined"
        let status: String
        /// `false` when the owner turned Precise Location off — fixes then
        /// come back kilometres wide, too coarse to draw a road with.
        let precise: Bool
        /// Whether `requestAlwaysPermission` can still show a system prompt;
        /// otherwise only the Settings app can change it.
        let canAskAlways: Bool
    }

    func locationPermission() -> PermissionReply {
        let status: String
        switch manager.authorizationStatus {
        case .authorizedAlways: status = "always"
        case .authorizedWhenInUse: status = "whenInUse"
        case .denied: status = "denied"
        case .restricted: status = "restricted"
        default: status = "notDetermined"
        }
        let canAsk = status == "notDetermined" || (status == "whenInUse" && !alwaysAsked)
        return PermissionReply(status: status, precise: manager.accuracyAuthorization == .fullAccuracy, canAskAlways: canAsk)
    }

    private var permissionWaiters: [(PermissionReply) -> Void] = []
    /// Set while the first ("While Using") prompt is up, so its answer goes
    /// straight on to the "Always" upgrade prompt.
    private var upgradeAfterWhenInUse = false

    /// Apple's two-step route to "Always": ask "While Using" first, then —
    /// once it is granted, while the app is still in front — ask for the
    /// upgrade, which iOS shows immediately as "Change to Always Allow".
    /// Calls `completion` with whatever the owner ended up choosing, never
    /// with what was merely asked for.
    func requestAlwaysPermission(_ completion: @escaping (PermissionReply) -> Void) {
        DispatchQueue.main.async { [self] in
            switch manager.authorizationStatus {
            case .notDetermined:
                permissionWaiters.append(completion)
                upgradeAfterWhenInUse = true
                manager.requestWhenInUseAuthorization()
            case .authorizedWhenInUse where !alwaysAsked:
                permissionWaiters.append(completion)
                askAlways()
            default:
                completion(locationPermission())
            }
        }
    }

    /// "Keep Only While Using" changes nothing, so no authorization callback
    /// fires for it — the prompt's dismissal (the app becoming active again)
    /// is what ends the wait. If iOS shows no prompt at all (the app never
    /// resigns active), the wait ends after a moment instead of hanging.
    private func askAlways() {
        alwaysAsked = true
        let wait = AlwaysPromptWait { [weak self] in self?.finishPermission() }
        manager.requestAlwaysAuthorization()
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { wait.endUnlessPrompted() }
    }

    private func finishPermission() {
        let waiters = permissionWaiters
        permissionWaiters.removeAll()
        guard !waiters.isEmpty else { return }
        let reply = locationPermission()
        waiters.forEach { $0(reply) }
    }

    // MARK: - Plugin-facing calls

    func arm(trip: String, title: String, start: String, end: String, user: String, base: String, stopBody: String, unauthorizedBody: String) {
        #if DEBUG
        defaults?.removeObject(forKey: Self.debugForceCooldownKey)
        #endif
        var a = armed
        a[trip] = ArmedTrip(
            title: title, start: start, end: end, user: user, base: base,
            armedAt: ISO8601DateFormatter().string(from: Date()), openEnded: false,
            stopBody: stopBody, unauthorizedBody: unauthorizedBody
        )
        armed = a
        var d = declined
        d.remove(trip)
        declined = d
        var s = stopped
        s.removeValue(forKey: trip)
        stopped = s

        // The studio page walks the owner through "Always" before arming;
        // this only covers a caller that skipped that step, and does
        // nothing once iOS has no prompt left to show.
        requestAlwaysPermission { _ in }
        manager.allowsBackgroundLocationUpdates = manager.authorizationStatus == .authorizedAlways
        manager.pausesLocationUpdatesAutomatically = manager.authorizationStatus == .authorizedAlways
        beginTracking()
        scheduleStopNotice(trip: trip, end: end, body: stopBody, base: base, user: user)
    }

    func disarm(trip: String, decline: Bool) {
        let removedTrip = armed[trip]
        var a = armed
        a.removeValue(forKey: trip)
        armed = a
        if decline {
            var d = declined
            d.insert(trip)
            declined = d
        }
        var s = stopped
        s.removeValue(forKey: trip)
        stopped = s
        cancelNotices(trip: trip)
        if armed.isEmpty {
            // Security review (2026-09-24), finding 9 — one last upload
            // attempt before the buffer goes, not silent data loss for
            // whatever was recorded since the last successful upload.
            finalUploadThenPurge(removedTrip) // ponytail: whole-buffer purge, correct only
            // because a second, still-armed trip would keep its own fixes
            // in the same file — see the doc comment on `purgeBuffer`.
            endTracking()
            // Security review (2026-09-24), finding 4 — nothing left armed,
            // nothing left to upload with.
            GpsCredentialStore.clear()
        }
    }

    // MARK: - Notices — B2196/B2197's stop, open-ended and before-trip
    // notices, all scheduled natively via `UNUserNotificationCenter`. No
    // `@capacitor/local-notifications`: it could not be installed in an
    // earlier session (sandboxed `npm install` was refused), and once the
    // stop/open-ended notices turned out to need no WebView at all — they
    // fire off `arm`/`keepRecording`, which Recorder already owns — the
    // before-trip notice moved here too rather than keeping two scheduling
    // mechanisms for the same feature. Every body string arrives already
    // translated from JS (`site/locales/*.json` via `useI18n()`); nothing
    // here hardcodes English.

    private func stopNoticeId(_ trip: String) -> String { "gps-stop-\(trip)" }
    private func openEndedNoticeId(_ trip: String) -> String { "gps-open-ended-\(trip)" }
    private static let beforeTripPrefix = "gps-before-"
    private func beforeTripNoticeId(_ trip: String) -> String { "\(Self.beforeTripPrefix)\(trip)" }

    /// The trip's own studio page — B2196 security review (2026-09-24)
    /// finding 8: every notice needs a `url` or a tap opens nothing.
    /// Built from `base`/`user`, both natively sourced (finding 1's fix),
    /// never from anything the JS side supplies for this purpose.
    private func studioURL(base: String, user: String, trip: String) -> String {
        let tripQ = trip.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? trip
        let userP = user.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? user
        return "\(base)/\(userP)/studio/trip?trip=\(tripQ)"
    }

    private func scheduleStopNotice(trip: String, end: String, body: String, base: String, user: String) {
        guard let endDate = dayFormatter.date(from: end) else { return }
        let cal = Calendar.current
        let at = cal.date(byAdding: .day, value: 2, to: cal.startOfDay(for: endDate)) ?? endDate
        let content = UNMutableNotificationContent()
        content.title = "Fernscout"
        content.body = body
        content.userInfo = ["url": studioURL(base: base, user: user, trip: trip)]
        let comps = cal.dateComponents([.year, .month, .day, .hour, .minute], from: at)
        let trigger = UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: stopNoticeId(trip), content: content, trigger: trigger))
    }

    /// D3 — every 7 days while a trip stays open-ended.
    private func scheduleOpenEndedReminder(trip: String, body: String, base: String, user: String) {
        let content = UNMutableNotificationContent()
        content.title = "Fernscout"
        content.body = body
        content.userInfo = ["url": studioURL(base: base, user: user, trip: trip)]
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 7 * 24 * 60 * 60, repeats: true)
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: openEndedNoticeId(trip), content: content, trigger: trigger))
    }

    private func cancelNotices(trip: String) {
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [stopNoticeId(trip), openEndedNoticeId(trip), beforeTripNoticeId(trip)])
    }

    /// D3 — "keep recording" past the cooldown. Security review (2026-09-24),
    /// functional finding 6: the trip is no longer in `armed` once its
    /// cooldown has passed (`applyStopRule` moved it to `stopped`), so this
    /// must re-arm it from there rather than silently doing nothing —
    /// `stopped` now holds the whole trip (title/dates/user/base) for
    /// exactly this reason.
    func keepRecording(trip: String, openEndedBody: String) {
        var a = armed
        var t: ArmedTrip
        if let alreadyArmed = a[trip] {
            t = alreadyArmed
        } else if let previouslyStopped = stopped[trip] {
            t = previouslyStopped
            var s = stopped
            s.removeValue(forKey: trip)
            stopped = s
        } else {
            return // never armed, never stopped — nothing to keep going
        }
        t.openEnded = true
        a[trip] = t
        armed = a
        beginTracking()
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [stopNoticeId(trip)])
        scheduleOpenEndedReminder(trip: trip, body: openEndedBody, base: t.base, user: t.user)
    }

    /// B2197's before-trip notice — replaces every pending one at once
    /// (the `gps-before-` prefix), since the caller (`ScheduleRouteNotices
    /// .tsx`) always sends the complete current due set: a trip whose
    /// dates moved or that got armed/declined/deleted since the last call
    /// is simply absent from `trips` this time, which cancels its old
    /// notice without this function having to know why.
    func scheduleBeforeTrip(trips: [(id: String, url: String, body: String, at: Date)]) {
        let center = UNUserNotificationCenter.current()
        center.getPendingNotificationRequests { requests in
            let stale = requests.map(\.identifier).filter { $0.hasPrefix(Self.beforeTripPrefix) }
            center.removePendingNotificationRequests(withIdentifiers: stale)
            for trip in trips {
                let content = UNMutableNotificationContent()
                content.title = "Fernscout"
                content.body = trip.body
                content.userInfo = ["url": trip.url]
                let comps = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: trip.at)
                let trigger = UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)
                center.add(UNNotificationRequest(identifier: self.beforeTripNoticeId(trip.id), content: content, trigger: trigger))
            }
        }
    }

    // MARK: - Notification permission — B2197's explicit "Allow reminders"
    // button asks for this only after the owner taps it, never silently.

    func notificationPermissionStatus(_ completion: @escaping (String) -> Void) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            completion(Self.permissionString(settings.authorizationStatus))
        }
    }

    func requestNotificationPermission(_ completion: @escaping (String) -> Void) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in
            self.notificationPermissionStatus(completion)
        }
    }

    private static func permissionString(_ status: UNAuthorizationStatus) -> String {
        switch status {
        case .authorized, .provisional, .ephemeral: return "granted"
        case .denied: return "denied"
        default: return "unknown"
        }
    }

    struct StatusReply {
        let state: String // off | declined | recording | stopped | error
        let since: String?
        let lastUploadAt: String?
        let openEnded: Bool
        let stoppedOn: String?
        let errorKind: String?
        /// Security review (2026-09-24), finding 2 — the write:gps token's
        /// own expiry, so the studio page can decide whether to refresh
        /// without ever reading the token itself out of native, and without
        /// minting a fresh one just because the page was opened.
        let tokenExpiresAt: String?
    }

    private var currentTokenExpiresAt: String? { GpsCredentialStore.load()?.expiresAt }

    func status(trip: String) -> StatusReply {
        applyStopRule()
        if declined.contains(trip) {
            return StatusReply(state: "declined", since: nil, lastUploadAt: nil, openEnded: false, stoppedOn: nil, errorKind: nil, tokenExpiresAt: nil)
        }
        if let error = lastError {
            return StatusReply(state: "error", since: nil, lastUploadAt: nil, openEnded: false, stoppedOn: nil, errorKind: error, tokenExpiresAt: currentTokenExpiresAt)
        }
        if manager.authorizationStatus == .authorizedWhenInUse, armed[trip] != nil {
            return StatusReply(state: "error", since: armed[trip]?.armedAt, lastUploadAt: nil, openEnded: false, stoppedOn: nil, errorKind: "when_in_use_only", tokenExpiresAt: currentTokenExpiresAt)
        }
        if let t = armed[trip] {
            let uploadISO = lastUpload.map { ISO8601DateFormatter().string(from: $0) }
            return StatusReply(state: "recording", since: t.armedAt, lastUploadAt: uploadISO, openEnded: t.openEnded, stoppedOn: nil, errorKind: nil, tokenExpiresAt: currentTokenExpiresAt)
        }
        if let stoppedTrip = stopped[trip] {
            let stoppedOn = dayFormatter.string(from: cooldownEnd(stoppedTrip))
            return StatusReply(state: "stopped", since: nil, lastUploadAt: nil, openEnded: false, stoppedOn: stoppedOn, errorKind: nil, tokenExpiresAt: nil)
        }
        return StatusReply(state: "off", since: nil, lastUploadAt: nil, openEnded: false, stoppedOn: nil, errorKind: nil, tokenExpiresAt: nil)
    }

    func armedTripIds() -> (armed: [String], declined: [String]) {
        (Array(armed.keys), Array(declined))
    }

    /// Second review (2026-09-24), finding 1 — the confirmation dialog
    /// `LocationRecorderPlugin.arm`/`keepRecording` show before doing
    /// anything needs the `user`/`base` a re-arm from `stopped` would use,
    /// without mutating any state to get it. Read-only on purpose.
    func lookup(trip: String) -> (user: String, base: String)? {
        guard let t = armed[trip] ?? stopped[trip] else { return nil }
        return (t.user, t.base)
    }

    /// Second review (2026-09-24), finding 2 — called from `setToken`: a
    /// fresh token is exactly what an `unauthorized` error needed, so it is
    /// cleared here rather than staying wedged until the next successful
    /// upload proves it. Left alone for any other error (`storage_full`, a
    /// contract refusal) — a new token does not fix those.
    func clearAuthError() {
        if lastError == "unauthorized" { lastError = nil }
        unauthorizedNoticePosted = false
    }

    // MARK: - Stop rule — checked on every fix and every launch (B2196)

    /// Not before 00:00 on `start`, off at 00:00 two days after `end`
    /// (D2's cooldown) unless the trip is open-ended (D3). A trip that
    /// crosses the cooldown moves from `armed` to `stopped`, purging the
    /// buffer only when nothing else stays armed.
    private func applyStopRule() {
        let now = Date()
        var a = armed
        var s = stopped
        var changed = false
        var lastStopped: ArmedTrip?
        for (id, trip) in a {
            if !trip.openEnded, now >= cooldownEnd(trip) {
                a.removeValue(forKey: id)
                s[id] = trip
                lastStopped = trip
                changed = true
            }
        }
        if changed {
            armed = a
            stopped = s
            if a.isEmpty {
                // Security review (2026-09-24), finding 9 — one last upload
                // attempt before the buffer goes.
                finalUploadThenPurge(lastStopped)
                endTracking()
                // Security review (2026-09-24), finding 4 — nothing left
                // armed, nothing left to upload with.
                GpsCredentialStore.clear()
            }
        }
    }

    /// D2's cooldown end — the moment `trip` stops (or would have, if it
    /// were not open-ended): local midnight two days after `end`. One
    /// formula, read from `applyStopRule` (deciding whether to stop) and
    /// `status()` (reporting the date it stopped on) alike, so the two can
    /// never quietly disagree the way a second stored copy of the date
    /// could.
    private func cooldownEnd(_ trip: ArmedTrip) -> Date {
        #if DEBUG
        // Test-only, compiled out of Release — B2196 security review
        // (2026-09-24), functional finding 6: lets the stopped → Keep
        // recording path be driven in the Simulator without waiting two
        // real days. See `debugForceCooldown()` below.
        if defaults?.bool(forKey: Self.debugForceCooldownKey) == true { return .distantPast }
        #endif
        guard let end = dayFormatter.date(from: trip.end) else { return .distantPast }
        let cal = Calendar.current
        return cal.date(byAdding: .day, value: 2, to: cal.startOfDay(for: end)) ?? end
    }

    #if DEBUG
    private static let debugForceCooldownKey = "recorder-debug-force-cooldown"

    /// Test-only — sets every armed trip's cooldown to already have passed
    /// and re-runs the stop rule immediately. Compiled out of Release
    /// entirely (`#if DEBUG`), so it is not reachable in a build the App
    /// Store would ever see.
    func debugForceCooldown() {
        defaults?.set(true, forKey: Self.debugForceCooldownKey)
        applyStopRule()
    }
    #endif

    private var dayFormatter: DateFormatter {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = .current
        return f
    }

    /// Whether *any* armed trip's window (start's midnight onward) already
    /// covers `now` — a fix from before every armed trip's own start is
    /// dropped rather than buffered.
    private func withinAnyArmedWindow(_ now: Date) -> Bool {
        let cal = Calendar.current
        return armed.values.contains { trip in
            guard let start = dayFormatter.date(from: trip.start) else { return false }
            return now >= cal.startOfDay(for: start)
        }
    }

    // MARK: - Buffer

    /// Security review (2026-09-24), finding 3 — the app's own Application
    /// Support directory, not the shared app-group container: nothing but
    /// this recorder ever needs to read the raw buffer (the share extension
    /// does not), so it does not belong in the group's shared, backed-up
    /// storage. `harden(_:)` re-applies both the file-protection class and
    /// `isExcludedFromBackup` after every rewrite, since an atomic write
    /// replaces the file (temp file + rename) and a fresh file starts with
    /// neither.
    private var bufferURL: URL {
        let dir = (try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true))
            ?? FileManager.default.temporaryDirectory
        return dir.appendingPathComponent("route-buffer.jsonl")
    }
    private static let bufferCap = 50_000

    private func harden(_ url: URL) {
        try? FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: url.path)
        var mutableURL = url
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? mutableURL.setResourceValues(values)
    }

    private func appendFix(_ fix: Fix) {
        let url = bufferURL
        let line = fix.jsonLine + "\n"
        if !FileManager.default.fileExists(atPath: url.path) {
            FileManager.default.createFile(atPath: url.path, contents: nil)
        }
        if let handle = try? FileHandle(forWritingTo: url) {
            handle.seekToEndOfFile()
            handle.write(line.data(using: .utf8)!)
            try? handle.close()
        }
        harden(url)
        capBuffer()
    }

    /// Oldest lines dropped past `bufferCap` — B2196's 50,000-line ceiling,
    /// so a phone offline for weeks does not grow the buffer without limit.
    private func capBuffer() {
        guard let text = try? String(contentsOf: bufferURL, encoding: .utf8) else { return }
        var lines = text.split(separator: "\n", omittingEmptySubsequences: true)
        guard lines.count > Self.bufferCap else { return }
        lines = lines.suffix(Self.bufferCap)
        try? (lines.joined(separator: "\n") + "\n").write(to: bufferURL, atomically: true, encoding: .utf8)
        harden(bufferURL)
    }

    private func readBufferSnapshot() -> [Substring] {
        guard let text = try? String(contentsOf: bufferURL, encoding: .utf8) else { return [] }
        return Array(text.split(separator: "\n", omittingEmptySubsequences: true))
    }

    private func removeUploadedLines(_ n: Int) {
        let remaining = readBufferSnapshot().dropFirst(n)
        try? (remaining.isEmpty ? "" : remaining.joined(separator: "\n") + "\n").write(to: bufferURL, atomically: true, encoding: .utf8)
        harden(bufferURL)
    }

    /// ponytail: purges the one shared buffer file rather than per-trip
    /// slices — correct while every armed trip's fixes are still wanted by
    /// at least one trip, wrong the moment two trips overlap and only one
    /// is stopped; callers only purge once `armed` is empty, which is the
    /// upgrade path if a per-trip buffer is ever needed.
    private func purgeBuffer() {
        try? FileManager.default.removeItem(at: bufferURL)
    }

    // MARK: - Upload

    private static let uploadInterval: TimeInterval = 30 * 60

    /// `POST /api/v2/<user>/import`'s own error shape — `{"error": "<code>",
    /// "message": "..."}` (`lib/api/v2/route.ts`'s `fail()`). Read the code
    /// out of the body rather than trusting the status alone — B2196
    /// security review (2026-09-24), functional finding 7: every 400 used to
    /// be treated as `storage_full`, so a contract refusal (a malformed
    /// snapshot this recorder itself produced, say) would wedge uploads off
    /// forever instead of just dropping the one bad snapshot.
    private static func errorCode(from data: Data?) -> String? {
        guard let data, let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return obj["error"] as? String
    }

    private func maybeUpload(force: Bool = false) {
        guard let credential = GpsCredentialStore.load() else { return }
        guard let trip = armed.values.first else { return } // same base/user for every armed trip in practice
        // Finding 7 — storage_full stops automatic attempts (nothing changed
        // server-side without the owner doing something about it), but a
        // foreground open still gets to check whether space freed up.
        if !force, lastError == "storage_full" { return }
        let snapshot = readBufferSnapshot()
        guard !snapshot.isEmpty else { return } // never upload an empty buffer
        if !force, let last = lastUpload, Date().timeIntervalSince(last) < Self.uploadInterval { return }

        let n = snapshot.count
        guard let request = uploadRequest(trip: trip, credential: credential, text: snapshot.joined(separator: "\n")) else { return }

        backgroundTask = UIApplication.shared.beginBackgroundTask { [weak self] in
            guard let self else { return }
            UIApplication.shared.endBackgroundTask(self.backgroundTask)
            self.backgroundTask = .invalid
        }
        URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
            guard let self else { return }
            defer {
                if self.backgroundTask != .invalid {
                    UIApplication.shared.endBackgroundTask(self.backgroundTask)
                    self.backgroundTask = .invalid
                }
            }
            guard let http = response as? HTTPURLResponse else { return } // offline/transient — keep buffering
            switch http.statusCode {
            case 200...299:
                self.removeUploadedLines(n)
                self.lastUpload = Date()
                self.lastError = nil
                self.unauthorizedNoticePosted = false // second review, finding 5
            case 401:
                self.lastError = "unauthorized"
                // Second review (2026-09-24), finding 5 — posted once per
                // 401 streak, not on every upload attempt after; `setToken`
                // (via `clearAuthError()`) and a 2xx both reset the flag.
                if !self.unauthorizedNoticePosted {
                    self.unauthorizedNoticePosted = true
                    // One native notice — the JS side never sees this
                    // failure, so the body has to already be sitting in
                    // `armed`, stored at `arm()` time from the owner's own
                    // locale.
                    let body = self.armed.values.first?.unauthorizedBody ?? "Open Fernscout to resume uploading your route."
                    self.postLocalNotice(body: body)
                }
            case 400:
                if Self.errorCode(from: data) == "storage_full" {
                    self.lastError = "storage_full" // kept buffered — see the `force` check above
                } else {
                    self.removeUploadedLines(n) // a contract refusal — drop the bad snapshot, not the whole feature
                }
            case 408, 429:
                // Second review (2026-09-24), finding 4 — both are
                // transient (a timeout, a rate limit), not a reason to drop
                // data or show an error; treated like a 5xx.
                break
            case 402...499:
                self.removeUploadedLines(n)
                self.lastError = Self.errorCode(from: data) ?? "http_\(http.statusCode)"
            default:
                break // 5xx or otherwise transient — keep buffering, no error recorded
            }
        }.resume()
    }

    private func uploadRequest(trip: ArmedTrip, credential: GpsCredential, text: String) -> URLRequest? {
        guard let url = URL(string: "\(trip.base)/api/v2/\(trip.user)/import") else { return nil }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.setValue("Bearer \(credential.token)", forHTTPHeaderField: "authorization")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["kind": "gps", "format": "fixes", "text": text])
        return request
    }

    /// Security review (2026-09-24), finding 9 — one last upload attempt
    /// when nothing stays armed (owner Stop, or the cooldown ending),
    /// rather than silently discarding whatever was recorded since the last
    /// successful upload. The buffer is purged either way — on a 2xx, on
    /// any failure, and on the background task simply running out of time —
    /// `finish()` is the only path to `purgeBuffer()` and it is reachable
    /// from both the network callback and the expiration handler.
    private func finalUploadThenPurge(_ trip: ArmedTrip?) {
        guard let trip, let credential = GpsCredentialStore.load() else {
            purgeBuffer()
            return
        }
        let snapshot = readBufferSnapshot()
        guard !snapshot.isEmpty, let request = uploadRequest(trip: trip, credential: credential, text: snapshot.joined(separator: "\n")) else {
            purgeBuffer()
            return
        }
        var task = UIBackgroundTaskIdentifier.invalid
        var done = false
        let finish: () -> Void = { [weak self] in
            guard !done else { return }
            done = true
            self?.purgeBuffer()
            if task != .invalid { UIApplication.shared.endBackgroundTask(task) }
        }
        task = UIApplication.shared.beginBackgroundTask { finish() }
        URLSession.shared.dataTask(with: request) { _, _, _ in finish() }.resume()
    }

    private func postLocalNotice(body: String) {
        // Deliberately not @capacitor/local-notifications (that package
        // could not be installed in this sandboxed session — see
        // components/studio/ScheduleRouteNotices.tsx's doc comment). A
        // bare `UNUserNotificationCenter` call needs no dependency and
        // covers this one native-only notice.
        let content = UNMutableNotificationContent()
        content.title = "Fernscout"
        content.body = body
        let request = UNNotificationRequest(identifier: "gps-unauthorized", content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }
}

// MARK: - CLLocationManagerDelegate

extension Recorder: CLLocationManagerDelegate {
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        applyStopRule()
        guard !armed.isEmpty else { return }
        for loc in locations where loc.horizontalAccuracy >= 0 { // negative: iOS's own "invalid"
            record(at: loc.timestamp, loc.coordinate)
            lastLocation = loc
        }
        // A fix while GPS is off came from the significant-change service:
        // the phone has moved ~500 m since it settled, so trace from here.
        if !moving { startMoving() }
    }

    /// Arrivals and departures, the way a timeline marks "stayed here from
    /// … to …". iOS delivers these even to an app it has to relaunch.
    func locationManager(_ manager: CLLocationManager, didVisit visit: CLVisit) {
        applyStopRule()
        guard !armed.isEmpty else { return }
        if visit.arrivalDate != .distantPast { record(at: visit.arrivalDate, visit.coordinate) }
        if visit.departureDate == .distantFuture {
            settle(at: visit.coordinate)
        } else {
            record(at: visit.departureDate, visit.coordinate)
            if !moving { startMoving() }
        }
    }

    /// iOS paused GPS because the phone stopped moving. Apple: pauses do
    /// not resume by themselves, so fence the spot and restart on exit.
    func locationManagerDidPauseLocationUpdates(_ manager: CLLocationManager) {
        guard let loc = lastLocation else { return }
        settle(at: loc.coordinate)
    }

    func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) {
        guard region.identifier == Self.resumeFenceId, !armed.isEmpty else { return }
        let task = UIApplication.shared.beginBackgroundTask()
        startMoving()
        if task != .invalid { UIApplication.shared.endBackgroundTask(task) }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // Offline or a transient CoreLocation error — keep buffering
        // whatever has already been read; nothing to purge or report here.
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        manager.allowsBackgroundLocationUpdates = status == .authorizedAlways
        manager.pausesLocationUpdatesAutomatically = status == .authorizedAlways
        switch status {
        case .notDetermined:
            break
        case .authorizedWhenInUse where upgradeAfterWhenInUse:
            upgradeAfterWhenInUse = false
            askAlways()
        default:
            upgradeAfterWhenInUse = false
            finishPermission()
        }
        // "Always" granted later, from Settings — the low-power services
        // could not run without it, so start them now.
        if status == .authorizedAlways, !armed.isEmpty { beginTracking() }
    }
}

/// One "Change to Always Allow" prompt's wait, a class so the notification
/// blocks can share its state. Ends once: when the app becomes active again
/// after the prompt, or — if no prompt ever took the app out of the
/// foreground — when `endUnlessPrompted()` is called.
private final class AlwaysPromptWait {
    private var prompted = false
    private var observers: [NSObjectProtocol] = []
    private var onEnd: (() -> Void)?

    init(onEnd: @escaping () -> Void) {
        self.onEnd = onEnd
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
            self?.prompted = true
        })
        // Strong `self`: these observers are what keep the wait alive until
        // it ends, and `end()` removes them, breaking the cycle.
        observers.append(center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { _ in
            self.end()
        })
    }

    func endUnlessPrompted() {
        if !prompted { end() }
    }

    private func end() {
        observers.forEach { NotificationCenter.default.removeObserver($0) }
        observers.removeAll()
        let run = onEnd
        onEnd = nil
        run?()
    }
}

/// Called on every foreground — B2196's other upload trigger, beside "30
/// minutes since the last one". `AppDelegate.applicationWillEnterForeground`
/// and `applicationDidBecomeActive` both call this via `Recorder.shared`.
extension Recorder {
    func foreground() {
        applyStopRule()
        maybeUpload(force: true)
    }

    /// `UIApplication.openSettingsURLString` — B2198's Settings link for the
    /// "While using" only error.
    func openSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        DispatchQueue.main.async { UIApplication.shared.open(url) }
    }
}
