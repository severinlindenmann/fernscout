import UIKit
import Capacitor

/// The bridge with the app's own plugins registered — B2175. The storyboard
/// names this class instead of `CAPBridgeViewController` directly.
class ViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(ShareInboxPlugin())
        bridge?.registerPluginInstance(LocationRecorderPlugin())
    }
}
