import AppIntents
import Foundation

/// Siri intent: "What's burning?"
/// Reads back the top P0 alerts from Mission Control.
struct WhatsBurningIntent: AppIntent {
    static var title: LocalizedStringResource = "What's Burning"
    static var description = IntentDescription("Check for critical alerts in Mission Control.")

    static var openAppWhenRun: Bool = false

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard AuthManager.shared.isAuthenticated else {
            return .result(dialog: "Please open Mission Control on your phone to set up first.")
        }

        do {
            let alerts = try await APIClient.shared.fetchAlerts(severity: 0)

            if alerts.isEmpty {
                return .result(dialog: "Nothing's burning. All systems are clear.")
            }

            let top3 = alerts.prefix(3)
            let summary = top3.enumerated().map { index, alert in
                "\(index + 1). \(alert.title)"
            }.joined(separator: ". ")

            let total = alerts.count
            let suffix = total > 3 ? " Plus \(total - 3) more." : ""

            return .result(dialog: IntentDialog(stringLiteral: "\(total) critical alert\(total == 1 ? "" : "s"). \(summary).\(suffix)"))
        } catch {
            return .result(dialog: "Sorry, I couldn't check alerts right now.")
        }
    }
}
