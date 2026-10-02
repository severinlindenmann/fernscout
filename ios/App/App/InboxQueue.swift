import Foundation
#if canImport(WidgetKit)
import WidgetKit
#endif

/// The durable "Save to inbox" queue — B2732, the app's own door beside the
/// Photos share sheet (`ShareViewController.swift`, B2175). Deliberately not
/// `MediaUploadSession` (the web studio's own outbox uploader): that type
/// deletes its multipart body on failure and only ever knows `kind: photo`
/// with no trip (`MediaUploadSession.swift:58`); this queue must survive a
/// failed send, show its own state in a list, and carry an optional trip.
///
/// One directory in the app-group container holds each original photograph
/// plus its JSON record. An original is deleted only once the server has
/// confirmed it with a 2xx naming a non-empty `src` (with a trip the src is
/// not `inbox:…` — it is stored on the trip — so "confirmed" is "any
/// non-empty src", not the `inbox:` prefix `MediaUploadSession` checks for
/// its own, always-trip-less uploads). Any other outcome keeps the file and
/// retries later. A tiny summary (`inbox-queue-summary` in the app-group
/// `UserDefaults`) is B2734's own read: `{"waiting": n, "updatedAt": iso}`.
enum InboxQueueState: String, Codable {
    /// Not yet attempted, or will be retried (offline, timed out, 5xx,
    /// 408/429 — nothing here says the file itself was wrong).
    case waiting
    /// A 401 — the stored token is gone; kept until the owner reconnects.
    case reconnect
    /// A definitive 4xx other than 401/408/429 — kept until the owner
    /// removes it; it is their photograph, never dropped silently.
    case refused
}

struct InboxQueueItem: Codable, Identifiable, Equatable {
    let id: String
    let base: String
    let user: String
    let tripId: String?
    let tripTitle: String?
    let filename: String
    let mime: String
    let createdAt: String
    var state: InboxQueueState
    var message: String?

    var fileName: String { "\(id)-\(filename)" }
}

final class InboxQueue: NSObject, URLSessionDataDelegate {
    static let identifier = "ch.fernscout.app.inbox-queue"
    static let shared = InboxQueue()

