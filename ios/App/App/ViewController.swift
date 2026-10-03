import UIKit
import Capacitor
import Network
import SwiftUI
import WebKit

/// The bridge with the app's own plugins registered — B2175. The storyboard
/// names this class instead of `CAPBridgeViewController` directly.
class ViewController: CAPBridgeViewController {
    /// The server this build names in `capacitor.config.json`, before any
    /// choice of the owner's replaced it — what `ServerChoice.reset` goes
    /// back to.
    private(set) static var defaultServerURL: String?

    /// Held strongly because `WKWebView.navigationDelegate` is `weak` —
    /// without this the observer would be deallocated the instant
    /// `capacitorDidLoad()` returns.
    private var navigationFailureObserver: NetworkFailureObserver?
    private var pathMonitor: NWPathMonitor?
    private var pathSatisfied = true
    private var troubleHost: UIHostingController<ConnectionTroubleView>?
    private var trouble: ConnectionTroubleKind?
    /// B2732 — the quick action / App Shortcut notification observer, held
    /// strongly for the controller's lifetime (there is only ever one).
    private var saveToInboxObserver: NSObjectProtocol?

    /// `-FernscoutForceOffline` — compiled out of Release — lets a Simulator
    /// run exercise the "No internet" screen without an airplane-mode
    /// toggle or a Link Conditioner profile.
    #if DEBUG
    private lazy var forcedOffline = ProcessInfo.processInfo.arguments.contains("-FernscoutForceOffline")
    #endif

