#!/usr/bin/env node

import { execFile } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(repoRoot, ".meeting-copilot.env");

export const AUDIO_BACKENDS = Object.freeze({
  custom: Object.freeze({
    id: "custom",
    label: "Meetron Audio",
    meetingToAI: Object.freeze({
      name: "Meetron: Meeting to AI",
      uid: "io.github.bb8ad8.meetron.audio.meeting-to-ai.device",
    }),
    aiToMeeting: Object.freeze({
      name: "Meetron: AI to Meeting",
      uid: "io.github.bb8ad8.meetron.audio.ai-to-meeting.device",
    }),
  }),
  legacyCustom: Object.freeze({
    id: "legacy-custom",
    label: "Meeting Copilot Audio (legacy)",
    meetingToAI: Object.freeze({
      name: "Meeting Copilot: Meeting to AI",
      uid: "dev.meetingcopilot.audio.meeting-to-ai.device",
    }),
    aiToMeeting: Object.freeze({
      name: "Meeting Copilot: AI to Meeting",
      uid: "dev.meetingcopilot.audio.ai-to-meeting.device",
    }),
  }),
  blackhole: Object.freeze({
    id: "blackhole",
    label: "BlackHole (legacy)",
    meetingToAI: Object.freeze({ name: "BlackHole 2ch", uid: "BlackHole2ch_UID" }),
    aiToMeeting: Object.freeze({ name: "BlackHole 16ch", uid: "BlackHole16ch_UID" }),
  }),
});

function configuredBackendPreference() {
  if (process.env.MEETING_COPILOT_AUDIO_BACKEND) {
    return process.env.MEETING_COPILOT_AUDIO_BACKEND;
  }
  if (existsSync(envPath)) {
    const match = readFileSync(envPath, "utf8").match(
      /^MEETING_COPILOT_AUDIO_BACKEND=['"]?([^'"\r\n]+)['"]?$/m,
    );
    if (match) return match[1];
  }
  return "auto";
}

export function selectAudioBackend(devices, requested = configuredBackendPreference()) {
  if (!["auto", "custom", "legacy-custom", "blackhole"].includes(requested)) {
    throw new Error(`Unsupported audio backend: ${requested}`);
  }
  const available = (backend) => [backend.meetingToAI, backend.aiToMeeting]
    .every((required) => resolveDeviceTarget(devices, required));
  if (requested === "legacy-custom") return AUDIO_BACKENDS.legacyCustom;
  if (requested !== "auto") return AUDIO_BACKENDS[requested];
  if (available(AUDIO_BACKENDS.custom)) return AUDIO_BACKENDS.custom;
  if (available(AUDIO_BACKENDS.legacyCustom)) return AUDIO_BACKENDS.legacyCustom;
  if (available(AUDIO_BACKENDS.blackhole)) return AUDIO_BACKENDS.blackhole;
  return AUDIO_BACKENDS.custom;
}

export function routingForBackend(backend) {
  return {
    chatgptInput: backend.meetingToAI,
    chatgptOutput: backend.aiToMeeting,
    meetingMicrophone: backend.aiToMeeting,
    meetingSpeaker: backend.meetingToAI,
  };
}

function audioControlExecutable() {
  const explicit = process.env.MEETING_COPILOT_AUDIOCTL;
  const candidates = explicit !== undefined
    ? [explicit]
    : [
        resolve(repoRoot, "native/audio-control/.build/apple/Products/Release/meetron-audioctl"),
        resolve(repoRoot, "native/audio-control/.build/release/meeting-copilot-audioctl"),
        resolve(repoRoot, "native/audio-control/.build/debug/meeting-copilot-audioctl"),
        "/usr/local/bin/meetron-audioctl",
        "/usr/local/bin/meeting-copilot-audioctl",
      ];
  return candidates.find((candidate) => candidate && existsSync(candidate));
}

