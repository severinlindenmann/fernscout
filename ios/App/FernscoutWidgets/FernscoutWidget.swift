import WidgetKit
import SwiftUI

/// B2734 — this is NOT the Next.js you know, it is the Home Screen / Lock
/// Screen widget: the one way to see the route's state and the "Save to
/// inbox" queue between app launches, with no WebView and no network of its
/// own. Reads exactly the two app-group summaries `Recorder`
/// (`recorder-summary`) and `InboxQueue` (`inbox-queue-summary`) already
/// publish on every state change, plus whether a `ShareCredential` exists —
/// nothing here computes anything the app itself has not already decided.
///
/// Never a trip name or a place, even when the owner's own
/// `lockscreen-trip-name` toggle is on for the Live Activity card: that
/// opt-in is for the Lock Screen while the phone is in the owner's hand; a
/// widget face can be glanced at by anyone nearby, so it stays generic.
private enum FWColor {
    static let cream = Color(red: 0xff / 255, green: 0xfa / 255, blue: 0xf0 / 255)
    static let ink = Color(red: 0x1e / 255, green: 0x29 / 255, blue: 0x3b / 255)
    static let muted = Color(red: 0x5a / 255, green: 0x6a / 255, blue: 0x80 / 255)
    static let yellow = Color(red: 0xff / 255, green: 0xd2 / 255, blue: 0x3f / 255)
    static let inkGround = Color(red: 0x14 / 255, green: 0x1b / 255, blue: 0x24 / 255)
}

struct FernscoutWidgetEntry: TimelineEntry {
    let date: Date
    /// "recording" | "needsPermission" | "sendingRefused" | "ended" | nil —
    /// exactly `Recorder`'s own state, nil when nothing is armed or known.
    let routeState: String?
    let tripId: String?
    let dayNumber: Int?
    let lastSentAt: Date?
    /// `recorder-summary`'s own `updatedAt` — the route line's "as of".
    let routeAsOf: Date?
    let waiting: Int
    /// `inbox-queue-summary`'s own `updatedAt` — the waiting line's "as of".
    let waitingAsOf: Date?
    let hasCredential: Bool

    /// Matches `RouteControlWidget.isOn()` — every state but "ended"/absent.
    var routeOn: Bool {
        routeState == "recording" || routeState == "needsPermission" || routeState == "sendingRefused"
    }
    var needsYou: Bool { routeState == "needsPermission" || routeState == "sendingRefused" }
    /// The ticket's own fallback: route not armed and nothing waiting means
    /// the phone has nothing to say — mark plus (if a credential exists)
    /// "Save to inbox" only, never an empty "Route off" card.
    var nothingToShow: Bool { !routeOn && waiting == 0 }

    static let placeholder = FernscoutWidgetEntry(
        date: Date(), routeState: "recording", tripId: "preview", dayNumber: 4,
        lastSentAt: Date(), routeAsOf: Date(), waiting: 3, waitingAsOf: Date(), hasCredential: true
    )
}

struct FernscoutWidgetProvider: TimelineProvider {
    private static let appGroup = "group.ch.fernscout.app"
    private static let routeKey = "recorder-summary"
    private static let inboxKey = "inbox-queue-summary"
    private static let isoFormatter = ISO8601DateFormatter()

    private func readEntry() -> FernscoutWidgetEntry {
        let defaults = UserDefaults(suiteName: Self.appGroup)

        var routeState: String?
        var tripId: String?
        var dayNumber: Int?
        var lastSentAt: Date?
        var routeAsOf: Date?
        if let data = defaults?.data(forKey: Self.routeKey),
           let summary = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            routeState = summary["state"] as? String
            tripId = summary["tripId"] as? String
            dayNumber = summary["dayNumber"] as? Int
            if let s = summary["lastSentAt"] as? String { lastSentAt = Self.isoFormatter.date(from: s) }
            if let s = summary["updatedAt"] as? String { routeAsOf = Self.isoFormatter.date(from: s) }
        }

