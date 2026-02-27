import SafariServices
import SwiftUI

/// Handles deep links from CarPlay handoff.
/// Opens the full Mission Control web UI in an in-app Safari view.
struct HandoffView: View {
    let deepLink: URL

    @State private var showSafari = true

    var body: some View {
        VStack {
            if showSafari, let webURL = resolveWebURL(from: deepLink) {
                SafariView(url: webURL)
                    .ignoresSafeArea()
            } else {
                ContentView()
            }
        }
    }

    /// Converts a missioncontrol:// deep link to the corresponding web URL.
    private func resolveWebURL(from deepLink: URL) -> URL? {
        guard let base = AuthManager.shared.baseURL else { return nil }

        let path = deepLink.host ?? ""
        let id = deepLink.pathComponents.dropFirst().first

        switch path {
        case "project":
            if let id = id {
                return URL(string: "\(base)/projects/\(id)")
            }
        case "alerts":
            return URL(string: "\(base)/alerts")
        case "fleet":
            return URL(string: "\(base)/fleet")
        default:
            break
        }

        return URL(string: base)
    }
}

/// SwiftUI wrapper for SFSafariViewController.
struct SafariView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        SFSafariViewController(url: url)
    }

    func updateUIViewController(_ uiViewController: SFSafariViewController, context: Context) {}
}
