import Foundation
import Capacitor
import UIKit
import WebKit

/// A Stripe Checkout Session, opened inside the app rather than handed to
/// Safari — B2657.
///
/// Safari is a separate app with its own cookie jar. Paying for a postcard
/// or a photobook used to open Checkout there, and when Stripe redirected
/// back to this site's own success/cancel page, Safari showed it signed
/// out — the owner's session cookie lives in the Capacitor WebView's own
/// store, never Safari's — and the studio tab that had opened the
/// checkout, one app-switch behind it, never learned the checkout had
/// finished at all.
///
/// This is a plain modal sheet around a `WKWebView` rather than an
/// `SFSafariViewController`, for one reason: `WKWebViewConfiguration
/// .websiteDataStore` can be set to `.default()`, the same store Capacitor's
/// own bridge WebView already uses (`CAPBridgeViewController` does this by
/// default), so the owner's session cookie is already there the instant
/// Stripe redirects back — same site, same jar. `SFSafariViewController`
/// shares Safari's own, separate jar and cannot be pointed at this app's
/// instead, which is exactly the bug this plugin exists to avoid repeating.
///
/// A plain `WKNavigationDelegate` is also what makes "closes itself when
/// the checkout is done" possible at all without a custom URL scheme or an
/// `Info.plist`/Associated-Domains change: every navigation the sheet makes
/// passes through `decidePolicyFor`, so watching for the return URL is a
/// string comparison, not a redirect dance.
@objc(InAppCheckoutPlugin)
public class InAppCheckoutPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "InAppCheckoutPlugin"
    public let jsName = "InAppCheckout"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise)
    ]

    @objc func open(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"), let url = URL(string: urlString) else {
            call.reject("a checkout url is required")
            return
        }
        // Never empty in practice (every caller passes its own origin), but
        // an empty prefix would match everything on the very first
        // navigation and close the sheet before Stripe had shown anything —
        // refused outright rather than silently doing that.
        guard let returnPrefix = call.getString("returnPrefix"), !returnPrefix.isEmpty else {
            call.reject("a returnPrefix is required")
            return
        }

        DispatchQueue.main.async { [weak self] in
            guard let presenter = self?.bridge?.viewController else {
                call.reject("no view to present the checkout sheet from")
                return
            }
            let sheet = InAppCheckoutViewController(url: url, returnPrefix: returnPrefix) { finalUrl in
                call.resolve(["url": finalUrl?.absoluteString ?? ""])
            }
            let nav = UINavigationController(rootViewController: sheet)
            nav.modalPresentationStyle = .pageSheet
            presenter.present(nav, animated: true)
        }
    }
}

/// The sheet itself: a `WKWebView`, a title, and a Cancel button — nothing
/// Stripe's own Checkout page does not already supply (its own back arrow,
/// its own "powered by Stripe" footer).
private class InAppCheckoutViewController: UIViewController, WKNavigationDelegate {
    private let startUrl: URL
    private let returnPrefix: String
    private let onReturn: (URL?) -> Void
    private var webView: WKWebView!
    private var resolved = false

    init(url: URL, returnPrefix: String, onReturn: @escaping (URL?) -> Void) {
        self.startUrl = url
        self.returnPrefix = returnPrefix
        self.onReturn = onReturn
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        navigationItem.leftBarButtonItem = UIBarButtonItem(
            barButtonSystemItem: .cancel, target: self, action: #selector(cancelTapped)
        )

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        webView = WKWebView(frame: view.bounds, configuration: config)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.navigationDelegate = self
        view.addSubview(webView)
        view.backgroundColor = .systemBackground
        webView.load(URLRequest(url: startUrl))
    }

    @objc private func cancelTapped() {
        finish(with: nil)
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        if let url = navigationAction.request.url, url.absoluteString.hasPrefix(returnPrefix) {
            decisionHandler(.cancel)
            finish(with: url)
            return
        }
        decisionHandler(.allow)
    }

    /// Resolves exactly once — a navigation matching `returnPrefix` and a
    /// manual Cancel tap are two different ways to get here, and the
    /// dismiss animation gives either one a moment to race the other.
    private func finish(with url: URL?) {
        guard !resolved else { return }
        resolved = true
        onReturn(url)
        // Called on `self`, not on the `UINavigationController` it is
        // wrapped in — UIKit forwards a dismiss from anywhere in a
        // presented stack to whoever actually presented it.
        dismiss(animated: true)
    }
}
