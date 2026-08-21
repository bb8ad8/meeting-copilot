import CoreAudio
import Foundation

public let meetronAudioControlVersion = "0.1.0"

public struct AudioDevice: Codable, Equatable, Sendable {
    public let id: UInt32
    public let uid: String
    public let name: String
    public let hasInput: Bool
    public let hasOutput: Bool

    public init(id: UInt32, uid: String, name: String, hasInput: Bool, hasOutput: Bool) {
        self.id = id
        self.uid = uid
        self.name = name
        self.hasInput = hasInput
        self.hasOutput = hasOutput
    }
}

public struct AudioSystemStatus: Codable, Sendable {
    public let input: AudioDevice?
    public let output: AudioDevice?
    public let devices: [AudioDevice]
}

public enum AudioControlError: LocalizedError {
    case coreAudio(operation: String, status: OSStatus)
    case deviceNotFound(uid: String)
    case unsupportedDirection(uid: String, direction: String)

    public var errorDescription: String? {
        switch self {
        case let .coreAudio(operation, status):
            return "\(operation) failed with Core Audio status \(status)"
        case let .deviceNotFound(uid):
            return "Audio device was not found: \(uid)"
        case let .unsupportedDirection(uid, direction):
            return "Audio device \(uid) does not support \(direction)"
        }
    }
}

public struct AudioDeviceManager {
    public init() {}

    public func status() throws -> AudioSystemStatus {
        let devices = try allDevices()
        let inputID = try defaultDeviceID(selector: kAudioHardwarePropertyDefaultInputDevice)
        let outputID = try defaultDeviceID(selector: kAudioHardwarePropertyDefaultOutputDevice)
        return AudioSystemStatus(
            input: devices.first(where: { $0.id == inputID }),
            output: devices.first(where: { $0.id == outputID }),
            devices: devices
        )
    }

    public func allDevices() throws -> [AudioDevice] {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDevices,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var size: UInt32 = 0
        try check(
            AudioObjectGetPropertyDataSize(
                AudioObjectID(kAudioObjectSystemObject),
                &address,
                0,
                nil,
                &size
            ),
            operation: "List audio devices"
        )
        let count = Int(size) / MemoryLayout<AudioDeviceID>.size
        var ids = [AudioDeviceID](repeating: 0, count: count)
        try check(
            AudioObjectGetPropertyData(
                AudioObjectID(kAudioObjectSystemObject),
                &address,
                0,
                nil,
                &size,
                &ids
            ),
            operation: "Read audio devices"
        )
        return try ids.map { id in
            AudioDevice(
                id: id,
                uid: try stringProperty(id: id, selector: kAudioDevicePropertyDeviceUID),
                name: try stringProperty(id: id, selector: kAudioObjectPropertyName),
                hasInput: try hasStreams(id: id, scope: kAudioDevicePropertyScopeInput),
                hasOutput: try hasStreams(id: id, scope: kAudioDevicePropertyScopeOutput)
            )
        }.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    @discardableResult
    public func setDefaultInput(uid: String) throws -> AudioDevice {
        try setDefault(uid: uid, selector: kAudioHardwarePropertyDefaultInputDevice, input: true)
    }

    @discardableResult
    public func setDefaultOutput(uid: String) throws -> AudioDevice {
        try setDefault(uid: uid, selector: kAudioHardwarePropertyDefaultOutputDevice, input: false)
    }

    public static func device(withUID uid: String, in devices: [AudioDevice]) -> AudioDevice? {
        devices.first(where: { $0.uid == uid })
    }

    private func setDefault(
        uid: String,
        selector: AudioObjectPropertySelector,
        input: Bool
    ) throws -> AudioDevice {
        let devices = try allDevices()
        guard let device = Self.device(withUID: uid, in: devices) else {
            throw AudioControlError.deviceNotFound(uid: uid)
        }
        guard input ? device.hasInput : device.hasOutput else {
            throw AudioControlError.unsupportedDirection(
                uid: uid,
                direction: input ? "input" : "output"
            )
        }
        var address = AudioObjectPropertyAddress(
            mSelector: selector,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var deviceID = AudioDeviceID(device.id)
        try check(
            AudioObjectSetPropertyData(
                AudioObjectID(kAudioObjectSystemObject),
                &address,
                0,
                nil,
                UInt32(MemoryLayout<AudioDeviceID>.size),
                &deviceID
            ),
            operation: input ? "Set default input" : "Set default output"
        )
        return device
    }

    private func defaultDeviceID(selector: AudioObjectPropertySelector) throws -> AudioDeviceID {
        var address = AudioObjectPropertyAddress(
            mSelector: selector,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var deviceID = AudioDeviceID(0)
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)
        try check(
            AudioObjectGetPropertyData(
                AudioObjectID(kAudioObjectSystemObject),
                &address,
                0,
                nil,
                &size,
                &deviceID
            ),
            operation: "Read default audio device"
        )
        return deviceID
    }

    private func stringProperty(
        id: AudioDeviceID,
        selector: AudioObjectPropertySelector
    ) throws -> String {
        var address = AudioObjectPropertyAddress(
            mSelector: selector,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var value: CFString = "" as CFString
        var size = UInt32(MemoryLayout<CFString>.size)
        try withUnsafeMutablePointer(to: &value) { pointer in
            try check(
                AudioObjectGetPropertyData(id, &address, 0, nil, &size, pointer),
                operation: "Read audio device property"
            )
        }
        return value as String
    }

    private func hasStreams(id: AudioDeviceID, scope: AudioObjectPropertyScope) throws -> Bool {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyStreams,
            mScope: scope,
            mElement: kAudioObjectPropertyElementMain
        )
        var size: UInt32 = 0
        try check(
            AudioObjectGetPropertyDataSize(id, &address, 0, nil, &size),
            operation: "Read audio device streams"
        )
        return size >= UInt32(MemoryLayout<AudioStreamID>.size)
    }

    private func check(_ status: OSStatus, operation: String) throws {
        guard status == noErr else {
            throw AudioControlError.coreAudio(operation: operation, status: status)
        }
    }
}
