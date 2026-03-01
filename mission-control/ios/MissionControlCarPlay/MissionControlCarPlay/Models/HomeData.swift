import Foundation

/// Matches the CarPlayHomeData TypeScript interface from the backend.
struct HomeData: Codable {
    let rocketDigest: String?
    let topProjects: [ProjectCard]
    let fleetHealth: FleetHealth
    let burningTasks: [BurningTask]
    let prCiStatus: PrCiStatus
    let mrrGauge: MrrGauge
    let updatedAt: String
}

struct ProjectCard: Codable, Identifiable {
    let id: String
    let name: String
    let statusColor: String // "green", "yellow", "red", "gray"
    let nextAction: String?
    let blockersCount: Int
}

struct FleetHealth: Codable {
    let active: Int
    let total: Int
    let blocked: Int
    let healthColor: String
}

struct BurningTask: Codable, Identifiable {
    let id: String
    let title: String
    let priority: String
    let projectName: String?
}

struct PrCiStatus: Codable {
    let total: Int
    let passing: Int
    let failing: Int
    let pending: Int
}

struct MrrGauge: Codable {
    let current: Double
    let burnRate: Double
    let runway: Double?
    let logScalePercent: Double
}