        var waiting = 0
        var waitingAsOf: Date?
        if let data = defaults?.data(forKey: Self.inboxKey),
           let summary = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            waiting = summary["waiting"] as? Int ?? 0
            if let s = summary["updatedAt"] as? String { waitingAsOf = Self.isoFormatter.date(from: s) }
        }

        return FernscoutWidgetEntry(
            date: Date(), routeState: routeState, tripId: tripId, dayNumber: dayNumber,
            lastSentAt: lastSentAt, routeAsOf: routeAsOf, waiting: waiting, waitingAsOf: waitingAsOf,
            hasCredential: ShareCredentialStore.load() != nil
        )
    }

    func placeholder(in context: Context) -> FernscoutWidgetEntry { .placeholder }

    func getSnapshot(in context: Context, completion: @escaping (FernscoutWidgetEntry) -> Void) {
        completion(context.isPreview ? .placeholder : readEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<FernscoutWidgetEntry>) -> Void) {
        // `Recorder` and `InboxQueue` already reload every timeline on their
        // own state changes; this 30-minute refresh only covers the "as of"
        // line going stale while nothing has actually changed.
        let next = Date().addingTimeInterval(30 * 60)
        completion(Timeline(entries: [readEntry()], policy: .after(next)))
    }
}

private func dayText(_ n: Int) -> String { String(format: String(localized: "widget.day"), n) }
private func asOfText(_ d: Date) -> String { String(format: String(localized: "widget.asOf"), d.formatted(date: .omitted, time: .shortened)) }
private func sentShortText(_ d: Date) -> String { String(format: String(localized: "widget.sentShort"), d.formatted(date: .omitted, time: .shortened)) }
private func waitingLongText(_ n: Int) -> String { String(format: String(localized: "saveToInbox.photosWaiting"), n) }
private func waitingShortText(_ n: Int) -> String { String(format: String(localized: "widget.waitingShort"), n) }

/// The small card's own content — also the medium widget's left column.
private struct RouteStatusColumn: View {
    let entry: FernscoutWidgetEntry
    @Environment(\.colorScheme) private var colorScheme
    private var ink: Color { colorScheme == .dark ? FWColor.cream : FWColor.ink }
    private var muted: Color { colorScheme == .dark ? FWColor.cream.opacity(0.7) : FWColor.muted }

    var body: some View {
        if entry.nothingToShow {
            Image("Mark").resizable().scaledToFit().frame(width: 26, height: 26).opacity(0.6)
        } else {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Circle()
                        .fill(entry.needsYou ? FWColor.yellow : (entry.routeOn ? Color.green : muted))
                        .frame(width: 8, height: 8)
                    Text(entry.routeOn ? "routeActivity.control.on" : "routeActivity.control.off")
                        .font(.caption)
                        .foregroundStyle(muted)
                }
                if let day = entry.dayNumber {
                    Text(dayText(day))
                        .font(.system(.title2, design: .serif))
                        .foregroundStyle(ink)
                }
                if entry.needsYou {
                    Text("widget.needsYou").font(.caption2).foregroundStyle(ink)
                } else if let asOf = entry.routeAsOf {
                    Text(asOfText(asOf)).font(.caption2).foregroundStyle(muted)
                }
            }
        }
    }
}

