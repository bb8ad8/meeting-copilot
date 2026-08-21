import Foundation
import MeetronAudioCore

struct CommandResult: Codable {
    let changed: Bool?
    let device: AudioDevice?

    init(changed: Bool? = nil, device: AudioDevice? = nil) {
        self.changed = changed
        self.device = device
    }
}

struct InstallStatus: Codable {
    let installed: Bool
    let requiredUIDs: [String: Bool]
}

struct RoutingVerification: Codable {
    let ready: Bool
    let defaultInputUID: String?
    let meetingToAIInstalled: Bool
    let aiToMeetingInstalled: Bool
}

let meetingToAIUID = "io.github.bb8ad8.meetron.audio.meeting-to-ai.device"
let aiToMeetingUID = "io.github.bb8ad8.meetron.audio.ai-to-meeting.device"

func usage() {
    print("""
    Usage: meetron-audioctl COMMAND [options]

      status                         Print defaults and all devices as JSON
      list                           Print all devices as JSON
      install-status                 Check whether both custom devices exist
      get-default-input              Print the current default input as JSON
      set-default-input --uid UID    Change the macOS default input
      set-default-output --uid UID   Change the macOS default output
      verify-routing                 Verify the custom devices and default input
      version                        Print the helper protocol version
    """)
}

func uidArgument(_ arguments: [String]) throws -> String {
    guard let index = arguments.firstIndex(of: "--uid"), arguments.indices.contains(index + 1) else {
        throw AudioControlError.deviceNotFound(uid: "missing --uid")
    }
    return arguments[index + 1]
}

let arguments = Array(CommandLine.arguments.dropFirst())
if arguments.isEmpty || arguments.contains("--help") || arguments.contains("-h") {
    usage()
    exit(arguments.isEmpty ? 2 : 0)
}

do {
    let manager = AudioDeviceManager()
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    let data: Data
    switch arguments[0] {
    case "status":
        data = try encoder.encode(manager.status())
    case "list":
        data = try encoder.encode(manager.allDevices())
    case "install-status":
        let devices = try manager.allDevices()
        let required = [
            meetingToAIUID: AudioDeviceManager.device(withUID: meetingToAIUID, in: devices) != nil,
            aiToMeetingUID: AudioDeviceManager.device(withUID: aiToMeetingUID, in: devices) != nil,
        ]
        data = try encoder.encode(InstallStatus(
            installed: required.values.allSatisfy { $0 },
            requiredUIDs: required
        ))
    case "get-default-input":
        data = try encoder.encode(manager.status().input)
    case "set-default-input":
        data = try encoder.encode(CommandResult(changed: true, device: manager.setDefaultInput(uid: try uidArgument(arguments))))
    case "set-default-output":
        data = try encoder.encode(CommandResult(changed: true, device: manager.setDefaultOutput(uid: try uidArgument(arguments))))
    case "verify-routing":
        let status = try manager.status()
        let meetingToAIInstalled = AudioDeviceManager.device(withUID: meetingToAIUID, in: status.devices) != nil
        let aiToMeetingInstalled = AudioDeviceManager.device(withUID: aiToMeetingUID, in: status.devices) != nil
        data = try encoder.encode(RoutingVerification(
            ready: meetingToAIInstalled && aiToMeetingInstalled && status.input?.uid == meetingToAIUID,
            defaultInputUID: status.input?.uid,
            meetingToAIInstalled: meetingToAIInstalled,
            aiToMeetingInstalled: aiToMeetingInstalled
        ))
    case "version":
        data = try encoder.encode(["version": meetronAudioControlVersion])
    default:
        fputs("Unknown command: \(arguments[0])\n", stderr)
        usage()
        exit(2)
    }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0A]))
} catch {
    let message = error.localizedDescription
    let body = try JSONSerialization.data(withJSONObject: ["error": message], options: [.sortedKeys])
    FileHandle.standardError.write(body)
    FileHandle.standardError.write(Data([0x0A]))
    exit(1)
}
