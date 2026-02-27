import Foundation

struct AuthTokens: Codable {
    let accessToken: String
    let refreshToken: String?
    let expiresAt: String
}

struct RefreshResponse: Codable {
    let accessToken: String
    let expiresAt: String
}

struct MessageResponse: Codable {
    let carplayDigest: String?
    let fullText: String?
    let messageId: String
}
