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
const profileDir = await mkdtemp(resolve(tmpdir(), "meeting-copilot-prepare-meet-"));

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
  if (!endpointReady) throw new Error("Chrome CDP endpoint did not start.");

  browser = await connectToChromeOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  await context.route("https://meet.google.com/**", (route) => {
    const url = new URL(route.request().url());
    const cameraOn = url.searchParams.has("camera-on");
    const cameraUnknown = url.searchParams.has("camera-unknown");
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><body>
        <button aria-label="Microphone: Meetron: AI to Meeting">Microphone</button>
        <button aria-label="Speaker: Meetron: Meeting to AI">Speaker</button>
        <button aria-label="Turn on microphone">Muted</button>
        ${
          cameraOn
            ? '<button aria-label="Turn off camera" onclick="this.setAttribute(\'aria-label\', \'Turn on camera\')">Camera</button>'
            : cameraUnknown
              ? "<p>Camera status uses an unknown UI</p>"
              : "<p>Camera device is unavailable</p>"
        }
        <button aria-label="Join now" onclick="document.body.dataset.joinClicked = 'true'; this.remove(); document.body.append(' Leave call ')">Join</button>
      </body></html>`,
    });
  });

  async function prepare(url, { join = false, expectedExit = 0 } = {}) {
    const argumentsList = [
      resolve(repoRoot, "scripts/prepare-meet.mjs"),
      "--cdp",
      `http://127.0.0.1:${port}`,
      "--url",
      url,
      "--microphone-device",
      "Meetron: AI to Meeting",
      "--speaker-device",
      "Meetron: Meeting to AI",
    ];
    if (join) argumentsList.push("--join", "--join-delay", "0");
    try {
      const { stdout } = await execFileAsync(process.execPath, argumentsList, {
        cwd: repoRoot,
        timeout: 30_000,
      });
      if (expectedExit !== 0) throw new Error(`Expected exit ${expectedExit}, got 0.`);
      return JSON.parse(stdout);
    } catch (error) {
      if (error.code !== expectedExit) throw error;
      return JSON.parse(error.stdout);
    }
  }

  const unavailableCamera = await prepare("https://meet.google.com/abc-defg-hij");
  const enabledCamera = await prepare("https://meet.google.com/abc-defg-hij?camera-on=1");
  const unknownCamera = await prepare(
    "https://meet.google.com/abc-defg-hij?camera-unknown=1",
    { join: true, expectedExit: 16 },
  );
  const unknownCameraPage = context
    .pages()
    .find((page) => page.url().includes("camera-unknown=1"));
  const joinClicked = await unknownCameraPage?.evaluate(() => document.body.dataset.joinClicked);
  if (
    unavailableCamera.cameraDisabled !== true ||
    unavailableCamera.cameraState !== "unavailable" ||
    enabledCamera.cameraDisabled !== true ||
    enabledCamera.cameraState !== "off" ||
    unknownCamera.cameraDisabled !== false ||
    unknownCamera.cameraState !== "control-unavailable" ||
    unknownCamera.joinStatus !== "manual-camera-check-required" ||
    joinClicked
  ) {
    throw new Error(
      `Meet camera handling failed: ${JSON.stringify({ unavailableCamera, enabledCamera, unknownCamera, joinClicked })}`,
    );
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

process.stdout.write("Meet camera states fail over to manual admission when unknown.\n");
