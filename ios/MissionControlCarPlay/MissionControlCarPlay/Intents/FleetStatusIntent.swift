import AppIntents
import Foundation

/// Siri intent: "Fleet status"
/// Reads back a summary of fleet health from Mission Control.
struct FleetStatusIntent: AppIntent {
    static var title: LocalizedStringResource = "Fleet Status"
    static var description = IntentDescription("Get a quick summary of your agent fleet health.")

    static var openAppWhenRun: Bool = false

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard AuthManager.shared.isAuthenticated else {
            return .result(dialog: "Please open Mission Control on your phone to set up first.")
        }

        do {
            let home = try await APIClient.shared.fetchHome()
            let fleet = home.fleetHealth
            let burning = home.burningTasks.count
            let ci = home.prCiStatus

            var parts: [String] = []

            // Fleet health
            parts.append("\(fleet.active) of \(fleet.total) agents active")
            if fleet.blocked > 0 {
                parts.append("\(fleet.blocked) blocked")
            }

            // Burning tasks
            if burning > 0 {
                parts.append("\(burning) burning task\(burning == 1 ? "" : "s")")
            }

            // CI status
            if ci.failing > 0 {
                parts.append("\(ci.failing) CI failure\(ci.failing == 1 ? "" : "s")")
            } else {
                parts.append("CI all green")
            }

            // MRR
            let mrr = home.mrrGauge
            let formatted = mrr.current >= 1000
                ? "$\(String(format: "%.1f", mrr.current / 1000))k MRR"
                : "$\(Int(mrr.current)) MRR"
            parts.append(formatted)

            let summary = parts.joined(separator: ". ") + "."
            return .result(dialog: IntentDialog(stringLiteral: summary))
        } catch {
            return .result(dialog: "Sorry, I couldn't get fleet status right now.")
        }
    }
}
