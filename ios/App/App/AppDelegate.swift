import UIKit
import Capacitor
import UserNotifications

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    /// The scene's window — B2328. Under the scene lifecycle UIKit hands the
    /// window to `SceneDelegate`, not to this class; this reads it back for
    /// the notification tap below, which only knows the app delegate.
    var window: UIWindow? {
        UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.delegate as? SceneDelegate }
            .first?.window
    }

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // B2196 — `Recorder` is created here, not lazily from the plugin,
        // so a background relaunch (`launchOptions[.location]`, or the
        // significant-change service waking the app) starts it with no
        // WebView ever having loaded. `start()` itself checks whether
        // anything is actually armed before touching CoreLocation.
        // `start()` no-ops when nothing is armed, so calling it on every
        // launch (ordinary or `launchOptions[.location]`) is cheap and
        // needs no separate "was anything armed" check duplicated here.
        Recorder.shared.start()
        // B2197 — every native notice (stop, open-ended, before-trip) opens
        // its trip's studio page in the WebView on tap; see
        // `userNotificationCenter(_:didReceive:withCompletionHandler:)`
        // below.
        UNUserNotificationCenter.current().delegate = self
        // B2330 — reattach to whatever `MediaUploadSession` still has running
        // from before this launch. `handleEventsForBackgroundURLSession`
        // below covers a relaunch iOS does purely to report finished
        // uploads; this covers an ordinary launch (icon tap) while some are
        // still in flight.
        MediaUploadSession.shared.rejoin()
        // B2732 — same reattach for the "Save to inbox" queue, plus a retry
        // of anything still `waiting`/`reconnect` and the quick action's own
        // presence, which only reflects "is a credential stored" once this
        // runs.
        InboxQueue.shared.rejoin()
        InboxQueue.shared.sendAll()
        SaveToInboxDoors.syncQuickAction()
        #if DEBUG
        handleB2730TestArgs()
        #endif
        return true
    }

    #if DEBUG
    /// B2730 — a DEBUG-only launch-argument hook so this ticket's recorder
    /// behaviour (a Stop the network could not reach, a definitive refusal,
    /// the 7-day drop) can be driven and proven in the Simulator with no
    /// real GPS movement and no WebView sign-in/arm flow. Each flag is a
    /// thin, direct call onto `Recorder.shared` — nothing here is reachable
    /// from a compiled Release build. Run in the fixed order below
    /// (set token, arm, inject a fix, foreground, disarm, age the pending
    /// file) regardless of the order the flags are given on the command
    /// line, since several of these only make sense done in that sequence.
    private func handleB2730TestArgs() {
        let args = ProcessInfo.processInfo.arguments
        func value(after flag: String) -> String? {
            guard let i = args.firstIndex(of: flag), i + 1 < args.count else { return nil }
            return args[i + 1]
        }
        if let token = value(after: "-b2730SetToken") {
            let expires = value(after: "-b2730TokenExpires") ?? "2099-01-01T00:00:00Z"
            _ = GpsCredentialStore.save(GpsCredential(token: token, expiresAt: expires))
        }
        if let trip = value(after: "-b2730Arm"), let user = value(after: "-b2730User"), let base = value(after: "-b2730Base") {
            let start = value(after: "-b2730Start") ?? "2020-01-01"
            let end = value(after: "-b2730End") ?? "2099-01-01"
            Recorder.shared.arm(
                trip: trip, title: "B2730 test trip", start: start, end: end, user: user, base: base,
                stopBody: "stop", unauthorizedBody: "unauthorized"
            )
        }
        if let latS = value(after: "-b2730InjectFix"), let lonS = value(after: "-b2730InjectFixLon"),
           let lat = Double(latS), let lon = Double(lonS) {
            Recorder.shared.debugInjectFix(lat: lat, lon: lon)
        }
        if args.contains("-b2730Foreground") {
            Recorder.shared.foreground()
        }
        if let trip = value(after: "-b2730Disarm") {
            Recorder.shared.disarm(trip: trip, decline: false)
        }
        if let daysS = value(after: "-b2730AgePending"), let days = Int(daysS) {
            Recorder.shared.debugAgePendingUpload(days: days)
        }
        if args.contains("-b2730Dump") {
            Recorder.shared.debugDumpState()
        }
        // B2732 — a DEBUG-only hook so "Save to inbox" can be proven in the
        // Simulator with no studio "Connect this iPhone" round trip: stores
        // a `ShareCredential` with a token minted by hand (an ordinary
        // `fs_agent_…` token from `POST /api/auth/<user>/codes/redeem`) and
        // syncs the quick action exactly as `ShareInboxPlugin.connect` would.
        if let base = value(after: "-b2732SetCredential"), let user = value(after: "-b2732User"), let token = value(after: "-b2732Token") {
            let expires = value(after: "-b2732Expires") ?? "2099-01-01T00:00:00Z"
            _ = ShareCredentialStore.save(ShareCredential(base: base, user: user, token: token, expiresAt: expires))
            SaveToInboxDoors.syncQuickAction()
        }
        if args.contains("-b2732ClearCredential") {
            ShareCredentialStore.clear()
            SaveToInboxDoors.syncQuickAction()
        }
    }
    #endif

    /// iOS relaunches the app in the background purely to say this session's
    /// tasks have news — B2330. Recreating `MediaUploadSession` (same fixed
    /// identifier) reattaches its delegate to them; once every event is
    /// delivered, `urlSessionDidFinishEvents` calls the completion handler
    /// this hands it, which is the system's own signal that it is safe to
    /// suspend the app again.
    func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String, completionHandler: @escaping () -> Void) {
        switch identifier {
        case MediaUploadSession.identifier:
            MediaUploadSession.shared.backgroundCompletion = completionHandler
            MediaUploadSession.shared.rejoin()
        case InboxQueue.identifier:
            // B2732 — same dance as `MediaUploadSession`, its own fixed
            // identifier so a relaunch purely to report finished tasks
            // reattaches this session's delegate to them.
            InboxQueue.shared.backgroundCompletion = completionHandler
            InboxQueue.shared.rejoin()
        default:
            completionHandler()
        }
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    // B2115 — forwarding required by @capacitor/push-notifications' own
    // docs: these two `UIApplicationDelegate` callbacks are a different pair
    // from `UNUserNotificationCenterDelegate` below (already ours, for
    // B2196/B2197's local notices) and do not compete with it. The plugin
    // listens for these two notification names and turns them into its own
    // `registration` / `registrationError` JS events — nothing here reads
    // the token itself.
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

}

