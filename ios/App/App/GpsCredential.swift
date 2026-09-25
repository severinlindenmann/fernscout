import Foundation
import Security

/// The recorder's own credential — B2196/B2204. A `write:gps` token, minted
/// by the studio page (`mintGpsToken`/`refreshGpsToken` in
/// `components/nativeShell.ts`) and handed to `LocationRecorderPlugin`,
/// stored in its own Keychain item — deliberately *not*
/// `ShareCredentialStore`'s: that one is the extension's journal-wide agent
/// token, and this one is scoped to gps writes only. Two different
/// credentials for two different failure domains: a compromised recorder
/// buffer can upload positions and nothing else.
struct GpsCredential: Codable {
    let token: String
    /// ISO 8601 — `RouteRecordSection` refreshes with under seven days left.
    let expiresAt: String
}

enum GpsCredentialStore {
    private static let appGroup = ShareCredentialStore.appGroup
    private static let defaultsKey = "gps-recorder-credential"
    private static let keychainAccount = "gps-recorder-token"

    private static var defaults: UserDefaults? { UserDefaults(suiteName: appGroup) }

    static func load() -> GpsCredential? {
        guard let expiresAt = defaults?.string(forKey: defaultsKey), let token = readToken() else { return nil }
        return GpsCredential(token: token, expiresAt: expiresAt)
    }

    static func save(_ c: GpsCredential) -> Bool {
        guard writeToken(c.token) else { return false }
        defaults?.set(c.expiresAt, forKey: defaultsKey)
        return true
    }

    static func clear() {
        defaults?.removeObject(forKey: defaultsKey)
        SecItemDelete(query() as CFDictionary)
    }

    /// Security review (2026-09-24), finding 4 — no `kSecAttrAccessGroup`
    /// here any more. This token is read only by `Recorder`, in the App
    /// target; the ShareInbox extension has no use for it and, with the app
    /// group access group removed, can no longer read it even by accident.
    /// `kSecAttrService` keeps the app-group string only as a plain
    /// namespacing label — that does not itself share anything.
    private static func query() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: appGroup,
            kSecAttrAccount as String: keychainAccount,
        ]
    }

    private static func readToken() -> String? {
        var q = query()
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private static func writeToken(_ token: String) -> Bool {
        SecItemDelete(query() as CFDictionary)
        var q = query()
        q[kSecValueData as String] = token.data(using: .utf8)!
        // Readable after the first unlock, the same as the share
        // extension's own token — a background upload that starts while
        // the phone is locked must still be able to read it.
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        return SecItemAdd(q as CFDictionary, nil) == errSecSuccess
    }
}
