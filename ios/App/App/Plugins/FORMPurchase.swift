import Capacitor
import StoreKit
import Security
import UIKit

@objc(FORMPurchasePlugin)
public final class FORMPurchasePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FORMPurchasePlugin"
    public let jsName = "FORMPurchase"
    public let pluginMethods = ["products", "purchase", "recover", "balance", "refundHelp"].map { CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise) }
    private var updates: Task<Void, Never>?
    private var productsByID: [String: Product] = [:]
    private var unitsByID: [String: Int] = [:]
    private var confirming: Set<UInt64> = []
    private var purchasing = false
    public override func load() {
        guard getConfig().getBoolean("enabled", false) else { return }
        updates = Task { @MainActor [weak self] in
            for await result in Transaction.updates {
                guard !Task.isCancelled, let self = self else { return }
                let outcome = await self.confirm(result)
                self.notifyListeners("purchaseUpdate", data: ["status": outcome["status"] ?? "awaiting_confirmation"])
            }
        }
    }
    deinit { updates?.cancel() }
    @MainActor private func settings() throws -> (environment: String, countries: [String]) {
        guard getConfig().getBoolean("enabled", false), let environment = getConfig().getString("environment"), ["Production", "Sandbox"].contains(environment),
              let countries = getConfig().getArray("approvedStorefronts") as? [String], !countries.isEmpty,
              countries.allSatisfy({ $0.range(of: "^[A-Z]{3}$", options: .regularExpression) != nil }) else { throw FORMAuthError(code: "PURCHASES_DISABLED") }
        return (environment, countries)
    }
    @MainActor private func pendingQuery(_ owner: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: (Bundle.main.bundleIdentifier ?? "invalid.form.placeholder") + ".form.purchase-pending", kSecAttrAccount as String: owner, kSecAttrSynchronizable as String: false]
    }
    @MainActor private func pending(_ owner: String) throws -> Set<String> {
        var query = pendingQuery(owner); query[kSecReturnData as String] = true; query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?; let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return [] }
        guard status == errSecSuccess, let data = result as? Data, let ids = try JSONSerialization.jsonObject(with: data) as? [String] else { throw FORMAuthError(code: "KEYCHAIN_UNAVAILABLE") }
        return Set(ids)
    }
    @MainActor private func writePending(_ ids: Set<String>, owner: String) throws {
        let query = pendingQuery(owner), data = try JSONSerialization.data(withJSONObject: Array(ids).sorted())
        let values: [String: Any] = [kSecValueData as String: data, kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        let status = SecItemUpdate(query as CFDictionary, values as CFDictionary)
        if status == errSecItemNotFound {
            guard SecItemAdd(query.merging(values) { _, new in new } as CFDictionary, nil) == errSecSuccess else { throw FORMAuthError(code: "KEYCHAIN_UNAVAILABLE") }
        } else if status != errSecSuccess { throw FORMAuthError(code: "KEYCHAIN_UNAVAILABLE") }
    }
    @MainActor private func loadProducts() async throws -> JSObject {
        let config = try settings(), owner = try await FORMAuthSessionStore.owner()
        let storefront = await Storefront.current
        guard let country = storefront?.countryCode, config.countries.contains(country) else { throw FORMAuthError(code: "STOREFRONT_UNAVAILABLE") }
        let server = try await FORMAuthSessionStore.authenticatedRequest("/catalog")
        guard server["enabled"] as? Bool == true, let catalog = server["products"] as? [JSObject], !catalog.isEmpty, catalog.count <= 2 else { throw FORMAuthError(code: "PURCHASES_DISABLED") }
        var units: [String: Int] = [:]
        for item in catalog {
            guard let id = item["productId"] as? String, id.range(of: "^[A-Za-z0-9][A-Za-z0-9.-]{0,254}$", options: .regularExpression) != nil,
                  let count = item["units"] as? Int, [5, 15].contains(count), units[id] == nil else { throw FORMAuthError(code: "CATALOG_MISMATCH") }
            units[id] = count
        }
        let products = try await Product.products(for: Array(units.keys))
        guard products.count == units.count, products.allSatisfy({ $0.type == .consumable && units[$0.id] != nil }) else { throw FORMAuthError(code: "CATALOG_MISMATCH") }
        guard try await FORMAuthSessionStore.owner() == owner else { throw FORMAuthError(code: "PURCHASE_ACCOUNT_TOKEN_MISMATCH") }
        productsByID = Dictionary(uniqueKeysWithValues: products.map { ($0.id, $0) }); unitsByID = units
        let pendingIDs = try pending(owner)
        return ["ownerId": owner, "storefront": country, "environment": config.environment, "pendingProductIds": Array(pendingIDs), "products": products.sorted { $0.id < $1.id }.map {
            ["productId": $0.id, "units": units[$0.id]!, "displayPrice": $0.displayPrice, "type": "consumable"] as JSObject
        }]
    }
    @MainActor private func readBalance() async throws -> JSObject {
        let owner = try await FORMAuthSessionStore.owner(), result = try await FORMAuthSessionStore.authenticatedRequest("/credits")
        guard result["ownerId"] as? String == owner, result["scope"] as? String == "live", let units = result["availableUnits"] as? Int, units >= 0,
              try await FORMAuthSessionStore.owner() == owner else { throw FORMAuthError(code: "BALANCE_UNAVAILABLE") }
        return ["ownerId": owner, "scope": "live", "availableUnits": units]
    }
    @MainActor private func confirm(_ result: VerificationResult<Transaction>) async -> JSObject {
        guard case .verified(let transaction) = result, !confirming.contains(transaction.id) else { return ["status": "awaiting_confirmation"] }
        confirming.insert(transaction.id); defer { confirming.remove(transaction.id) }
        do {
            let config = try settings(), owner = try await FORMAuthSessionStore.owner()
            guard transaction.appAccountToken?.uuidString.lowercased() == owner.lowercased(), transaction.productType == .consumable, transaction.quantity == 1 else { throw FORMAuthError(code: "PURCHASE_ACCOUNT_TOKEN_MISMATCH") }
            if #available(iOS 16.0, *) {
                guard (transaction.environment == .production && config.environment == "Production") || (transaction.environment == .sandbox && config.environment == "Sandbox") else { throw FORMAuthError(code: "PURCHASE_ENVIRONMENT_MISMATCH") }
            }
            // This server call is the only durable-credit acknowledgment; signed material never reaches JS/logs.
            let ack = try await FORMAuthSessionStore.authenticatedRequest("/purchases/verify", body: ["signedTransaction": result.jwsRepresentation, "environment": config.environment])
            guard let status = ack["status"] as? String, ["credited", "already-credited"].contains(status), ack["scope"] as? String == "live",
                  let units = ack["units"] as? Int, [5, 15].contains(units), let id = ack["purchaseId"] as? String, !id.isEmpty,
                  try await FORMAuthSessionStore.owner() == owner else { throw FORMAuthError(code: "PURCHASE_ACK_INVALID") }
            var ids = try pending(owner); ids.remove(transaction.productID); try writePending(ids, owner: owner)
            await transaction.finish()
            return ["status": "credited"]
        } catch { return ["status": "awaiting_confirmation"] }
    }
    @objc public func products(_ call: CAPPluginCall) {
        Task { @MainActor in
            do { call.resolve(try await loadProducts()) }
            catch { productsByID.removeAll(); unitsByID.removeAll(); call.reject("Purchases are unavailable.", (error as? FORMAuthError)?.code ?? "PURCHASES_UNAVAILABLE") }
        }
    }
    @objc public func purchase(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard !purchasing else { call.resolve(["status": "awaiting_confirmation"]); return }
            purchasing = true; defer { purchasing = false }
            do {
                _ = try await loadProducts(); _ = try await readBalance()
                let owner = try await FORMAuthSessionStore.owner()
                guard let accountToken = UUID(uuidString: owner), let id = call.getString("productId"), let product = productsByID[id] else { throw FORMAuthError(code: "AUTH_REQUIRED") }
                var ids = try pending(owner)
                guard ids.isEmpty, confirming.isEmpty else { call.resolve(["status": "pending"]); return }
                for await unfinished in Transaction.unfinished {
                    switch unfinished {
                    case .verified(let transaction), .unverified(let transaction, _):
                        if transaction.productID == id { call.resolve(["status": "awaiting_confirmation"]); return }
                    }
                }
                // Persist before entering the Apple sheet: app death must not invite a second payment.
                ids.insert(id); try writePending(ids, owner: owner)
                do {
                    switch try await product.purchase(options: [.appAccountToken(accountToken)]) {
                    case .success(let result): call.resolve(await confirm(result))
                    case .pending: call.resolve(["status": "pending"])
                    case .userCancelled: ids.remove(id); try writePending(ids, owner: owner); call.resolve(["status": "cancelled"])
                    @unknown default: call.resolve(["status": "awaiting_confirmation"])
                    }
                } catch { call.resolve(["status": "awaiting_confirmation"]) }
            } catch { call.resolve(["status": "unavailable"]) } // Failed preflight never enters Apple payment UI.
        }
    }
    @objc public func recover(_ call: CAPPluginCall) {
        Task { @MainActor in
            do {
                _ = try settings(); let owner = try await FORMAuthSessionStore.owner(); var unresolved = false
                for await result in Transaction.unfinished {
                    let outcome = await confirm(result); if outcome["status"] as? String != "credited" { unresolved = true }
                }
                call.resolve(["pending": unresolved || !(try pending(owner)).isEmpty])
            } catch { call.reject("Purchase confirmation is unavailable.", "PURCHASES_UNAVAILABLE") }
        }
    }
    @objc public func balance(_ call: CAPPluginCall) {
        Task { @MainActor in
            do { call.resolve(try await readBalance()) }
            catch { call.reject("Your balance could not be verified.", "BALANCE_UNAVAILABLE") }
        }
    }
    @objc public func refundHelp(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let url = URL(string: "https://reportaproblem.apple.com") else { call.reject("Refund help is unavailable.", "UNAVAILABLE"); return }
            UIApplication.shared.open(url, options: [:]) { opened in call.resolve(["status": opened ? "opened" : "unavailable"]) }
        }
    }
}
