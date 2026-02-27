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
        guard let webURL = DeepLinkRouter.resolve(url) else { return }
        UIApplication.shared.open(webURL)
    }
}
