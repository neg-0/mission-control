import Foundation

/// Centralized networking layer for the CarPlay API.
/// Auto-injects Bearer tokens and auto-refreshes on 401.
class APIClient {
    static let shared = APIClient()
    private let session: URLSession
    private let decoder = JSONDecoder()

    private init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 10
        config.timeoutIntervalForResource = 30
        session = URLSession(configuration: config)
    }

    // MARK: - Read endpoints

    func fetchHome() async throws -> HomeData {
        try await get(Endpoints.home)
    }

    func fetchAlerts(severity: Int? = nil) async throws -> [AlertData] {
        let url = Endpoints.alertsFiltered(severity: severity)
        let response: AlertsResponse = try await get(url)
        return response.alerts
    }

    func fetchProject(id: String) async throws -> ProjectDetail {
        try await get(Endpoints.project(id: id))
    }

    // MARK: - Write endpoints

    func ackAlert(id: String) async throws {
        let _: [String: String] = try await post(Endpoints.ack, body: ["alertId": id])
    }

    func performAction(action: String, context: String? = nil) async throws {
        var body: [String: String] = ["action": action]
        if let ctx = context { body["context"] = ctx }
        let _: [String: AnyCodable] = try await post(Endpoints.action, body: body)
    }

    func sendMessage(text: String, source: String) async throws -> MessageResponse {
        try await post(Endpoints.message, body: ["text": text, "source": source])
    }

    // MARK: - Generic HTTP

    private func get<T: Decodable>(_ url: URL) async throws -> T {
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        try injectAuth(&request)

        let (data, response) = try await session.data(for: request)

        if let http = response as? HTTPURLResponse, http.statusCode == 401 {
            try await AuthManager.shared.refresh()
            try injectAuth(&request)
            let (retryData, _) = try await session.data(for: request)
            return try decoder.decode(T.self, from: retryData)
        }

        return try decoder.decode(T.self, from: data)
    }

    private func post<T: Decodable>(_ url: URL, body: [String: Any]) async throws -> T {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        try injectAuth(&request)

        let (data, response) = try await session.data(for: request)

        if let http = response as? HTTPURLResponse, http.statusCode == 401 {
            try await AuthManager.shared.refresh()
            try injectAuth(&request)
            let (retryData, _) = try await session.data(for: request)
            return try decoder.decode(T.self, from: retryData)
        }

        return try decoder.decode(T.self, from: data)
    }

    private func injectAuth(_ request: inout URLRequest) throws {
        guard let token = AuthManager.shared.accessToken else {
            throw MCError.notAuthenticated
        }
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    }
}

/// Type-erased Codable wrapper for mixed-type dictionaries.
struct AnyCodable: Codable {
    let value: Any

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let str = try? container.decode(String.self) { value = str }
        else if let int = try? container.decode(Int.self) { value = int }
        else if let bool = try? container.decode(Bool.self) { value = bool }
        else if let double = try? container.decode(Double.self) { value = double }
        else { value = "unknown" }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        if let str = value as? String { try container.encode(str) }
        else if let int = value as? Int { try container.encode(int) }
        else if let bool = value as? Bool { try container.encode(bool) }
        else if let double = value as? Double { try container.encode(double) }
    }
}
