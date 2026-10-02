import WidgetKit
import SwiftUI
import AppIntents

/// B2733 — Control Center's own toggle. Reads `Recorder`'s plain
/// "recorder-summary" (the same app-group JSON `RouteLiveActivityWidget`'s
/// timeline does not need, since ActivityKit pushes that one directly) to
/// decide on/off; never arms anything itself — "on" only opens the stop
/// confirmation (`RouteConfirmStopIntent`), "off" only opens the studio's
/// location page (the system's own `OpenURLIntent`, needing no custom type).
@available(iOS 18.0, *)
struct RouteControlWidget: ControlWidget {
    private static let appGroup = "group.ch.fernscout.app"
    private static let summaryKey = "recorder-summary"

    /// `true` for every state but "ended"/absent — the Control is a coarse
    /// on/off, not a second place to read the Lock Screen's own detail.
    private static func isOn() -> Bool {
        guard let defaults = UserDefaults(suiteName: appGroup),
              let data = defaults.data(forKey: summaryKey),
              let summary = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let state = summary["state"] as? String else { return false }
        return state == "recording" || state == "needsPermission" || state == "sendingRefused"
    }

    /// A `ControlWidgetButton`, not `ControlWidgetToggle` — the ticket's own
    /// "never arms" rule means the two states are not a symmetric flip of one
    /// value, only a label change; the one tap always goes through
    /// `RouteControlTapIntent`, which brings the app forward and lets
    /// `AppDelegate` (the one file with both this notification and
    /// `Recorder`) decide whether that means "ask to stop" or "open the
    /// location page" — `ControlWidgetTemplateBuilder` itself refuses an
    /// `if`/`else` that would pick between two different action types here.
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "ch.fernscout.app.widgets.route-control") {
            ControlWidgetButton(action: RouteControlTapIntent()) {
                Label(
                    Self.isOn() ? String(localized: "routeActivity.control.on") : String(localized: "routeActivity.control.off"),
                    systemImage: "point.topleft.down.curvedto.point.filled.bottomright.up"
                )
            }
        }
        .displayName("routeActivity.control.on")
    }
}