// MARK: - SceneDelegate

/// The one window scene — B2328. iOS 27 refuses to run an app built with its
/// SDK that still uses the app-delegate-only lifecycle (a SIGTRAP in
/// `_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption` before
/// anything is drawn). UIKit builds the window from `Main.storyboard` (the
/// scene manifest in Info.plist names it), so Capacitor's bridge view
/// controller comes up exactly as before. Under scenes the app delegate's
/// foreground, open-URL and user-activity callbacks are no longer called, so
/// they live here and forward where the app delegate used to.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    /// B2697 — a sign-in link that launched the app cold. The bridge does not
    /// exist yet in `willConnectTo`, so it is loaded once the scene is active.
    private var pendingLink: URL?
    /// B2732 — a quick-action tap that launched the app cold; UIKit hands it
    /// here rather than to `windowScene(_:performActionFor:)` in that case,
    /// so the sheet it asks for is shown once the scene is active too.
    private var pendingShortcut: UIApplicationShortcutItem?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        // A launch by URL or activity arrives here rather than through the
        // callbacks below.
        if let url = connectionOptions.urlContexts.first?.url {
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: url, options: [:])
        }
        if let activity = connectionOptions.userActivities.first {
            pendingLink = activity.webpageURL
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: activity, restorationHandler: { _ in })
        }
        pendingShortcut = connectionOptions.shortcutItem
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        if let url = pendingLink {
            pendingLink = nil
            openInBridge(url)
        }
        if let shortcut = pendingShortcut {
            pendingShortcut = nil
            _ = SaveToInboxDoors.handle(shortcut)
        }
    }

    /// A quick-action tap while the app was already running or backgrounded
    /// — UIKit calls this instead of handing it through `willConnectTo`.
    func windowScene(_ windowScene: UIWindowScene, performActionFor shortcutItem: UIApplicationShortcutItem, completionHandler: @escaping (Bool) -> Void) {
        completionHandler(SaveToInboxDoors.handle(shortcutItem))
    }

    /// B2697 — a universal link (`applinks:` in App.entitlements, claimed by
    /// `app/.well-known/apple-app-site-association`) is a sign-in link from
    /// Mail. Loaded into the bridge's own WebView so the token is redeemed
    /// into the app's cookie jar, on the same exact host/scheme/port match
    /// against `appStartServerURL` the notification taps use below. An owner
    /// who pointed the app at another server keeps getting Safari for it.
    private func openInBridge(_ url: URL) {
        guard let bridge = (window?.rootViewController as? CAPBridgeViewController)?.bridge,
              let base = bridge.config.appStartServerURL as URL?,
              url.host == base.host, url.scheme == base.scheme, url.port == base.port else { return }
        bridge.webView?.load(URLRequest(url: url))
    }

    func sceneWillEnterForeground(_ scene: UIScene) {
        // B2196 — the recorder's other upload trigger, beside "30 minutes
        // since the last one".
        Recorder.shared.foreground()
        // B2732 — the inbox queue's own retry point beside launch and the
        // network path becoming satisfied again.
        InboxQueue.shared.sendAll()
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        // Kept for the Capacitor App API's url-open tracking.
        for context in URLContexts {
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: context.url, options: [:])
        }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        if let url = userActivity.webpageURL { openInBridge(url) }
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
    }
}

