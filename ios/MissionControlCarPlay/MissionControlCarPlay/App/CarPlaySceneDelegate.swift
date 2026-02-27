import CarPlay
import Foundation

/// CarPlay scene delegate — manages the CarPlay interface lifecycle.
class CarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {
    var interfaceController: CPInterfaceController?
    private var templateManager: TemplateManager?
    private var refreshTimer: Timer?

    // MARK: - Lifecycle

    func templateApplicationScene(
        _ templateApplicationScene: CPTemplateApplicationScene,
        didConnect interfaceController: CPInterfaceController
    ) {
        self.interfaceController = interfaceController
        self.templateManager = TemplateManager(interfaceController: interfaceController)

        if AuthManager.shared.isAuthenticated {
            loadHome()
        } else {
            showSetupPrompt()
        }
    }

    func templateApplicationScene(
        _ templateApplicationScene: CPTemplateApplicationScene,
        didDisconnectInterfaceController interfaceController: CPInterfaceController
    ) {
        refreshTimer?.invalidate()
        refreshTimer = nil
        self.interfaceController = nil
        self.templateManager = nil
    }

    // MARK: - Home Screen

    private func loadHome() {
        Task {
            do {
                let home = try await APIClient.shared.fetchHome()
                let template = HomeTemplate.build(from: home, delegate: self)
                interfaceController?.setRootTemplate(template, animated: true, completion: nil)
                startBackgroundRefresh()
            } catch {
                showError("Failed to load: \(error.localizedDescription)")
            }
        }
    }

    private func startBackgroundRefresh() {
        refreshTimer?.invalidate()
        refreshTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            self?.refreshHome()
        }
    }

    private func refreshHome() {
        Task {
            guard let home = try? await APIClient.shared.fetchHome() else { return }
            let template = HomeTemplate.build(from: home, delegate: self)
            interfaceController?.setRootTemplate(template, animated: false, completion: nil)
        }
    }

    // MARK: - Setup / Error

    private func showSetupPrompt() {
        let template = CPInformationTemplate(
            title: "Mission Control",
            layout: .leading,
            items: [
                CPInformationItem(title: "Setup Required", detail: "Open the Mission Control app on your phone to pair this device.")
            ],
            actions: []
        )
        interfaceController?.setRootTemplate(template, animated: true, completion: nil)
    }

    private func showError(_ message: String) {
        let template = CPInformationTemplate(
            title: "Error",
            layout: .leading,
            items: [CPInformationItem(title: "Error", detail: message)],
            actions: []
        )
        interfaceController?.setRootTemplate(template, animated: true, completion: nil)
    }
}

// MARK: - HomeTemplateDelegate

extension CarPlaySceneDelegate: HomeTemplateDelegate {
    func didSelectTile(_ tile: HomeTile) {
        guard let templateManager = templateManager else { return }

        switch tile {
        case .rocketDigest:
            templateManager.showRocketDigest()
        case .topApps:
            templateManager.showTopApps()
        case .fleetHealth:
            templateManager.showFleetHealth()
        case .burningTasks:
            templateManager.showBurningTasks()
        case .prCiStatus:
            templateManager.showPrCiStatus()
        case .mrrGauge:
            templateManager.showMrrGauge()
        }
    }
}
