import Foundation
import CoreLocation
import CoreMotion
import UIKit
import UserNotifications
#if canImport(WidgetKit)
import WidgetKit
#endif

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

/// One recorded fix, the buffer's own line shape — B2196, mode added B2541.
/// `[epochSeconds, lat, lon]` or `[epochSeconds, lat, lon, "mode"]`, matching
/// the `fixes` import format exactly so nothing has to reshape it before it
/// is sent.
private struct Fix {
    let t: Int
    let lat: Double
    let lon: Double
    /// One of `TRANSPORT_MODES` (`importers/gps/schema.ts`), or `nil` when
    /// Core Motion has not reported an activity yet. Never guessed here —
    /// see `modeString(for:)` below for exactly what is (and is not) mapped.
    let mode: String?
    var jsonLine: String {
        mode.map { "[\(t),\(lat),\(lon),\"\($0)\"]" } ?? "[\(t),\(lat),\(lon)]"
    }
}

/// B2730 — a final upload `finalUploadThenPurge` could not confirm
/// delivered, kept narrowly enough to retry safely: just the one trip it was
/// recorded for, the exact server and user it was bound for, and the exact
/// snapshot text already built. Never the whole buffer format or an
/// `ArmedTrip` — a disarmed trip's record is already gone from `armed` by
/// the time this exists, and re-deriving a request from it later must not
/// depend on any of that having survived. Mirrors `bufferURL`'s own
/// storage choice (security review, 2026-09-24, finding 3): nothing but
/// this recorder ever reads raw positions, so this stays in the app's own
/// protected, non-backed-up storage rather than the shared app-group
/// container the rest of this file's state lives in.
private struct PendingUpload: Codable {
    let tripId: String
    let base: String
    let user: String
    /// ISO 8601, set once when first created and never refreshed on a
    /// retry — the 7-day ceiling (B2730's own acceptance) counts from when
    /// the data first could not be sent, not from the most recent attempt.
    let createdAt: String
    let text: String
    /// Carried along so a 401 on retry can still post the one-time notice
    /// in the owner's own language, the same as the original attempt did —
    /// by retry time the trip is no longer in `armed` or `stopped` to read
    /// it back from.
    let unauthorizedBody: String
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
    /// B2541 — Core Motion's own best guess at how the phone is currently
    /// moving, read alongside each fix. Started only while at least one trip
    /// is armed (`beginTracking`/`endTracking`), the same lifetime GPS
    /// itself gets, so it costs nothing while nothing is recording.
    private let motion = CMMotionActivityManager()
    private var currentMode: String?
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
    /// B2542, security review 2026-09-28 — the fingerprint of each armed
    /// trip's own state as last successfully sent, so an unchanged state is
    /// not re-sent on every 30-minute upload, and so a trip whose state
    /// *does* change is not stuck waiting for `armed.first`'s own buffer to
    /// have fixes before it gets a report of its own. `[tripId: String]`.
    private static let lastSentStateKey = "recorder-last-sent-state"

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
    private var lastSentState: [String: String] {
        get { decode(defaults?.data(forKey: Self.lastSentStateKey)) ?? [:] }
        set { defaults?.set(try? JSONEncoder().encode(newValue), forKey: Self.lastSentStateKey) }
    }
    /// B2733 — the owner's own opt-in to show the trip's name on the Lock
    /// Screen (default off; anyone holding the phone can read it there).
    private static let lockScreenTripNameKey = "lockscreen-trip-name"
    /// B2766 — the owner's two Live Activity switches. Lock Screen on and
    /// Island off until they say otherwise; an absent key is that default.
    private static let activityLockScreenKey = "liveactivity-lockscreen"
    private static let activityIslandKey = "liveactivity-island"
    private static let summaryKey = "recorder-summary"

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
        retryPendingUpload() // B2730 — every launch, including a background relaunch
        publishSummary() // B2733 — the widgets' own summary, current from the moment the app exists
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
        startMotionUpdates()
    }

    private func endTracking() {
        moving = false
        manager.stopUpdatingLocation()
        manager.stopMonitoringSignificantLocationChanges()
        manager.stopMonitoringVisits()
        clearResumeFence()
        motion.stopActivityUpdates()
        currentMode = nil
    }

    /// B2541 — Core Motion's own activity classifier, alongside GPS. Kept
    /// deliberately small: only the categories `CMMotionActivity` itself
    /// reports, mapped to the shared vocabulary
    /// (`importers/gps/schema.ts`'s `TRANSPORT_MODES`) — a low-confidence
    /// reading is still kept (a phone's own guess is what this vocabulary is
    /// *for*; a named stretch, B2539, is how the owner overrides it), but
    /// `.unknown` (no categories set at all) leaves `currentMode` untouched
    /// rather than overwriting a real reading with "not sure" on every
    /// callback.
    private func startMotionUpdates() {
        guard CMMotionActivityManager.isActivityAvailable() else { return }
        motion.startActivityUpdates(to: .main) { [weak self] activity in
            guard let self, let activity else { return }
            if let mapped = Self.modeString(for: activity) { self.currentMode = mapped }
        }
    }

    private static func modeString(for activity: CMMotionActivity) -> String? {
        if activity.walking || activity.running { return "on_foot" }
        if activity.cycling { return "bike" }
        if activity.automotive { return "car" }
        if activity.stationary { return nil } // says nothing about transport mode
        return activity.unknown ? nil : "unknown"
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
        appendFix(Fix(t: Int(time.timeIntervalSince1970), lat: coordinate.latitude, lon: coordinate.longitude, mode: currentMode))
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
        publishSummary(allowStart: true) // B2733 — arming always runs foreground, from a button tap
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
            finalUploadThenPurge(tripId: trip, removedTrip) // ponytail: whole-buffer purge, correct only
            // because a second, still-armed trip would keep its own fixes
            // in the same file — see the doc comment on `purgeBuffer`.
            endTracking()
            // Security review (2026-09-24), finding 4 — nothing left armed,
            // nothing left to upload with. B2730: `finalUploadThenPurge`
            // itself now decides this (`clearCredentialIfUnneeded()`) once
            // the final upload's own outcome is known, rather than clearing
            // unconditionally here before that outcome exists — a failed
            // final upload needs this same token to retry.
            if let removedTrip {
                publishSummary(endedTrip: removedTrip, endedTripId: trip) // B2733
            }
        } else {
            publishSummary() // B2733 — another armed trip takes over the activity
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
        let tripQ = trip.addingPercentEncoding(withAllowedCharacters: .urlFragmentAllowed) ?? trip
        let userP = user.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? user
        return "\(base)/@\(userP)/studio/location#trip-\(tripQ)"
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
        publishSummary(allowStart: true) // B2733 — same as `arm`, a foreground button tap
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
        publishSummary()
    }

    // MARK: - B2733: Live Activity / Control / Lock Screen summary

    func lockScreenTripNameEnabled() -> Bool {
        defaults?.bool(forKey: Self.lockScreenTripNameKey) ?? false
    }

    /// B2766 — iOS shows a running Live Activity on the Lock Screen and in
    /// the Dynamic Island together, so "Lock Screen" off means no activity
    /// at all, and "Island" off means one whose Island regions are empty.
    func activityPrefs() -> (lockScreen: Bool, island: Bool) {
        (defaults?.object(forKey: Self.activityLockScreenKey) as? Bool ?? true,
         defaults?.object(forKey: Self.activityIslandKey) as? Bool ?? false)
    }

    /// Called from the route page, which is on screen — so turning the Lock
    /// Screen back on may start a new activity right away.
    func setActivityPrefs(lockScreen: Bool?, island: Bool?) {
        if let lockScreen { defaults?.set(lockScreen, forKey: Self.activityLockScreenKey) }
        if let island { defaults?.set(island, forKey: Self.activityIslandKey) }
        publishSummary(allowStart: true)
    }

    /// The owner's own toggle — `LocationRecorderPlugin.setLockScreenTripName`.
    /// Republishes at once so a change is visible on the Lock Screen within
    /// the same `update()` ActivityKit allows from anywhere, not just the
    /// next state change.
    func setLockScreenTripName(_ on: Bool) {
        defaults?.set(on, forKey: Self.lockScreenTripNameKey)
        publishSummary()
    }

    /// The trip the Control's stop-confirmation names — `armed.first`, the
    /// same trip `maybeUpload` itself picks when several are armed at once
    /// (B2542's own "first armed trip" rule, restated here for the Control).
    func firstArmedTrip() -> (id: String, title: String)? {
        guard let (id, trip) = armed.first else { return nil }
        return (id, trip.title)
    }

    /// What is physically still on the phone, unsent — the buffer plus
    /// whatever B2730's own pending final upload holds. Never a server-side
    /// count: the Control shows what would be lost, not what the network
    /// might still be about to confirm.
    func unsentPositionCount() -> Int {
        let bufferCount = readBufferSnapshot().count
        let pendingCount = loadPendingUpload().map { $0.text.split(separator: "\n", omittingEmptySubsequences: true).count } ?? 0
        return bufferCount + pendingCount
    }

    /// `fernscout://route/<tripId>` (the Lock Screen, the Dynamic Island,
    /// the widgets and the Control's "off" state all tap through here) —
    /// B2757: always the studio's "Your routes" page, where the recording
    /// card is, never the single trip's map. The user comes from a trip the
    /// phone itself knows (armed, recently stopped, or the one named), never
    /// from the URL; `nil` when the phone knows none, so the tap is left
    /// alone rather than guessing whose studio to open.
    func routePagePath(tripId: String?) -> String? {
        guard let user = tripId.flatMap({ lookup(trip: $0)?.user })
            ?? (armed.first?.value ?? stopped.first?.value)?.user else { return nil }
        let userP = user.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? user
        return "/@\(userP)/studio/location"
    }

    /// B2733 — days since `start`, by the device's calendar: local midnight
    /// to local midnight, plus one, so the trip's first day reads "Day 1".
    private func dayNumber(start: String) -> Int? {
        guard let startDate = dayFormatter.date(from: start) else { return nil }
        let cal = Calendar.current
        let days = cal.dateComponents([.day], from: cal.startOfDay(for: startDate), to: cal.startOfDay(for: Date())).day ?? 0
        return days + 1
    }

    private func reloadWidgets() {
        #if canImport(WidgetKit)
        if #available(iOS 14.0, *) { WidgetCenter.shared.reloadAllTimelines() }
        #endif
    }

    /// The whole of what the Lock Screen, the Dynamic Island, the Control and
    /// (B2734) the widgets know about this recorder — rebuilt on every state
    /// change and written to the app-group defaults as plain JSON, since a
    /// widget extension's timeline provider cannot share this file's private
    /// `ArmedTrip` type. Never the positions themselves.
    ///
    /// `endedTrip`/`endedTripId` are supplied only from the one moment a trip
    /// actually stops (`disarm`, `applyStopRule`'s own cooldown) — by the
    /// time this runs otherwise, a stopped trip is already gone from both
    /// `armed` and `stopped`, so there is nothing left to read it back from.
    /// `allowStart` is `true` only when this call is known to be running
    /// while the app is foreground and active (arming, keeping recording, or
    /// becoming active again) — `Activity.request` itself refuses from the
    /// background, so every other call site leaves it `false` and only ever
    /// updates or ends an activity that is already running.
    private func publishSummary(endedTrip: ArmedTrip? = nil, endedTripId: String? = nil, allowStart: Bool = false) {
        var payload: [String: Any] = ["updatedAt": ISO8601DateFormatter().string(from: Date())]
        if let endedTrip, let endedTripId {
            payload["state"] = "ended"
            payload["tripId"] = endedTripId
            if let day = dayNumber(start: endedTrip.start) { payload["dayNumber"] = day }
            if lockScreenTripNameEnabled() { payload["tripTitle"] = endedTrip.title }
            if let data = try? JSONSerialization.data(withJSONObject: payload) { defaults?.set(data, forKey: Self.summaryKey) }
            reloadWidgets()
            if #available(iOS 16.2, *) { syncActivity(payload, ended: true, allowStart: false) }
            return
        }
        guard let (id, trip) = armed.first else {
            defaults?.removeObject(forKey: Self.summaryKey)
            reloadWidgets()
            if #available(iOS 16.2, *) { LiveActivityController.endAllImmediately() }
            return
        }
        let state: String
        if lastError == "unauthorized" { state = "sendingRefused" }
        else if lastError == "denied" || manager.authorizationStatus == .authorizedWhenInUse { state = "needsPermission" }
        else { state = "recording" }
        payload["state"] = state
        payload["tripId"] = id
        if let day = dayNumber(start: trip.start) { payload["dayNumber"] = day }
        // B2542 — `lastUpload` is one shared timestamp across every armed
        // trip; attributing it to this one when several are armed at once
        // would be a guess, so it is left out entirely rather than shown
        // against the wrong trip.
        if armed.count == 1, let last = lastUpload { payload["lastSentAt"] = ISO8601DateFormatter().string(from: last) }
        if !trip.openEnded { payload["recordsUntil"] = ISO8601DateFormatter().string(from: cooldownEnd(trip)) }
        if lockScreenTripNameEnabled() { payload["tripTitle"] = trip.title }
        if let data = try? JSONSerialization.data(withJSONObject: payload) { defaults?.set(data, forKey: Self.summaryKey) }
        reloadWidgets()
        if #available(iOS 16.2, *) { syncActivity(payload, ended: false, allowStart: allowStart) }
    }

    /// B2766 — the owner's switches decide whether there is an activity at
    /// all and what its Island shows; the widgets' summary above is written
    /// either way.
    @available(iOS 16.2, *)
    private func syncActivity(_ payload: [String: Any], ended: Bool, allowStart: Bool) {
        let prefs = activityPrefs()
        guard prefs.lockScreen else {
            LiveActivityController.endAllImmediately()
            return
        }
        var content = payload
        content["showsIsland"] = prefs.island
        if ended { LiveActivityController.end(content) } else { LiveActivityController.sync(content, allowStart: allowStart) }
    }

    /// B2733 — called from `SceneDelegate.sceneDidBecomeActive`, the one
    /// trigger allowed to start a brand-new Live Activity if none is running
    /// yet for an armed trip (ActivityKit's own foreground requirement).
    /// Does nothing when nothing is armed: there is no trip to start a new
    /// activity for, and — found while proving the "ended" state in the
    /// Simulator — calling `publishSummary()` with nothing armed and no
    /// `endedTrip` falls into its "nothing to report" branch and force-ends
    /// every activity immediately, which cut an "ended" card's own brief,
    /// dismissable life short by a fraction of a second every single time
    /// the app came active again right after a disarm.
    func syncLiveActivityOnBecomeActive() {
        guard !armed.isEmpty else { return }
        publishSummary(allowStart: true)
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
        var lastStopped: (id: String, trip: ArmedTrip)?
        for (id, trip) in a {
            if !trip.openEnded, now >= cooldownEnd(trip) {
                a.removeValue(forKey: id)
                s[id] = trip
                lastStopped = (id, trip)
                changed = true
            }
        }
        if changed {
            armed = a
            stopped = s
            if a.isEmpty {
                // Security review (2026-09-24), finding 9 — one last upload
                // attempt before the buffer goes.
                finalUploadThenPurge(tripId: lastStopped?.id, lastStopped?.trip)
                endTracking()
                // Security review (2026-09-24), finding 4; B2730 — see the
                // matching comment in `disarm()`: `finalUploadThenPurge`
                // itself clears the credential once it knows whether a
                // pending upload still needs it.
                if let lastStopped {
                    publishSummary(endedTrip: lastStopped.trip, endedTripId: lastStopped.id) // B2733
                }
            } else {
                publishSummary() // B2733 — this cooldown took one trip; another stays armed
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

    #if DEBUG
    /// B2730 test hooks — called only from `AppDelegate`'s own
    /// `#if DEBUG` launch-argument handling, so this ticket's pending-upload
    /// behaviour (a Stop the network could not reach, a 400 drop, the 7-day
    /// drop) is provable in the Simulator with no real GPS movement and no
    /// WebView sign-in flow. All compiled out of Release.

    /// Appends one fix straight to the buffer, bypassing CoreLocation and
    /// the armed-window check — the Simulator has no real movement to
    /// generate one from.
    func debugInjectFix(lat: Double, lon: Double) {
        appendFix(Fix(t: Int(Date().timeIntervalSince1970), lat: lat, lon: lon, mode: nil))
    }

    /// Dumps a small JSON snapshot of internal state to a fixed debug file
    /// in Application Support, purely so a test run can read it back from
    /// outside the sandbox (`xcrun simctl get_app_container … data`).
    func debugDumpState() {
        let dict: [String: Any] = [
            "armed": Array(armed.keys),
            "stopped": Array(stopped.keys),
            "declined": Array(declined),
            "lastError": lastError ?? NSNull(),
            "hasCredential": GpsCredentialStore.load() != nil,
            "bufferExists": FileManager.default.fileExists(atPath: bufferURL.path),
            "pendingExists": FileManager.default.fileExists(atPath: pendingUploadURL.path),
        ]
        let dir = (try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true))
            ?? FileManager.default.temporaryDirectory
        let url = dir.appendingPathComponent("b2730-debug-dump.json")
        if let data = try? JSONSerialization.data(withJSONObject: dict, options: [.prettyPrinted]) {
            try? data.write(to: url, options: .atomic)
        }
    }

    /// Rewrites the pending upload's `createdAt` to look `days` old, so the
    /// 7-day drop (`retryPendingUpload`) can be proven without waiting a
    /// week for it.
    func debugAgePendingUpload(days: Int) {
        guard let pending = loadPendingUpload() else { return }
        let aged = Calendar.current.date(byAdding: .day, value: -days, to: Date()) ?? Date()
        savePendingUpload(tripId: pending.tripId, trip: ArmedTrip(
            title: "", start: "", end: "", user: pending.user, base: pending.base,
            armedAt: "", openEnded: false, stopBody: "", unauthorizedBody: pending.unauthorizedBody
        ), text: pending.text, createdAt: ISO8601DateFormatter().string(from: aged))
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

    // MARK: - Pending final upload (B2730)

    /// Same directory and hardening as `bufferURL` — see `PendingUpload`'s
    /// own doc comment for why this is not the app-group container.
    private var pendingUploadURL: URL {
        let dir = (try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true))
            ?? FileManager.default.temporaryDirectory
        return dir.appendingPathComponent("route-pending-upload.json")
    }

    private func loadPendingUpload() -> PendingUpload? {
        guard let data = try? Data(contentsOf: pendingUploadURL) else { return nil }
        return try? JSONDecoder().decode(PendingUpload.self, from: data)
    }

    /// ponytail: one pending slot, like the one shared buffer — correct
    /// because `finalUploadThenPurge` only ever runs once `armed` is empty,
    /// so there is only ever one trip's final snapshot outstanding at a
    /// time; a later call overwrites whatever did not get sent before it,
    /// same upgrade path as `purgeBuffer`'s own note if that ever changes.
    private func savePendingUpload(tripId: String, trip: ArmedTrip, text: String, createdAt: String = ISO8601DateFormatter().string(from: Date())) {
        let pending = PendingUpload(tripId: tripId, base: trip.base, user: trip.user, createdAt: createdAt, text: text, unauthorizedBody: trip.unauthorizedBody)
        guard let data = try? JSONEncoder().encode(pending) else { return }
        try? data.write(to: pendingUploadURL, options: .atomic)
        harden(pendingUploadURL)
    }

    private func clearPendingUpload() {
        try? FileManager.default.removeItem(at: pendingUploadURL)
    }

    /// The server this app currently points at, without needing a bridge —
    /// `start()` can run from a background relaunch with no WebView at all.
    /// The owner's own bring-your-own-server choice if they made one, else
    /// the build's default once some bridge has loaded it at least once in
    /// this process. `nil` only means "not known yet", never "no server" —
    /// a pending upload is left alone rather than dropped on that
    /// uncertainty.
    private var chosenServerBase: String? {
        ServerChoiceStore.chosen ?? ViewController.defaultServerURL
    }

    /// Security review (2026-09-24), finding 4, extended by B2730 — the
    /// `write:gps` token is only truly unneeded once nothing is armed *and*
    /// no pending upload still needs it to retry; clearing it the moment a
    /// trip stops would strand a pending upload with no way to ever retry.
    private func clearCredentialIfUnneeded() {
        guard armed.isEmpty, loadPendingUpload() == nil else { return }
        GpsCredentialStore.clear()
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
        // Same base/user for every armed trip in practice — the state
        // report (B2542) is scoped to this one trip's own id, the same trip
        // the fixes in this snapshot were recorded against. Every *other*
        // armed trip's own state is still kept current — see
        // `syncOtherTripStates` — so a second trip armed alongside this one
        // is not stuck waiting for this one's buffer to have fixes before
        // its own recording state can update at all (security review,
        // 2026-09-28).
        guard let (tripId, trip) = armed.first else { return }
        // Finding 7 — storage_full stops automatic attempts (nothing changed
        // server-side without the owner doing something about it), but a
        // foreground open still gets to check whether space freed up.
        if !force, lastError == "storage_full" {
            syncOtherTripStates(excluding: tripId)
            return
        }
        let snapshot = readBufferSnapshot()
        if snapshot.isEmpty || (!force && lastUpload.map { Date().timeIntervalSince($0) < Self.uploadInterval } == true) {
            // Nothing of this trip's own fixes to upload right now — its own
            // state may still have changed (permission downgraded, say), so
            // report that on its own rather than waiting for a fix.
            syncTripState(tripId: tripId, trip: trip, credential: credential)
            syncOtherTripStates(excluding: tripId)
            return
        }

        let n = snapshot.count
        let report = stateReport(tripId: tripId, trip: trip)
        let fingerprint = Self.stateFingerprint(report)
        guard let request = uploadRequest(
            base: trip.base, user: trip.user, credential: credential, text: snapshot.joined(separator: "\n"), state: report
        ) else { return }

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
                self.syncOtherTripStates(excluding: tripId)
            }
            guard let http = response as? HTTPURLResponse else { return } // offline/transient — keep buffering
            switch http.statusCode {
            case 200...299:
                self.removeUploadedLines(n)
                self.lastUpload = Date()
                self.lastError = nil
                self.unauthorizedNoticePosted = false // second review, finding 5
                var sent = self.lastSentState
                sent[tripId] = fingerprint
                self.lastSentState = sent
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
            self.publishSummary() // B2733 — every upload outcome can flip the Lock Screen's own state
        }.resume()
    }

    /// B2542 — the phone's own latest armed/permission report, sent
    /// alongside every upload so the studio can tell "recording", "off" and
    /// "armed but silently not working" apart. `armed` is `true` here by
    /// construction: only an armed trip's own buffer ever reaches
    /// `uploadRequest` at all. `armedUntil` is the same cooldown formula
    /// `cooldownEnd` already computes, restated as the one instant this
    /// trip's own arming currently claims it will stop — an open-ended trip
    /// (D3) has no such ceiling, so it is left out rather than guessed.
    private func stateReport(tripId: String, trip: ArmedTrip, armed: Bool = true) -> [String: Any] {
        var report: [String: Any] = ["trip": tripId, "armed": armed]
        if armed, !trip.openEnded { report["armedUntil"] = ISO8601DateFormatter().string(from: cooldownEnd(trip)) }
        report["permission"] = jsPermission(locationPermission().status)
        if let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String {
            report["appVersion"] = version
        }
        return report
    }

    /// Native's own `"always"`/`"whenInUse"`/… already matches
    /// `GpsStateReport`'s enum exactly (`locationPermission()` above), except
    /// `"restricted"` — parental controls or an MDM profile, which the
    /// server-side vocabulary has no slot for since it behaves like "denied"
    /// from a recording point of view (no fixes either way).
    private func jsPermission(_ status: String) -> String {
        status == "restricted" ? "denied" : status
    }

    /// A stable, order-independent encoding of one `stateReport(...)` —
    /// B2542, security review 2026-09-28. Not `Equatable` on the raw
    /// dictionary (`[String: Any]` has no such conformance); good enough to
    /// tell "this trip's own state has not changed since the last report
    /// that actually reached the server" without a round trip to find out.
    private static func stateFingerprint(_ report: [String: Any]) -> String {
        report.keys.sorted().map { "\($0)=\(report[$0] ?? "")" }.joined(separator: "&")
    }

    /// One armed trip's own state-only ping, sent with an **empty** `text`
    /// (the server's own B2542 fix accepts this: nothing to import, still
    /// something to say about the recorder) — only when it has actually
    /// changed since the last one that reached the server. Used both for
    /// the trip whose own buffer had nothing to upload this round
    /// (`maybeUpload`) and for every *other* armed trip
    /// (`syncOtherTripStates`).
    private func syncTripState(tripId: String, trip: ArmedTrip, credential: GpsCredential) {
        let report = stateReport(tripId: tripId, trip: trip)
        let fingerprint = Self.stateFingerprint(report)
        guard lastSentState[tripId] != fingerprint else { return }
        guard let request = uploadRequest(base: trip.base, user: trip.user, credential: credential, text: "", state: report) else { return }
        URLSession.shared.dataTask(with: request) { [weak self] _, response, _ in
            guard let self, let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else { return }
            var sent = self.lastSentState
            sent[tripId] = fingerprint
            self.lastSentState = sent
        }.resume()
    }

    /// Every armed trip but `excluding` (the one `maybeUpload` already
    /// covered this round, with its own fixes or its own empty-buffer ping)
    /// — B2542, security review 2026-09-28: `maybeUpload` only ever picks
    /// one trip's buffer to upload (`armed.first`), so without this a second
    /// or third armed trip's own recording state would never reach the
    /// server at all unless it happened to become `armed.first` itself.
    private func syncOtherTripStates(excluding: String?) {
        guard let credential = GpsCredentialStore.load() else { return }
        for (tripId, trip) in armed where tripId != excluding {
            syncTripState(tripId: tripId, trip: trip, credential: credential)
        }
    }

    private func uploadRequest(base: String, user: String, credential: GpsCredential, text: String, state: [String: Any]? = nil) -> URLRequest? {
        guard let url = URL(string: "\(base)/api/v2/\(user)/import") else { return nil }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.setValue("Bearer \(credential.token)", forHTTPHeaderField: "authorization")
        var body: [String: Any] = ["kind": "gps", "format": "fixes", "text": text]
        if let state { body["state"] = state }
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        return request
    }

    /// Security review (2026-09-24), finding 9 — one last upload attempt
    /// when nothing stays armed (owner Stop, or the cooldown ending),
    /// rather than silently discarding whatever was recorded since the last
    /// successful upload. The buffer itself is always purged here — the
    /// fixes it held either went out just now, got dropped as unrecoverable,
    /// or were just copied into `PendingUpload` to retry from there instead
    /// — never purged *and* lost. B2730 — a non-2xx, a transport error or
    /// the background task running out of time before a response arrives no
    /// longer purges the snapshot outright: it is kept as a `PendingUpload`
    /// (`retryPendingUpload()`, called from `start()` and `foreground()`)
    /// instead, bound to this one trip/base/user so it can never be replayed
    /// against a different server or journal. The classification below
    /// mirrors `maybeUpload`'s own switch exactly, on purpose — a stopped
    /// trip's last snapshot should not be treated more or less leniently
    /// than a running one's.
    private func finalUploadThenPurge(tripId: String?, _ trip: ArmedTrip?) {
        guard let trip, let tripId else {
            purgeBuffer()
            clearCredentialIfUnneeded()
            return
        }
        let text = readBufferSnapshot().joined(separator: "\n")
        // B2542 — this trip is no longer armed by the time this runs (Stop,
        // or the cooldown ending), so its own last report says `armed:
        // false` rather than reusing `stateReport`'s "still armed" default —
        // the studio should read "not recording" from the moment this lands,
        // not "recording" until the next report happens to correct it.
        //
        // **Sent even when the buffer is already empty** (security review,
        // 2026-09-28) — an empty `text` is exactly the state-only ping the
        // server's own B2542 fix now accepts, and disarming with nothing
        // freshly recorded must still tell the studio recording stopped,
        // not leave it reading whatever the last real upload said.
        let state = stateReport(tripId: tripId, trip: trip, armed: false)
        guard let credential = GpsCredentialStore.load() else {
            // No token to even attempt with — B2730 keeps the snapshot the
            // same as a 401 would, so a fresh token (`setToken`, from the
            // studio's own global "unauthorized" check) plus the next
            // launch or foreground can still deliver it.
            savePendingUpload(tripId: tripId, trip: trip, text: text)
            purgeBuffer()
            return
        }
        guard let request = uploadRequest(
            base: trip.base, user: trip.user, credential: credential, text: text, state: state
        ) else {
            purgeBuffer()
            clearCredentialIfUnneeded()
            return
        }
        var task = UIBackgroundTaskIdentifier.invalid
        var done = false
        let finish: (Bool) -> Void = { [weak self] keepPending in
            guard !done else { return }
            done = true
            if keepPending {
                self?.savePendingUpload(tripId: tripId, trip: trip, text: text)
            } else {
                self?.clearPendingUpload()
            }
            self?.purgeBuffer()
            self?.clearCredentialIfUnneeded() // no-op while `keepPending` left a file behind
            if task != .invalid { UIApplication.shared.endBackgroundTask(task) }
        }
        // Ran out of background time before the request settled — the
        // outcome is unknown, so this keeps the snapshot rather than
        // guessing it succeeded (B2730).
        task = UIApplication.shared.beginBackgroundTask { finish(true) }
        URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
            guard let self else { finish(true); return }
            guard let http = response as? HTTPURLResponse else {
                finish(true) // offline or another transport error — B2730
                return
            }
            switch http.statusCode {
            case 200...299:
                finish(false)
            case 401:
                self.lastError = "unauthorized"
                if !self.unauthorizedNoticePosted {
                    self.unauthorizedNoticePosted = true
                    self.postLocalNotice(body: trip.unauthorizedBody)
                }
                finish(true) // the token may be renewed — B2730
            case 400:
                if Self.errorCode(from: data) == "storage_full" {
                    self.lastError = "storage_full"
                    finish(true)
                } else {
                    finish(false) // a contract refusal — drop the bad snapshot
                }
            case 408, 429:
                finish(true) // transient — B2730
            case 402...499:
                self.lastError = Self.errorCode(from: data) ?? "http_\(http.statusCode)"
                finish(false) // definitive refusal
            default:
                finish(true) // 5xx or otherwise transient — B2730
            }
        }.resume()
    }

    /// B2730 — retries a `PendingUpload` a previous Stop (or the cooldown
    /// ending) could not deliver. Called from `start()` (every launch,
    /// including a background relaunch) and `foreground()` (every time the
    /// app comes back), the same two triggers an armed trip's own upload
    /// already gets. No `state` on this request — the trip was already
    /// reported as stopped by the attempt that created this pending upload
    /// (or by a previous retry of it); there is nothing new to say about
    /// recording state from here.
    private func retryPendingUpload() {
        guard let pending = loadPendingUpload() else { return }
        guard let created = ISO8601DateFormatter().date(from: pending.createdAt),
              Date().timeIntervalSince(created) <= 7 * 24 * 60 * 60 else {
            clearPendingUpload() // unreadable, or older than B2730's 7-day ceiling
            clearCredentialIfUnneeded()
            return
        }
        // Never resurrect a snapshot for a server the owner is no longer
        // pointed at (bring-your-own-server) — `nil` here just means "not
        // known yet" (no bridge has loaded in this process yet), not "no
        // server", so the retry is skipped this once rather than the
        // pending file being dropped on that uncertainty.
        if let chosen = chosenServerBase, chosen != pending.base {
            clearPendingUpload()
            clearCredentialIfUnneeded()
            return
        }
        guard let credential = GpsCredentialStore.load() else { return } // no token yet — try again next time
        guard let request = uploadRequest(base: pending.base, user: pending.user, credential: credential, text: pending.text) else {
            clearPendingUpload() // cannot even form the request — nothing to retry with
            clearCredentialIfUnneeded()
            return
        }
        URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
            guard let self else { return }
            guard let http = response as? HTTPURLResponse else { return } // offline again — keep it, try later
            switch http.statusCode {
            case 200...299:
                self.clearPendingUpload()
                self.clearCredentialIfUnneeded()
            case 401:
                self.lastError = "unauthorized"
                if !self.unauthorizedNoticePosted {
                    self.unauthorizedNoticePosted = true
                    self.postLocalNotice(body: pending.unauthorizedBody)
                }
                // kept — see the guard above, a fresh token may still land
            case 400:
                if Self.errorCode(from: data) == "storage_full" {
                    self.lastError = "storage_full"
                } else {
                    self.clearPendingUpload() // a contract refusal — drop it
                    self.clearCredentialIfUnneeded()
                }
            case 408, 429:
                break // transient — keep it, try again later
            case 402...499:
                self.lastError = Self.errorCode(from: data) ?? "http_\(http.statusCode)"
                self.clearPendingUpload() // definitive refusal
                self.clearCredentialIfUnneeded()
            default:
                break // 5xx — transient
            }
        }.resume()
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
        case .denied, .restricted:
            // B2363 — access revoked mid-trip. `armed` stays populated (the
            // owner's own dates still hold), but iOS delivers no more fixes,
            // so `status()` must not fall through to "recording": stop every
            // location service and surface it as an error the studio can
            // show a way out for, the same way `unauthorized` already does.
            upgradeAfterWhenInUse = false
            finishPermission()
            if !armed.isEmpty {
                endTracking()
                lastError = "denied"
            }
        default:
            upgradeAfterWhenInUse = false
            finishPermission()
            // Access restored (Settings, after a revoke) — nothing else
            // clears this one, unlike `unauthorized` (`clearAuthError()`).
            if lastError == "denied" { lastError = nil }
        }
        // "Always" granted later, from Settings — the low-power services
        // could not run without it, so start them now.
        if status == .authorizedAlways, !armed.isEmpty { beginTracking() }
        if !armed.isEmpty { publishSummary() } // B2733 — the needs-you card tracks this directly
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
        retryPendingUpload() // B2730
        publishSummary() // B2733 — cheap and idempotent; covers the no-network-call paths above
    }

    /// `UIApplication.openSettingsURLString` — B2198's Settings link for the
    /// "While using" only error.
    func openSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        DispatchQueue.main.async { UIApplication.shared.open(url) }
    }
}
