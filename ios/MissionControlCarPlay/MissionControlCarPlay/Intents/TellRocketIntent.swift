import AppIntents
import Foundation

/// Siri intent: "Tell Rocket [message]"
/// Sends a message to the Rocket agent and reads back the CarPlay digest.
struct TellRocketIntent: AppIntent {
    static var title: LocalizedStringResource = "Tell Rocket"
    static var description = IntentDescription("Send a message to Rocket and hear the response.")

    static var openAppWhenRun: Bool = false

    @Parameter(title: "Message", description: "What to tell Rocket")
    var message: String

    static var parameterSummary: some ParameterSummary {
        Summary("Tell Rocket \(\.$message)")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard AuthManager.shared.isAuthenticated else {
            return .result(dialog: "Please open Mission Control on your phone to set up first.")
        }

        do {
            let response = try await APIClient.shared.sendMessage(text: message, source: "siri")
            let digest = response.carplayDigest ?? response.fullText ?? "Rocket didn't have a response."
            return .result(dialog: IntentDialog(stringLiteral: digest))
        } catch {
            return .result(dialog: "Sorry, I couldn't reach Rocket right now.")
        }
    }
}
