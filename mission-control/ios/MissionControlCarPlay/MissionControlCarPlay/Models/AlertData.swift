import Foundation

/// Matches the CarPlayAlertResponse TypeScript interface.
struct AlertData: Codable, Identifiable {
    let id: String
    let severity: Int
    let type: String
    let title: String
    let detail: String?
    let triggeredAt: String
    let acknowledgedAt: String?
    let repeatCount: Int

    var severityLabel: String {
        switch severity {
        case 0: return "P0"
        case 1: return "P1"
        case 2: return "P2"
        default: return "P\(severity)"
        }
    }

    var isAcknowledged: Bool {
        acknowledgedAt != nil
    }
}

struct AlertsResponse: Codable {
    let alerts: [AlertData]
    let total: Int
}