    private var isOffline: Bool {
        #if DEBUG
        if forcedOffline { return true }
        #endif
        return !pathSatisfied
    }

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
        answerBridgeConfigWithoutPrompt()
        bridge?.registerPluginInstance(ShareInboxPlugin())
        bridge?.registerPluginInstance(LocationRecorderPlugin())
        bridge?.registerPluginInstance(ServerChoicePlugin())
        bridge?.registerPluginInstance(MediaUploadPlugin())
        bridge?.registerPluginInstance(InAppCheckoutPlugin())
        // B2655 — never registered, so no in-app purchase could ever start.
        if #available(iOS 15.0, *) {
            bridge?.registerPluginInstance(AppleIAPPlugin())
        }
        // B2324 — WKWebView ships this off; every iPhone user reaches for
        // the left-edge swipe back regardless, and it works against Next's
        // own pushState history the same as any other back-forward move.
        webView?.allowsBackForwardNavigationGestures = true
        exposeAppVersion()
        observeNetworkFailures()
        observeSaveToInbox()
    }

    // MARK: B2732 — Save to inbox

    private func observeSaveToInbox() {
        saveToInboxObserver = NotificationCenter.default.addObserver(
            forName: SaveToInboxDoors.showSheetNotification, object: nil, queue: .main
        ) { [weak self] _ in self?.presentSaveToInbox() }
    }

    /// Absent with no `ShareCredential` — the same rule as the quick action
    /// and the App Shortcut (`SaveToInboxDoors.syncQuickAction`), so a tap
    /// that somehow still reaches here (a stale Spotlight/Siri entry) does
    /// nothing rather than crash on a missing credential.
    func presentSaveToInbox() {
        guard let credential = ShareCredentialStore.load() else { return }
        let view = SaveToInboxView(
            credential: credential,
            onOpenStudioInbox: { [weak self] in self?.openStudioInbox() },
            onDismiss: { [weak self] in self?.presentedInboxSheet?.dismiss(animated: true) }
        )
        let host = UIHostingController(rootView: view)
        presentedInboxSheet = host
        present(host, animated: true)
    }

    private var presentedInboxSheet: UIViewController?

    private func openStudioInbox() {
        guard let credential = ShareCredentialStore.load(),
              let url = URL(string: "\(credential.base)/@\(credential.user)/studio/inbox") else { return }
        presentedInboxSheet?.dismiss(animated: true) { [weak self] in
            self?.webView?.load(URLRequest(url: url))
        }
    }

    /// B2731 — a failed main-frame load (no connection, or the chosen server
    /// not answering) used to leave a blank WebView. The bridge's own
    /// `WebViewDelegationHandler` is already `webView.navigationDelegate` by
    /// the time `capacitorDidLoad()` runs (set in `prepareWebView`, called
    /// earlier in `loadView()`); `capacitorBridge` itself is private to
    /// `CAPBridgeViewController`, so reading it back off the public,
    /// `fileprivate(set)` `webView` is the only way to reach it without
    /// forking Capacitor in `node_modules`. Composing in front of it (see
    /// `NetworkFailureObserver`) is the hook this gives us.
    private func observeNetworkFailures() {
        guard let original = webView?.navigationDelegate else { return }
        let monitor = NWPathMonitor()
        monitor.pathUpdateHandler = { [weak self] path in
            DispatchQueue.main.async {
                self?.pathSatisfied = path.status == .satisfied
                self?.retryIfPathSatisfied()
                // B2732 — the queue's other retry point beside launch and
                // becoming active.
                if path.status == .satisfied { InboxQueue.shared.sendAll() }
            }
        }
        monitor.start(queue: .global(qos: .utility))
        pathMonitor = monitor

        let observer = NetworkFailureObserver(
            inner: original,
            isOffline: { [weak self] in self?.isOffline ?? false },
            onSuccess: { [weak self] in self?.dismissTrouble() },
            onFailure: { [weak self] kind in self?.presentTrouble(kind) }
        )
        navigationFailureObserver = observer
        webView?.navigationDelegate = observer
    }

    private func retryIfPathSatisfied() {
        guard trouble != nil, pathSatisfied else { return }
        tryAgain()
    }

    private func tryAgain() {
        guard let url = bridge?.config.appStartServerURL else { return }
        webView?.load(URLRequest(url: url))
    }

    private func presentTrouble(_ kind: ConnectionTroubleKind) {
        trouble = kind
        let view = ConnectionTroubleView(
            kind: kind,
            host: bridge?.config.serverURL.host ?? "",
            recordingArmed: !Recorder.shared.armedTripIds().armed.isEmpty,
            customServerChosen: ServerChoiceStore.chosen != nil,
            defaultServerHost: Self.defaultServerURL.flatMap { URL(string: $0)?.host } ?? "",
            // B2732 — only shown with a stored credential, same rule as the
            // quick action and the App Shortcut.
            hasShareCredential: ShareCredentialStore.load() != nil,
            photosWaiting: InboxQueue.shared.waitingCount,
            onTryAgain: { [weak self] in self?.tryAgain() },
            onOpenDefaultServer: { ServerChoicePlugin.switchServer(to: nil) },
            onSaveToInbox: { [weak self] in self?.presentSaveToInbox() }
        )
        if let host = troubleHost {
            host.rootView = view
            return
        }
        // `self.view` *is* the WebView (`loadView()` sets `view = webView` and
        // is `final`, so there is no separate container to lay this over) —
        // laid on top as a proper child view controller, the standard
        // `UIHostingController` containment dance.
        let host = UIHostingController(rootView: view)
        host.view.backgroundColor = .clear
        addChild(host)
        host.view.translatesAutoresizingMaskIntoConstraints = false
        self.view.addSubview(host.view)
        NSLayoutConstraint.activate([
            host.view.topAnchor.constraint(equalTo: self.view.topAnchor),
            host.view.bottomAnchor.constraint(equalTo: self.view.bottomAnchor),
            host.view.leadingAnchor.constraint(equalTo: self.view.leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: self.view.trailingAnchor),
        ])
        host.didMove(toParent: self)
        troubleHost = host
    }

    private func dismissTrouble() {
        guard trouble != nil else { return }
        trouble = nil
        troubleHost?.willMove(toParent: nil)
        troubleHost?.view.removeFromSuperview()
        troubleHost?.removeFromParent()
        troubleHost = nil
    }

    /// B2820 — a blank cream screen on launch. Capacitor's `native-bridge.js`
    /// (a document-start user script) asks native twice, synchronously, with
    /// `prompt()` whether CapacitorCookies and CapacitorHttp are on. On iOS
    /// 27 and 18.3 that sync IPC is sometimes never dispatched by the UI
    /// process (`WebPageProxy::runJavaScriptPrompt` is never reached), so the
    /// WebContent process waits forever inside `injectUserScripts`, before
    /// the parser has built `<html>` — nothing is ever painted, no navigation
    /// fails, and the trouble screen has nothing to react to. Both answers
    /// are fixed by `capacitor.config.json` before any page loads, so this
    /// script, run *before* the bridge's own, answers those two in the page
    /// and every other `prompt()` goes to WebKit as before. Inserted first by
    /// re-adding the bridge's scripts after it, since user scripts run in the
    /// order they were added.
    private func answerBridgeConfigWithoutPrompt() {
        guard let controller = webView?.configuration.userContentController,
              let config = bridge?.config else { return }
        let answers: [String: String] = [
            "CapacitorCookies.isEnabled": String(config.getPluginConfig("CapacitorCookies").getBoolean("enabled", false)),
            "CapacitorHttp": String(config.getPluginConfig("CapacitorHttp").getBoolean("enabled", false)),
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: answers),
              let json = String(data: data, encoding: .utf8) else { return }
        let source = """
        (function () {
          var answers = \(json), nativePrompt = window.prompt;
          window.prompt = function (message) {
            try {
              var type = JSON.parse(message).type;
              if (Object.prototype.hasOwnProperty.call(answers, type)) return answers[type];
            } catch (e) {}
            return nativePrompt.apply(this, arguments);
          };
        })();
        """
        // `userScripts` is WebKit's live list, not a snapshot: copy it out
        // before clearing, or re-adding walks a list that keeps growing.
        let existing = controller.userScripts.map { $0 }
        controller.removeAllUserScripts()
        controller.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        existing.forEach(controller.addUserScript)
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
