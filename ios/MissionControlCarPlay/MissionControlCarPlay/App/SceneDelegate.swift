import UIKit
import SwiftUI

/// Phone scene delegate — handles deep links from CarPlay handoff.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        window.rootViewController = UIHostingController(rootView: ContentView())
        self.window = window
        window.makeKeyAndVisible()

        // Handle any URLs passed at launch
        if let url = connectionOptions.urlContexts.first?.url {
            handleDeepLink(url)
        }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        guard let url = URLContexts.first?.url else { return }
        handleDeepLink(url)
    }

    private func handleDeepLink(_ url: URL) {
        // missioncontrol://project/compiq → open web MC
        // missioncontrol://alerts → open web MC alerts
        // missioncontrol://fleet → open web MC fleet view
        guard url.scheme == "missioncontrol" else { return }

        let baseURL = AuthManager.shared.baseURL ?? "https://mc.neg0.cloud"
        var webPath = "/"

        switch url.host {
        case "project":
            if let projectId = url.pathComponents.dropFirst().first {
                webPath = "/projects/\(projectId)"
            }
        case "alerts":
            webPath = "/alerts"
        case "fleet":
            webPath = "/"
        default:
            break
        }

        // Open in Safari
        if let webURL = URL(string: "\(baseURL)\(webPath)") {
            UIApplication.shared.open(webURL)
        }
    }
}
