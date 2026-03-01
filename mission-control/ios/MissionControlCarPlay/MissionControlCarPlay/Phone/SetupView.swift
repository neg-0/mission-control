import SwiftUI

/// Device pairing view — user enters their MC base URL and secret.
struct SetupView: View {
    @State private var baseURL: String = ""
    @State private var secret: String = ""
    @State private var isPairing: Bool = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(spacing: 24) {
            Image(systemName: "link.badge.plus")
                .font(.system(size: 48))
                .foregroundColor(.blue)

            Text("Pair with Mission Control")
                .font(.title2)
                .fontWeight(.semibold)

            Text("Enter your Mission Control server URL and device pairing secret.")
                .multilineTextAlignment(.center)
                .foregroundColor(.secondary)
                .padding(.horizontal, 32)

            VStack(spacing: 16) {
                TextField("Server URL", text: $baseURL)
                    .textFieldStyle(.roundedBorder)
                    .keyboardType(.URL)
                    .autocapitalization(.none)
                    .autocorrectionDisabled()
                    .padding(.horizontal, 32)

                SecureField("Device Secret", text: $secret)
                    .textFieldStyle(.roundedBorder)
                    .padding(.horizontal, 32)
            }

            if let error = errorMessage {
                Text(error)
                    .foregroundColor(.red)
                    .font(.caption)
                    .padding(.horizontal, 32)
            }

            Button {
                pair()
            } label: {
                if isPairing {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                } else {
                    Text("Pair Device")
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(baseURL.isEmpty || secret.isEmpty || isPairing)
            .padding(.horizontal, 32)

            Spacer()
        }
        .padding(.top, 48)
        .navigationTitle("Setup")
    }

    private func pair() {
        // Normalize URL
        var url = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        if !url.hasPrefix("http://") && !url.hasPrefix("https://") {
            url = "https://\(url)"
        }
        if url.hasSuffix("/") {
            url = String(url.dropLast())
        }

        isPairing = true
        errorMessage = nil

        Task {
            do {
                try await AuthManager.shared.pair(baseURL: url, deviceSecret: secret)
            } catch {
                await MainActor.run {
                    errorMessage = error.localizedDescription
                    isPairing = false
                }
            }
        }
    }
}

#Preview {
    NavigationStack {
        SetupView()
    }
}
