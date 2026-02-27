import CarPlay
import Foundation

/// Enumerates the six home screen tiles.
enum HomeTile: CaseIterable {
    case rocketDigest
    case topApps
    case fleetHealth
    case burningTasks
    case prCiStatus
    case mrrGauge
}

/// Delegate for home screen tile selection.
protocol HomeTemplateDelegate: AnyObject {
    func didSelectTile(_ tile: HomeTile)
}

/// Builds the CarPlay home CPGridTemplate from HomeData.
enum HomeTemplate {
    static func build(from data: HomeData, delegate: HomeTemplateDelegate) -> CPGridTemplate {
        let buttons = HomeTile.allCases.map { tile in
            gridButton(for: tile, data: data, delegate: delegate)
        }

        let template = CPGridTemplate(title: "Mission Control", gridButtons: buttons)
        return template
    }

    // MARK: - Button Factory

    private static func gridButton(
        for tile: HomeTile,
        data: HomeData,
        delegate: HomeTemplateDelegate
    ) -> CPGridButton {
        let (title, image) = metadata(for: tile, data: data)

        let button = CPGridButton(titleVariants: [title], image: image) { _ in
            delegate.didSelectTile(tile)
        }
        return button
    }

    private static func metadata(for tile: HomeTile, data: HomeData) -> (String, UIImage) {
        switch tile {
        case .rocketDigest:
            let hasDigest = data.rocketDigest != nil
            return (
                hasDigest ? "Rocket" : "No Digest",
                systemImage("bubble.left.fill")
            )

        case .topApps:
            let count = data.topProjects.count
            return (
                "\(count) Apps",
                systemImage("square.grid.2x2.fill")
            )

        case .fleetHealth:
            let fleet = data.fleetHealth
            return (
                "\(fleet.active)/\(fleet.total)",
                systemImage(fleet.healthColor == "green" ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
            )

        case .burningTasks:
            let count = data.burningTasks.count
            return (
                count > 0 ? "\(count) Burning" : "Clear",
                systemImage("flame.fill")
            )

        case .prCiStatus:
            let ci = data.prCiStatus
            return (
                ci.failing > 0 ? "\(ci.failing) Fail" : "\(ci.passing) Pass",
                systemImage(ci.failing > 0 ? "xmark.circle.fill" : "checkmark.shield.fill")
            )

        case .mrrGauge:
            let mrr = data.mrrGauge
            return (
                Formatters.currency(mrr.current),
                systemImage("chart.line.uptrend.xyaxis")
            )
        }
    }

    // MARK: - Helpers

    private static func systemImage(_ name: String) -> UIImage {
        UIImage(systemName: name) ?? UIImage()
    }
}