    private static let appGroup = ShareCredentialStore.appGroup
    private static let recordsKey = "inbox-queue-records"
    static let summaryKey = "inbox-queue-summary"

    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: Self.identifier)
        config.sharedContainerIdentifier = Self.appGroup
        config.isDiscretionary = false
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    /// Set by `AppDelegate` on a relaunch purely to report finished tasks —
    /// the same dance as `MediaUploadSession.backgroundCompletion`.
    var backgroundCompletion: (() -> Void)?
    /// The sheet/list observes this to refresh without polling.
    var onChange: (() -> Void)?

    /// Touches `session` so a cold or relaunched process reattaches to this
    /// identifier's outstanding tasks — safe to call any number of times.
    func rejoin() { _ = session }

    private static var defaults: UserDefaults? { UserDefaults(suiteName: appGroup) }

    private static func dir() -> URL? {
        guard let base = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup) else { return nil }
        let d = base.appendingPathComponent("inbox-queue", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    private func readRecords() -> [InboxQueueItem] {
        guard let data = Self.defaults?.data(forKey: Self.recordsKey),
              let list = try? JSONDecoder().decode([InboxQueueItem].self, from: data) else { return [] }
        return list
    }

    private func writeRecords(_ list: [InboxQueueItem]) {
        if let data = try? JSONEncoder().encode(list) { Self.defaults?.set(data, forKey: Self.recordsKey) }
        writeSummary(list)
        DispatchQueue.main.async { [weak self] in self?.onChange?() }
    }

    private func writeSummary(_ list: [InboxQueueItem]) {
        let waiting = list.filter { $0.state == .waiting || $0.state == .reconnect }.count
        let summary: [String: Any] = ["waiting": waiting, "updatedAt": ISO8601DateFormatter().string(from: Date())]
        if let data = try? JSONSerialization.data(withJSONObject: summary) {
            Self.defaults?.set(data, forKey: Self.summaryKey)
        }
        #if canImport(WidgetKit)
        if #available(iOS 14.0, *) { WidgetCenter.shared.reloadAllTimelines() }
        #endif
    }

    /// Everything still queued, newest first — the "On this phone" list.
    var items: [InboxQueueItem] { readRecords().reversed() }

    var waitingCount: Int { readRecords().filter { $0.state == .waiting || $0.state == .reconnect }.count }

    /// Copies `source` into the queue dir under a fresh id and records it.
    /// Called from the picker callback before it returns, so the original in
    /// Photos is never touched again — the file handed in here already is
    /// the owner's copy to keep or lose.
    @discardableResult
    func add(source: URL, filename: String, mime: String, trip: (id: String, title: String)?, credential: ShareCredential) -> Bool {
        guard let dir = Self.dir() else { return false }
        let id = UUID().uuidString
        let item = InboxQueueItem(
            id: id, base: credential.base, user: credential.user,
            tripId: trip?.id, tripTitle: trip?.title,
            filename: filename, mime: mime,
            createdAt: ISO8601DateFormatter().string(from: Date()), state: .waiting, message: nil
        )
        let dest = dir.appendingPathComponent(item.fileName)
        guard (try? FileManager.default.copyItem(at: source, to: dest)) != nil else { return false }
        var list = readRecords()
        list.append(item)
        writeRecords(list)
        return true
    }

    /// A swipe-to-remove — the owner's own call on any item, any state.
    func remove(id: String) {
        var list = readRecords()
        guard let idx = list.firstIndex(where: { $0.id == id }) else { return }
        let item = list.remove(at: idx)
        if let dir = Self.dir() {
            try? FileManager.default.removeItem(at: dir.appendingPathComponent(item.fileName))
        }
        writeRecords(list)
    }

    /// Every record still on disk whose state is `waiting` or `reconnect`,
    /// matched against the owner's *current* `ShareCredential` — an item
    /// saved for another host or user just waits, never sent elsewhere.
    /// Called on launch, on becoming active, and when the network path is
    /// satisfied again.
    func sendAll() {
        guard let credential = ShareCredentialStore.load() else { return }
        for item in readRecords() where item.state == .waiting || item.state == .reconnect {
            guard item.base == credential.base, item.user == credential.user else { continue }
            send(item, credential)
        }
    }

    private func send(_ item: InboxQueueItem, _ c: ShareCredential) {
        guard let dir = Self.dir() else { return }
        let fileURL = dir.appendingPathComponent(item.fileName)
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return }

        let boundary = "fernscout-\(UUID().uuidString)"
        var declined: [String: String] = ["caption": "to be written in the studio"]
        var intent: [String: Any] = ["kind": "photo"]
        if let trip = item.tripId {
            intent["trip"] = trip
            declined["day"] = "saved from the iPhone, not placed on a day yet"
        } else {
            declined["trip"] = "saved from the iPhone, trip not chosen yet"
            declined["day"] = "saved from the iPhone, not placed on a day yet"
        }
        intent["declined"] = declined
        guard let intentData = try? JSONSerialization.data(withJSONObject: intent),
              let intentText = String(data: intentData, encoding: .utf8),
              let bytes = try? Data(contentsOf: fileURL) else { return }

        var body = Data()
        func part(_ s: String) { body.append(s.data(using: .utf8)!) }
        part("--\(boundary)\r\nContent-Disposition: form-data; name=\"intent\"\r\n\r\n\(intentText)\r\n")
        let safeName = item.filename.unicodeScalars.filter { $0.value >= 32 && $0 != "\"" && $0 != "\\" }.map(String.init).joined()
        part("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(safeName)\"\r\nContent-Type: \(item.mime)\r\n\r\n")
        body.append(bytes)
        part("\r\n--\(boundary)--\r\n")

        let bodyURL = dir.appendingPathComponent("\(item.id).multipart")
        guard (try? body.write(to: bodyURL)) != nil else { return }
        guard let url = URL(string: "\(c.base)/api/v2/\(c.user)/media") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("Bearer \(c.token)", forHTTPHeaderField: "Authorization")
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        let task = session.uploadTask(with: req, fromFile: bodyURL)
        task.taskDescription = item.id
        task.resume()
    }

    // MARK: URLSessionDataDelegate

    private var responseData: [Int: Data] = [:]

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        responseData[dataTask.taskIdentifier, default: Data()].append(data)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let id = task.taskDescription else { return }
        let status = (task.response as? HTTPURLResponse)?.statusCode ?? 0
        let data = responseData.removeValue(forKey: task.taskIdentifier)
        var list = readRecords()
        guard let idx = list.firstIndex(where: { $0.id == id }) else { return }

        if error == nil, status >= 200, status < 300, let data,
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let src = json["src"] as? String, !src.isEmpty {
            if let dir = Self.dir() {
                try? FileManager.default.removeItem(at: dir.appendingPathComponent(list[idx].fileName))
            }
            list.remove(at: idx)
        } else if status == 401 {
            list[idx].state = .reconnect
            list[idx].message = nil
        } else if status >= 400, status < 500, status != 408, status != 429 {
            list[idx].state = .refused
            list[idx].message = Self.errorMessage(from: data)
        } else {
            // Offline, timed out, a 5xx, or a 408/429 — nothing here says the
            // file was wrong, so it just waits for the next `sendAll()`.
            list[idx].state = .waiting
        }
        if let dir = Self.dir() {
            try? FileManager.default.removeItem(at: dir.appendingPathComponent("\(id).multipart"))
        }
        writeRecords(list)
    }

    /// The v2 envelope is flat — `{error, message}` (`lib/api/v2/route.ts`'s
    /// `fail()`) — not nested under an `error` object.
    private static func errorMessage(from data: Data?) -> String? {
        guard let data, let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return json["message"] as? String
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        DispatchQueue.main.async { [weak self] in
            self?.backgroundCompletion?()
            self?.backgroundCompletion = nil
        }
    }
}
