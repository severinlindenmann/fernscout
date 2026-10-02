import WidgetKit
import SwiftUI

/// B2733 — the one `@main` for the `FernscoutWidgets` extension, home of the
/// route recorder's Live Activity and Control. A `WidgetBundle` rather than a
/// single `Widget` on purpose: B2734 adds ordinary home-screen widgets to
/// this same bundle later, and a bundle is how more than one of any of these
/// kinds ever coexist in one extension.
@main
struct FernscoutWidgetsBundle: WidgetBundle {
    var body: some Widget {
        if #available(iOS 16.2, *) {
            RouteLiveActivityWidget()
        }
        if #available(iOS 18.0, *) {
            RouteControlWidget()
        }
    }
}
