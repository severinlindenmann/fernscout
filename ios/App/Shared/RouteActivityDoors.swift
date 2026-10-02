import Foundation
import AppIntents

/// B2733 — the Control's one door back into the running app, the same shape
/// `SaveToInboxDoors`/`SaveToInboxIntent` already use for the quick action:
/// an `AppIntent` with `openAppWhenRun` posts a notification and does
/// nothing else, because `perform()` itself runs wherever `openAppWhenRun`
/// brought it — the app's own process, not the widget extension's. Compiled
/// into both `App` and `FernscoutWidgets` (the Control needs the intent
/// type in the extension's own module to build its button at all); only
/// `AppDelegate` ever observes the notification, so all the real work —
/// reading `Recorder`'s state, presenting the native alert — stays in the
/// one file that already has those types.
enum RouteActivityDoors {
    static let showStopConfirmNotification = Notification.Name("RouteActivityDoors.showStopConfirm")
    /// B2733 — the Control's own one tap target. One intent rather than two
    /// (one per on/off state) because `ControlWidgetTemplateBuilder` (the
    /// result builder `StaticControlConfiguration`'s content closure uses)
    /// refuses an `if`/`else` choosing between two different `ControlWidget
    /// Button` action types; `AppDelegate` decides what the tap means —
    /// still armed, so the stop confirmation; nothing armed, so the location
    /// page — the same place that already holds `Recorder`.
    static let controlTapNotification = Notification.Name("RouteActivityDoors.controlTap")
}

/// Tapping the Control (either state) brings the app forward and posts this;
/// it never arms or stops anything itself. The same two-step the owner's own
/// web Stop button goes through via `confirmAndRun` when there is something
/// to stop.
@available(iOS 16.0, *)
struct RouteControlTapIntent: AppIntent {
    static var title: LocalizedStringResource = "routeActivity.control.on"
    static var openAppWhenRun: Bool = true

    @MainActor
    func perform() async throws -> some IntentResult {
        NotificationCenter.default.post(name: RouteActivityDoors.controlTapNotification, object: nil)
        return .result()
    }
}
