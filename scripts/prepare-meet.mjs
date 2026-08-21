#!/usr/bin/env node

import { getAudioStatus } from "./audio-backend.mjs";
import { connectToChromeOverCDP } from "./playwright-cdp.mjs";

const CONTROLLER_EXTENSION_ID = "jlikakgdldiihhflkobhnpfegjlcakdd";

const args = process.argv.slice(2);
const options = {
  cdp: "http://127.0.0.1:9223",
  join: false,
  joinDelay: 2,
  microphoneDevice: "",
  name: "GPT-Live",
  speakerDevice: "",
  url: "",
};

function usage() {
  process.stdout.write(`Usage: node scripts/prepare-meet.mjs [options]\n\nOptions:\n  --cdp URL                Chrome DevTools endpoint (default: ${options.cdp})\n  --name NAME              Meet participant name (default: ${options.name})\n  --url URL                Expected Google Meet URL\n  --microphone-device NAME Override the selected virtual microphone\n  --speaker-device NAME    Override the selected virtual speaker\n  --join                   Request admission after preparing the pre-join screen\n  --join-delay SEC         Wait before requesting admission (default: ${options.joinDelay})\n  -h, --help               Show this help\n`);
}

for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  switch (argument) {
    case "--cdp":
      options.cdp = args[++index] || "";
      break;
    case "--name":
      options.name = args[++index] || "";
      break;
    case "--microphone-device":
      options.microphoneDevice = args[++index] || "";
      break;
    case "--speaker-device":
      options.speakerDevice = args[++index] || "";
      break;
    case "--url":
      options.url = args[++index] || "";
      break;
    case "--join":
      options.join = true;
      break;
    case "--join-delay":
      options.joinDelay = Number(args[++index]);
      break;
    case "-h":
    case "--help":
      usage();
      process.exit(0);
      break;
    default:
      process.stderr.write(`Unknown argument: ${argument}\n`);
      usage();
      process.exit(2);
  }
}

if (!options.url.startsWith("https://meet.google.com/")) {
  process.stderr.write("A Google Meet URL is required with --url.\n");
  process.exit(2);
}

if (!Number.isFinite(options.joinDelay) || options.joinDelay < 0) {
  process.stderr.write("--join-delay must be a non-negative number.\n");
  process.exit(2);
}

if (!options.microphoneDevice || !options.speakerDevice) {
  const audio = await getAudioStatus();
  options.microphoneDevice ||= audio.routing.meetingMicrophone.name;
  options.speakerDevice ||= audio.routing.meetingSpeaker.name;
}

function exactDevicePattern(name) {
  return new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}

const browser = await connectToChromeOverCDP(options.cdp);
const contexts = browser.contexts();
if (contexts.length === 0) {
  throw new Error("Chrome did not expose a browser context.");
}

const context = contexts[0];
await context.grantPermissions(["microphone"], {
  origin: "https://meet.google.com",
});

const controllerWorker = context
  .serviceWorkers()
  .find((worker) => worker.url().startsWith(`chrome-extension://${CONTROLLER_EXTENSION_ID}/`));
if (controllerWorker) {
  await controllerWorker.evaluate(() => chrome.storage.local.set({ controlsCollapsed: true }));
}

const meetPages = context
  .pages()
  .filter((candidate) => candidate.url().startsWith("https://meet.google.com/"));
let page = meetPages.find((candidate) => candidate.url().startsWith(options.url));
await Promise.all(
  meetPages
    .filter((candidate) => candidate !== page)
    .map((candidate) => candidate.close()),
);

if (!page) {
  page = await context.newPage();
  await page.goto(options.url, { waitUntil: "domcontentloaded" });
}

await page.bringToFront();
await page.waitForLoadState("domcontentloaded");
page.setDefaultTimeout(5_000);

