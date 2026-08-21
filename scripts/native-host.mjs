#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { getAudioStatus } from "./audio-backend.mjs";
import { connectToChromeOverCDP } from "./playwright-cdp.mjs";

const EXTENSION_ID = "jlikakgdldiihhflkobhnpfegjlcakdd";
const EXPECTED_ORIGIN = `chrome-extension://${EXTENSION_ID}/`;
const MAX_MESSAGE_BYTES = 1024 * 1024;
const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appVersion = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8")).version;
const scriptsDir = resolve(repoRoot, "scripts");
const runtimeDir = resolve(
  process.env.MEETING_COPILOT_RUNTIME_DIR || resolve(repoRoot, ".meeting-copilot-runtime"),
);
const meetingStatePath = resolve(runtimeDir, "meeting-launch.json");
const meetingLogPath = resolve(runtimeDir, "meeting-launch.log");
const micStatePath = resolve(runtimeDir, "meet-mic.json");
const setupStatePath = resolve(runtimeDir, "setup.json");
const envPath = resolve(repoRoot, ".meeting-copilot.env");
const dedicatedProfileDir =
  process.env.MEETING_COPILOT_PROFILE_DIR ||
  resolve(process.env.HOME || "", "Library/Application Support/MeetingCopilot/GPTParticipantChrome");
const PROFILE_LAYOUT_VERSION = 2;
let dedicatedBrowser = null;

if (process.argv.includes("--help")) {
  process.stdout.write(`Meetron Native Messaging Host\n\nExpected extension: ${EXTENSION_ID}\n`);
  process.exit(0);
}

const callerOrigin = process.argv[2] || "";
if (callerOrigin !== EXPECTED_ORIGIN) {
  process.stderr.write(`Rejected Native Messaging caller: ${callerOrigin}\n`);
  process.exit(1);
}

function configuredValue(name) {
  if (process.env[name]) {
    return process.env[name];
  }
  if (!existsSync(envPath)) {
    return "";
  }
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = readFileSync(envPath, "utf8").match(
    new RegExp(`^${escapedName}=['\"]?([^'\"\\r\\n]+)['\"]?$`, "m"),
  );
  return match?.[1] || "";
}

function configuredPort(name, fallback) {
  const value = configuredValue(name);
  return /^\d{2,5}$/.test(value) && Number(value) <= 65_535 ? value : fallback;
}

function commandEnvironment() {
  const nodePath = configuredValue("MEETING_COPILOT_NODE_PATH");
  const commandPaths = [
    nodePath ? dirname(nodePath) : "",
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    process.env.PATH || "",
  ].filter(Boolean);
  return {
    ...process.env,
    PATH: commandPaths.join(":"),
    MEETING_COPILOT_NODE_PATH: nodePath,
    MEETING_COPILOT_CDP_PORT: configuredPort("MEETING_COPILOT_CDP_PORT", "9223"),
  };
}

async function run(command, args, timeout = 30_000) {
  return execFileAsync(command, args, {
    cwd: repoRoot,
    env: commandEnvironment(),
    maxBuffer: 1024 * 1024,
    timeout,
  });
}

function runDetached(command, args, logName) {
  mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
  const logPath = resolve(runtimeDir, logName);
  rotateLog(logPath);
  const log = openSync(logPath, "a", 0o600);
  const child = spawn(command, args, {
    cwd: repoRoot,
    detached: true,
    env: commandEnvironment(),
    stdio: ["ignore", log, log],
  });
  child.unref();
  closeSync(log);
  return { started: true, pid: child.pid };
}

function rotateLog(path, maximumBytes = 2 * 1024 * 1024) {
  if (!existsSync(path) || statSync(path).size <= maximumBytes) {
    return;
  }
  const previousPath = `${path}.1`;
  if (existsSync(previousPath)) {
    unlinkSync(previousPath);
  }
  renameSync(path, previousPath);
}

function writeJsonAtomic(path, value) {
  mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporaryPath, path);
}

async function connectDedicatedChrome() {
  const port = configuredPort("MEETING_COPILOT_CDP_PORT", "9223");
  await run(
    process.execPath,
    [
      resolve(scriptsDir, "verify-dedicated-chrome.mjs"),
      "--profile-dir",
      dedicatedProfileDir,
      "--port",
      port,
    ],
    5_000,
  );
  if (dedicatedBrowser?.isConnected()) {
    return dedicatedBrowser;
  }

  dedicatedBrowser = await connectToChromeOverCDP(
    `http://127.0.0.1:${port}`,
    { timeout: 3_000 },
  );
  return dedicatedBrowser;
}

