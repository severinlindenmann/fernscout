import SwiftUI
import PhotosUI
import UniformTypeIdentifiers

/// The sheet behind B2732's "Save to inbox" door — the app-icon quick
/// action, the App Shortcut and B2731's can't-reach screen all present this.
/// SwiftUI, modal, presented from `ViewController`. Picks photographs with
/// `PHPickerViewController` (originals, never re-encoded — the same rule as
/// the share extension, B2113/B2175) and hands each one to `InboxQueue`,
/// which owns the durable store and the background upload.
struct SaveToInboxView: View {
    let credential: ShareCredential
    let onOpenStudioInbox: () -> Void
    let onDismiss: () -> Void

    @State private var trips: [TripList.Row] = TripList.cached()
    @State private var showAllTrips = false
    @State private var selectedTripId: String? // nil = Decide later
    /// The current selection's original files — replaced, never appended,
    /// by each pick, and deleted when the sheet goes away unsaved.
    @State private var picked: [PhotoPicker.File] = []
    private var pickedCount: Int { picked.count }
    @State private var showPicker = false
    @State private var saving = false
    @State private var items: [InboxQueueItem] = InboxQueue.shared.items
    /// Confirmed this session — `InboxQueue` drops a record the moment the
    /// server confirms it, so the "In your inbox" line only exists here,
    /// for as long as this sheet stays open.
    @State private var sentThisSession: Set<String> = []
    @State private var removing: InboxQueueItem?

    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.dismiss) private var dismiss

    private var cream: Color { Color(red: 0xff / 255, green: 0xfa / 255, blue: 0xf0 / 255) }
    private var inkGround: Color { Color(red: 0x14 / 255, green: 0x1b / 255, blue: 0x24 / 255) }
    private var ink: Color { Color(red: 0x1e / 255, green: 0x29 / 255, blue: 0x3b / 255) }
    private var muted: Color {
        colorScheme == .dark
            ? Color(red: 0x9a / 255, green: 0xa8 / 255, blue: 0xbb / 255)
            : Color(red: 0x5a / 255, green: 0x6a / 255, blue: 0x80 / 255)
    }
    private var yellow: Color { Color(red: 0xff / 255, green: 0xd2 / 255, blue: 0x3f / 255) }
    private var background: Color { colorScheme == .dark ? inkGround : cream }
    private var textPrimary: Color { colorScheme == .dark ? cream : ink }

    private static let fewCount = 3
    private var shownTrips: [TripList.Row] { showAllTrips ? trips : Array(trips.prefix(Self.fewCount)) }
    private var hasMoreTrips: Bool { !showAllTrips && trips.count > Self.fewCount }
    private var selectedTrip: TripList.Row? { trips.first { $0.id == selectedTripId } }

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    journalRow
                    tripSection
                    pickButton
                    saveButton
                    Text(String(localized: "saveToInbox.footer"))
                        .font(.footnote)
                        .foregroundColor(muted)
                    if !items.isEmpty || !sentThisSession.isEmpty {
                        onThisPhoneSection
                    }
                }
                .padding(20)
            }
            .background(background.ignoresSafeArea())
            .navigationTitle(String(localized: "saveToInbox.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(action: { onDismiss(); dismiss() }) { Image(systemName: "xmark") }
                }
            }
        }
        .sheet(isPresented: $showPicker) {
            PhotoPicker { files in
                PhotoPicker.discard(picked)
                picked = files
            }
        }
        .onAppear {
            items = InboxQueue.shared.items
            TripList.refresh(credential) { trips = $0 }
            InboxQueue.shared.onChange = { refreshItems() }
        }
        .onDisappear {
            PhotoPicker.discard(picked)
            picked = []
        }
        .alert(
            String(localized: "saveToInbox.remove.title"),
            isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } })
        ) {
            Button(String(localized: "saveToInbox.remove.confirm"), role: .destructive) {
                if let id = removing?.id { InboxQueue.shared.remove(id: id) }
                removing = nil
            }
            Button(String(localized: "saveToInbox.remove.keep"), role: .cancel) { removing = nil }
        } message: {
            Text(String(localized: "saveToInbox.remove.message"))
        }
    }

    private func refreshItems() {
        let previousIds = Set(items.map(\.id))
        let next = InboxQueue.shared.items
        let nextIds = Set(next.map(\.id))
        // Dropped from the queue with no failure state recorded against it
        // anywhere in `next` means the server confirmed it — show "In your
        // inbox" for the rest of this session.
        for id in previousIds.subtracting(nextIds) { sentThisSession.insert(id) }
        items = next
    }

    // MARK: journal + trip

    private var journalRow: some View {
        HStack(spacing: 10) {
            Image(systemName: "book.closed.fill").foregroundColor(textPrimary)
            Text("\(URL(string: credential.base)?.host ?? credential.base) · @\(credential.user)")
                .font(.subheadline.weight(.medium))
                .foregroundColor(textPrimary)
        }
    }

    private var tripSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(String(localized: "shareInbox.whichTrip")).font(.headline).foregroundColor(textPrimary)
            ForEach(shownTrips) { trip in
                tripRow(trip)
            }
            if hasMoreTrips {
                Button(action: { showAllTrips = true }) {
                    Text(String(format: String(localized: "shareInbox.allTrips"), trips.count))
                        .font(.subheadline)
                        .foregroundColor(muted)
                }
            }
            decideLaterRow
        }
    }

    private func tripRow(_ trip: TripList.Row) -> some View {
        Button(action: { selectedTripId = trip.id }) {
            HStack {
                Image(systemName: trip.underWay ? "figure.walk" : "suitcase.fill").foregroundColor(textPrimary)
                VStack(alignment: .leading) {
                    Text(trip.title).foregroundColor(textPrimary)
                    if trip.underWay { Text(String(localized: "shareInbox.underWay")).font(.caption).foregroundColor(muted) }
                }
                Spacer()
                if selectedTripId == trip.id { Image(systemName: "checkmark.circle.fill").foregroundColor(textPrimary) }
            }
            .padding(10)
            .background(selectedTripId == trip.id ? yellow.opacity(0.35) : Color.clear)
            .cornerRadius(10)
        }
        .buttonStyle(.plain)
    }

    private var decideLaterRow: some View {
        Button(action: { selectedTripId = nil }) {
            HStack {
                Image(systemName: "tray.fill").foregroundColor(textPrimary)
                VStack(alignment: .leading) {
                    Text(String(localized: "shareInbox.decideLater")).foregroundColor(textPrimary)
                    Text(String(localized: "shareInbox.decideLater.detail")).font(.caption).foregroundColor(muted)
                }
                Spacer()
                if selectedTripId == nil { Image(systemName: "checkmark.circle.fill").foregroundColor(textPrimary) }
            }
            .padding(10)
            .background(selectedTripId == nil ? yellow.opacity(0.35) : Color.clear)
            .cornerRadius(10)
        }
        .buttonStyle(.plain)
    }

    // MARK: photos + save

    private var pickButton: some View {
        Button(action: { showPicker = true }) {
            Label(String(localized: "saveToInbox.choosePhotos"), systemImage: "photo.on.rectangle")
                .font(.headline)
                .foregroundColor(textPrimary)
                .frame(maxWidth: .infinity, minHeight: 44)
        }
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(textPrimary.opacity(0.25), lineWidth: 1))
    }

    private var saveButton: some View {
        Button(action: save) {
            Text(saveLabel)
                .font(.headline)
                .foregroundColor(ink)
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(pickedCount > 0 ? yellow : yellow.opacity(0.4))
                .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .disabled(pickedCount == 0 || saving)
    }

    /// "Save to inbox" until something is picked — never "Save 0 photos".
    private var saveLabel: String {
        switch pickedCount {
        case 0: return String(localized: "saveToInbox.title")
        case 1: return String(localized: "saveToInbox.save.one")
        default: return String(format: String(localized: "saveToInbox.save"), pickedCount)
        }
    }

    private func save() {
        guard pickedCount > 0 else { return }
        saving = true
        let trip = selectedTrip.map { (id: $0.id, title: $0.title) }
        for file in picked {
            InboxQueue.shared.add(source: file.url, filename: file.name, mime: file.mime, trip: trip, credential: credential)
        }
        PhotoPicker.discard(picked)
        picked = []
        InboxQueue.shared.sendAll()
        saving = false
        refreshItems()
    }

    // MARK: on this phone

    private var onThisPhoneSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Divider()
            Text(String(localized: "saveToInbox.onThisPhone")).font(.headline).foregroundColor(textPrimary)
            ForEach(items) { item in
                itemRow(item)
            }
            ForEach(Array(sentThisSession), id: \.self) { id in
                if !items.contains(where: { $0.id == id }) {
                    HStack {
                        Image(systemName: "checkmark.circle.fill").foregroundColor(.green)
                        Text(String(localized: "saveToInbox.state.sent")).foregroundColor(muted)
                    }
                }
            }
            Button(action: onOpenStudioInbox) {
                Text(String(localized: "saveToInbox.openStudioInbox")).font(.subheadline.weight(.semibold)).foregroundColor(textPrimary)
            }
            .padding(.top, 4)
        }
    }

    private func itemRow(_ item: InboxQueueItem) -> some View {
        HStack {
            stateIcon(item.state)
            VStack(alignment: .leading) {
                Text(item.filename).lineLimit(1).foregroundColor(textPrimary)
                Text(stateLabel(item)).font(.caption).foregroundColor(muted)
            }
            Spacer()
        }
        .contentShape(Rectangle())
        .swipeActions {
            Button(role: .destructive) { removing = item } label: {
                Label(String(localized: "saveToInbox.remove.confirm"), systemImage: "trash")
            }
        }
    }

    private func stateIcon(_ state: InboxQueueState) -> some View {
        let (symbol, color): (String, Color) = {
            switch state {
            case .waiting: return ("clock", muted)
            case .reconnect: return ("exclamationmark.triangle.fill", .orange)
            case .refused: return ("xmark.circle.fill", .red)
            }
        }()
        return Image(systemName: symbol).foregroundColor(color)
    }

    private func stateLabel(_ item: InboxQueueItem) -> String {
        switch item.state {
        case .waiting: return String(localized: "saveToInbox.state.waiting")
        case .reconnect: return String(localized: "saveToInbox.state.reconnect")
        case .refused: return item.message ?? String(localized: "saveToInbox.state.refused")
        }
    }
}

