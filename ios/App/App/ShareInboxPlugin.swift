import Foundation
import Capacitor

/// The page's one native call for the share extension — B2175.
///
/// `connect` stores the credential the studio minted; `status` says whether
/// one is there and when it runs out; `disconnect` forgets it. Nothing here
/// talks to the server: the page holds the cookie, so the page mints.
@objc(ShareInboxPlugin)
public class ShareInboxPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ShareInboxPlugin"
    public let jsName = "ShareInbox"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "connect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disconnect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cacheTrips", returnType: CAPPluginReturnPromise),
    ]

    @objc func connect(_ call: CAPPluginCall) {
        guard let base = call.getString("base"), let user = call.getString("user"),
              let token = call.getString("token"), let expiresAt = call.getString("expiresAt") else {
            call.reject("base, user, token and expiresAt are required")
            return
        }
        let ok = ShareCredentialStore.save(ShareCredential(base: base, user: user, token: token, expiresAt: expiresAt))
        ok ? call.resolve(["connected": true, "expiresAt": expiresAt]) : call.reject("could not store the credential")
    }

    @objc func status(_ call: CAPPluginCall) {
        if let c = ShareCredentialStore.load() {
            call.resolve(["connected": true, "user": c.user, "base": c.base, "expiresAt": c.expiresAt])
        } else {
            call.resolve(["connected": false])
        }
    }

    /// The raw `GET …/trips` body, so the share sheet's picker has its rows
    /// before the first share ever — B2206.
    @objc func cacheTrips(_ call: CAPPluginCall) {
        guard let json = call.getString("json"), let data = json.data(using: .utf8) else {
            call.reject("json is required")
            return
        }
        ShareCredentialStore.defaults?.set(data, forKey: ShareCredentialStore.tripsKey)
        call.resolve()
    }

    @objc func disconnect(_ call: CAPPluginCall) {
        ShareCredentialStore.clear()
        call.resolve(["connected": false])
    }
}
