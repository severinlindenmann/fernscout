import Foundation
import Capacitor
import StoreKit

/// StoreKit 2 in-app purchase — B2598. Apple 3.1.3(b) requires the app to
/// sell the same plan the web sells through Apple's own purchase, so this is
/// the app's only door to Plus and the Trip pass; nothing here talks to
/// Stripe or points at a web checkout.
///
/// A purchase's signed transaction (its JWS) is handed to the page
/// unfinished; `finishTransaction` is called only after the server has
/// verified and granted it, so a crash or a dropped network call between
/// purchase and verification leaves the transaction outstanding — StoreKit
/// (and `restorePurchases`) will hand it to us again rather than losing it.
@available(iOS 15.0, *)
@objc(AppleIAPPlugin)
public class AppleIAPPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppleIAPPlugin"
    public let jsName = "AppleIAP"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "loadProducts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restorePurchases", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finishTransaction", returnType: CAPPluginReturnPromise),
    ]

    @objc func loadProducts(_ call: CAPPluginCall) {
        guard let ids = call.getArray("productIds", String.self) else {
            call.reject("productIds is required")
            return
        }
        Task {
            do {
                let products = try await Product.products(for: ids)
                call.resolve([
                    "products": products.map { [
                        "id": $0.id,
                        "displayName": $0.displayName,
                        "displayPrice": $0.displayPrice,
                    ] }
                ])
            } catch {
                call.reject("could not load products", nil, error)
            }
        }
    }

    @objc func purchase(_ call: CAPPluginCall) {
        guard let productId = call.getString("productId"), let tokenString = call.getString("appAccountToken"),
              let appAccountToken = UUID(uuidString: tokenString) else {
            call.reject("productId and a valid appAccountToken are required")
            return
        }
        Task {
            do {
                guard let product = try await Product.products(for: [productId]).first else {
                    call.reject("unknown product")
                    return
                }
                let result = try await product.purchase(options: [.appAccountToken(appAccountToken)])
                switch result {
                case .success(let verification):
                    switch verification {
                    case .verified(let transaction):
                        call.resolve(["transactionJws": verification.jwsRepresentation, "transactionId": String(transaction.id)])
                    case .unverified:
                        // StoreKit's own local verification failed — never hand this to
                        // the server as if it were trustworthy.
                        call.reject("purchase could not be verified locally")
                    }
                case .userCancelled:
                    call.resolve(["cancelled": true])
                case .pending:
                    call.resolve(["pending": true])
                @unknown default:
                    call.reject("unknown purchase result")
                }
            } catch {
                call.reject("purchase failed", nil, error)
            }
        }
    }

    /// Every current entitlement's own signed transaction, unfinished ones
    /// included — the same JWS `purchase()` hands the page, so the page
    /// posts each to the same verify-purchase route (which is idempotent on
    /// `originalTransactionId`, so replaying an already-granted one is free).
    @objc func restorePurchases(_ call: CAPPluginCall) {
        Task {
            do {
                try await AppStore.sync()
            } catch {
                // Sync failing (offline, no Apple ID) still lets local
                // entitlements answer — best effort, not fatal.
            }
            var jwsList: [String] = []
            for await result in Transaction.currentEntitlements {
                if case .verified = result {
                    jwsList.append(result.jwsRepresentation)
                }
            }
            call.resolve(["transactions": jwsList])
        }
    }

    @objc func finishTransaction(_ call: CAPPluginCall) {
        guard let idString = call.getString("transactionId"), let id = UInt64(idString) else {
            call.reject("transactionId is required")
            return
        }
        Task {
            for await result in Transaction.unfinished {
                if case .verified(let transaction) = result, transaction.id == id {
                    await transaction.finish()
                    break
                }
            }
            call.resolve()
        }
    }
}
