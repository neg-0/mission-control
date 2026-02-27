import Foundation

/// Matches the CarPlayProjectDetail TypeScript interface.
struct ProjectDetail: Codable {
    let projectName: String
    let stage: String
    let todayProgress: Progress
    let topBlockers: [Blocker]
    let nextTasks: [ProjectTask]

    struct Progress: Codable {
        let tasksCompleted: Int
        let tasksPending: Int
        let percentComplete: Int
    }

    struct Blocker: Codable, Identifiable {
        let id: String
        let title: String
        let severity: String
    }

    struct ProjectTask: Codable, Identifiable {
        let id: String
        let title: String
        let priority: String
        let status: String
    }
}
