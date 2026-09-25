import UIKit
import UniformTypeIdentifiers

/// Photos → Share → Fernscout — B2175, with a trip to choose — B2183.
///
/// The sheet lists the journal's trips and one row, "Decide later". A trip
/// files the photographs onto that trip with the day declined (the media
/// door stores them on the trip, attachable to a day in the studio);
/// "Decide later" declines the trip too and they land in What's waiting.
/// Either way every item becomes one background upload to
/// `POST /api/v2/<user>/media`; iOS finishes them after the sheet closes,
/// app or no app. HEIC originals go as they are.
///
/// The trip list is cached in the app group so the sheet opens at once and
/// works without a signal, and refreshed in the background on each open.
/// No caption here: the person writes it in the studio, in their words.
final class ShareViewController: UIViewController, UITableViewDataSource, UITableViewDelegate {
    private static func isUnderWay(from: String?, to: String?) -> Bool {
        guard let from else { return false }
        return from <= today && (to == nil || today <= to!)
    }
    private struct TripRow: Codable {
        let id: String; let title: String; let from: String?; let to: String?
        var underWay: Bool { ShareViewController.isUnderWay(from: from, to: to) }
    }

    private let label = UILabel()
    private let card = UIView()
    private var cardHeight: NSLayoutConstraint!
    private static let today: String = {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; return f.string(from: Date())
    }()
    private let table = UITableView(frame: .zero, style: .insetGrouped)
    private var session: URLSession!
    private var credential: ShareCredential?
    private var trips: [TripRow] = []
    private var files: [(url: URL, name: String, mime: String)] = []
    private var collected = false
    /// Three most recent by default — B2183, the owner's ask — the rest
    /// behind one row.
    private var showAll = false
    private static let fewCount = 3
    private var shown: [TripRow] { showAll ? trips : Array(trips.prefix(Self.fewCount)) }
    private var hasMore: Bool { !showAll && trips.count > Self.fewCount }
    private static let cream = UIColor(red: 1.0, green: 0.98, blue: 0.94, alpha: 1)
    private static let navy = UIColor(red: 0.118, green: 0.161, blue: 0.231, alpha: 1)

    /// A half sheet that grows with its rows rather than a full page —
    /// iOS lets an extension size itself through `preferredContentSize`.
    private func fitSheet() {
        let rows = CGFloat(shown.count + (hasMore ? 1 : 0) + 1)
        let height = 8 + 118 + rows * 56 + 44 + 24 + view.safeAreaInsets.bottom
        cardHeight.constant = min(height, view.bounds.height - 60)
        UIView.animate(withDuration: 0.2) { self.view.layoutIfNeeded() }
    }

