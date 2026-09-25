import Foundation
import Capacitor
import UIKit

/// Which Fernscout the app opens — bring your own server.
///
/// The shell loads its pages from one site (`capacitor.config.ts`), and a
/// self-hoster used to have to build their own app to point it at their own
/// instance. This keeps the one chosen address in the app's own
/// `UserDefaults`; `ViewController.instanceDescriptor()` reads it before the
/// bridge exists, so every native check that already trusts
/// `bridge.config.appStartServerURL` (the recorder's base, a notice's tap
/// target) follows the owner's choice rather than a second, looser source.
enum ServerChoiceStore {
    private static let key = "server-choice-url"
    private static let copyKey = "server-choice-unreachable-copy"

    /// The owner's own server, e.g. `https://travel.example.org`, or `nil`
    /// for the one this build names.
    static var chosen: String? {
        guard let s = UserDefaults.standard.string(forKey: key), !s.isEmpty else { return nil }
        return s
    }

    /// The words for "your server does not answer", translated by the page
    /// when the owner chose it and kept here, because the one moment they are
    /// needed is when no page can load — native never hardcodes English.
    static var unreachableCopy: [String: String]? {
        UserDefaults.standard.dictionary(forKey: copyKey) as? [String: String]
    }

    static func set(_ origin: String?, unreachableCopy: [String: String]? = nil) {
        if let origin {
            UserDefaults.standard.set(origin, forKey: key)
            UserDefaults.standard.set(unreachableCopy, forKey: copyKey)
        } else {
            UserDefaults.standard.removeObject(forKey: key)
            UserDefaults.standard.removeObject(forKey: copyKey)
        }
    }

    /// Scheme, host and port, and nothing else: a path, a query or a
    /// password pasted along with the address is dropped rather than kept
    /// and trusted. `https` only, except a `DEBUG` build talking to a local
    /// `http://` dev server — the same rule `LocationRecorderPlugin
    /// .nativeBase()` applies.
    static func origin(from raw: String) -> String? {
        var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.contains("://") { text = "https://" + text }
        guard let parts = URLComponents(string: text), let host = parts.host, !host.isEmpty,
              parts.user == nil, parts.password == nil, let scheme = parts.scheme?.lowercased() else { return nil }
        #if DEBUG
        guard scheme == "https" || scheme == "http" else { return nil }
        #else
        guard scheme == "https" else { return nil }
        #endif
        var out = URLComponents()
        out.scheme = scheme
        out.host = host.lowercased()
        out.port = parts.port
        return out.string
    }
}

