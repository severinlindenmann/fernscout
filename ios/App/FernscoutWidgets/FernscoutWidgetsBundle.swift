import WidgetKit
import SwiftUI

/// B2733 — the one `@main` for the `FernscoutWidgets` extension, home of the
/// route recorder's Live Activity and Control. A `WidgetBundle` rather than a
/// single `Widget` on purpose: more than one of these kinds coexist in one
/// extension — B2734's own `FernscoutWidget` (the Home Screen and Lock
/// Screen widget, iOS 17+ same as this extension's deployment target, so no
/// `#available` guard needed) joined it below.
@main
struct FernscoutWidgetsBundle: WidgetBundle {
    var body: some Widget {
        if #available(iOS 16.2, *) {
            RouteLiveActivityWidget()
        }
        if #available(iOS 18.0, *) {
            RouteControlWidget()
        }
        FernscoutWidget()
    }
}