/// `PHPickerViewController` wrapped for SwiftUI — unlimited images, no
/// `Photos` permission prompt (the system picker runs out-of-process).
/// Originals are copied into a temp file per selection and handed to the
/// sheet as that pick's whole selection, the way the share extension's own
/// `collectItems` copies its attachments.
struct PhotoPicker: UIViewControllerRepresentable {
    struct File { let url: URL; let name: String; let mime: String }

    /// Called once per pick with that pick's files — the whole selection,
    /// so the sheet replaces what it held rather than adding to it.
    let onPicked: ([File]) -> Void

    static func discard(_ files: [File]) {
        for file in files { try? FileManager.default.removeItem(at: file.url) }
    }

    func makeUIViewController(context: Context) -> PHPickerViewController {
        var config = PHPickerConfiguration()
        config.filter = .images
        config.selectionLimit = 0
        config.preferredAssetRepresentationMode = .current
        let picker = PHPickerViewController(configuration: config)
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: PHPickerViewController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, PHPickerViewControllerDelegate {
        let parent: PhotoPicker
        init(_ parent: PhotoPicker) { self.parent = parent }

        func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
            picker.dismiss(animated: true)
            // Cancel hands back no results: keep whatever was picked before.
            guard !results.isEmpty,
                  let dir = try? FileManager.default.url(for: .itemReplacementDirectory, in: .userDomainMask, appropriateFor: FileManager.default.temporaryDirectory, create: true) else { return }
            let group = DispatchGroup()
            let lock = NSLock()
            var files: [File] = []
            for result in results {
                let provider = result.itemProvider
                let candidates = provider.registeredTypeIdentifiers
                    .compactMap { UTType($0) }
                    .filter { $0.conforms(to: .image) }
                guard let type = candidates.first(where: { $0 != .jpeg }) ?? candidates.first else { continue }
                group.enter()
                provider.loadFileRepresentation(forTypeIdentifier: type.identifier) { url, _ in
                    defer { group.leave() }
                    guard let url else { return }
                    let name = url.lastPathComponent
                    let dest = dir.appendingPathComponent("\(UUID().uuidString)-\(name)")
                    guard (try? FileManager.default.copyItem(at: url, to: dest)) != nil else { return }
                    let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
                    lock.lock()
                    files.append(File(url: dest, name: name, mime: mime))
                    lock.unlock()
                }
            }
            group.notify(queue: .main) { [parent] in parent.onPicked(files) }
        }
    }
}