// MARK: - UNUserNotificationCenterDelegate

extension AppDelegate: UNUserNotificationCenterDelegate {
    /// A tap on any of B2196/B2197's local notices — stop, open-ended or
    /// before-trip — loads that trip's studio page directly into the
    /// bridge's own `WKWebView`, the same page the notice names in
    /// `userInfo["url"]`. Works whether the app was foreground,
    /// background or not running at all: iOS delivers the response once the
    /// scene has connected, and `window` reads it from there (B2328).
    ///
    /// B2115 — a tap on a *remote* push (an invite, a published day,
    /// anything `lib/push.ts`'s APNs sender sent) lands here too, unchanged.
    /// There is exactly one `UNUserNotificationCenter.current().delegate` in
    /// the process and this file owns it; the push plugin never installs its
    /// own. A remote notification's payload carries `userInfo["url"]` the
    /// same shape the local notices do (`lib/push.ts`'s payload, mirrored by
    /// the APNs sender), so the same path — read it, resolve it against the
    /// bridge's own `appStartServerURL`, load it only on an exact host,
    /// scheme and port match — is already the right one for both. No
    /// `response.notification.request.trigger` branch needed: the
    /// same-origin check is the whole of what either kind of notice is
    /// allowed to do.
    ///
    /// Security review (2026-09-24), finding 5 — `userInfo["url"]` for the
    /// before-trip notice came from `scheduleBeforeTrip`'s JS caller, so a
    /// compromised WebView could otherwise schedule a notice whose tap loads
    /// an attacker's page into the app's own WKWebView. Resolved against
    /// `bridge.config.appStartServerURL` (native, not JS-reachable — the
    /// same source `LocationRecorderPlugin.nativeBase()` uses) rather than
    /// the WebView's own current URL, and loaded only when the resolved
    /// host, scheme and port all match it (second review, 2026-09-24,
    /// finding 3 — port too, not just host and scheme); anything else is
    /// silently ignored.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        if let path = response.notification.request.content.userInfo["url"] as? String,
           let bridge = (window?.rootViewController as? CAPBridgeViewController)?.bridge,
           let base = bridge.config.appStartServerURL as URL?,
           let url = URL(string: path, relativeTo: base),
           url.host == base.host, url.scheme == base.scheme, url.port == base.port {
            bridge.webView?.load(URLRequest(url: url))
        }
        completionHandler()
    }

    /// Shown while the app is already open, rather than silently dropped —
    /// a route recording notice is still worth seeing mid-session.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound])
    }
}
