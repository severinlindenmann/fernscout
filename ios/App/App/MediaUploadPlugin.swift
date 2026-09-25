import Foundation
import Capacitor

/// The outbox's own native door — B2330. `enqueue` hands one queued
/// photograph's bytes to `MediaUploadSession`'s background `URLSession`;
/// `drainCompleted` is the only way JS ever hears what happened to it. No
/// credential is ever passed in from JS — this reads the same one the share
/// extension mints and refreshes (`ShareCredentialStore`, B2175), the one
/// door the studio already trusts to speak for the owner from the shell.
@objc(MediaUploadPlugin)
public class MediaUploadPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MediaUploadPlugin"
    public let jsName = "MediaUpload"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "enqueue", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "drainCompleted", returnType: CAPPluginReturnPromise),
    ]

    @objc func enqueue(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let base64 = call.getString("base64"),
              let filename = call.getString("filename") else {
            call.reject("id, base64 and filename are required")
            return
        }
        let mimeType = call.getString("mimeType") ?? "application/octet-stream"
        // No credential connected (the phone has never opened the app once
        // to mint one) — the caller's own fallback is the ordinary web path.
        guard let credential = ShareCredentialStore.load(), let data = Data(base64Encoded: base64) else {
            call.resolve(["handedOff": false])
            return
        }
        let ok = MediaUploadSession.shared.enqueue(id: id, data: data, filename: filename, mimeType: mimeType, credential: credential)
        call.resolve(["handedOff": ok])
    }

    @objc func drainCompleted(_ call: CAPPluginCall) {
        let (completed, failed) = MediaUploadSession.drain()
        call.resolve([
            "completed": completed.map { ["id": $0.id, "realId": $0.realId] },
            "failed": failed,
        ])
    }
}
