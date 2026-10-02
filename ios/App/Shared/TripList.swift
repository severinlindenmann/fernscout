import Foundation

/// The trip list both doors into the inbox show — the Photos share sheet
/// (`ShareViewController.swift`, B2175/B2183) and the app's own "Save to
/// inbox" sheet (`SaveToInboxView.swift`, B2732). Moved here so both targets
/// compile one copy rather than two copies of the same parsing and ordering
/// rule drifting apart.
enum TripList {
    static let today: String = {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; return f.string(from: Date())
    }()

    static func isUnderWay(from: String?, to: String?) -> Bool {
        guard let from else { return false }
        return from <= today && (to == nil || today <= to!)
    }

    struct Row: Codable, Identifiable, Equatable {
        let id: String
        let title: String
        let from: String?
        let to: String?
        var underWay: Bool { TripList.isUnderWay(from: from, to: to) }
    }

    /// The rows out of a `GET …/trips` body: the trip under way first, then
    /// newest first. The same function reads the cache the app wrote at
    /// connect time and the fresh body from the network.
    static func parse(_ data: Data) -> [Row] {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let list = json["trips"] as? [[String: Any]] else { return [] }
        var rows: [Row] = list.compactMap { t in
            guard let id = t["id"] as? String, let title = t["title"] as? String else { return nil }
            let dates = t["dates"] as? [String: Any]
            return Row(id: id, title: title, from: dates?["from"] as? String, to: dates?["to"] as? String)
        }
        rows.sort { a, b in
            if a.underWay != b.underWay { return a.underWay }
            return (a.from ?? "") > (b.from ?? "")
        }
        return rows
    }

    static func cached() -> [Row] {
        guard let data = ShareCredentialStore.defaults?.data(forKey: ShareCredentialStore.tripsKey) else { return [] }
        return parse(data)
    }

    /// Fetched with the owner's own token; a refusal leaves the cached list
    /// alone — a stale list is still the person's own trips.
    static func refresh(_ c: ShareCredential, completion: @escaping ([Row]) -> Void) {
        guard let url = URL(string: "\(c.base)/api/v2/\(c.user)/trips?limit=200") else { return }
        var req = URLRequest(url: url)
        req.setValue("Bearer \(c.token)", forHTTPHeaderField: "Authorization")
        URLSession.shared.dataTask(with: req) { data, response, _ in
            guard let data, (response as? HTTPURLResponse)?.statusCode == 200 else { return }
            let rows = parse(data)
            guard !rows.isEmpty else { return }
            ShareCredentialStore.defaults?.set(data, forKey: ShareCredentialStore.tripsKey)
            DispatchQueue.main.async { completion(rows) }
        }.resume()
    }
}