async function getChatgptPage() {
  const browser = await connectDedicatedChrome();
  return browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((page) => page.url().startsWith("https://chatgpt.com/"));
}

async function getChatgptStatus() {
  try {
    const page = await getChatgptPage();
    if (!page) {
      return { browserConnected: true, voiceActive: false, microphoneOn: false };
    }

    const endVoice = page.getByRole("button", {
      name: /^(音声を終了する|End voice)$/i,
    });
    const microphoneOn = page.getByRole("button", {
      name: /^(マイクをオフにする|Turn off microphone)$/i,
    });

    const audioOutput = await page.evaluate(() => {
      const state = globalThis.__meetingCopilotAudioRouting;
      if (!state) return { routed: false, device: "", internalChecked: false };
      const internalCheck = state.internalAudioOutput;
      return {
        routed:
          state.failures.length === 0 &&
          internalCheck?.checked === true &&
          (internalCheck.unexpectedOutputs?.length || 0) === 0,
        device: state.label,
        internalChecked: internalCheck?.checked === true,
        unexpectedOutputs: internalCheck?.unexpectedOutputs || [],
      };
    });

    return {
      browserConnected: true,
      voiceActive: (await endVoice.count()) > 0 && (await endVoice.first().isVisible()),
      microphoneOn:
        (await microphoneOn.count()) > 0 && (await microphoneOn.first().isVisible()),
      audioOutput,
      title: await page.title(),
    };
  } catch (error) {
    dedicatedBrowser = null;
    return {
      browserConnected: false,
      voiceActive: false,
      microphoneOn: false,
      error: error.message,
    };
  }
}

async function locatorIsVisible(locator) {
  try {
    return (await locator.count()) > 0 && (await locator.first().isVisible());
  } catch {
    return false;
  }
}

async function getDedicatedMeetStatus() {
  try {
    const browser = await connectDedicatedChrome();
    const page = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) => candidate.url().startsWith("https://meet.google.com/"));
    if (!page) {
      return {
        browserConnected: true,
        connection: "not-running",
        microphone: "unavailable",
      };
    }

    const turnOn = page.getByRole("button", {
      name: /マイクをオン(?:にする)?|turn on microphone|unmute microphone/i,
    });
    const turnOff = page.getByRole("button", {
      name: /マイクをオフ(?:にする)?|turn off microphone|mute microphone/i,
    });
    const leave = page.getByRole("button", { name: /通話から退出|leave call/i });
    const [turnOnVisible, turnOffVisible, leaveVisible, bodyText] = await Promise.all([
      locatorIsVisible(turnOn),
      locatorIsVisible(turnOff),
      locatorIsVisible(leave),
      page.locator("body").innerText().catch(() => ""),
    ]);

    let connection = "prejoin";
    if (leaveVisible) {
      connection = "joined";
    } else if (/参加を許可するまで|waiting for the host|asking to join/i.test(bodyText)) {
      connection = "waiting";
    } else if (/参加できません|can't join|cannot join/i.test(bodyText)) {
      connection = "rejected";
    }

    return {
      browserConnected: true,
      connection,
      microphone: turnOnVisible ? "muted" : turnOffVisible ? "unmuted" : "unavailable",
      url: page.url(),
      title: await page.title(),
    };
  } catch (error) {
    dedicatedBrowser = null;
    return {
      browserConnected: false,
      connection: "not-running",
      microphone: "unavailable",
      error: error.message,
    };
  }
}

async function stopVoice() {
  const page = await getChatgptPage();
  if (!page) {
    return { stopped: false, alreadyStopped: true };
  }

  const rateLimitDialog = page.locator('[data-testid="modal-conversation-history-rate-limit"]');
  if (await locatorIsVisible(rateLimitDialog)) {
    const acknowledge = rateLimitDialog.getByRole("button", {
      name: /^(了解|OK|Got it)$/i,
    });
    if (await locatorIsVisible(acknowledge)) {
      await acknowledge.first().click({ force: true, timeout: 5_000 });
      await rateLimitDialog.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => {});
    }
  }

  const endVoice = page.getByRole("button", {
    name: /^(音声を終了する|End voice)$/i,
  });
  if ((await endVoice.count()) === 0 || !(await endVoice.first().isVisible())) {
    return { stopped: false, alreadyStopped: true };
  }

  await endVoice.first().click({ force: true, timeout: 5_000 });
  await endVoice.first().waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
  if (await locatorIsVisible(endVoice)) {
    throw new Error("ChatGPT Voiceの終了状態を確認できませんでした");
  }
  return { stopped: true, alreadyStopped: false };
}

