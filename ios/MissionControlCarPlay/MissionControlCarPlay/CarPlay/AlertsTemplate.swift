import CarPlay
import Foundation

/// Builds CarPlay list templates for alerts, grouped by severity.
enum AlertsTemplate {

    /// Build the alerts list from fetched alert data.
    static func build(
        from alerts: [AlertData],
        onAcknowledge: @escaping (String) -> Void
    ) -> CPListTemplate {
        let p0 = alerts.filter { $0.severity == 0 }
        let p1 = alerts.filter { $0.severity == 1 }
        let p2 = alerts.filter { $0.severity == 2 }

        var sections: [CPListSection] = []

        if !p0.isEmpty {
            sections.append(section(title: "P0 — Critical", alerts: p0, onAcknowledge: onAcknowledge))
        }
        if !p1.isEmpty {
            sections.append(section(title: "P1 — Warning", alerts: p1, onAcknowledge: onAcknowledge))
        }
        if !p2.isEmpty {
            sections.append(section(title: "P2 — Info", alerts: p2, onAcknowledge: onAcknowledge))
        }

        if sections.isEmpty {
            let emptyItem = CPListItem(text: "No active alerts", detailText: "All systems nominal")
            sections.append(CPListSection(items: [emptyItem]))
        }

        let template = CPListTemplate(title: "Alerts", sections: sections)
        return template
    }

    // MARK: - Sections

    private static func section(
        title: String,
        alerts: [AlertData],
        onAcknowledge: @escaping (String) -> Void
    ) -> CPListSection {
        let items = alerts.map { alert in
            listItem(for: alert, onAcknowledge: onAcknowledge)
        }
        return CPListSection(items: items, header: title, sectionIndexTitle: nil)
    }

    // MARK: - Items

    private static func listItem(
        for alert: AlertData,
        onAcknowledge: @escaping (String) -> Void
    ) -> CPListItem {
        let repeatText = alert.repeatCount > 1 ? " (×\(alert.repeatCount))" : ""
        let detail = (alert.detail ?? alert.type) + repeatText

        let item = CPListItem(text: alert.title, detailText: detail)
        item.accessoryType = alert.isAcknowledged ? .none : .disclosureIndicator

        if !alert.isAcknowledged {
            item.handler = { _, completion in
                onAcknowledge(alert.id)
                completion()
            }
        }

        return item
    }
}
