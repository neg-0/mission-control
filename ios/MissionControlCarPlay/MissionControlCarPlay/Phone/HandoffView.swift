import SafariServices
import SwiftUI

/// Handles deep links from CarPlay handoff.
/// Opens the full Mission Control web UI in an in-app Safari view.
struct HandoffView: View {
    let deepLink: URL

    @State private var showSafari = true

    var body: some View {
        VStack {
            if showSafari, let webURL = DeepLinkRouter.resolve(deepLink) {
                SafariView(url: webURL)
                    .ignoresSafeArea()
            } else {
                ContentView()
            }
        }
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