/// The page's one native call for choosing the server — `status`, `choose`
/// and `reset`.
///
/// **Why the switch is confirmed natively.** Any script in the WebView can
/// reach this plugin, and moving the whole app to another server is the
/// largest thing a page could ask for: everything the owner types next goes
/// there. So nothing changes until the owner has read the host — filled in
/// here, from the address that will actually be used, never from a string
/// the page pre-filled — on a native dialog and said yes, the same shape
/// `LocationRecorderPlugin.confirmAndRun` uses for arming a recording.
///
/// **What a switch forgets.** The share extension's token and the route
/// recorder's `write:gps` token were minted by the old server and name a
/// journal there, so both are cleared; a switch is refused while a trip is
/// still recording, because the recorder would keep uploading to the old
/// server with no way for the owner to see it from the new one.
@objc(ServerChoicePlugin)
public class ServerChoicePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ServerChoicePlugin"
    public let jsName = "ServerChoice"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "choose", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reset", returnType: CAPPluginReturnPromise),
    ]

    private func trimmed(_ url: URL?) -> String? {
        guard let s = url?.absoluteString else { return nil }
        return s.hasSuffix("/") ? String(s.dropLast()) : s
    }

    @objc func status(_ call: CAPPluginCall) {
        var body: [String: Any] = ["custom": ServerChoiceStore.chosen != nil]
        if let server = trimmed(bridge?.config.serverURL) { body["server"] = server }
        if let host = bridge?.config.serverURL.host { body["host"] = host }
        if let fallback = ViewController.defaultServerURL { body["defaultServer"] = fallback }
        call.resolve(body)
    }

    @objc func choose(_ call: CAPPluginCall) {
        guard let raw = call.getString("url"), let origin = ServerChoiceStore.origin(from: raw),
              let host = URLComponents(string: origin)?.host else {
            call.reject("that is not an https address", "invalid")
            return
        }
        if origin == ViewController.defaultServerURL.flatMap(ServerChoiceStore.origin(from:)) {
            // The build's own server: going back to it, or nothing to do.
            if ServerChoiceStore.chosen == nil { call.resolve(["changed": false]) } else { confirmAndSwitch(call: call, host: host, to: nil) }
            return
        }
        guard Recorder.shared.armedTripIds().armed.isEmpty else {
            call.reject("a trip is still recording", "recording")
            return
        }
        Self.probe(origin) { [weak self] outcome in
            guard let self else { return }
            switch outcome {
            case .fernscout: self.confirmAndSwitch(call: call, host: host, to: origin)
            case .notFernscout: call.reject("no Fernscout answers at that address", "notFernscout")
            case .unreachable: call.reject("that address could not be reached", "unreachable")
            }
        }
    }

    @objc func reset(_ call: CAPPluginCall) {
        guard ServerChoiceStore.chosen != nil else {
            call.resolve(["changed": false])
            return
        }
        let host = ViewController.defaultServerURL.flatMap { URL(string: $0)?.host } ?? ""
        confirmAndSwitch(call: call, host: host, to: nil)
    }

    enum ProbeOutcome { case fernscout, notFernscout, unreachable }

    /// `GET /api/health` — every Fernscout answers it, unauthenticated, with
    /// a `status` and the `paid` block the open edition always carries. A
    /// typo, a parked domain or somebody else's site does not, and is
    /// refused before the owner is asked anything. Native rather than a page
    /// `fetch`, which the other server's CORS policy would stop.
    static func probe(_ origin: String, _ done: @escaping (ProbeOutcome) -> Void) {
        guard let url = URL(string: origin + "/api/health") else { return done(.notFernscout) }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 10)
        request.setValue("application/json", forHTTPHeaderField: "accept")
        URLSession.shared.dataTask(with: request) { data, response, error in
            let outcome: ProbeOutcome
            if error != nil || response == nil {
                outcome = .unreachable
            } else if let data, let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      json["status"] is String, json["paid"] is [String: Any] {
                outcome = .fernscout
            } else {
                outcome = .notFernscout
            }
            DispatchQueue.main.async { done(outcome) }
        }.resume()
    }

    private func confirmAndSwitch(call: CAPPluginCall, host: String, to origin: String?) {
        guard let title = call.getString("confirmTitle"), let bodyTemplate = call.getString("confirmBody"),
              let confirmLabel = call.getString("confirmLabel"), let cancelLabel = call.getString("cancelLabel") else {
            call.reject("confirmTitle, confirmBody, confirmLabel and cancelLabel are required")
            return
        }
        guard Recorder.shared.armedTripIds().armed.isEmpty else {
            call.reject("a trip is still recording", "recording")
            return
        }
        var copy: [String: String] = [:]
        for key in ["unreachableTitle", "unreachableBody", "retryLabel", "resetLabel"] {
            if let value = call.getString(key) { copy[key] = value }
        }
        let body = bodyTemplate.replacingOccurrences(of: "{host}", with: host)
        DispatchQueue.main.async {
            let alert = UIAlertController(title: title, message: body, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: cancelLabel, style: .cancel) { _ in
                call.resolve(["changed": false])
            })
            alert.addAction(UIAlertAction(title: confirmLabel.replacingOccurrences(of: "{host}", with: host), style: .default) { _ in
                call.resolve(["changed": true])
                Self.switchServer(to: origin, unreachableCopy: copy)
            })
            Self.present(alert)
        }
    }

    static func switchServer(to origin: String?, unreachableCopy: [String: String]? = nil) {
        ServerChoiceStore.set(origin, unreachableCopy: unreachableCopy)
        ShareCredentialStore.clear()
        GpsCredentialStore.clear()
        restart()
    }

    /// A fresh bridge on the new server. The server address is read once,
    /// when the bridge is built, so a new view controller is the only way to
    /// change it — loading another URL into the old WebView would leave
    /// `appStartServerURL` naming the old one.
    private static func restart() {
        guard let window = UIApplication.shared.windows.first(where: { $0.isKeyWindow }),
              let fresh = UIStoryboard(name: "Main", bundle: nil).instantiateInitialViewController() else { return }
        window.rootViewController = fresh
        window.makeKeyAndVisible()
    }

    private static func present(_ alert: UIAlertController) {
        var top = UIApplication.shared.windows.first(where: { $0.isKeyWindow })?.rootViewController
        while let presented = top?.presentedViewController { top = presented }
        top?.present(alert, animated: true)
    }

    /// The way back when the owner's own server does not answer — checked
    /// once per launch, and only when a server was chosen: the build's own
    /// server never gets this dialog. Without it, a server that was taken
    /// down would leave the app with no page to reach the reset from. Both
    /// buttons are native and never reachable from a page, so going back to
    /// the default here needs no second confirmation.
    static func checkChosenServerAnswers(reload: @escaping () -> Void) {
        guard let origin = ServerChoiceStore.chosen, let copy = ServerChoiceStore.unreachableCopy,
              let title = copy["unreachableTitle"], let body = copy["unreachableBody"],
              let retry = copy["retryLabel"], let reset = copy["resetLabel"] else { return }
        probe(origin) { outcome in
            guard outcome == .unreachable else { return }
            let host = URLComponents(string: origin)?.host ?? origin
            let fallback = ViewController.defaultServerURL.flatMap { URL(string: $0)?.host } ?? ""
            let alert = UIAlertController(
                title: title,
                message: body.replacingOccurrences(of: "{host}", with: host),
                preferredStyle: .alert
            )
            alert.addAction(UIAlertAction(title: retry, style: .default) { _ in
                probe(origin) { again in
                    if again == .unreachable { checkChosenServerAnswers(reload: reload) } else { reload() }
                }
            })
            alert.addAction(UIAlertAction(title: reset.replacingOccurrences(of: "{host}", with: fallback), style: .cancel) { _ in
                switchServer(to: nil)
            })
            present(alert)
        }
    }
}
