import Capacitor
import AuthenticationServices
import Security
import UIKit

struct FORMAuthError: Error { let code: String }
private final class FORMRejectRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}

// Shared authenticated boundary for F24; only server-issued identity and Keychain refresh material.
@MainActor enum FORMAuthSessionStore {
    private static var origin: String?
    private static var current: JSObject?
    private static var refreshJob: Task<JSObject, Error>?
    static var generation = 0
    private static var service: String { (Bundle.main.bundleIdentifier ?? "invalid.form.placeholder") + ".form.session" }
    private static var query: [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "refresh", kSecAttrSynchronizable as String: false] }
    static func configure(_ config: PluginConfig) {
        let previous = origin
        defer { if previous != origin { current = nil; generation += 1; refreshJob?.cancel(); refreshJob = nil } }
        origin = nil
        guard config.getBoolean("enabled", false), let value = config.getString("apiOrigin"),
              let allowed = config.getArray("approvedApiOrigins") as? [String], allowed.contains(value),
              let url = URLComponents(string: value), url.scheme == "https", url.host != nil, url.path.isEmpty,
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil else { return }
        origin = value
    }
    static func request(_ path: String, body: JSObject? = nil, access: String? = nil) async throws -> JSObject {
        let paths = ["/auth/challenge", "/auth/apple", "/session/refresh", "/session/logout", "/catalog", "/purchases/verify", "/credits"]
        guard let origin = origin, paths.contains(path), let url = URL(string: origin + "/api/v2" + path) else { throw FORMAuthError(code: "AUTH_DISABLED") }
        var request = URLRequest(url: url); request.httpMethod = body == nil ? "GET" : "POST"
        request.timeoutInterval = 30; request.cachePolicy = .reloadIgnoringLocalCacheData; request.httpShouldHandleCookies = false
        request.setValue("application/json", forHTTPHeaderField: "Content-Type"); request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        if let body = body { request.httpBody = try JSONSerialization.data(withJSONObject: body) }
        if let access = access { request.setValue("Bearer " + access, forHTTPHeaderField: "Authorization") }
        let configuration = URLSessionConfiguration.ephemeral; configuration.httpShouldSetCookies = false
        let session = URLSession(configuration: configuration, delegate: FORMRejectRedirects(), delegateQueue: nil)
        defer { session.finishTasksAndInvalidate() }
        let (data, response) = try await session.data(for: request)
        guard data.count <= 64 * 1024, let http = response as? HTTPURLResponse, http.url == url else { throw FORMAuthError(code: "SESSION_INVALID") }
        if http.statusCode == 204 { return [:] }
        guard let value = (try? JSONSerialization.jsonObject(with: data)) as? JSObject else { throw FORMAuthError(code: "SESSION_INVALID") }
        guard (200...299).contains(http.statusCode) else {
            let code = value["code"] as? String ?? "SESSION_UNAVAILABLE"
            throw FORMAuthError(code: code.range(of: "^[A-Z0-9_]{1,80}$", options: .regularExpression) == nil ? "SESSION_UNAVAILABLE" : code)
        }
        return value
    }
    private static func read() throws -> JSObject? {
        var q = query; q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?; let status = SecItemCopyMatching(q as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data, let value = try JSONSerialization.jsonObject(with: data) as? JSObject else { throw FORMAuthError(code: "KEYCHAIN_UNAVAILABLE") }
        return value
    }
    private static func write(_ value: JSObject) throws {
        let attributes: [String: Any] = [kSecValueData as String: try JSONSerialization.data(withJSONObject: value), kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        let updated = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if updated == errSecItemNotFound {
            guard SecItemAdd(query.merging(attributes) { _, new in new } as CFDictionary, nil) == errSecSuccess else { throw FORMAuthError(code: "KEYCHAIN_UNAVAILABLE") }
        } else if updated != errSecSuccess { throw FORMAuthError(code: "KEYCHAIN_UNAVAILABLE") }
    }
    private static func clear() throws {
        current = nil; let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw FORMAuthError(code: "KEYCHAIN_UNAVAILABLE") }
    }
    private static func expiry(_ value: Any?) -> Date? {
        guard let string = value as? String else { return nil }
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: string)
    }
    private static func token(_ value: Any?) -> String? {
        guard let s = value as? String, s.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil else { return nil }; return s
    }
    static func install(_ pair: JSObject, expectedGeneration: Int, expectedOwner: String? = nil) throws -> JSObject {
        guard expectedGeneration == generation, let origin = origin, let owner = pair["ownerId"] as? String,
              owner.range(of: "^[A-Za-z0-9_-]{1,128}$", options: .regularExpression) != nil, expectedOwner == nil || expectedOwner == owner,
              let access = token(pair["accessToken"]), let refresh = token(pair["refreshToken"]),
              let accessExpiry = expiry(pair["accessExpiresAt"]), let refreshExpiry = expiry(pair["refreshExpiresAt"]), accessExpiry > Date(), refreshExpiry > Date() else { throw FORMAuthError(code: "SESSION_INVALID") }
        try write(["ownerId": owner, "apiOrigin": origin, "refreshToken": refresh, "refreshExpiresAt": pair["refreshExpiresAt"]!])
        let result: JSObject = ["status": "signed_in", "ownerId": owner, "accessToken": access, "accessExpiresAt": pair["accessExpiresAt"]!]
        current = result; return result
    }
    static func session(forceRefresh: Bool = false) async throws -> JSObject {
        guard origin != nil else { throw FORMAuthError(code: "AUTH_DISABLED") }
        if !forceRefresh, let current = current, let date = expiry(current["accessExpiresAt"]), date > Date().addingTimeInterval(30) { return current }
        if let job = refreshJob { return try await job.value }
        let expected = generation
        let job = Task<JSObject, Error> { @MainActor in
            guard let stored = try read() else { return ["status": "signed_out"] }
            guard stored["apiOrigin"] as? String == origin, let refresh = token(stored["refreshToken"]), let owner = stored["ownerId"] as? String,
                  let date = expiry(stored["refreshExpiresAt"]), date > Date() else { try clear(); throw FORMAuthError(code: "SESSION_EXPIRED") }
            do { return try install(await request("/session/refresh", body: ["refreshToken": refresh]), expectedGeneration: expected, expectedOwner: owner) }
            catch { if expected == generation { current = nil }; throw error } // Never blindly resend an uncertain rotated token.
        }
        refreshJob = job; defer { refreshJob = nil }; return try await job.value
    }
    static func owner() async throws -> String {
        let value = try await session(); guard let owner = value["ownerId"] as? String else { throw FORMAuthError(code: "AUTH_REQUIRED") }; return owner
    }
    static func authenticatedRequest(_ path: String, body: JSObject? = nil) async throws -> JSObject {
        guard ["/catalog", "/purchases/verify", "/credits"].contains(path) else { throw FORMAuthError(code: "INVALID_NATIVE_API_PATH") }
        let value = try await session(); guard let access = value["accessToken"] as? String else { throw FORMAuthError(code: "AUTH_REQUIRED") }
        return try await request(path, body: body, access: access)
    }
    static func logout() async throws -> Bool {
        let saved = try read(), previous = current; generation += 1; refreshJob?.cancel(); refreshJob = nil; try clear()
        guard saved != nil || previous != nil else { return false }
        do {
            let access: String
            if let value = previous?["accessToken"] as? String, let date = expiry(previous?["accessExpiresAt"]), date > Date() { access = value }
            else {
                guard let saved = saved, saved["apiOrigin"] as? String == origin, let refresh = token(saved["refreshToken"]) else { return true }
                let pair = try await request("/session/refresh", body: ["refreshToken": refresh]); guard let token = token(pair["accessToken"]) else { return true }; access = token
            }
            _ = try await request("/session/logout", body: [:], access: access); return false
        } catch { return true } // Local Keychain cleared; do not claim remote revocation on network failure.
    }
}