function switchAudioSourceExecutable() {
  const explicit = process.env.MEETING_COPILOT_SWITCH_AUDIO_SOURCE;
  const candidates = explicit !== undefined
    ? [explicit]
    : ["/opt/homebrew/bin/SwitchAudioSource", "/usr/local/bin/SwitchAudioSource"];
  return candidates.find((candidate) => candidate && existsSync(candidate));
}

async function systemStatus() {
  const audioctl = audioControlExecutable();
  if (audioctl) {
    const { stdout } = await execFileAsync(audioctl, ["status"], { timeout: 10_000 });
    return { ...JSON.parse(stdout), controller: "coreaudio", executable: audioctl };
  }
  const switchAudioSource = switchAudioSourceExecutable();
  if (!switchAudioSource) {
    return { input: null, output: null, devices: [], controller: "unavailable" };
  }
  const [input, output, allDevices] = await Promise.all([
    execFileAsync(switchAudioSource, ["-c", "-t", "input"], { timeout: 10_000 }),
    execFileAsync(switchAudioSource, ["-c", "-t", "output"], { timeout: 10_000 }),
    execFileAsync(switchAudioSource, ["-a"], { timeout: 10_000 }),
  ]);
  const names = allDevices.stdout.split("\n").map((value) => value.trim()).filter(Boolean);
  const device = (name) => ({ id: 0, uid: "", name, hasInput: true, hasOutput: true });
  return {
    input: device(input.stdout.trim()),
    output: device(output.stdout.trim()),
    devices: names.map(device),
    controller: "switchaudio-osx",
    executable: switchAudioSource,
  };
}

export function resolveDeviceTarget(devices, target) {
  if (target.uid) {
    const uidMatch = devices.find((device) => device.uid === target.uid);
    if (uidMatch) return uidMatch;
    if (devices.some((device) => device.uid)) return undefined;
  }
  return devices.find((device) => device.name === target.name);
}

function hasDevice(devices, target) {
  return Boolean(resolveDeviceTarget(devices, target));
}

function isDevice(device, target) {
  if (!device) return false;
  if (target.uid && device.uid) return device.uid === target.uid;
  return device.name === target.name;
}

export async function getAudioStatus() {
  try {
    const system = await systemStatus();
    const backend = selectAudioBackend(system.devices);
    const routing = routingForBackend(backend);
    const required = [backend.meetingToAI, backend.aiToMeeting];
    const devicesReady = required.every((target) => hasDevice(system.devices, target));
    return {
      ready: devicesReady,
      devicesReady,
      controller: system.controller,
      backend: backend.id,
      backendLabel: backend.label,
      input: system.input?.name || "",
      output: system.output?.name || "",
      inputUID: system.input?.uid || "",
      outputUID: system.output?.uid || "",
      devices: system.devices.map((device) => device.name),
      deviceDetails: system.devices,
      requiredDevices: Object.fromEntries(required.map((target) => [target.name, hasDevice(system.devices, target)])),
      requiredDeviceNames: required.map((target) => target.name),
      routing,
      systemDefaultsUnchanged: true,
      inputMatchesLegacyRoute: isDevice(system.input, routing.chatgptInput),
      audioControlInstalled: system.controller === "coreaudio",
      switchAudioSourceInstalled: system.controller === "switchaudio-osx",
    };
  } catch (error) {
    const required = [AUDIO_BACKENDS.custom.meetingToAI, AUDIO_BACKENDS.custom.aiToMeeting];
    return {
      ready: false,
      devicesReady: false,
      controller: "error",
      backend: "custom",
      backendLabel: AUDIO_BACKENDS.custom.label,
      input: "",
      output: "",
      devices: [],
      requiredDevices: Object.fromEntries(required.map((target) => [target.name, false])),
      requiredDeviceNames: required.map((target) => target.name),
      routing: routingForBackend(AUDIO_BACKENDS.custom),
      error: error.message,
    };
  }
}

