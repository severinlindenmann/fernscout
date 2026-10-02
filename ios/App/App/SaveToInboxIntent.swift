import UIKit
import AppIntents

/// The two doors into B2732's sheet beside the can't-reach screen's own
/// button: a dynamic app-icon quick action and an App Intent (Siri /
/// Shortcuts / Spotlight). Both only exist while a `ShareCredential` is
/// stored — `syncQuickAction()` is called after every connect and
/// disconnect (`ShareInboxPlugin`) and once at launch (`AppDelegate`), so a
/// phone that has never opened the app, or was just disconnected, shows
/// neither.
enum SaveToInboxDoors {
    static let quickActionType = "ch.fernscout.app.save-to-inbox"
    /// `ViewController` observes this to present the sheet — posted by the
    /// quick action handler (`SceneDelegate`) and by the App Intent below.
    static let showSheetNotification = Notification.Name("SaveToInboxDoors.showSheet")

    static func syncQuickAction() {
        guard ShareCredentialStore.load() != nil else {
            UIApplication.shared.shortcutItems = []
            return
        }
        let item = UIApplicationShortcutItem(
            type: quickActionType,
            localizedTitle: String(localized: "saveToInbox.title"),
            localizedSubtitle: nil,
            icon: UIApplicationShortcutIcon(systemImageName: "tray.and.arrow.down.fill")
        )
        UIApplication.shared.shortcutItems = [item]
    }

    static func handle(_ item: UIApplicationShortcutItem) -> Bool {
        guard item.type == quickActionType else { return false }
        NotificationCenter.default.post(name: showSheetNotification, object: nil)
        return true
    }
}

/// The App Shortcut itself — iOS 16+. `openAppWhenRun` brings the app to the
/// foreground before `perform()` runs, so the sheet it posts for is
/// presented over the already-loaded WebView rather than racing a cold
/// launch.
@available(iOS 16.0, *)
struct SaveToInboxIntent: AppIntent {
    static var title: LocalizedStringResource = "saveToInboxIntent.title"
    static var openAppWhenRun: Bool = true

    @MainActor
    func perform() async throws -> some IntentResult {
        NotificationCenter.default.post(name: SaveToInboxDoors.showSheetNotification, object: nil)
        return .result()
    }
}

@available(iOS 16.0, *)
struct FernscoutShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: SaveToInboxIntent(),
            phrases: ["Save to \(.applicationName) inbox"],
            shortTitle: "saveToInbox.title",
            systemImageName: "tray.and.arrow.down.fill"
        )
    }
}