@objc(FORMAuthPlugin)
public final class FORMAuthPlugin: CAPPlugin, CAPBridgedPlugin, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    public let identifier = "FORMAuthPlugin"
    public let jsName = "FORMAuth"
    public let pluginMethods = ["signIn", "restore", "refresh", "logout"].map { CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise) }
    private var pending: CAPPluginCall?
    private var authorization: ASAuthorizationController?
    private var context: (challengeId: String, state: String, generation: Int)?
    @objc public func signIn(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard pending == nil, bridge?.viewController?.view.window != nil else { call.reject("Sign in is unavailable.", "NATIVE_AUTH_BUSY"); return }
            pending = call; FORMAuthSessionStore.configure(getConfig()); let generation = FORMAuthSessionStore.generation
            do {
                let challenge = try await FORMAuthSessionStore.request("/auth/challenge", body: [:])
                guard pending === call, generation == FORMAuthSessionStore.generation, let id = challenge["challengeId"] as? String,
                      let nonce = challenge["nonce"] as? String, nonce.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil else { throw FORMAuthError(code: "AUTH_CHALLENGE_INVALID") }
                var random = [UInt8](repeating: 0, count: 32); guard SecRandomCopyBytes(kSecRandomDefault, random.count, &random) == errSecSuccess else { throw FORMAuthError(code: "AUTH_UNAVAILABLE") }
                let state = Data(random).base64EncodedString(); context = (id, state, generation)
                let request = ASAuthorizationAppleIDProvider().createRequest(); request.nonce = nonce; request.state = state; request.requestedScopes = []
                let controller = ASAuthorizationController(authorizationRequests: [request]); controller.delegate = self; controller.presentationContextProvider = self
                authorization = controller; controller.performRequests()
            } catch { if pending === call { pending = nil; context = nil; self.authorization = nil; call.reject("Sign in could not be completed.", (error as? FORMAuthError)?.code ?? "NATIVE_AUTH_FAILED") } }
        }
    }
    public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor { bridge?.viewController?.view.window ?? ASPresentationAnchor() }
    public func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        Task { @MainActor in
            guard controller === self.authorization else { return }
            guard let call = pending, let context = context else { return }
            do {
                guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential, credential.state == context.state,
                      let data = credential.identityToken, data.count <= 16 * 1024, let identityToken = String(data: data, encoding: .utf8) else { throw FORMAuthError(code: "APPLE_TOKEN_INVALID") }
                let pair = try await FORMAuthSessionStore.request("/auth/apple", body: ["challengeId": context.challengeId, "identityToken": identityToken])
                let result = try FORMAuthSessionStore.install(pair, expectedGeneration: context.generation)
                pending = nil; self.context = nil; self.authorization = nil; call.resolve(result)
            } catch { if pending === call { pending = nil; self.context = nil; self.authorization = nil; call.reject("Sign in could not be verified.", (error as? FORMAuthError)?.code ?? "NATIVE_AUTH_FAILED") } }
        }
    }
    public func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        Task { @MainActor in
            guard controller === self.authorization else { return }
            let call = pending; pending = nil; context = nil; authorization = nil
            if (error as? ASAuthorizationError)?.code == .canceled { call?.resolve(["status": "cancelled"]) }
            else { call?.reject("Sign in could not be completed.", "NATIVE_AUTH_FAILED") }
        }
    }
    private func recover(_ call: CAPPluginCall, force: Bool) {
        Task { @MainActor in
            FORMAuthSessionStore.configure(getConfig())
            do { call.resolve(try await FORMAuthSessionStore.session(forceRefresh: force)) }
            catch { call.reject("Your session could not be verified.", (error as? FORMAuthError)?.code ?? "NATIVE_AUTH_FAILED") }
        }
    }
    @objc public func restore(_ call: CAPPluginCall) { recover(call, force: false) }
    @objc public func refresh(_ call: CAPPluginCall) { recover(call, force: true) }
    @objc public func logout(_ call: CAPPluginCall) {
        Task { @MainActor in
            pending?.resolve(["status": "cancelled"]); pending = nil; context = nil; authorization = nil
            do { call.resolve(["status": "signed_out", "revocationPending": try await FORMAuthSessionStore.logout()]) }
            catch { call.reject("Local session cleanup needs to be retried.", "KEYCHAIN_UNAVAILABLE") }
        }
    }
}
