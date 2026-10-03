import Foundation
#if canImport(ActivityKit)
import ActivityKit
#endif

/// B2733 — the Live Activity's own shape, compiled into both `App` (which
/// starts/updates/ends it from `Recorder`) and `FernscoutWidgets` (which
/// draws it). `ActivityAttributes` itself carries nothing that changes
/// per-update — everything live lives in `ContentState` below, the only part
/// `LiveActivityController.update` ever sends again.
///
/// Never a place, a coordinate or a map — the Lock Screen is visible to
/// anyone holding the phone, and GPS positions stay off it entirely (see
/// `AGENTS.md`'s GPS rules). `tripTitle` is the one piece of trip identity
/// allowed here, and only once the owner opts in (`lockscreen-trip-name` in
/// the app-group defaults, default off) — `nil` otherwise, never a guess.
#if canImport(ActivityKit)
@available(iOS 16.1, *)
struct RouteActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        /// "recording" | "needsPermission" | "sendingRefused" | "ended" —
        /// exactly `Recorder`'s own state, never a richer guess ("standing
        /// still" does not exist: `Recorder` cannot tell it apart from "about
        /// to lose signal").
        var state: String
        /// Days since the trip's own `start`, by the device's calendar —
        /// `Calendar.current` day-count from local midnight on `start` to
        /// local midnight today, plus one, so the trip's first day reads "Day
        /// 1". Computed once when the summary is built, not refreshed
        /// in-widget — a Live Activity that outlives local midnight stays on
        /// the day it was last updated until the next update ticks it over,
        /// which `Recorder`'s own 30-minute upload cadence does in practice.
        var dayNumber: Int
        /// `nil` whenever more than one trip is armed at once (B2542's own
        /// `lastUpload` is shared across all of them, so attributing it to
        /// just this trip would be a guess) — see `Recorder.publishSummary`.
        var lastSentAt: Date?
        /// D2's own cooldown end for this trip, or `nil` when it is
        /// open-ended (D3) — there is no ceiling to show.
        var recordsUntil: Date?
        /// Only set when the owner's own toggle is on; absent, not empty,
        /// otherwise.
        var tripTitle: String?
        /// B2766 — the owner's "Show in the Dynamic Island" switch (default
        /// off). iOS always gives a running activity the Island; off draws
        /// every Island region empty, leaving only the system's own pill.
        /// Optional so a state encoded without it decodes as off.
        var showsIsland: Bool?
    }

    /// Nothing fixed per-activity beyond the trip id — everything else
    /// changes over the activity's life and lives in `ContentState`.
    var tripId: String
}
#endif