async function setDefault(kind, target, system) {
  if (system.controller === "coreaudio") {
    const resolvedTarget = resolveDeviceTarget(system.devices, target);
    if (!resolvedTarget?.uid) throw new Error(`Audio device UID was not found: ${target.name}`);
    await execFileAsync(system.executable, [`set-default-${kind}`, "--uid", resolvedTarget.uid], { timeout: 10_000 });
  } else if (system.controller === "switchaudio-osx") {
    await execFileAsync(system.executable, ["-t", kind, "-s", target.name], { timeout: 10_000 });
  } else {
    throw new Error("No supported macOS audio controller is available. Build the audio control helper first.");
  }
}

function runtimeStatePath() {
  const runtimeDir = resolve(
    process.env.MEETING_COPILOT_RUNTIME_DIR || resolve(repoRoot, ".meeting-copilot-runtime"),
  );
  return { runtimeDir, statePath: resolve(runtimeDir, "audio-original.json") };
}

export async function configureAudio({ dryRun = false } = {}) {
  const { statePath } = runtimeStatePath();
  const legacyRestorePending = existsSync(statePath);
  const legacyRestore = legacyRestorePending && !dryRun
    ? await restoreAudio()
    : { restored: false, alreadyRestored: !legacyRestorePending };
  const system = await systemStatus();
  const backend = selectAudioBackend(system.devices);
  const routing = routingForBackend(backend);
  const required = [backend.meetingToAI, backend.aiToMeeting];
  const missing = required.filter((target) => !hasDevice(system.devices, target));
  if (missing.length) throw new Error(`Required audio device was not found: ${missing.map((item) => item.name).join(", ")}`);
  if (dryRun) {
    return {
      dryRun: true,
      backend: backend.id,
      input: system.input?.name || "",
      output: system.output?.name || "",
      legacyRestorePending,
      systemDefaultsUnchanged: true,
    };
  }
  return {
    ready: true,
    backend: backend.id,
    input: system.input?.name || "",
    inputUID: system.input?.uid || "",
    output: system.output?.name || "",
    outputUID: system.output?.uid || "",
    inputUnchanged: true,
    outputUnchanged: true,
    systemDefaultsUnchanged: true,
    restorable: false,
    legacyRestore,
    routing,
  };
}

export async function restoreAudio({ dryRun = false } = {}) {
  const { statePath } = runtimeStatePath();
  if (!existsSync(statePath)) return { restored: false, alreadyRestored: true };
  const saved = JSON.parse(readFileSync(statePath, "utf8"));
  const system = await systemStatus();
  const input = { name: saved.input, uid: saved.inputUID || "" };
  const output = { name: saved.output, uid: saved.outputUID || "" };
  if (!input.name) throw new Error("The saved input device is invalid.");
  if (!hasDevice(system.devices, input)) throw new Error(`The original audio device is no longer available: ${input.name}`);
  if (saved.outputChanged !== false && !hasDevice(system.devices, output)) {
    throw new Error(`The original audio device is no longer available: ${output.name}`);
  }
  if (dryRun) return { dryRun: true, input: input.name, output: output.name, outputRestored: saved.outputChanged !== false };
  await setDefault("input", input, system);
  if (saved.outputChanged !== false) await setDefault("output", output, system);
  const resolved = await systemStatus();
  if (!isDevice(resolved.input, input) || (saved.outputChanged !== false && !isDevice(resolved.output, output))) {
    throw new Error("The original audio routing could not be verified.");
  }
  unlinkSync(statePath);
  return {
    restored: true,
    input: resolved.input.name,
    output: resolved.output?.name || "",
    outputRestored: saved.outputChanged !== false,
  };
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (["-h", "--help"].includes(command)) {
    process.stdout.write("Usage: node scripts/audio-backend.mjs <status|configure|restore> [--dry-run]\n");
    return;
  }
  const dryRun = args.includes("--dry-run");
  let result;
  if (command === "status") result = await getAudioStatus();
  else if (command === "configure") result = await configureAudio({ dryRun });
  else if (command === "restore") result = await restoreAudio({ dryRun });
  else throw new Error("Expected status, configure, or restore command.");
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}
