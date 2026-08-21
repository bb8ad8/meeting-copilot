#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { connectToChromeOverCDP } from "../scripts/playwright-cdp.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const executablePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profileDir = await mkdtemp(resolve(tmpdir(), "meeting-copilot-unified-profile-"));

const port = await new Promise((resolvePort, reject) => {
  const server = net.createServer();
  server.on("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const allocated = server.address().port;
    server.close(() => resolvePort(allocated));
  });
});

const chrome = spawn(
  executablePath,
  [
    "--headless=new",
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--disable-background-networking",
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "about:blank",
  ],
  { stdio: "ignore" },
);

let browser;
try {
  let endpointReady = false;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    endpointReady = await fetch(`http://127.0.0.1:${port}/json/version`)
      .then((response) => response.ok)
      .catch(() => false);
    if (endpointReady) break;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  if (!endpointReady) {
    throw new Error("Chrome CDP endpoint did not start.");
  }

  const { stdout: ownershipOutput } = await execFileAsync(
    process.execPath,
    [
      resolve(repoRoot, "scripts/verify-dedicated-chrome.mjs"),
      "--profile-dir",
      profileDir,
      "--port",
      String(port),
    ],
    { cwd: repoRoot, timeout: 10_000 },
  );
  if (JSON.parse(ownershipOutput).verified !== true) {
    throw new Error(`Dedicated Chrome ownership was not verified: ${ownershipOutput}`);
  }
  let wrongProfileRejected = false;
  try {
    await execFileAsync(
      process.execPath,
      [
        resolve(repoRoot, "scripts/verify-dedicated-chrome.mjs"),
        "--profile-dir",
        resolve(profileDir, "not-the-active-profile"),
        "--port",
        String(port),
      ],
      { cwd: repoRoot, timeout: 10_000 },
    );
  } catch {
    wrongProfileRejected = true;
  }
  if (!wrongProfileRejected) {
    throw new Error("A CDP endpoint from another profile was accepted.");
  }

  browser = await connectToChromeOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];

  const { stdout: internalPageOutput } = await execFileAsync(
    process.execPath,
    [
      resolve(repoRoot, "scripts/open-chrome-page.mjs"),
      "--cdp",
      `http://127.0.0.1:${port}`,
      "--url",
      "chrome://version/",
    ],
    { cwd: repoRoot, timeout: 10_000 },
  );
  const internalPageResult = JSON.parse(internalPageOutput);
  if (!internalPageResult.opened || internalPageResult.url !== "chrome://version/") {
    throw new Error(`Chrome internal page did not open: ${internalPageOutput}`);
  }

  await context.route("https://chatgpt.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><body>
        <script>
          const nativeEnumerateDevices = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
          navigator.mediaDevices.enumerateDevices = async () => {
            const devices = await nativeEnumerateDevices();
            const input = devices.find((device) => device.kind === 'audioinput');
            const output = devices.find((device) => device.kind === 'audiooutput');
            return [
              ...devices,
              ...(input ? [{ kind: 'audioinput', deviceId: input.deviceId, label: 'Meetron: Meeting to AI (Virtual)' }] : []),
              ...(output ? [{ kind: 'audiooutput', deviceId: output.deviceId, label: 'Meetron: AI to Meeting (Virtual)' }] : []),
            ];
          };
        </script>
        <button aria-label="Open profile menu">Profile</button>
        <textarea aria-label="New chat in Meetron"></textarea>
        <button aria-label="Start voice" onclick="void (async () => {
          window.__testVoiceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          window.__testVoiceContext = new AudioContext();
          window.__testAudioConstructorElement = new Audio();
          window.__testCreatedAudioElement = document.createElement('audio');
          window.__testCreatedAudioElement.srcObject = new MediaStream();
          if (location.pathname.includes('g-p-failure')) {
            window.__testCreatedAudioElement.setSinkId = () => Promise.reject(new Error('simulated sink failure'));
          }
          this.setAttribute('aria-label', 'End voice');
          document.querySelector('#microphone').hidden = false;
        })()">Voice</button>
        <button id="microphone" aria-label="Turn off microphone" hidden>Mic</button>
      </body></html>`,
    }),
  );
  await context.route("https://meet.google.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Meet preserved</title>" }),
  );

  const meetPage = await context.newPage();
  await meetPage.goto("https://meet.google.com/abc-defg-hij");
  const oldChatgptPage = await context.newPage();
  await oldChatgptPage.goto("https://chatgpt.com/old-chat");

  const { stdout } = await execFileAsync(
    process.execPath,
    [
      resolve(repoRoot, "scripts/prepare-chatgpt-live.mjs"),
      "--cdp",
      `http://127.0.0.1:${port}`,
      "--project-url",
      "https://chatgpt.com/g/g-p-test/project",
      "--input-device",
      "Meetron: Meeting to AI",
      "--input-device-uid",
      "io.github.bb8ad8.meetron.audio.meeting-to-ai.device",
      "--output-device",
      "Meetron: AI to Meeting",
      "--output-device-uid",
      "io.github.bb8ad8.meetron.audio.ai-to-meeting.device",
      "--replace-tab",
    ],
    { cwd: repoRoot, timeout: 30_000 },
  );
  const result = JSON.parse(stdout);
  const pages = context.pages();
  const meetPreserved = pages.some((page) => page.url().startsWith("https://meet.google.com/"));
  const chatgptPages = pages.filter((page) => page.url().startsWith("https://chatgpt.com/"));

  if (
    result.status !== "voice-active" ||
    result.replacedTab !== true ||
    result.audioInput?.routed !== true ||
    !result.audioInput?.device?.startsWith("Meetron: Meeting to AI") ||
    result.audioInput?.inputRequests !== 1 ||
    result.audioOutput?.routed !== true ||
    !result.audioOutput?.device?.startsWith("Meetron: AI to Meeting") ||
    result.audioOutput?.audioContexts !== 1 ||
    result.audioOutput?.mediaElements !== 2 ||
    result.audioOutput?.detachedMediaElements !== 2 ||
    result.internalAudioOutput?.checked !== true ||
    result.internalAudioOutput?.unexpectedOutputs?.length !== 0 ||
    !oldChatgptPage.isClosed() ||
    !meetPreserved ||
    meetPage.isClosed() ||
    chatgptPages.length !== 1
  ) {
    throw new Error(`ChatGPT tab replacement did not preserve Meet: ${JSON.stringify({ result, meetPreserved, chatgptPages: chatgptPages.length })}`);
  }

  let routingFailureDetected = false;
  try {
    await execFileAsync(
      process.execPath,
      [
        resolve(repoRoot, "scripts/prepare-chatgpt-live.mjs"),
        "--cdp",
        `http://127.0.0.1:${port}`,
        "--project-url",
        "https://chatgpt.com/g/g-p-failure/project",
        "--input-device",
        "Meetron: Meeting to AI",
        "--input-device-uid",
        "io.github.bb8ad8.meetron.audio.meeting-to-ai.device",
        "--output-device",
        "Meetron: AI to Meeting",
        "--output-device-uid",
        "io.github.bb8ad8.meetron.audio.ai-to-meeting.device",
        "--replace-tab",
      ],
      { cwd: repoRoot, timeout: 30_000 },
    );
  } catch (error) {
    routingFailureDetected = /simulated sink failure/.test(error.stderr || error.message);
  }

  const remainingPages = context.pages();
  if (
    !routingFailureDetected ||
    remainingPages.some((candidate) => candidate.url().startsWith("https://chatgpt.com/")) ||
    !remainingPages.some((candidate) => candidate.url().startsWith("https://meet.google.com/")) ||
    meetPage.isClosed()
  ) {
    throw new Error("ChatGPT Voice routing failure did not close only the Voice tab.");
  }
} finally {
  await browser?.close().catch(() => {});
  chrome.kill();
  if (chrome.exitCode === null) {
    await Promise.race([
      new Promise((resolveExit) => chrome.once("exit", resolveExit)),
      new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000)),
    ]);
  }
  await rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

process.stdout.write("Unified profile routes detached audio and cleans up Voice failures.\n");
