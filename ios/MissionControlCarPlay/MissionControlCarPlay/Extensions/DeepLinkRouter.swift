import Foundation

/// Shared deep link resolver for missioncontrol:// URLs.
/// Used by both SceneDelegate (opens Safari) and HandoffView (in-app SFSafariViewController).
enum DeepLinkRouter {

    /// Resolve a missioncontrol:// deep link to a web URL.
    /// Returns nil if the user is not authenticated or the URL scheme is wrong.
    static func resolve(_ url: URL) -> URL? {
        guard url.scheme == "missioncontrol",
              AuthManager.shared.isAuthenticated,
              let baseURL = AuthManager.shared.baseURL
        else { return nil }

        let webPath = webPath(for: url)
        return URL(string: "\(baseURL)\(webPath)")
    }

    private static func webPath(for url: URL) -> String {
        let host = url.host ?? ""
        let id = url.pathComponents.dropFirst().first

        switch host {
        case "project":
            if let id = id { return "/projects/\(id)" }
        case "alerts":
            return "/alerts"
        case "fleet":
            return "/fleet"
        default:
            break
        }
        return "/"
    }
}
