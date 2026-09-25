import Foundation
import Security

/// What the share extension needs to reach the journal, and where it lives —
/// B2175. Written by the app (through `ShareInboxPlugin`) after the studio
/// minted the owner's own agent token; read by the extension, which is a
/// separate process with no access to the WebView's cookies.
///
/// The token sits in the Keychain under the app group's access group, the
/// rest in the group's `UserDefaults`. Both targets compile this one file.
struct ShareCredential: Codable {
    /// The site, e.g. `https://fernscout.ch`, never with a trailing slash.
    let base: String
    /// The journal's username.
    let user: String
    /// The owner's seven-day agent token.
    let token: String
    /// ISO 8601, from the exchange; the app refreshes before it runs out.
    let expiresAt: String
}

enum ShareCredentialStore {
    static let appGroup = "group.ch.fernscout.app"
    /// The raw `GET …/trips` body, written by the app at connect time and by
    /// the extension after each refresh; parsed by the extension — B2206.
    static let tripsKey = "share-inbox-trips-json"
    private static let defaultsKey = "share-inbox-credential"
    private static let keychainAccount = "share-inbox-token"

    static var defaults: UserDefaults? { UserDefaults(suiteName: appGroup) }

    static func load() -> ShareCredential? {
        guard let meta = defaults?.dictionary(forKey: defaultsKey),
              let base = meta["base"] as? String,
              let user = meta["user"] as? String,
              let expiresAt = meta["expiresAt"] as? String,
              let token = readToken() else { return nil }
        return ShareCredential(base: base, user: user, token: token, expiresAt: expiresAt)
    }

    static func save(_ c: ShareCredential) -> Bool {
        guard writeToken(c.token) else { return false }
        defaults?.set(["base": c.base, "user": c.user, "expiresAt": c.expiresAt], forKey: defaultsKey)
        return true
    }

    static func clear() {
        defaults?.removeObject(forKey: defaultsKey)
        defaults?.removeObject(forKey: tripsKey)
        SecItemDelete(query() as CFDictionary)
    }

    private static func query() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: appGroup,
            kSecAttrAccount as String: keychainAccount,
            kSecAttrAccessGroup as String: appGroup,
        ]
    }

    private static func readToken() -> String? {
        var q = query()
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess,
              let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private static func writeToken(_ token: String) -> Bool {
        SecItemDelete(query() as CFDictionary)
        var q = query()
        q[kSecValueData as String] = token.data(using: .utf8)!
        // Readable after the first unlock, so a background upload that
        // starts while the phone is locked can still finish.
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        return SecItemAdd(q as CFDictionary, nil) == errSecSuccess
    }
}
