import Network
import SwiftUI
import WebKit

/// B2731 — which screen `ViewController` lays over the WebView. Both name
/// the real host; neither ever says "the server is down" — a restart or a
/// move look the same from here as a real outage.
enum ConnectionTroubleKind: Equatable {
    case noInternet
    case cantReachServer
}

/// NSURLErrorDomain codes that mean a real network failure happened — never
/// `NSURLErrorCancelled` (-999), which fires on every ordinary navigation
/// that interrupts one already in flight, and never anything from another
/// domain (an HTTP error page the server itself returned is not this).
private let networkFailureCodes: Set<Int> = [
    NSURLErrorTimedOut,
    NSURLErrorCannotFindHost,
    NSURLErrorCannotConnectToHost,
    NSURLErrorNetworkConnectionLost,
    NSURLErrorDNSLookupFailed,
    NSURLErrorNotConnectedToInternet,
    NSURLErrorInternationalRoamingOff,
    NSURLErrorDataNotAllowed,
]

/// Sits in front of the WebView's real `WebViewDelegationHandler` (reached
/// via `webView.navigationDelegate`, since `CAPBridgeViewController` keeps
/// its own `CapacitorBridge` — and `webViewDelegationHandler` on it — private
/// to the class). Capacitor builds that instance itself, inside
/// `CAPBridgeViewController.loadView()`, so subclassing it would only give us
/// a second, unwired instance. Composing in front of it and forwarding
/// everything we do not care about is the only way to add this hook without
/// forking `node_modules`:
/// `responds(to:)` / `forwardingTarget(for:)` is plain Objective-C message
/// forwarding, so every `WKNavigationDelegate` method below that we do not
/// implement still reaches the original handler exactly as before (plugin
/// `shouldOverrideLoad`, the bridge reset on each navigation, and so on).
final class NetworkFailureObserver: NSObject, WKNavigationDelegate {
    private weak var inner: WKNavigationDelegate?
    private let isOffline: () -> Bool
    private let onSuccess: () -> Void
    private let onFailure: (ConnectionTroubleKind) -> Void

    private let interceptedSelectors: Set<Selector> = [
        #selector(webView(_:didFinish:)),
        #selector(webView(_:didFailProvisionalNavigation:withError:)),
        #selector(webView(_:didFail:withError:)),
    ]

    init(
        inner: WKNavigationDelegate,
        isOffline: @escaping () -> Bool,
        onSuccess: @escaping () -> Void,
        onFailure: @escaping (ConnectionTroubleKind) -> Void
    ) {
        self.inner = inner
        self.isOffline = isOffline
        self.onSuccess = onSuccess
        self.onFailure = onFailure
    }

    override func responds(to aSelector: Selector!) -> Bool {
        interceptedSelectors.contains(aSelector) || (inner?.responds(to: aSelector) ?? false)
    }

    override func forwardingTarget(for aSelector: Selector!) -> Any? {
        interceptedSelectors.contains(aSelector) ? nil : inner
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        onSuccess()
        inner?.webView?(webView, didFinish: navigation)
    }

    // The force unwrap matches the protocol declaration.
    // swiftlint:disable:next implicitly_unwrapped_optional
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        handle(error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        handle(error)
    }

    /// Never forwarded to `inner` on a network failure: its own `didFail`
    /// would load `bridge.config.errorPathURL`, which this build leaves
    /// unconfigured, so skipping it loses nothing and keeps one screen in
    /// charge of a failed load rather than two.
    private func handle(_ error: Error) {
        let nsError = error as NSError
        guard nsError.domain == NSURLErrorDomain, networkFailureCodes.contains(nsError.code) else { return }
        if nsError.code == NSURLErrorNotConnectedToInternet || isOffline() {
            onFailure(.noInternet)
        } else {
            onFailure(.cantReachServer)
        }
    }
}

/// The SwiftUI screen itself — laid over the WebView by `ViewController` via
/// `UIHostingController`. Brand colours per the run's brief rather than the
/// web app's own CSS tokens, since no stylesheet is reachable here.
struct ConnectionTroubleView: View {
    let kind: ConnectionTroubleKind
    /// The server this screen could not reach — `ViewController`'s own
    /// configured host, read once when the observer was wired up.
    let host: String
    let recordingArmed: Bool
    let customServerChosen: Bool
    let defaultServerHost: String
    let onTryAgain: () -> Void
    let onOpenDefaultServer: () -> Void

    @Environment(\.colorScheme) private var colorScheme

    private var cream: Color { Color(red: 0xff / 255, green: 0xfa / 255, blue: 0xf0 / 255) }
    private var inkGround: Color { Color(red: 0x14 / 255, green: 0x1b / 255, blue: 0x24 / 255) }
    private var ink: Color { Color(red: 0x1e / 255, green: 0x29 / 255, blue: 0x3b / 255) }
    /// #5a6a80 on cream; #9aa8bb on the ink ground — #5a6a80 there is only
    /// ~3:1, under the 4.5:1 body text needs.
    private var muted: Color {
        colorScheme == .dark
            ? Color(red: 0x9a / 255, green: 0xa8 / 255, blue: 0xbb / 255)
            : Color(red: 0x5a / 255, green: 0x6a / 255, blue: 0x80 / 255)
    }
    private var yellow: Color { Color(red: 0xff / 255, green: 0xd2 / 255, blue: 0x3f / 255) }

    private var background: Color { colorScheme == .dark ? inkGround : cream }
    private var textPrimary: Color { colorScheme == .dark ? cream : ink }

    private var title: String {
        switch kind {
        case .noInternet: return String(localized: "connectionTrouble.noInternet.title")
        case .cantReachServer: return String(localized: "connectionTrouble.cantReach.title")
        }
    }

    private var body_: String {
        switch kind {
        case .noInternet: return String(format: String(localized: "connectionTrouble.noInternet.body"), host)
        case .cantReachServer: return String(format: String(localized: "connectionTrouble.cantReach.body"), host)
        }
    }

    var body: some View {
        ZStack {
            background.ignoresSafeArea()
            VStack(spacing: 20) {
                Spacer()
                Text(title)
                    .font(.system(.title, design: .serif))
                    .foregroundColor(textPrimary)
                    .multilineTextAlignment(.center)
                Text(body_)
                    .font(.body)
                    .foregroundColor(muted)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
                if recordingArmed {
                    Label(String(localized: "connectionTrouble.recordingOn"), systemImage: "location.fill")
                        .font(.footnote)
                        .foregroundColor(muted)
                }
                Button(action: onTryAgain) {
                    Text(String(localized: "connectionTrouble.tryAgain"))
                        .font(.headline)
                        .foregroundColor(ink)
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .background(yellow)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .padding(.horizontal, 32)
                if customServerChosen {
                    VStack(spacing: 6) {
                        Button(action: onOpenDefaultServer) {
                            Text(String(format: String(localized: "connectionTrouble.openDefault"), defaultServerHost))
                                .font(.subheadline.weight(.semibold))
                                .foregroundColor(textPrimary)
                                .frame(minHeight: 44)
                        }
                        Text(String(format: String(localized: "connectionTrouble.openDefaultCaption"), defaultServerHost))
                            .font(.caption)
                            .foregroundColor(muted)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 48)
                    }
                }
                Spacer()
            }
        }
    }
}
