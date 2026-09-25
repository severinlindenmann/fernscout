import UIKit
import Capacitor
import UserNotifications

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

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
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
        // B2196 — the recorder's other upload trigger, beside "30 minutes
        // since the last one".
        Recorder.shared.foreground()
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
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

// MARK: - UNUserNotificationCenterDelegate

extension AppDelegate: UNUserNotificationCenterDelegate {
    /// A tap on any of B2196/B2197's local notices — stop, open-ended or
    /// before-trip — loads that trip's studio page directly into the
    /// bridge's own `WKWebView`, the same page the notice names in
    /// `userInfo["url"]`. Works whether the app was foreground,
    /// background or not running at all: `didFinishLaunching` always runs
    /// first and always sets `window`.
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
