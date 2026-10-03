import Foundation
#if canImport(ActivityKit)
import ActivityKit
#endif

#if canImport(ActivityKit)
/// B2733 — the one place that ever calls `Activity.request`/`update`/`end`.
/// `Recorder` builds a plain JSON summary (shared with B2734's widgets,
/// which read it from a timeline provider that cannot share this file's
/// private `ArmedTrip` type) and hands it here to become the typed call
/// ActivityKit actually wants. `RouteActivityAttributes` itself only needs
/// iOS 16.1; this file additionally uses `ActivityContent` (16.2) for the
/// non-deprecated update/end calls, so every entry point is gated on that
/// floor rather than the attributes' own lower one.
@available(iOS 16.2, *)
enum LiveActivityController {
    private static var current: Activity<RouteActivityAttributes>? {
        Activity<RouteActivityAttributes>.activities.first
    }

    private static func contentState(from summary: [String: Any]) -> RouteActivityAttributes.ContentState? {
        guard let state = summary["state"] as? String, let dayNumber = summary["dayNumber"] as? Int else { return nil }
        let iso = ISO8601DateFormatter()
        let lastSentAt = (summary["lastSentAt"] as? String).flatMap { iso.date(from: $0) }
        let recordsUntil = (summary["recordsUntil"] as? String).flatMap { iso.date(from: $0) }
        let tripTitle = summary["tripTitle"] as? String
        return RouteActivityAttributes.ContentState(
            state: state, dayNumber: dayNumber, lastSentAt: lastSentAt, recordsUntil: recordsUntil, tripTitle: tripTitle,
            showsIsland: summary["showsIsland"] as? Bool ?? false
        )
    }

    /// Called from `Recorder.publishSummary` on every state change, from
    /// anywhere (background included — `update()` has no foreground
    /// requirement). Starts a brand-new activity only when `allowStart` says
    /// this call is known to be running while the app is active:
    /// `Activity.request` itself throws from the background, so this never
    /// even tries otherwise, and a trip armed while the app was already
    /// backgrounded simply waits for the next `sceneDidBecomeActive`.
    static func sync(_ summary: [String: Any], allowStart: Bool) {
        guard let state = contentState(from: summary), let tripId = summary["tripId"] as? String else { return }
        let content = ActivityContent(state: state, staleDate: nil)
        if let activity = current {
            Task { await activity.update(content) }
            return
        }
        guard allowStart, ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        do {
            _ = try Activity.request(attributes: RouteActivityAttributes(tripId: tripId), content: content)
        } catch {
            // Nothing to show for this trip — the route page itself still
            // works; a Live Activity is a convenience, not the source of truth.
        }
    }

    /// The trip's own last word — "Route recording stopped" — then iOS's
    /// normal dismissal timing takes over (`.default`: on the Lock Screen a
    /// few hours, or sooner if the owner swipes it away).
    static func end(_ summary: [String: Any]) {
        guard let state = contentState(from: summary) else { endAllImmediately(); return }
        let content = ActivityContent(state: state, staleDate: nil)
        Task {
            for activity in Activity<RouteActivityAttributes>.activities {
                await activity.end(content, dismissalPolicy: .default)
            }
        }
    }

    /// Nothing left to report at all (declined, or a stray activity from a
    /// previous run with no current trip to attribute it to) — dismissed at
    /// once rather than left showing a state nothing backs any more.
    static func endAllImmediately() {
        Task {
            for activity in Activity<RouteActivityAttributes>.activities {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
        }
    }
}
#endif
