import Foundation
import UIKit

/// Manages CarPlay authentication tokens with secure Keychain storage.
class AuthManager: ObservableObject {
    static let shared = AuthManager()

    @Published var isAuthenticated: Bool = false
    @Published var baseURL: String?

    private static let accessTokenKey = "carplay_access_token"
    private static let refreshTokenKey = "carplay_refresh_token"
    private static let baseURLKey = "carplay_base_url"
    private static let expiresAtKey = "carplay_expires_at"

    private init() {
        baseURL = UserDefaults.standard.string(forKey: Self.baseURLKey)
        isAuthenticated = Keychain.load(key: Self.accessTokenKey) != nil
    }

    // MARK: - Token Access

    var accessToken: String? {
        Keychain.load(key: Self.accessTokenKey)
    }

    var refreshToken: String? {
        Keychain.load(key: Self.refreshTokenKey)
    }

    var isTokenExpired: Bool {
        guard let expiresStr = UserDefaults.standard.string(forKey: Self.expiresAtKey),
              let expiresDate = ISO8601DateFormatter().date(from: expiresStr)
        else { return true }
        return Date() >= expiresDate
    }

    // MARK: - Pairing

    func pair(baseURL: String, deviceSecret: String) async throws {
        let url = URL(string: "\(baseURL)/api/carplay/auth")!
        let deviceId = UIDevice.current.identifierForVendor?.uuidString ?? UUID().uuidString

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode([
            "deviceId": deviceId,
            "secret": deviceSecret,
        ])

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 201 else {
            throw MCError.pairingFailed
        }

        let tokens = try JSONDecoder().decode(AuthTokens.self, from: data)
        saveTokens(tokens, baseURL: baseURL)
    }

    // MARK: - Token Refresh

    func refresh() async throws {
        guard let base = baseURL, let refresh = refreshToken else {
            throw MCError.notAuthenticated
        }

        let url = URL(string: "\(base)/api/carplay/auth")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["refreshToken": refresh])

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            logout()
            throw MCError.refreshFailed
        }

        let refreshed = try JSONDecoder().decode(RefreshResponse.self, from: data)
        Keychain.save(key: Self.accessTokenKey, value: refreshed.accessToken)
        UserDefaults.standard.set(refreshed.expiresAt, forKey: Self.expiresAtKey)

        await MainActor.run { isAuthenticated = true }
    }

    // MARK: - Storage

    private func saveTokens(_ tokens: AuthTokens, baseURL: String) {
        Keychain.save(key: Self.accessTokenKey, value: tokens.accessToken)
        if let refresh = tokens.refreshToken {
            Keychain.save(key: Self.refreshTokenKey, value: refresh)
        }
        UserDefaults.standard.set(baseURL, forKey: Self.baseURLKey)
        UserDefaults.standard.set(tokens.expiresAt, forKey: Self.expiresAtKey)
        self.baseURL = baseURL

        Task { @MainActor in
            isAuthenticated = true
        }
    }

    func logout() {
        Keychain.delete(key: Self.accessTokenKey)
        Keychain.delete(key: Self.refreshTokenKey)
        UserDefaults.standard.removeObject(forKey: Self.expiresAtKey)

        Task { @MainActor in
            isAuthenticated = false
        }
    }
}

enum MCError: LocalizedError {
    case pairingFailed
    case refreshFailed
    case notAuthenticated
    case networkError(String)

    var errorDescription: String? {
        switch self {
        case .pairingFailed: return "Device pairing failed. Check your secret."
        case .refreshFailed: return "Session expired. Please re-pair."
        case .notAuthenticated: return "Not authenticated."
        case .networkError(let msg): return msg
        }
    }
}
