import CarPlay
import Foundation

/// Manages navigation and template presentation for the CarPlay interface.
class TemplateManager {
    private let interfaceController: CPInterfaceController
    private var currentHome: HomeData?

    init(interfaceController: CPInterfaceController) {
        self.interfaceController = interfaceController
    }

    /// Cache the latest home data for drill-down screens.
    func updateHome(_ data: HomeData) {
        currentHome = data
    }

    // MARK: - Tile Drill-Downs

    func showRocketDigest() {
        let digest = currentHome?.rocketDigest ?? "No recent digest from Rocket."
        let template = CPInformationTemplate(
            title: "Rocket Latest",
            layout: .leading,
            items: [CPInformationItem(title: "Digest", detail: digest)],
            actions: []
        )
        push(template)
    }

    func showTopApps() {
        guard let projects = currentHome?.topProjects, !projects.isEmpty else {
            showEmpty("No projects to display.")
            return
        }

        let items = projects.map { project -> CPListItem in
            let blockers = project.blockersCount > 0 ? " (\(project.blockersCount) blockers)" : ""
            let detail = (project.nextAction ?? "No pending action") + blockers
            let item = CPListItem(text: project.name, detailText: detail)

            item.handler = { [weak self] _, completion in
                self?.showProjectDetail(id: project.id)
                completion()
            }

            return item
        }

        let template = CPListTemplate(
            title: "Top Apps",
            sections: [CPListSection(items: items)]
        )
        push(template)
    }

    func showFleetHealth() {
        guard let fleet = currentHome?.fleetHealth else {
            showEmpty("Fleet data unavailable.")
            return
        }

        let template = CPInformationTemplate(
            title: "Fleet Health",
            layout: .leading,
            items: [
                CPInformationItem(title: "Active", detail: "\(fleet.active)"),
                CPInformationItem(title: "Total", detail: "\(fleet.total)"),
                CPInformationItem(title: "Blocked", detail: "\(fleet.blocked)"),
                CPInformationItem(title: "Status", detail: fleet.healthColor.capitalized),
            ],
            actions: []
        )
        push(template)
    }

    func showBurningTasks() {
        guard let tasks = currentHome?.burningTasks, !tasks.isEmpty else {
            showEmpty("No burning tasks.")
            return
        }

        let items = tasks.map { task -> CPListItem in
            let detail = "[\(task.priority)] \(task.projectName ?? "Unassigned")"
            return CPListItem(text: task.title, detailText: detail)
        }

        let template = CPListTemplate(
            title: "Burning Tasks",
            sections: [CPListSection(items: items)]
        )
        push(template)
    }

    func showPrCiStatus() {
        guard let ci = currentHome?.prCiStatus else {
            showEmpty("CI data unavailable.")
            return
        }

        let template = CPInformationTemplate(
            title: "PR & CI",
            layout: .leading,
            items: [
                CPInformationItem(title: "Total", detail: "\(ci.total)"),
                CPInformationItem(title: "Passing", detail: "\(ci.passing)"),
                CPInformationItem(title: "Failing", detail: "\(ci.failing)"),
                CPInformationItem(title: "Pending", detail: "\(ci.pending)"),
            ],
            actions: []
        )
        push(template)
    }

    func showMrrGauge() {
        guard let mrr = currentHome?.mrrGauge else {
            showEmpty("MRR data unavailable.")
            return
        }

        var items: [CPInformationItem] = [
            CPInformationItem(title: "MRR", detail: "$\(String(format: "%.0f", mrr.current))"),
            CPInformationItem(title: "Gauge", detail: "\(String(format: "%.0f", mrr.logScalePercent))%"),
            CPInformationItem(title: "Burn Rate", detail: "$\(String(format: "%.0f", mrr.burnRate))/mo"),
        ]

        if let runway = mrr.runway {
            items.append(CPInformationItem(title: "Runway", detail: "\(String(format: "%.1f", runway)) months"))
        }

        let template = CPInformationTemplate(
            title: "MRR Gauge",
            layout: .leading,
            items: items,
            actions: []
        )
        push(template)
    }

    // MARK: - Project Detail

    func showProjectDetail(id: String) {
        Task {
            do {
                let project = try await APIClient.shared.fetchProject(id: id)
                let template = ProjectTemplate.build(from: project)
                await MainActor.run {
                    push(template)
                }
            } catch {
                await MainActor.run {
                    showEmpty("Failed to load project.")
                }
            }
        }
    }

    // MARK: - Alerts

    func showAlerts() {
        Task {
            do {
                let alerts = try await APIClient.shared.fetchAlerts()
                let template = AlertsTemplate.build(from: alerts) { [weak self] alertId in
                    self?.acknowledgeAlert(id: alertId)
                }
                await MainActor.run {
                    push(template)
                }
            } catch {
                await MainActor.run {
                    showEmpty("Failed to load alerts.")
                }
            }
        }
    }

    private func acknowledgeAlert(id: String) {
        Task {
            try? await APIClient.shared.ackAlert(id: id)
            // Refresh alert list — pop current then push updated to avoid stacking
            let alerts = (try? await APIClient.shared.fetchAlerts()) ?? []
            let template = AlertsTemplate.build(from: alerts) { [weak self] alertId in
                self?.acknowledgeAlert(id: alertId)
            }
            await MainActor.run {
                interfaceController.popTemplate(animated: false, completion: nil)
                push(template)
            }
        }
    }

    // MARK: - Helpers

    private func push(_ template: CPTemplate) {
        interfaceController.pushTemplate(template, animated: true, completion: nil)
    }

    private func showEmpty(_ message: String) {
        let template = CPInformationTemplate(
            title: "Info",
            layout: .leading,
            items: [CPInformationItem(title: "", detail: message)],
            actions: []
        )
        push(template)
    }
}
