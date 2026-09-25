import UIKit
import Capacitor
import WebKit

/// The bridge with the app's own plugins registered — B2175. The storyboard
/// names this class instead of `CAPBridgeViewController` directly.
class ViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(ShareInboxPlugin())
        bridge?.registerPluginInstance(LocationRecorderPlugin())
        exposeAppVersion()
    }

    /// `window.FernscoutApp = { version, build }` on every page, before any
    /// page script runs, so `/me` can say which app is running
    /// (`nativeAppVersion` in components/nativeShell.ts). Serialised with
    /// JSONSerialization rather than interpolated, so nothing in the plist
    /// can break out of the literal.
    private func exposeAppVersion() {
        let info = Bundle.main.infoDictionary ?? [:]
        let values: [String: String] = [
            "version": info["CFBundleShortVersionString"] as? String ?? "",
            "build": info["CFBundleVersion"] as? String ?? "",
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: values),
              let json = String(data: data, encoding: .utf8) else { return }
        let script = WKUserScript(
            source: "window.FernscoutApp = Object.freeze(\(json));",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        webView?.configuration.userContentController.addUserScript(script)
    }
}
