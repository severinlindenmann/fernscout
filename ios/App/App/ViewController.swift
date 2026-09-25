import UIKit
import Capacitor

/// The bridge with the app's own plugins registered — B2175. The storyboard
/// names this class instead of `CAPBridgeViewController` directly.
class ViewController: CAPBridgeViewController {
    /// The server this build names in `capacitor.config.json`, before any
    /// choice of the owner's replaced it — what `ServerChoice.reset` goes
    /// back to.
    private(set) static var defaultServerURL: String?
    private var checkedChosenServer = false

    /// Bring your own server: the owner's chosen address, when there is one,
    /// replaces the build's before the bridge reads it, so the WebView, the
    /// navigation rules and every `appStartServerURL` check agree on it.
    override open func instanceDescriptor() -> InstanceDescriptor {
        let descriptor = super.instanceDescriptor()
        if Self.defaultServerURL == nil { Self.defaultServerURL = descriptor.serverURL }
        if let chosen = ServerChoiceStore.chosen { descriptor.serverURL = chosen }
        return descriptor
    }

    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(ShareInboxPlugin())
        bridge?.registerPluginInstance(LocationRecorderPlugin())
        bridge?.registerPluginInstance(ServerChoicePlugin())
        // B2324 — WKWebView ships this off; every iPhone user reaches for
        // the left-edge swipe back regardless, and it works against Next's
        // own pushState history the same as any other back-forward move.
        webView?.allowsBackForwardNavigationGestures = true
    }

    override open func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !checkedChosenServer else { return }
        checkedChosenServer = true
        ServerChoicePlugin.checkChosenServerAnswers { [weak self] in
            guard let url = self?.bridge?.config.appStartServerURL else { return }
            self?.webView?.load(URLRequest(url: url))
        }
    }
}