    @objc private func cancelTapped(_ g: UITapGestureRecognizer) {
        if card.frame.contains(g.location(in: view)) { return }
        extensionContext?.cancelRequest(withError: NSError(domain: "ch.fernscout.app.share", code: 0))
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        // iOS presents an extension full height whatever it asks for, so the
        // sheet draws its own: a dimmed ground and a cream card sized to its
        // rows, pinned to the bottom — B2206 ("still a big pane"). A tap on
        // the ground cancels.
        view.backgroundColor = UIColor.black.withAlphaComponent(0.001)
        card.backgroundColor = Self.cream
        card.layer.cornerRadius = 28
        card.layer.maskedCorners = [.layerMinXMinYCorner, .layerMaxXMinYCorner]
        card.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(card)
        cardHeight = card.heightAnchor.constraint(equalToConstant: 360)
        NSLayoutConstraint.activate([
            card.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            card.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            card.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            cardHeight,
        ])
        let ground = UITapGestureRecognizer(target: self, action: #selector(cancelTapped))
        // Only the dimmed ground cancels; a tap on the card must reach its rows.
        ground.cancelsTouchesInView = false
        view.addGestureRecognizer(ground)
        UIView.animate(withDuration: 0.25) { self.view.backgroundColor = UIColor.black.withAlphaComponent(0.35) }
        label.numberOfLines = 0
        label.textAlignment = .center
        label.font = .preferredFont(forTextStyle: .body)
        label.textColor = Self.navy
        label.translatesAutoresizingMaskIntoConstraints = false
        table.translatesAutoresizingMaskIntoConstraints = false
        table.backgroundColor = Self.cream
        table.dataSource = self
        table.delegate = self
        table.isHidden = true
        card.addSubview(table)
        card.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: card.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: card.centerYAnchor),
            label.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 24),
            label.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -24),
            table.topAnchor.constraint(equalTo: card.topAnchor, constant: 8),
            table.bottomAnchor.constraint(equalTo: card.bottomAnchor),
            table.leadingAnchor.constraint(equalTo: card.leadingAnchor),
            table.trailingAnchor.constraint(equalTo: card.trailingAnchor),
        ])

        let config = URLSessionConfiguration.background(withIdentifier: "ch.fernscout.app.share.\(UUID().uuidString)")
        config.sharedContainerIdentifier = ShareCredentialStore.appGroup
        config.isDiscretionary = false
        session = URLSession(configuration: config)

        guard let c = ShareCredentialStore.load() else {
            finish("Open Fernscout once, then share again.", after: 2.5)
            return
        }
        if let until = ISO8601DateFormatter().date(from: c.expiresAt), until < Date() {
            finish("Open Fernscout once to reconnect this iPhone, then share again.", after: 2.5)
            return
        }
        credential = c
        trips = Self.cachedTrips()
        label.isHidden = true
        table.tableHeaderView = Self.header(width: view.bounds.width)
        table.rowHeight = 56
        table.sectionHeaderTopPadding = 8
        table.isHidden = false
        table.reloadData()
        fitSheet()
        refreshTrips(c)
        collectItems { [weak self] files in
            self?.files = files
            self?.collected = true
        }
    }

    // MARK: the list

    /// The waymark, the name and the question, as one header.
    private static func header(width: CGFloat) -> UIView {
        let box = UIView(frame: CGRect(x: 0, y: 0, width: width, height: 118))
        let mark = UIImageView(image: UIImage(named: "Mark"))
        mark.contentMode = .scaleAspectFit
        mark.frame = CGRect(x: (width - 44) / 2, y: 14, width: 44, height: 44)
        let name = UILabel(frame: CGRect(x: 0, y: 62, width: width, height: 20))
        name.text = "Fernscout"
        name.textAlignment = .center
        name.font = UIFont.monospacedSystemFont(ofSize: 12, weight: .semibold)
        name.textColor = .secondaryLabel
        if let text = name.text { name.attributedText = NSAttributedString(string: text.uppercased(), attributes: [.kern: 2.5, .font: name.font!, .foregroundColor: UIColor.secondaryLabel]) }
        let ask = UILabel(frame: CGRect(x: 24, y: 84, width: width - 48, height: 26))
        ask.text = "Which trip is this?"
        ask.textAlignment = .center
        ask.font = .systemFont(ofSize: 20, weight: .semibold)
        ask.textColor = navy
        [mark, name, ask].forEach(box.addSubview)
        return box
    }

    private func iconCell(_ symbol: String, tint: UIColor, fill: UIColor, title: String, detail: String?) -> UITableViewCell {
        let cell = UITableViewCell(style: .subtitle, reuseIdentifier: nil)
        cell.backgroundColor = .white
        cell.textLabel?.text = title
        cell.textLabel?.textColor = Self.navy
        cell.textLabel?.font = .systemFont(ofSize: 17, weight: .medium)
        cell.detailTextLabel?.text = detail
        cell.detailTextLabel?.textColor = .secondaryLabel
        let config = UIImage.SymbolConfiguration(pointSize: 15, weight: .semibold)
        let icon = UIImageView(image: UIImage(systemName: symbol, withConfiguration: config))
        icon.tintColor = tint
        icon.contentMode = .center
        icon.backgroundColor = fill
        icon.layer.cornerRadius = 17
        icon.frame = CGRect(x: 0, y: 0, width: 34, height: 34)
        cell.imageView?.image = nil
        let wrap = UIView(frame: icon.frame)
        wrap.addSubview(icon)
        cell.accessoryView = nil
        cell.contentView.addSubview(wrap)
        wrap.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            wrap.leadingAnchor.constraint(equalTo: cell.contentView.leadingAnchor, constant: 16),
            wrap.centerYAnchor.constraint(equalTo: cell.contentView.centerYAnchor),
            wrap.widthAnchor.constraint(equalToConstant: 34),
            wrap.heightAnchor.constraint(equalToConstant: 34),
        ])
        cell.indentationLevel = 0
        cell.separatorInset = UIEdgeInsets(top: 0, left: 64, bottom: 0, right: 0)
        // Push the labels right of the icon.
        cell.contentView.layoutMargins.left = 64
        cell.textLabel?.translatesAutoresizingMaskIntoConstraints = false
        cell.detailTextLabel?.translatesAutoresizingMaskIntoConstraints = false
        if let t = cell.textLabel, let d = cell.detailTextLabel {
            NSLayoutConstraint.activate([
                t.leadingAnchor.constraint(equalTo: cell.contentView.leadingAnchor, constant: 64),
                t.trailingAnchor.constraint(equalTo: cell.contentView.trailingAnchor, constant: -16),
                t.topAnchor.constraint(equalTo: cell.contentView.topAnchor, constant: detail == nil ? 17 : 9),
                d.leadingAnchor.constraint(equalTo: t.leadingAnchor),
                d.trailingAnchor.constraint(equalTo: t.trailingAnchor),
                d.topAnchor.constraint(equalTo: t.bottomAnchor, constant: 1),
            ])
        }
        return cell
    }

    /// The rows out of a `GET …/trips` body: the trip under way first, then
    /// newest first. The same function reads the cache the app wrote at
    /// connect time and the fresh body from the network.
    private static func parseTrips(_ data: Data) -> [TripRow] {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let list = json["trips"] as? [[String: Any]] else { return [] }
        var rows: [TripRow] = list.compactMap { t in
            guard let id = t["id"] as? String, let title = t["title"] as? String else { return nil }
            let dates = t["dates"] as? [String: Any]
            return TripRow(id: id, title: title, from: dates?["from"] as? String, to: dates?["to"] as? String)
        }
        rows.sort { a, b in
            if a.underWay != b.underWay { return a.underWay }
            return (a.from ?? "") > (b.from ?? "")
        }
        return rows
    }

    private static func cachedTrips() -> [TripRow] {
        guard let data = ShareCredentialStore.defaults?.data(forKey: ShareCredentialStore.tripsKey) else { return [] }
        return parseTrips(data)
    }

    /// Newest first, the trip under way on top. Fetched with the same token
    /// the upload uses; a refusal leaves the cached list alone — a stale list
    /// is still the person's own trips, and the upload itself will say if
    /// the token is gone.
    private func refreshTrips(_ c: ShareCredential) {
        var req = URLRequest(url: URL(string: "\(c.base)/api/v2/\(c.user)/trips?limit=200")!)
        req.setValue("Bearer \(c.token)", forHTTPHeaderField: "Authorization")
        URLSession.shared.dataTask(with: req) { [weak self] data, response, _ in
            guard let data, (response as? HTTPURLResponse)?.statusCode == 200 else { return }
            let rows = Self.parseTrips(data)
            guard !rows.isEmpty else { return }
            ShareCredentialStore.defaults?.set(data, forKey: ShareCredentialStore.tripsKey)
            DispatchQueue.main.async {
                self?.trips = rows
                self?.table.reloadData()
                self?.fitSheet()
            }
        }.resume()
    }

    private static let yellow = UIColor(red: 1.0, green: 0.824, blue: 0.247, alpha: 1)
    private static let yellowSoft = UIColor(red: 1.0, green: 0.953, blue: 0.863, alpha: 1)
    private static let creamDeep = UIColor(red: 1.0, green: 0.914, blue: 0.741, alpha: 1)

    func numberOfSections(in tableView: UITableView) -> Int { 2 }
    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        section == 0 ? shown.count + (hasMore ? 1 : 0) : 1
    }
    func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
        section == 0 && trips.isEmpty ? "No trips yet" : nil
    }
    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        if indexPath.section == 0 {
            if indexPath.row < shown.count {
                let trip = shown[indexPath.row]
                return trip.underWay
                    ? iconCell("figure.walk", tint: Self.navy, fill: Self.yellow, title: trip.title, detail: "Under way")
                    : iconCell("suitcase.fill", tint: Self.navy, fill: Self.creamDeep, title: trip.title, detail: trip.from.map(Self.year) ?? nil)
            }
            return iconCell("chevron.down", tint: .secondaryLabel, fill: Self.yellowSoft, title: "All trips (\(trips.count))", detail: nil)
        }
        return iconCell("tray.fill", tint: Self.navy, fill: Self.creamDeep, title: "Decide later", detail: "Lands in What's waiting")
    }
    private static func year(_ from: String) -> String { String(from.prefix(4)) }
    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        if indexPath.section == 0 && indexPath.row == shown.count {
            showAll = true
            table.reloadSections(IndexSet(integer: 0), with: .fade)
            fitSheet()
            return
        }
        let trip = indexPath.section == 0 ? shown[indexPath.row] : nil
        table.isHidden = true
        label.isHidden = false
        label.text = "Handing over…"
        send(trip: trip)
    }

    // MARK: the upload

    /// Waits for the item copies if the tap came first — a tap is quicker
    /// than a HEIC copy — then hands every file to the background session.
    private func send(trip: TripRow?) {
        guard collected else {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in self?.send(trip: trip) }
            return
        }
        guard let c = credential else { return }
        if files.isEmpty {
            finish("Nothing here that Fernscout can take.", after: 2)
            return
        }
        for file in files { enqueue(file, trip: trip, c) }
        let n = files.count
        let what = "\(n) \(n == 1 ? "photograph" : "photographs")"
        finish(
            heading: trip.map { "On its way to “\($0.title)”" } ?? "On its way to What's waiting",
            line: "\(what) · uploads in the background, originals intact.",
            sent: true,
            after: 2.0
        )
    }

    /// Each attachment copied into the app group as a file, with its own
    /// name and type. A background upload must read from a file, and the
    /// item provider's URL is only valid while the extension lives.
    private func collectItems(_ done: @escaping ([(url: URL, name: String, mime: String)]) -> Void) {
        let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
        let providers = items.flatMap { $0.attachments ?? [] }
        let dir = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: ShareCredentialStore.appGroup)!
            .appendingPathComponent("share-inbox", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        var out: [(URL, String, String)] = []
        let group = DispatchGroup()
        for provider in providers {
            // Photos registers a JPEG it made on the spot *first* and the
            // original (`public.heic`) second, so a HEIC is only handed over
            // when asked for by its own type. Any registered non-JPEG image
            // or movie type is the original; JPEG is the fallback, and it is
            // also what a camera that shoots JPEG genuinely has (B1750, B2113).
            let candidates = provider.registeredTypeIdentifiers
                .compactMap { UTType($0) }
                .filter { $0.conforms(to: .image) || $0.conforms(to: .movie) }
            guard let type = candidates.first(where: { $0 != .jpeg }) ?? candidates.first else { continue }
            group.enter()
            provider.loadFileRepresentation(forTypeIdentifier: type.identifier) { url, _ in
                defer { group.leave() }
                guard let url else { return }
                let name = url.lastPathComponent
                let dest = dir.appendingPathComponent("\(UUID().uuidString)-\(name)")
                guard (try? FileManager.default.copyItem(at: url, to: dest)) != nil else { return }
                let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
                out.append((dest, name, mime))
            }
        }
        group.notify(queue: .main) { done(out.map { (url: $0.0, name: $0.1, mime: $0.2) }) }
    }

    /// One multipart body per file, written beside it, then handed to the
    /// background session. With a trip, `intent.trip` is set and the day
    /// declined; without one, trip and day are both declined — the inbox.
    private func enqueue(_ file: (url: URL, name: String, mime: String), trip: TripRow?, _ c: ShareCredential) {
        let boundary = "fernscout-\(UUID().uuidString)"
        var declined: [String: String] = [
            "day": "shared from the iPhone, not placed on a day yet",
            "caption": "to be written in the studio",
        ]
        var intent: [String: Any] = ["kind": "photo"]
        if let trip { intent["trip"] = trip.id } else { declined["trip"] = "shared from the iPhone, trip not chosen yet" }
        intent["declined"] = declined
        guard let intentData = try? JSONSerialization.data(withJSONObject: intent),
              let intentText = String(data: intentData, encoding: .utf8) else { return }
        var body = Data()
        func part(_ s: String) { body.append(s.data(using: .utf8)!) }
        part("--\(boundary)\r\nContent-Disposition: form-data; name=\"intent\"\r\n\r\n\(intentText)\r\n")
        // A shared file's name is whatever the sender called it; quotes and
        // line breaks in it must not reach the part's header line.
        let safeName = file.name.unicodeScalars.filter { $0.value >= 32 && $0 != "\"" && $0 != "\\" }.map(String.init).joined()
        part("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(safeName)\"\r\nContent-Type: \(file.mime)\r\n\r\n")
        guard let bytes = try? Data(contentsOf: file.url) else { return }
        body.append(bytes)
        part("\r\n--\(boundary)--\r\n")
        let bodyURL = file.url.appendingPathExtension("multipart")
        guard (try? body.write(to: bodyURL)) != nil else { return }
        try? FileManager.default.removeItem(at: file.url)

        var req = URLRequest(url: URL(string: "\(c.base)/api/v2/\(c.user)/media")!)
        req.httpMethod = "POST"
        req.setValue("Bearer \(c.token)", forHTTPHeaderField: "Authorization")
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        session.uploadTask(with: req, fromFile: bodyURL).resume()
    }

    /// The closing card: the mark, a big check for a sent share or nothing
    /// for a message, a heading and one line — the same family as the
    /// picker's header, so the sheet reads as one thing start to end.
    private func finish(_ text: String, after seconds: Double) {
        finish(heading: text, line: nil, sent: false, after: seconds)
    }

    private func finish(heading: String, line: String?, sent: Bool, after seconds: Double) {
        table.isHidden = true
        label.isHidden = true
        let done = UIView()
        done.translatesAutoresizingMaskIntoConstraints = false
        self.card.addSubview(done)
        cardHeight.constant = 300 + view.safeAreaInsets.bottom
        UIView.animate(withDuration: 0.2) { self.view.layoutIfNeeded() }
        let card = done
        let mark = UIImageView(image: UIImage(named: "Mark"))
        mark.contentMode = .scaleAspectFit
        let badge = UIImageView(image: UIImage(systemName: "checkmark", withConfiguration: UIImage.SymbolConfiguration(pointSize: 30, weight: .bold)))
        badge.tintColor = .white
        badge.contentMode = .center
        badge.backgroundColor = UIColor(red: 0.133, green: 0.773, blue: 0.369, alpha: 1) // green-500
        badge.layer.cornerRadius = 32
        badge.isHidden = !sent
        let title = UILabel()
        title.text = heading
        title.numberOfLines = 0
        title.textAlignment = .center
        title.font = .systemFont(ofSize: 22, weight: .semibold)
        title.textColor = Self.navy
        let sub = UILabel()
        sub.text = line
        sub.numberOfLines = 0
        sub.textAlignment = .center
        sub.font = .preferredFont(forTextStyle: .body)
        sub.textColor = .secondaryLabel
        sub.isHidden = line == nil
        let stack = UIStackView(arrangedSubviews: [mark, badge, title, sub])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 14
        stack.setCustomSpacing(22, after: badge)
        stack.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(stack)
        NSLayoutConstraint.activate([
            card.leadingAnchor.constraint(equalTo: self.card.leadingAnchor, constant: 32),
            card.trailingAnchor.constraint(equalTo: self.card.trailingAnchor, constant: -32),
            card.centerYAnchor.constraint(equalTo: self.card.centerYAnchor, constant: -12),
            stack.topAnchor.constraint(equalTo: card.topAnchor),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor),
            mark.widthAnchor.constraint(equalToConstant: 44),
            mark.heightAnchor.constraint(equalToConstant: 44),
            badge.widthAnchor.constraint(equalToConstant: 64),
            badge.heightAnchor.constraint(equalToConstant: 64),
        ])
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds) { [weak self] in
            self?.extensionContext?.completeRequest(returningItems: nil)
        }
    }
}
