// swift-tools-version: 5.9

import PackageDescription

let package = Package(
    name: "MeetronAudioControl",
    platforms: [.macOS(.v13)],
    products: [
        .library(name: "MeetronAudioCore", targets: ["MeetronAudioCore"]),
        .executable(name: "meetron-audioctl", targets: ["meetron-audioctl"]),
    ],
    targets: [
        .target(
            name: "MeetronAudioCore",
            path: "Sources/MeetingCopilotAudioCore"
        ),
        .executableTarget(
            name: "meetron-audioctl",
            dependencies: ["MeetronAudioCore"],
            path: "Sources/meeting-copilot-audioctl"
        ),
    ]
)
