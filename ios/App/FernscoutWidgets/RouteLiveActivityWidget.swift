import WidgetKit
import SwiftUI
import ActivityKit

/// B2733 — Fernscout's own brand colours (`run-the-ios-app`'s rules file),
/// duplicated here rather than imported: this extension's module cannot see
/// `App`'s own Swift files, and a color constant is cheaper to repeat once
/// than to split into a second shared target just for this.
private enum RouteColor {
    static let cream = Color(red: 0xff / 255, green: 0xfa / 255, blue: 0xf0 / 255)
    static let ink = Color(red: 0x1e / 255, green: 0x29 / 255, blue: 0x3b / 255)
    static let muted = Color(red: 0x5a / 255, green: 0x6a / 255, blue: 0x80 / 255)
    static let yellow = Color(red: 0xff / 255, green: 0xd2 / 255, blue: 0x3f / 255)
    static let inkGround = Color(red: 0x14 / 255, green: 0x1b / 255, blue: 0x24 / 255)
}

/// Whether `state` is one of the two cards the ticket asks for a pale-yellow
/// treatment on — "needs you" states, never "recording" or "ended".
private func needsAttention(_ state: String) -> Bool {
    state == "needsPermission" || state == "sendingRefused"
}

private func headline(_ state: RouteActivityAttributes.ContentState) -> String {
    if let title = state.tripTitle {
        return title
    }
    return String(format: String(localized: "routeActivity.headline", bundle: .main), state.dayNumber)
}

private func needsYouBody(_ state: String) -> String {
    switch state {
    case "needsPermission": return String(localized: "routeActivity.needsPermission.whenInUse", bundle: .main)
    case "sendingRefused": return String(localized: "routeActivity.needsPermission.unauthorized", bundle: .main)
    default: return ""
    }
}

/// B2757 — the app icon's own mark (the extension's `Mark` asset), so the
/// card and the Island say which app they belong to. Kept in colour: the
/// rounded navy tile reads on cream, on ink and on the Island's black.
private func mark(_ size: CGFloat) -> some View {
    Image("Mark")
        .resizable()
        .interpolation(.high)
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: size * 0.22, style: .continuous))
        .accessibilityHidden(true)
}

private func routeURL(_ attrs: RouteActivityAttributes) -> URL? {
    URL(string: "fernscout://route/\(attrs.tripId)")
}

/// The Lock Screen's own card — also what the Dynamic Island's expanded
/// state renders into, SwiftUI's usual Live Activity reuse.
private struct RouteActivityView: View {
    let context: ActivityViewContext<RouteActivityAttributes>
    @Environment(\.colorScheme) private var colorScheme

    /// Dark mode: ink ground, cream text (`run-the-ios-app`'s rules file) —
    /// a needs-you card keeps its pale-yellow tint in both, since that is the
    /// one color doing the work of saying "look at this".
    private var ink: Color { colorScheme == .dark ? RouteColor.cream : RouteColor.ink }
    private var muted: Color { colorScheme == .dark ? RouteColor.cream.opacity(0.7) : RouteColor.muted }
    private var background: Color {
        if needsAttention(context.state.state) { return RouteColor.yellow.opacity(colorScheme == .dark ? 0.5 : 0.35) }
        return colorScheme == .dark ? RouteColor.inkGround : RouteColor.cream
    }

    var body: some View {
        let state = context.state
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                mark(28)
                Text(headline(state))
                    .font(.system(.headline, design: .serif))
                    .foregroundStyle(needsAttention(state.state) ? RouteColor.ink : ink)
                Spacer()
            }
            if state.state == "ended" {
                Text("routeActivity.ended", bundle: .main)
                    .font(.subheadline)
                    .foregroundStyle(muted)
            } else if needsAttention(state.state) {
                // Needs-you cards stay ink-on-yellow regardless of system
                // appearance — the yellow background itself does not invert.
                Text(needsYouBody(state.state))
                    .font(.subheadline)
                    .foregroundStyle(RouteColor.ink)
            } else {
                if let lastSentAt = state.lastSentAt {
                    Text(String(format: String(localized: "routeActivity.lastSent", bundle: .main), lastSentAt.formatted(date: .omitted, time: .shortened)))
                        .font(.subheadline)
                        .foregroundStyle(muted)
                }
                if let recordsUntil = state.recordsUntil {
                    Text(String(format: String(localized: "routeActivity.recordsUntil", bundle: .main), recordsUntil.formatted(date: .abbreviated, time: .omitted)))
                        .font(.caption)
                        .foregroundStyle(muted)
                }
            }
        }
        .padding(16)
        .activityBackgroundTint(background)
        .activitySystemActionForegroundColor(needsAttention(state.state) ? RouteColor.ink : ink)
    }
}

@available(iOS 16.2, *)
struct RouteLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RouteActivityAttributes.self) { context in
            RouteActivityView(context: context)
                .widgetURL(routeURL(context.attributes))
        } dynamicIsland: { context in
            let state = context.state
            // The Island's own background is always near-black, regardless of
            // the system's light/dark setting — these regions lean on
            // `RouteColor.yellow` for the needs-attention accent and the
            // system's own default (light) text otherwise, never the Lock
            // Screen card's dark `ink`, which would be close to invisible here.
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    mark(36)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(String(format: String(localized: "routeActivity.compactDay", bundle: .main), state.dayNumber))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(headline(state))
                            .font(.subheadline.weight(.semibold))
                        if state.state == "ended" {
                            Text("routeActivity.ended", bundle: .main).font(.caption)
                        } else if needsAttention(state.state) {
                            Text(needsYouBody(state.state)).font(.caption)
                        } else {
                            if let lastSentAt = state.lastSentAt {
                                Text(String(format: String(localized: "routeActivity.lastSent", bundle: .main), lastSentAt.formatted(date: .omitted, time: .shortened))).font(.caption)
                            }
                            if let recordsUntil = state.recordsUntil {
                                Text(String(format: String(localized: "routeActivity.recordsUntil", bundle: .main), recordsUntil.formatted(date: .abbreviated, time: .omitted))).font(.caption2)
                            }
                        }
                    }
                }
            } compactLeading: {
                mark(22)
            } compactTrailing: {
                Text(String(format: String(localized: "routeActivity.compactDay", bundle: .main), state.dayNumber))
                    .font(.caption2)
            } minimal: {
                mark(22)
            }
            .widgetURL(routeURL(context.attributes))
        }
    }
}
