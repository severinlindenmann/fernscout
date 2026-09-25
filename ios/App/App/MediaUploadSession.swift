import Foundation

/// One background `URLSession`, shared by every photograph the outbox queues
/// — B2330. A fixed identifier (unlike the share extension's own per-call
/// UUID, `ShareViewController.swift`) so a relaunch can reattach to tasks
/// still running and `AppDelegate.handleEventsForBackgroundURLSession` can
/// wake it to hear the rest. Same credential, same route, same "trip and day
/// both declined, lands in the inbox" shape the share extension already
/// sends (B2175) — this is that pattern's second door, for a photo picked
/// with nothing to send it to at the time rather than one shared from Photos.
///
/// ponytail: iOS cancels a background transfer outright if the user
/// force-quits the app from the app switcher — a platform limit, not a bug
/// here. What this class buys is the far more common case: the studio tab
/// backgrounded, locked or left to be swept by the system while the upload
/// keeps going, and the ordinary "handed off, still in flight" state a
/// still-running app can query at any time.
final class MediaUploadSession: NSObject, URLSessionDataDelegate {
    static let identifier = "ch.fernscout.app.media-upload"
    static let shared = MediaUploadSession()

    private static let appGroup = ShareCredentialStore.appGroup
    private static let jobsKey = "media-upload-jobs"
    private static let failedKey = "media-upload-failed"
    private static let startedKey = "media-upload-started"

    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: Self.identifier)
        config.sharedContainerIdentifier = Self.appGroup
        config.isDiscretionary = false
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    /// Set by `AppDelegate` when iOS relaunches the app to finish telling
    /// this session's delegate about tasks that completed while it was not
    /// running; `urlSessionDidFinishEvents` below calls it back.
    var backgroundCompletion: (() -> Void)?

    /// Touches `session` so a cold or relaunched process reattaches to
    /// `identifier`'s outstanding tasks — safe to call any number of times.
    func rejoin() { _ = session }

    /// `true` once the upload is under way (or was already, from an earlier
    /// call for the same `id` this process never heard back from) — either
    /// way the caller stops here rather than also sending it over `fetch`.
    /// `false` only when the bytes could not even be written, which the
    /// caller treats as "hand it to the web path instead".
    ///
    /// ponytail: the "already started" guard is a plain `UserDefaults`
    /// array, not a lock — fine for one JS event loop calling this one id at
    /// a time, not for two processes racing the same id.
    func enqueue(id: String, data: Data, filename: String, mimeType: String, credential: ShareCredential) -> Bool {
        var started = Self.defaults?.stringArray(forKey: Self.startedKey) ?? []
        if started.contains(id) { return true }
        guard let dir = Self.uploadsDir() else { return false }

        let boundary = "fernscout-\(UUID().uuidString)"
        let intent: [String: Any] = [
            "kind": "photo",
            "declined": [
                "trip": "queued offline, trip not chosen yet",
                "day": "queued offline, not placed on a day yet",
                "caption": "to be written in the studio",
            ],
        ]
        guard let intentData = try? JSONSerialization.data(withJSONObject: intent),
              let intentText = String(data: intentData, encoding: .utf8) else { return false }

        var body = Data()
        func part(_ s: String) { body.append(s.data(using: .utf8)!) }
        part("--\(boundary)\r\nContent-Disposition: form-data; name=\"intent\"\r\n\r\n\(intentText)\r\n")
        let safeName = filename.unicodeScalars.filter { $0.value >= 32 && $0 != "\"" && $0 != "\\" }.map(String.init).joined()
        part("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(safeName)\"\r\nContent-Type: \(mimeType)\r\n\r\n")
        body.append(data)
        part("\r\n--\(boundary)--\r\n")

        let bodyURL = dir.appendingPathComponent("\(id).multipart")
        guard (try? body.write(to: bodyURL)) != nil else { return false }

        guard let url = URL(string: "\(credential.base)/api/v2/\(credential.user)/media") else { return false }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("Bearer \(credential.token)", forHTTPHeaderField: "Authorization")
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        let task = session.uploadTask(with: req, fromFile: bodyURL)
        task.taskDescription = id
        started.append(id)
        Self.defaults?.set(started, forKey: Self.startedKey)
        task.resume()
        return true
    }

    private static func uploadsDir() -> URL? {
        guard let base = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup) else { return nil }
        let dir = base.appendingPathComponent("media-upload", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private static var defaults: UserDefaults? { UserDefaults(suiteName: appGroup) }

    struct Completed: Codable { let id: String; let realId: String }

    /// What `MediaUploadPlugin.drainCompleted` hands to JS — and the only
    /// place any of it is cleared, so a job reported once is gone whether or
    /// not the JS side ever asks again.
    static func drain() -> (completed: [Completed], failed: [String]) {
        let completed = readCompleted()
        let failed = defaults?.stringArray(forKey: failedKey) ?? []
        defaults?.removeObject(forKey: jobsKey)
        defaults?.removeObject(forKey: failedKey)
        let resolved = Set(completed.map { $0.id } + failed)
        if !resolved.isEmpty {
            let started = (defaults?.stringArray(forKey: startedKey) ?? []).filter { !resolved.contains($0) }
            defaults?.set(started, forKey: startedKey)
        }
        return (completed, failed)
    }

    private static func readCompleted() -> [Completed] {
        guard let data = defaults?.data(forKey: jobsKey), let list = try? JSONDecoder().decode([Completed].self, from: data) else { return [] }
        return list
    }

    private func recordCompleted(id: String, realId: String) {
        var list = Self.readCompleted()
        list.append(Completed(id: id, realId: realId))
        if let data = try? JSONEncoder().encode(list) { Self.defaults?.set(data, forKey: Self.jobsKey) }
    }

    private func recordFailed(id: String) {
        var list = Self.defaults?.stringArray(forKey: Self.failedKey) ?? []
        list.append(id)
        Self.defaults?.set(list, forKey: Self.failedKey)
    }

    // MARK: URLSessionDataDelegate

    private var responseData: [Int: Data] = [:]

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        responseData[dataTask.taskIdentifier, default: Data()].append(data)
    }

    /// The whole point: this fires whether the app is foreground, backgrounded
    /// or was relaunched just to hear it — the studio's own `mediaInboxIds`
    /// resolution (`lib/outbox.ts`'s `remapMediaId`) needs the real inbox id
    /// this reads out of the response body, not just a "succeeded" flag.
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let id = task.taskDescription else { return }
        let status = (task.response as? HTTPURLResponse)?.statusCode ?? 0
        let data = responseData.removeValue(forKey: task.taskIdentifier)
        if error == nil, status >= 200, status < 300, let data,
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let src = (json["src"] as? String), src.hasPrefix("inbox:") {
            recordCompleted(id: id, realId: String(src.dropFirst("inbox:".count)))
        } else {
            recordFailed(id: id)
        }
        if let dir = Self.uploadsDir() {
            try? FileManager.default.removeItem(at: dir.appendingPathComponent("\(id).multipart"))
        }
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        DispatchQueue.main.async { [weak self] in
            self?.backgroundCompletion?()
            self?.backgroundCompletion = nil
        }
    }
}