private struct SmallWidgetView: View {
    let entry: FernscoutWidgetEntry
    var body: some View {
        RouteStatusColumn(entry: entry)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

private struct MediumWidgetView: View {
    let entry: FernscoutWidgetEntry
    @Environment(\.colorScheme) private var colorScheme
    private var muted: Color { colorScheme == .dark ? FWColor.cream.opacity(0.7) : FWColor.muted }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            RouteStatusColumn(entry: entry)
                .frame(maxWidth: .infinity, alignment: .topLeading)
            VStack(alignment: .trailing, spacing: 6) {
                if entry.waiting > 0 {
                    VStack(alignment: .trailing, spacing: 1) {
                        Text(waitingLongText(entry.waiting)).font(.caption).foregroundStyle(muted)
                        if let asOf = entry.waitingAsOf {
                            Text(asOfText(asOf)).font(.caption2).foregroundStyle(muted)
                        }
                    }
                }
                Spacer(minLength: 0)
                if entry.hasCredential {
                    Link(destination: URL(string: "fernscout://save")!) {
                        Text("saveToInbox.title")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(FWColor.ink)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(FWColor.yellow, in: Capsule())
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
        }
    }
}

private struct CircularAccessoryView: View {
    let entry: FernscoutWidgetEntry
    var body: some View {
        if entry.routeOn, let day = entry.dayNumber {
            VStack(spacing: 2) {
                Image(systemName: "point.topleft.down.curvedto.point.filled.bottomright.up")
                Text("\(day)").font(.caption2.weight(.semibold))
            }
        } else if entry.hasCredential {
            // Nothing armed — the circle opens "Save to inbox" instead
            // (`widgetURL` below), same as the container's own tap rule.
            Image(systemName: "plus")
        } else {
            Image("Mark").resizable().scaledToFit().padding(4)
        }
    }
}

private struct RectangularAccessoryView: View {
    let entry: FernscoutWidgetEntry
    var body: some View {
        Text(compactLine).font(.caption)
    }
    private var compactLine: String {
        var parts = [String(localized: entry.routeOn ? "routeActivity.control.on" : "routeActivity.control.off")]
        if let last = entry.lastSentAt { parts.append(sentShortText(last)) }
        if entry.waiting > 0 { parts.append(waitingShortText(entry.waiting)) }
        return parts.joined(separator: " · ")
    }
}

private struct InlineAccessoryView: View {
    let entry: FernscoutWidgetEntry
    var body: some View {
        if entry.routeOn, let day = entry.dayNumber {
            Text("\(String(localized: "routeActivity.control.on")) · \(dayText(day))")
        } else {
            Text(entry.routeOn ? "routeActivity.control.on" : "routeActivity.control.off")
        }
    }
}

struct FernscoutWidgetView: View {
    @Environment(\.widgetFamily) private var family
    @Environment(\.colorScheme) private var colorScheme
    let entry: FernscoutWidgetEntry

    var body: some View {
        content
            // "Widget tap elsewhere → the route page when armed, else opens
            // the app" — the Lock Screen accessories and the medium's own
            // "Save to inbox" button override this per-region with their own
            // `widgetURL`/`Link`.
            .widgetURL(containerURL)
            .containerBackground(for: .widget) { background }
    }

    @ViewBuilder private var content: some View {
        switch family {
        case .systemMedium: MediumWidgetView(entry: entry)
        case .accessoryCircular: CircularAccessoryView(entry: entry)
        case .accessoryRectangular: RectangularAccessoryView(entry: entry)
        case .accessoryInline: InlineAccessoryView(entry: entry)
        default: SmallWidgetView(entry: entry)
        }
    }

    /// Armed → that trip's route page. Nothing armed but the circle wants to
    /// open "Save to inbox" → handled by the circle's own case below so this
    /// stays `nil` and the system opens the app instead.
    private var containerURL: URL? {
        if entry.routeOn, let tripId = entry.tripId {
            return URL(string: "fernscout://route/\(tripId)")
        }
        if family == .accessoryCircular, !entry.routeOn, entry.hasCredential {
            return URL(string: "fernscout://save")
        }
        return nil
    }

    /// Accessory families render through the system's own vibrant
    /// materials — a custom tint would fight that, so only the Home Screen
    /// families get the brand's cream/ink-ground treatment.
    @ViewBuilder private var background: some View {
        switch family {
        case .accessoryCircular, .accessoryRectangular, .accessoryInline:
            Color.clear
        default:
            if entry.needsYou {
                FWColor.yellow.opacity(colorScheme == .dark ? 0.5 : 0.35)
            } else {
                colorScheme == .dark ? FWColor.inkGround : FWColor.cream
            }
        }
    }
}

struct FernscoutWidget: Widget {
    static let kind = "ch.fernscout.app.widgets.fernscout"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: FernscoutWidgetProvider()) { entry in
            FernscoutWidgetView(entry: entry)
        }
        .configurationDisplayName("Fernscout")
        .description("widget.description")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}
