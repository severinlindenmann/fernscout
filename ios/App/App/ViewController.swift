import UIKit
import Capacitor

/// The bridge with the app's own plugins registered — B2175. The storyboard
/// names this class instead of `CAPBridgeViewController` directly.
class ViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(ShareInboxPlugin())
        bridge?.registerPluginInstance(LocationRecorderPlugin())
        // B2324 — WKWebView ships this off; every iPhone user reaches for
        // the left-edge swipe back regardless, and it works against Next's
        // own pushState history the same as any other back-forward move.
        webView?.allowsBackForwardNavigationGestures = true
    }
}