async function leaveDedicatedMeet() {
  const browser = await connectDedicatedChrome();
  const page = browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((candidate) => candidate.url().startsWith("https://meet.google.com/"));
  if (!page) {
    return { left: false, alreadyLeft: true, tabClosed: true };
  }

  const leave = page.getByRole("button", { name: /通話から退出|leave call/i });
  const leaveVisible = await locatorIsVisible(leave);
  if (leaveVisible) {
    await leave.first().click({ force: true, timeout: 5_000 });
    await page.waitForTimeout(300);
  }
  if (!page.isClosed()) {
    await page.close({ runBeforeUnload: false });
  }
  return { left: leaveVisible, alreadyLeft: !leaveVisible, tabClosed: true };
}

function projectConfigured() {
  const projectUrl = getProjectUrl();
  if (!projectUrl) {
    return false;
  }
  try {
    normalizeProjectUrl(projectUrl);
    return true;
  } catch {
    return false;
  }
}

function getProjectUrl() {
  if (!existsSync(envPath)) {
    return "";
  }
  const match = readFileSync(envPath, "utf8").match(
    /^MEETING_COPILOT_CHATGPT_PROJECT_URL=['"]?([^'"\r\n]+)['"]?$/m,
  );
  return match?.[1] || "";
}

function normalizeProjectUrl(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new Error("有効なChatGPT Project URLを入力してください");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "chatgpt.com" ||
    !/^\/g\/g-p-[A-Za-z0-9_-]+\/project\/?$/.test(url.pathname)
  ) {
    throw new Error("ChatGPT Projectの /g/g-p-.../project URLを入力してください");
  }
  url.search = "";
  url.hash = "";
  return url.toString();
}

function readSetupState() {
  if (!existsSync(setupStatePath)) {
    const previousLaunch = getMeetingLaunchState();
    const previouslyWorked = previousLaunch?.status === "completed";
    return {
      profileLayoutVersion: PROFILE_LAYOUT_VERSION,
      chatgptLoginConfirmed: false,
      googleLoginConfirmed: previouslyWorked,
    };
  }
  try {
    const state = JSON.parse(readFileSync(setupStatePath, "utf8"));
    const usesSharedProfile = state.profileLayoutVersion === PROFILE_LAYOUT_VERSION;
    return {
      profileLayoutVersion: PROFILE_LAYOUT_VERSION,
      chatgptLoginConfirmed: usesSharedProfile && state.chatgptLoginConfirmed === true,
      googleLoginConfirmed: state.googleLoginConfirmed === true,
    };
  } catch {
    return {
      profileLayoutVersion: PROFILE_LAYOUT_VERSION,
      chatgptLoginConfirmed: false,
      googleLoginConfirmed: false,
    };
  }
}

function writeSetupState(state) {
  mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
  const temporaryPath = `${setupStatePath}.${process.pid}.tmp`;
  writeFileSync(
    temporaryPath,
    `${JSON.stringify({
      ...state,
      profileLayoutVersion: PROFILE_LAYOUT_VERSION,
      updatedAt: new Date().toISOString(),
    }, null, 2)}\n`,
    { mode: 0o600 },
  );
  renameSync(temporaryPath, setupStatePath);
}

function dedicatedExtensionInstalled() {
  const preferenceFiles = ["Preferences", "Secure Preferences"];
  for (const fileName of preferenceFiles) {
    const preferencesPath = resolve(dedicatedProfileDir, `Default/${fileName}`);
    if (!existsSync(preferencesPath)) {
      continue;
    }
    try {
      const preferences = JSON.parse(readFileSync(preferencesPath, "utf8"));
      const extension = preferences.extensions?.settings?.[EXTENSION_ID];
      if (extension && (extension.disable_reasons || []).length === 0) {
        return true;
      }
    } catch {
      // Chrome may be updating one preference file while the other remains readable.
    }
  }
  return false;
}