async function clickFirst(locators, timeout = 2_000) {
  for (const locator of locators) {
    try {
      if ((await locator.count()) > 0 && (await locator.first().isVisible())) {
        await locator.first().click({ timeout });
        return true;
      }
    } catch {
      // Meet changes frequently; try the next localized selector.
    }
  }
  return false;
}

async function fillParticipantName() {
  const fields = [
    page.getByLabel(/^(名前|Name)$/i),
    page.getByPlaceholder(/名前を入力|名前/i),
    page.getByPlaceholder(/your name|name/i),
    page.getByRole("textbox"),
  ];

  for (const field of fields) {
    try {
      if ((await field.count()) === 1 && (await field.isVisible())) {
        await field.fill(options.name);
        return true;
      }
    } catch {
      // Try the next field.
    }
  }
  return false;
}

const microphoneOnboardingButtons = [
  page.getByRole("button", { name: /マイクの使用/ }),
  page.getByRole("button", { name: /use (the )?microphone|use mic/i }),
];

// The onboarding dialog can appear after the first DOMContentLoaded event.
try {
  await Promise.race(
    microphoneOnboardingButtons.map((button) =>
      button.first().waitFor({ state: "visible", timeout: 5_000 }),
    ),
  );
} catch {
  // Granting the permission can dismiss the dialog before it becomes visible.
}

const usedMicrophone = await clickFirst(microphoneOnboardingButtons);

await page.waitForTimeout(500);

async function selectAudioDevice({ buttonName, menuName, targetName }) {
  const button = page.getByRole("button", { name: buttonName }).first();
  await button.waitFor({ state: "visible", timeout: 15_000 });
  let currentLabel = (await button.getAttribute("aria-label")) || "";
  if (!targetName.test(currentLabel)) {
    await button.click();
    const menu = page.getByRole("menu", { name: menuName });
    await menu.getByRole("menuitemradio", { name: targetName }).click({ timeout: 5_000 });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      currentLabel = (await button.getAttribute("aria-label")) || "";
      if (targetName.test(currentLabel)) break;
      await page.waitForTimeout(100);
    }
  }
  if (!targetName.test(currentLabel)) {
    throw new Error(`Meet did not select the required audio device: ${targetName}`);
  }
  return currentLabel;
}

const microphoneDevice = await selectAudioDevice({
  buttonName: /^(マイク|Microphone):/i,
  menuName: /マイク|Microphone/i,
  targetName: exactDevicePattern(options.microphoneDevice),
});

const speakerDevice = await selectAudioDevice({
  buttonName: /^(スピーカー|Speaker):/i,
  menuName: /スピーカー|Speaker/i,
  targetName: exactDevicePattern(options.speakerDevice),
});

const nameFilled = await fillParticipantName();

async function visibleControlState({ on, off }) {
  if (await locatorIsVisible(on)) {
    return "off";
  }
  if (await locatorIsVisible(off)) {
    return "on";
  }
  return "unavailable";
}

async function locatorIsVisible(locator) {
  try {
    return (await locator.count()) > 0 && (await locator.first().isVisible());
  } catch {
    return false;
  }
}

const turnMicrophoneOn = page.getByRole("button", {
  name: /マイクをオン(?:にする)?|turn on microphone|unmute microphone/i,
});
const turnMicrophoneOff = page.getByRole("button", {
  name: /マイクをオフ(?:にする)?|マイクをミュート|turn off microphone|mute microphone/i,
});
let microphoneState = await visibleControlState({ on: turnMicrophoneOn, off: turnMicrophoneOff });
if (microphoneState === "on") {
  await turnMicrophoneOff.first().click();
  await page.waitForTimeout(300);
  microphoneState = await visibleControlState({ on: turnMicrophoneOn, off: turnMicrophoneOff });
}
if (microphoneState !== "off") {
  throw new Error("Meet microphone could not be verified as muted before admission.");
}

