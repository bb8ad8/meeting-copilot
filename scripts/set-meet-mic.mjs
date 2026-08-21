#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connectToChromeOverCDP } from "./playwright-cdp.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtimeDir = resolve(repoRoot, ".meeting-copilot-runtime");
const micStatePath = resolve(runtimeDir, "meet-mic.json");

const args = process.argv.slice(2);
const options = {
  cdp: "http://127.0.0.1:9223",
  assumeBefore: "",
  state: "",
  wait: 0,
};

function usage() {
  process.stdout.write(`Usage: node scripts/set-meet-mic.mjs [options]\n\nOptions:\n  --cdp URL             Chrome DevTools endpoint (default: ${options.cdp})\n  --state STATE         muted, unmuted, or toggle\n  --wait SEC            Wait for admission before changing the mic (default: 0)\n  --assume-before STATE Use muted or unmuted if the Meet control is hidden\n  -h, --help            Show this help\n`);
}

for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  switch (argument) {
    case "--cdp":
      options.cdp = args[++index] || "";
      break;
    case "--state":
      options.state = args[++index] || "";
      break;
    case "--assume-before":
      options.assumeBefore = args[++index] || "";
      break;
    case "--wait":
      options.wait = Number(args[++index]);
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

if (!new Set(["muted", "unmuted", "toggle"]).has(options.state)) {
  process.stderr.write("--state must be muted, unmuted, or toggle.\n");
  process.exit(2);
}

if (options.assumeBefore && !new Set(["muted", "unmuted"]).has(options.assumeBefore)) {
  process.stderr.write("--assume-before must be muted or unmuted.\n");
  process.exit(2);
}

if (!Number.isFinite(options.wait) || options.wait < 0) {
  process.stderr.write("--wait must be a non-negative number.\n");
  process.exit(2);
}

const browser = await connectToChromeOverCDP(options.cdp);
const context = browser.contexts()[0];
if (!context) {
  throw new Error("Chrome did not expose a browser context.");
}

const page = context
  .pages()
  .find((candidate) => candidate.url().startsWith("https://meet.google.com/"));
if (!page) {
  throw new Error("An active Google Meet page was not found.");
}

page.setDefaultTimeout(5_000);

function meetingKey(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return "";
  }
}

function readTrackedState(meetingUrl) {
  if (!existsSync(micStatePath)) {
    return "";
  }
  try {
    const tracked = JSON.parse(readFileSync(micStatePath, "utf8"));
    if (
      meetingKey(tracked.meetingUrl) === meetingKey(meetingUrl) &&
      new Set(["muted", "unmuted"]).has(tracked.state)
    ) {
      return tracked.state;
    }
  } catch {
    // Ignore a missing or interrupted previous state write.
  }
  return "";
}

function writeTrackedState(meetingUrl, state) {
  if (!new Set(["muted", "unmuted"]).has(state)) {
    return;
  }
  mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
  const temporaryPath = `${micStatePath}.${process.pid}.tmp`;
  writeFileSync(
    temporaryPath,
    `${JSON.stringify({ meetingUrl, state, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    { mode: 0o600 },
  );
  renameSync(temporaryPath, micStatePath);
}

const turnMicOn = [
  page.getByRole("button", {
    name: /マイクをオンにする|turn on microphone|unmute microphone/i,
  }),
  page.locator('[aria-label*="マイクをオン"], [aria-label*="turn on microphone" i], [aria-label*="unmute microphone" i]'),
  page.locator('[data-tooltip*="マイクをオン"], [data-tooltip*="turn on microphone" i], [data-tooltip*="unmute microphone" i]'),
];
const turnMicOff = [
  page.getByRole("button", {
    name: /マイクをオフにする|turn off microphone|mute microphone/i,
  }),
  page.locator('[aria-label*="マイクをオフ"], [aria-label*="turn off microphone" i], [aria-label*="mute microphone" i]'),
  page.locator('[data-tooltip*="マイクをオフ"], [data-tooltip*="turn off microphone" i], [data-tooltip*="mute microphone" i]'),
];

async function firstVisible(locators) {
  for (const locator of locators) {
    try {
      if ((await locator.count()) > 0 && (await locator.first().isVisible())) {
        return locator.first();
      }
    } catch {
      // Meet changes frequently; try the next representation of the control.
    }
  }
  return null;
}

async function currentState() {
  if (await firstVisible(turnMicOn)) {
    return "muted";
  }
  if (await firstVisible(turnMicOff)) {
    return "unmuted";
  }
  return "unavailable";
}

let before = await currentState();
if (before === "unavailable" && options.wait > 0) {
  await page
    .waitForFunction(
      () => {
        const text = document.body?.innerText || "";
        return (
          /通話から退出|leave call/i.test(text) ||
          /参加できません|can't join|cannot join/i.test(text)
        );
      },
      undefined,
      { timeout: options.wait * 1_000 },
    )
    .catch(() => {});
  before = await currentState();
}

const trackedBefore = readTrackedState(page.url());
if (
  before === "unavailable" &&
  !options.assumeBefore &&
  !trackedBefore &&
  options.state !== "toggle"
) {
  const bodyText = await page.locator("body").innerText().catch(() => "");
  if (/参加できません|can't join|cannot join/i.test(bodyText)) {
    throw new Error("Google Meet rejected this participant.");
  }
  throw new Error("The Meet microphone is unavailable or admission timed out.");
}

const effectiveBefore =
  before === "unavailable" ? options.assumeBefore || trackedBefore : before;
const desired =
  options.state === "toggle"
    ? effectiveBefore === "muted"
      ? "unmuted"
      : effectiveBefore === "unmuted"
        ? "muted"
        : "toggled"
    : options.state;

let usedKeyboardShortcut = false;
if (before === "unavailable") {
  if (desired !== effectiveBefore) {
    await page.keyboard.press(process.platform === "darwin" ? "Meta+d" : "Control+d");
    usedKeyboardShortcut = true;
    await page.waitForTimeout(500);
  }
} else if (before !== desired) {
  const control = await firstVisible(desired === "unmuted" ? turnMicOn : turnMicOff);
  if (control) {
    await control.click();
  } else {
    await page.keyboard.press(process.platform === "darwin" ? "Meta+d" : "Control+d");
    usedKeyboardShortcut = true;
    await page.waitForTimeout(500);
  }
}

let detectedAfter = await currentState();
if (desired !== "toggled" && detectedAfter !== desired) {
  for (let attempt = 0; attempt < 20 && detectedAfter !== desired; attempt += 1) {
    await page.waitForTimeout(100);
    detectedAfter = await currentState();
  }
}
const verified = desired !== "toggled" && detectedAfter === desired;
if (!verified) {
  throw new Error(`Meet microphone did not change to ${desired}.`);
}
const after = detectedAfter;

writeTrackedState(page.url(), detectedAfter);

process.stdout.write(
  `${JSON.stringify(
    {
      status: "ok",
      url: page.url(),
      before,
      after,
      detectedAfter,
      verified,
      usedKeyboardShortcut,
    },
    null,
    2,
  )}\n`,
);
process.exit(0);
