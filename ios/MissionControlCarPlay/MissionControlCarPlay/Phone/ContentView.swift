import SwiftUI

/// Main phone companion view — shows setup or connected status.
struct ContentView: View {
    @ObservedObject private var auth = AuthManager.shared

    var body: some View {
        NavigationStack {
            if auth.isAuthenticated {
                ConnectedView()
            } else {
                SetupView()
            }
        }
    }
}

/// Shows when device is already paired.
struct ConnectedView: View {
    @ObservedObject private var auth = AuthManager.shared

    var body: some View {
        VStack(spacing: 24) {
            Image(systemName: "car.fill")
                .font(.system(size: 64))
                .foregroundColor(.green)

            Text("CarPlay Connected")
                .font(.title2)
                .fontWeight(.semibold)

            Text("Your device is paired with Mission Control. Connect to CarPlay to view your dashboard.")
                .multilineTextAlignment(.center)
                .foregroundColor(.secondary)
                .padding(.horizontal, 32)

            Divider()
                .padding(.vertical, 8)

            VStack(alignment: .leading, spacing: 12) {
                Label("Say \"Hey Siri, tell Rocket...\"", systemImage: "mic.fill")
                Label("Say \"Hey Siri, what's burning?\"", systemImage: "flame.fill")
                Label("Say \"Hey Siri, fleet status\"", systemImage: "antenna.radiowaves.left.and.right")
            }
            .font(.subheadline)
            .foregroundColor(.secondary)

            Spacer()

            Button(role: .destructive) {
                auth.logout()
            } label: {
                Text("Unpair Device")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .padding(.horizontal, 32)
        }
        .padding(.top, 48)
        .navigationTitle("Mission Control")
    }
}

#Preview {
    ContentView()
}
