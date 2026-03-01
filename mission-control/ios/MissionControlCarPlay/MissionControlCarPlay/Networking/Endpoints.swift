import Foundation

/// URL construction for CarPlay API endpoints.
enum Endpoints {
    static var base: String {
        AuthManager.shared.baseURL ?? "http://localhost:3000"
    }

    static var home: URL { URL(string: "\(base)/api/carplay/home")! }
    static var alerts: URL { URL(string: "\(base)/api/carplay/alerts")! }
    static var ack: URL { URL(string: "\(base)/api/carplay/ack")! }
    static var action: URL { URL(string: "\(base)/api/carplay/action")! }
    static var message: URL { URL(string: "\(base)/api/carplay/message")! }
    static var auth: URL { URL(string: "\(base)/api/carplay/auth")! }

    static func project(id: String) -> URL {
        URL(string: "\(base)/api/carplay/project/\(id)")!
    }

    static func alertsFiltered(severity: Int? = nil) -> URL {
        var components = URLComponents(url: alerts, resolvingAgainstBaseURL: false)!
        var items: [URLQueryItem] = []
        if let sev = severity {
            items.append(URLQueryItem(name: "severity", value: "\(sev)"))
        }
        if !items.isEmpty { components.queryItems = items }
        return components.url!
    }
}
