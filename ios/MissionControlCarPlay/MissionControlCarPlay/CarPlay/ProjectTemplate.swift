import CarPlay
import Foundation

/// Builds a CarPlay information template for project detail view.
enum ProjectTemplate {

    static func build(from project: ProjectDetail) -> CPInformationTemplate {
        var items: [CPInformationItem] = []

        // Progress
        let progress = project.todayProgress
        items.append(CPInformationItem(
            title: "Progress",
            detail: "\(progress.tasksCompleted)/\(progress.tasksCompleted + progress.tasksPending) tasks (\(progress.percentComplete)%)"
        ))

        // Stage
        items.append(CPInformationItem(
            title: "Stage",
            detail: project.stage
        ))

        // Blockers
        if !project.topBlockers.isEmpty {
            let blockerText = project.topBlockers
                .prefix(3)
                .map { $0.title }
                .joined(separator: "; ")
            items.append(CPInformationItem(
                title: "\(project.topBlockers.count) Blockers",
                detail: blockerText
            ))
        }

        // Next tasks
        if !project.nextTasks.isEmpty {
            let taskText = project.nextTasks
                .prefix(3)
                .map { "[\($0.priority)] \($0.title)" }
                .joined(separator: "; ")
            items.append(CPInformationItem(
                title: "Next Up",
                detail: taskText
            ))
        }

        let template = CPInformationTemplate(
            title: project.projectName,
            layout: .leading,
            items: items,
            actions: []
        )

        return template
    }
}
