import AppIntents

/// Registers all Mission Control App Intents with the system.
struct MissionControlShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: TellRocketIntent(),
            phrases: [
                "Tell Rocket \(\.$message) in \(.applicationName)",
                "Tell Rocket \(\.$message)",
                "Ask Rocket \(\.$message) in \(.applicationName)",
            ],
            shortTitle: "Tell Rocket",
            systemImageName: "bubble.left.fill"
        )

        AppShortcut(
            intent: WhatsBurningIntent(),
            phrases: [
                "What's burning in \(.applicationName)",
                "What's burning",
                "Check critical alerts in \(.applicationName)",
            ],
            shortTitle: "What's Burning",
            systemImageName: "flame.fill"
        )

        AppShortcut(
            intent: FleetStatusIntent(),
            phrases: [
                "Fleet status in \(.applicationName)",
                "Fleet status",
                "Agent fleet health in \(.applicationName)",
            ],
            shortTitle: "Fleet Status",
            systemImageName: "antenna.radiowaves.left.and.right"
        )
    }
}
