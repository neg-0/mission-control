import Foundation

/// Shared formatters used across CarPlay templates and Siri intents.
enum Formatters {

    /// Format a dollar amount as "$X" or "$X.Xk" for values >= 1000.
    static func currency(_ value: Double) -> String {
        if value >= 1000 {
            return "$\(String(format: "%.1f", value / 1000))k"
        }
        return "$\(Int(value))"
    }

    /// Format a dollar amount with "MRR" suffix for spoken Siri responses.
    static func mrrSpeakable(_ value: Double) -> String {
        "\(currency(value)) MRR"
    }
}