const turnCameraOn = page.getByRole("button", {
  name: /カメラをオン(?:にする)?|turn on camera/i,
});
const turnCameraOff = page.getByRole("button", {
  name: /カメラをオフ(?:にする)?|turn off camera/i,
});
let cameraState = await visibleControlState({ on: turnCameraOn, off: turnCameraOff });
if (cameraState === "on") {
  await turnCameraOff.first().click();
  await page.waitForTimeout(300);
  cameraState = await visibleControlState({ on: turnCameraOn, off: turnCameraOff });
}
if (cameraState === "on") {
  throw new Error("Meet camera could not be disabled before admission.");
}
if (cameraState === "unavailable") {
  const bodyText = await page.locator("body").innerText().catch(() => "");
  cameraState = /カメラ.*(?:見つかりません|使用できません|利用できません|接続されていません)|(?:camera|webcam).*(?:not found|unavailable|not available|not detected|disconnected)/i.test(
    bodyText,
  )
    ? "unavailable"
    : "control-unavailable";
}

const microphoneButton = page.getByRole("button", {
  name: /^(マイク|Microphone):/i,
});
const speakerButton = page.getByRole("button", {
  name: /^(スピーカー|Speaker):/i,
});

const resolvedMicrophoneDevice =
  (await microphoneButton.getAttribute("aria-label")) || microphoneDevice;
const resolvedSpeakerDevice =
  (await speakerButton.getAttribute("aria-label")) || speakerDevice;

let joinStatus = "not-requested";
if (options.join) {
  if (cameraState === "control-unavailable") {
    joinStatus = "manual-camera-check-required";
  } else if (nameFilled) {
    joinStatus = "anonymous-login-required";
  } else {
    const joinButton = page.getByRole("button", {
      name: /参加をリクエスト|今すぐ参加|ask to join|join now/i,
    });

    try {
      await joinButton.first().waitFor({ state: "visible", timeout: 10_000 });
      await page.waitForTimeout(options.joinDelay * 1_000);
      // The controller panel can overlap Meet's lower-right join button.
      await joinButton.first().click({ timeout: 5_000, force: true });

      await page
        .waitForFunction(
          () => {
            const text = document.body?.innerText || "";
            return (
              /参加を許可するまで|waiting for the host|asking to join/i.test(
                text,
              ) ||
              /参加できません|can't join|cannot join/i.test(text) ||
              /通話から退出|leave call/i.test(text)
            );
          },
          undefined,
          { timeout: 15_000 },
        )
        .catch(() => {});

      const bodyText = await page.locator("body").innerText();
      if (/参加できません|can't join|cannot join/i.test(bodyText)) {
        joinStatus = "rejected";
      } else if (/通話から退出|leave call/i.test(bodyText)) {
        joinStatus = "joined";
      } else if (
        /参加を許可するまで|waiting for the host|asking to join/i.test(bodyText)
      ) {
        joinStatus = "waiting-for-admission";
      } else {
        joinStatus = "requested-status-unknown";
      }
    } catch (error) {
      const bodyText = await page.locator("body").innerText().catch(() => "");
      if (/通話から退出|leave call/i.test(bodyText)) {
        joinStatus = "already-joined";
      } else {
        throw new Error(`Could not request Meet admission: ${error.message}`);
      }
    }
  }
}

const result = {
  url: page.url(),
  permission: "microphone granted for meet.google.com",
  microphoneOnboarding: usedMicrophone ? "dismissed" : "not shown",
  participantNameFilled: nameFilled,
  microphoneMuted: microphoneState === "off",
  cameraDisabled: cameraState === "off" || cameraState === "unavailable",
  cameraState,
  microphoneDevice: resolvedMicrophoneDevice,
  speakerDevice: resolvedSpeakerDevice,
  joinStatus,
  title: await page.title(),
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (joinStatus === "anonymous-login-required") {
  process.exit(13);
}
if (joinStatus === "rejected") {
  process.exit(14);
}
if (joinStatus === "requested-status-unknown") {
  process.exit(15);
}
if (joinStatus === "manual-camera-check-required") {
  process.exit(16);
}
process.exit(0);