async function getSetupStatus(audioStatus = null) {
  const audio = audioStatus || await getAudioStatus();
  const confirmations = readSetupState();
  const audioDevicesReady = audio.devicesReady === true;
  const projectUrl = getProjectUrl();
  const projectIsConfigured = Boolean(projectUrl) && projectConfigured();
  const extensionInstalled = dedicatedExtensionInstalled();
  return {
    hostConnected: true,
    repoRoot,
    audio: {
      ...audio,
      devicesReady: audioDevicesReady,
    },
    project: {
      configured: projectIsConfigured,
      url: projectUrl,
    },
    dedicatedChrome: {
      sharedProfile: true,
      extensionInstalled,
      profileDir: dedicatedProfileDir,
    },
    confirmations,
    complete:
      audioDevicesReady &&
      projectIsConfigured &&
      extensionInstalled &&
      confirmations.chatgptLoginConfirmed &&
      confirmations.googleLoginConfirmed,
  };
}

function saveProjectUrl(payload) {
  const projectUrl = normalizeProjectUrl(payload?.projectUrl);
  const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const setting = `MEETING_COPILOT_CHATGPT_PROJECT_URL='${projectUrl}'`;
  const updated = /^MEETING_COPILOT_CHATGPT_PROJECT_URL=.*$/m.test(existing)
    ? existing.replace(/^MEETING_COPILOT_CHATGPT_PROJECT_URL=.*$/m, setting)
    : `${existing.trimEnd()}${existing.trim() ? "\n" : ""}${setting}\n`;
  const temporaryPath = `${envPath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, updated, { mode: 0o600 });
  renameSync(temporaryPath, envPath);

  const setup = readSetupState();
  writeSetupState({ ...setup, chatgptLoginConfirmed: false });
  return { configured: true, url: projectUrl };
}

async function configureAudio() {
  const result = await run(resolve(scriptsDir, "configure-audio.sh"), [], 15_000);
  try {
    return JSON.parse(result.stdout.trim());
  } catch {
    return { ready: true, output: result.stdout.trim() };
  }
}

function openDedicatedChromeSetup() {
  return runDetached(resolve(scriptsDir, "open-control-ui-setup.sh"), [], "setup-meet-chrome.log");
}

function openChatgptSetup() {
  if (!projectConfigured()) {
    throw new Error("先にChatGPT Project URLを保存してください");
  }
  return runDetached(
    resolve(scriptsDir, "open-chatgpt-live.sh"),
    [],
    "setup-chatgpt.log",
  );
}

function confirmSetupStep(payload) {
  const fieldByStep = {
    chatgptLogin: "chatgptLoginConfirmed",
    googleLogin: "googleLoginConfirmed",
  };
  const field = fieldByStep[payload?.step];
  if (!field || typeof payload?.complete !== "boolean") {
    throw new Error("Unsupported setup confirmation");
  }
  const state = readSetupState();
  state[field] = payload.complete;
  writeSetupState(state);
  return state;
}

function processIsRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function launchProcessIsRunning(pid) {
  if (!processIsRunning(pid)) return false;
  try {
    const result = await execFileAsync("/bin/ps", ["-p", String(pid), "-o", "command="], {
      timeout: 2_000,
    });
    return result.stdout.includes("meeting-start-job.mjs");
  } catch {
    return false;
  }
}

function signalLaunchProcessGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
    return;
  } catch (groupError) {
    try {
      process.kill(pid, signal);
      return;
    } catch {
      if (groupError.code !== "ESRCH") throw groupError;
    }
  }
}

async function cancelMeetingLaunch() {
  const launch = getMeetingLaunchState();
  if (!launch || !["starting", "running"].includes(launch.status)) {
    return { cancelled: false, alreadyStopped: true };
  }
  if (!(await launchProcessIsRunning(launch.pid))) {
    return { cancelled: false, alreadyStopped: true };
  }

  signalLaunchProcessGroup(launch.pid, "SIGTERM");
  for (let attempt = 0; attempt < 25; attempt += 1) {
    if (!(await launchProcessIsRunning(launch.pid))) {
      return { cancelled: true, forced: false, pid: launch.pid };
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }

  signalLaunchProcessGroup(launch.pid, "SIGKILL");
  return { cancelled: true, forced: true, pid: launch.pid };
}

function getMeetingLaunchState() {
  if (!existsSync(meetingStatePath)) {
    return null;
  }
  try {
    const state = JSON.parse(readFileSync(meetingStatePath, "utf8"));
    const startingWithoutPid = state.status === "starting" && !Number.isInteger(state.pid);
    const startingAge = Date.now() - Date.parse(state.startedAt || "");
    if (startingWithoutPid && Number.isFinite(startingAge) && startingAge <= 30_000) {
      return state;
    }
    if (["starting", "running"].includes(state.status) && !processIsRunning(state.pid)) {
      return { ...state, status: "failed", error: "起動処理が予期せず停止しました" };
    }
    return state;
  } catch (error) {
    return { status: "failed", error: `起動状態を読み取れません: ${error.message}` };
  }
}

function getMeetMicrophoneState() {
  if (!existsSync(micStatePath)) {
    return null;
  }
  try {
    const state = JSON.parse(readFileSync(micStatePath, "utf8"));
    return new Set(["muted", "unmuted"]).has(state.state) ? state : null;
  } catch {
    return null;
  }
}

function normalizeMeetingUrl(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new Error("有効なGoogle Meet URLを入力してください");
  }

  if (
    url.protocol !== "https:" ||
    url.hostname !== "meet.google.com" ||
    url.port ||
    url.username ||
    url.password ||
    !/^\/[a-z]{3}-[a-z]{4}-[a-z]{3}\/?$/i.test(url.pathname)
  ) {
    throw new Error("https://meet.google.com/xxx-xxxx-xxx 形式のURLを入力してください");
  }
  url.hash = "";
  return url.toString();
}

function startMeeting(payload) {
  const currentState = getMeetingLaunchState();
  if (
    currentState?.status === "starting" ||
    (currentState?.status === "running" && processIsRunning(currentState.pid))
  ) {
    throw new Error("別のMeet起動処理が進行中です");
  }

  const meetingUrl = normalizeMeetingUrl(payload?.meetingUrl);
  dedicatedBrowser = null;
  mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
  writeJsonAtomic(micStatePath, {
    meetingUrl,
    state: "unknown",
    updatedAt: new Date().toISOString(),
  });
  const state = {
    status: "starting",
    meetingUrl,
    pid: null,
    startedAt: new Date().toISOString(),
  };
  writeJsonAtomic(meetingStatePath, state);
  rotateLog(meetingLogPath);
  const log = openSync(meetingLogPath, "a", 0o600);
  const child = spawn(process.execPath, [resolve(scriptsDir, "meeting-start-job.mjs"), meetingUrl], {
    cwd: repoRoot,
    detached: true,
    env: commandEnvironment(),
    stdio: ["ignore", log, log],
  });
  try {
    const latestState = JSON.parse(readFileSync(meetingStatePath, "utf8"));
    if (latestState.status === "starting" && latestState.startedAt === state.startedAt) {
      writeJsonAtomic(meetingStatePath, { ...state, pid: child.pid });
    }
  } catch {
    // The launch job may have already advanced the state to running.
  }
  child.unref();
  closeSync(log);

  return { ...state, pid: child.pid };
}

async function getStatus() {
  const [audio, chatgpt, dedicatedMeet] = await Promise.all([
    getAudioStatus(),
    getChatgptStatus(),
    getDedicatedMeetStatus(),
  ]);
  const setup = await getSetupStatus(audio);
  return {
    host: { connected: true, version: appVersion },
    audio,
    chatgpt,
    dedicatedMeet,
    configuration: {
      projectConfigured: projectConfigured(),
      extensionId: EXTENSION_ID,
      setupComplete: setup.complete,
    },
    meetingLaunch: getMeetingLaunchState(),
    meetMicrophone: getMeetMicrophoneState(),
  };
}

async function restartVoice() {
  const meetBefore = await getDedicatedMeetStatus();
  await stopVoice();
  const result = await run(resolve(scriptsDir, "open-chatgpt-live.sh"), ["--replace-tab"], 120_000);
  const meetAfter = await getDedicatedMeetStatus();
  if (meetBefore.connection === "joined" && meetAfter.connection !== "joined") {
    throw new Error("Voiceは再起動しましたが、Meet参加状態を維持できませんでした");
  }
  return {
    restarted: true,
    meetPreserved: meetBefore.connection !== "joined" || meetAfter.connection === "joined",
    output: result.stdout.trim(),
  };
}

async function toggleMeetMicrophone() {
  const result = await run(resolve(scriptsDir, "set-meet-mic.sh"), ["toggle"], 15_000);
  const output = result.stdout.trim();
  try {
    return JSON.parse(output);
  } catch {
    return { status: "ok", output };
  }
}

async function restoreAudio() {
  const result = await run(resolve(scriptsDir, "restore-audio.sh"), [], 15_000);
  try {
    return JSON.parse(result.stdout.trim());
  } catch {
    return { restored: true, output: result.stdout.trim() };
  }
}

async function stopSession() {
  const warnings = [];
  let launchCancellation = { cancelled: false, alreadyStopped: true };
  try {
    launchCancellation = await cancelMeetingLaunch();
  } catch (error) {
    warnings.push(`起動中の処理を停止できませんでした: ${error.message}`);
  }

  let microphone = { muted: false, alreadyMuted: false };
  try {
    const meet = await getDedicatedMeetStatus();
    if (meet.connection === "joined" && meet.microphone === "unmuted") {
      const result = await run(resolve(scriptsDir, "set-meet-mic.sh"), ["mute"], 15_000);
      microphone = { muted: JSON.parse(result.stdout.trim()).verified === true, alreadyMuted: false };
    } else {
      microphone = { muted: false, alreadyMuted: meet.microphone === "muted" };
    }
  } catch (error) {
    warnings.push(`GPT参加者をミュートできませんでした: ${error.message}`);
  }

  let voice = { stopped: false, alreadyStopped: true };
  try {
    voice = await stopVoice();
  } catch (error) {
    warnings.push(`ChatGPT Voiceを停止できませんでした: ${error.message}`);
  }

  let meet = { left: false, alreadyLeft: true, tabClosed: false };
  try {
    meet = await leaveDedicatedMeet();
  } catch (error) {
    warnings.push(`GPT参加者をMeetから退出させられませんでした: ${error.message}`);
  }

  const audio = await restoreAudio();
  const launch = getMeetingLaunchState();
  if (launch) {
    writeJsonAtomic(meetingStatePath, {
      ...launch,
      status: "stopped",
      stoppedAt: new Date().toISOString(),
    });
  }
  return { stopped: true, launchCancellation, microphone, voice, meet, audio, warnings };
}

async function runDiagnostics() {
  try {
    const result = await run(resolve(scriptsDir, "check-env.sh"), [], 30_000);
    return { ok: true, output: `${result.stdout}${result.stderr}`.trim() };
  } catch (error) {
    return {
      ok: false,
      output: `${error.stdout || ""}${error.stderr || ""}`.trim() || error.message,
    };
  }
}

async function handleMessage(message) {
  switch (message.type) {
    case "ping":
      return { pong: true, extensionId: EXTENSION_ID };
    case "status.get":
      return getStatus();
    case "setup.status":
      return getSetupStatus();
    case "setup.project.save":
      return saveProjectUrl(message.payload);
    case "setup.audio.configure":
      return configureAudio();
    case "setup.open.dedicated-chrome":
      return openDedicatedChromeSetup();
    case "setup.open.chatgpt":
      return openChatgptSetup();
    case "setup.confirm":
      return confirmSetupStep(message.payload);
    case "meeting.start":
      return startMeeting(message.payload);
    case "meet.mic.toggle":
      return toggleMeetMicrophone();
    case "voice.restart":
      return restartVoice();
    case "voice.stop":
      return stopVoice();
    case "audio.restore":
      return restoreAudio();
    case "session.stop":
      return stopSession();
    case "diagnostics.run":
      return runDiagnostics();
    default:
      throw new Error(`Unsupported Native Host request: ${message.type || "missing type"}`);
  }
}

function sendMessage(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([header, body]));
}

let input = Buffer.alloc(0);
let queue = Promise.resolve();

process.stdin.on("data", (chunk) => {
  input = Buffer.concat([input, chunk]);

  while (input.length >= 4) {
    const length = input.readUInt32LE(0);
    if (length > MAX_MESSAGE_BYTES) {
      process.stderr.write(`Native Host message exceeded ${MAX_MESSAGE_BYTES} bytes.\n`);
      process.exit(1);
    }
    if (input.length < length + 4) {
      break;
    }

    const body = input.subarray(4, length + 4);
    input = input.subarray(length + 4);
    queue = queue.then(async () => {
      let message;
      try {
        message = JSON.parse(body.toString("utf8"));
        const data = await handleMessage(message);
        sendMessage({ id: message.id, ok: true, data });
      } catch (error) {
        sendMessage({ id: message?.id, ok: false, error: error.message });
      }
    });
  }
});

process.stdin.on("end", () => {
  queue.catch((error) => {
    process.stderr.write(`Native Host request queue failed: ${error.message}\n`);
    process.exitCode = 1;
  });
});
process.stdin.resume();
