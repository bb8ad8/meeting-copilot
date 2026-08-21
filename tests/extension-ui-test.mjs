#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const executablePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });

await context.addInitScript(() => {
  globalThis.__nativeRequests = [];
  globalThis.chrome = {
    runtime: {
      id: "jlikakgdldiihhflkobhnpfegjlcakdd",
      sendMessage: async ({ request }) => {
        globalThis.__nativeRequests.push(request);
        if (request.type === "diagnostics.run") {
          return { ok: true, data: { ok: true, output: "All checks passed." } };
        }
        if (request.type === "meeting.start") {
          return {
            ok: true,
            data: { status: "starting", meetingUrl: request.payload.meetingUrl },
          };
        }
        if (request.type === "meet.mic.toggle") {
          return { ok: true, data: { status: "ok", after: "unmuted", verified: true } };
        }
        if (request.type === "setup.status") {
          if (globalThis.__hostDisconnected) {
            return { ok: false, error: "Specified native messaging host not found." };
          }
          if (globalThis.__unifiedSetupIncomplete) {
            return {
              ok: true,
              data: {
                hostConnected: true,
                repoRoot: "/Users/test/meeting-copilot",
                audio: {
                  ready: true,
                  devicesReady: true,
                  requiredDevices: {
                    "Meetron: Meeting to AI": true,
                    "Meetron: AI to Meeting": true,
                  },
                },
                project: { configured: false, url: "" },
                dedicatedChrome: { extensionInstalled: false, sharedProfile: true },
                confirmations: {
                  profileLayoutVersion: 2,
                  chatgptLoginConfirmed: false,
                  googleLoginConfirmed: false,
                },
                complete: false,
              },
            };
          }
          if (globalThis.__setupIncomplete) {
            return {
              ok: true,
              data: {
                hostConnected: true,
                repoRoot: "/Users/test/meeting-copilot",
                audio: {
                  ready: false,
                  devicesReady: false,
                  requiredDevices: {
                    "Meetron: Meeting to AI": true,
                    "Meetron: AI to Meeting": false,
                  },
                },
                project: { configured: false, url: "" },
                dedicatedChrome: { extensionInstalled: false },
                confirmations: {
                  chatgptLoginConfirmed: false,
                  googleLoginConfirmed: false,
                },
                complete: false,
              },
            };
          }
          return {
            ok: true,
            data: {
              hostConnected: true,
              audio: { ready: true, devicesReady: true, requiredDevices: {} },
              project: { configured: true, url: "https://chatgpt.com/g/g-p-test/project" },
              dedicatedChrome: { extensionInstalled: true },
              confirmations: {
                chatgptLoginConfirmed: true,
                googleLoginConfirmed: true,
              },
              complete: true,
            },
          };
        }
        return {
          ok: true,
          data: {
            host: { connected: true },
            audio: { ready: true },
            chatgpt: {
              browserConnected: true,
              voiceActive: true,
              microphoneOn: true,
              audioOutput: { routed: true, internalChecked: true },
            },
            dedicatedMeet: {
              browserConnected: true,
              connection: "joined",
              microphone: "muted",
              url: "https://meet.google.com/abc-defg-hij",
            },
            meetingLaunch: {
              status: "completed",
              meetingUrl: "https://meet.google.com/abc-defg-hij",
            },
            meetMicrophone: {
              state: "muted",
              meetingUrl: "https://meet.google.com/abc-defg-hij",
            },
          },
        };
      },
    },
    storage: {
      local: {
        get: async () => ({}),
        set: async () => {},
      },
    },
  };
});

await context.route("https://meet.google.com/**", async (route) => {
  await route.fulfill({
    headers: { "content-type": "text/html; charset=utf-8" },
    body: `<!doctype html>
      <html lang="ja">
        <body style="margin:0;background:#202124;color:white;font-family:sans-serif">
          <main style="height:100vh;display:grid;place-items:center">
            <div style="text-align:center"><h1>Meeting test</h1><p>2 participants</p></div>
          </main>
          <button aria-label="通話から退出" style="position:fixed;bottom:20px;left:600px">Leave</button>
          <button id="meet-mic" aria-label="マイクをオフにする（⌘+D キー）" style="position:fixed;bottom:20px;left:550px">Mic</button>
          <script>
            document.querySelector('#meet-mic').addEventListener('click', (event) => {
              const button = event.currentTarget;
              button.setAttribute('aria-label', button.getAttribute('aria-label').includes('オン')
                ? 'マイクをオフにする（⌘+D キー）'
                : 'マイクをオンにする（⌘+D キー）');
            });
          </script>
        </body>
      </html>`,
  });
});

const page = await context.newPage();
await page.goto("https://meet.google.com/abc-defg-hij");
const script = (await readFile(resolve(repoRoot, "extension/content-script.js"), "utf8"))
  .replace('attachShadow({ mode: "closed" })', 'attachShadow({ mode: "open" })');
await page.evaluate(script);
await page.waitForTimeout(800);

const initial = await page.evaluate(() => {
  const root = document.querySelector("#meeting-copilot-controls-root")?.shadowRoot;
  return {
    exists: Boolean(root),
    meet: root?.querySelector("[data-meet-status]")?.textContent,
    voice: root?.querySelector("[data-voice-status]")?.textContent,
    audio: root?.querySelector("[data-audio-status]")?.textContent,
    mic: root?.querySelector("[data-mic] span")?.textContent,
    buttons: [...document.querySelectorAll("button")].map((button) => ({
      label: button.getAttribute("aria-label"),
      text: button.textContent,
      visible: button.getClientRects().length > 0,
    })),
  };
});

if (
  !initial.exists ||
  initial.meet !== "参加中・ミュート" ||
  initial.voice !== "起動中" ||
  initial.audio !== "正常" ||
  initial.mic !== "ミュート解除"
) {
  throw new Error(`Unexpected initial control UI: ${JSON.stringify(initial)}`);
}

await page.evaluate(() => {
  document
    .querySelector("#meeting-copilot-controls-root")
    .shadowRoot.querySelector("[data-mic]")
    .click();
});
const untrustedRequest = await page.evaluate(() =>
  globalThis.__nativeRequests.some((entry) => entry.type === "meet.mic.toggle"),
);
if (untrustedRequest) {
  throw new Error("An untrusted page-generated click reached the Native Host.");
}

await page.locator("#meeting-copilot-controls-root [data-mic]").click();
await page.waitForTimeout(900);

const after = await page.evaluate(() => {
  const root = document.querySelector("#meeting-copilot-controls-root").shadowRoot;
  return {
    meet: root.querySelector("[data-meet-status]").textContent,
    mic: root.querySelector("[data-mic] span").textContent,
    message: root.querySelector("[data-message]").textContent,
    nativeRequested: globalThis.__nativeRequests.some((entry) => entry.type === "meet.mic.toggle"),
    userMicrophoneLabel: document.querySelector("#meet-mic").getAttribute("aria-label"),
  };
});

if (
  after.meet !== "参加中・送話中" ||
  after.mic !== "ミュート" ||
  after.message !== "GPT参加者のミュートを解除しました" ||
  !after.nativeRequested ||
  !after.userMicrophoneLabel.includes("マイクをオフにする")
) {
  throw new Error(`Remote GPT microphone control did not stay isolated: ${JSON.stringify(after)}`);
}

await page.screenshot({ path: "/tmp/meeting-copilot-control-ui.png" });

const popup = await context.newPage();
const popupHtml = (await readFile(resolve(repoRoot, "extension/popup.html"), "utf8"))
  .replace('<link rel="stylesheet" href="popup.css">', "")
  .replace('<script src="popup.js"></script>', "");
await popup.setContent(popupHtml);
await popup.addStyleTag({ content: await readFile(resolve(repoRoot, "extension/popup.css"), "utf8") });
await popup.evaluate(await readFile(resolve(repoRoot, "extension/popup.js"), "utf8"));
await popup.locator("#meeting-url").fill("https://meet.google.com/abc-defg-hij");
await popup.locator("[data-start]").click();
await popup.waitForFunction(() =>
  document.querySelector("[data-message]")?.textContent.includes("開始しました"),
);

const popupResult = await popup.evaluate(() => ({
  request: globalThis.__nativeRequests.find((entry) => entry.type === "meeting.start"),
  message: document.querySelector("[data-message]").textContent,
  launch: document.querySelector("[data-launch-status]").textContent,
}));
if (
  popupResult.request?.payload?.meetingUrl !== "https://meet.google.com/abc-defg-hij" ||
  popupResult.launch !== "起動完了"
) {
  throw new Error(`Popup start did not submit the Meet URL: ${JSON.stringify(popupResult)}`);
}
await popup.screenshot({ path: "/tmp/meeting-copilot-popup-ui.png" });

const setupPopup = await context.newPage();
await setupPopup.setContent(popupHtml);
await setupPopup.addStyleTag({ content: await readFile(resolve(repoRoot, "extension/popup.css"), "utf8") });
await setupPopup.evaluate(() => { globalThis.__setupIncomplete = true; });
await setupPopup.evaluate(await readFile(resolve(repoRoot, "extension/popup.js"), "utf8"));
await setupPopup.waitForFunction(() =>
  document.querySelector('[data-step="1"]:not([hidden]) h2')?.textContent === "音声デバイス",
);
const setupResult = await setupPopup.evaluate(() => ({
  launchHidden: document.querySelector("[data-launch-view]").hidden,
  setupHidden: document.querySelector("[data-setup-view]").hidden,
  step: document.querySelector("[data-step-count]").textContent,
  outputStatus: document.querySelector('[data-device-label-index="1"]').textContent,
  nextDisabled: document.querySelector("[data-next-step]").disabled,
}));
if (
  !setupResult.launchHidden ||
  setupResult.setupHidden ||
  setupResult.step !== "2 / 4" ||
  setupResult.outputStatus !== "未検出" ||
  !setupResult.nextDisabled
) {
  throw new Error(`Setup wizard did not show the incomplete audio step: ${JSON.stringify(setupResult)}`);
}
await setupPopup.screenshot({ path: "/tmp/meeting-copilot-setup-ui.png" });

const unifiedSetupPopup = await context.newPage();
await unifiedSetupPopup.setContent(popupHtml);
await unifiedSetupPopup.addStyleTag({ content: await readFile(resolve(repoRoot, "extension/popup.css"), "utf8") });
await unifiedSetupPopup.evaluate(() => { globalThis.__unifiedSetupIncomplete = true; });
await unifiedSetupPopup.evaluate(await readFile(resolve(repoRoot, "extension/popup.js"), "utf8"));
await unifiedSetupPopup.waitForFunction(() =>
  document.querySelector('[data-step="2"]:not([hidden]) h2')?.textContent === "専用Chrome",
);
const unifiedSetupResult = await unifiedSetupPopup.evaluate(() => ({
  step: document.querySelector("[data-step-count]").textContent,
  heading: document.querySelector('[data-step="2"] h2').textContent,
  path: document.querySelector("[data-extension-path]").textContent,
  nextDisabled: document.querySelector("[data-next-step]").disabled,
}));
if (
  unifiedSetupResult.step !== "3 / 4" ||
  unifiedSetupResult.heading !== "専用Chrome" ||
  unifiedSetupResult.path !== "/Users/test/meeting-copilot/extension" ||
  !unifiedSetupResult.nextDisabled
) {
  throw new Error(`Unified profile setup step is incomplete: ${JSON.stringify(unifiedSetupResult)}`);
}
await unifiedSetupPopup.screenshot({ path: "/tmp/meeting-copilot-unified-setup-ui.png" });

const disconnectedPopup = await context.newPage();
await disconnectedPopup.setContent(popupHtml);
await disconnectedPopup.addStyleTag({ content: await readFile(resolve(repoRoot, "extension/popup.css"), "utf8") });
await disconnectedPopup.evaluate(() => { globalThis.__hostDisconnected = true; });
await disconnectedPopup.evaluate(await readFile(resolve(repoRoot, "extension/popup.js"), "utf8"));
await disconnectedPopup.waitForFunction(() =>
  document.querySelector("[data-host-status]")?.textContent === "ローカルホスト未接続",
);
const disconnectedResult = await disconnectedPopup.evaluate(() => ({
  command: document.querySelector("[data-bootstrap-command]").textContent,
  bootstrapHidden: document.querySelector("[data-bootstrap]").hidden,
}));
if (
  disconnectedResult.bootstrapHidden ||
  disconnectedResult.command.includes("/path/to/") ||
  !disconnectedResult.command.includes("Secure Preferences") ||
  !disconnectedResult.command.includes("jlikakgdldiihhflkobhnpfegjlcakdd") ||
  !disconnectedResult.command.includes('cd "$REPO_DIR"')
) {
  throw new Error(`Disconnected setup did not provide an automatic install path: ${JSON.stringify(disconnectedResult)}`);
}
await disconnectedPopup.screenshot({ path: "/tmp/meeting-copilot-disconnected-setup-ui.png" });

const unavailableRuntimePopup = await context.newPage();
const runtimeErrors = [];
unavailableRuntimePopup.on("pageerror", (error) => runtimeErrors.push(error.message));
await unavailableRuntimePopup.setContent(popupHtml);
await unavailableRuntimePopup.addStyleTag({
  content: await readFile(resolve(repoRoot, "extension/popup.css"), "utf8"),
});
await unavailableRuntimePopup.evaluate(() => {
  delete globalThis.chrome.runtime.sendMessage;
});
await unavailableRuntimePopup.evaluate(await readFile(resolve(repoRoot, "extension/popup.js"), "utf8"));
const unavailableRuntimeResult = await unavailableRuntimePopup.evaluate(() => ({
  hostStatus: document.querySelector("[data-host-status]").textContent,
  setupMessage: document.querySelector("[data-setup-message]").textContent,
}));
if (
  runtimeErrors.length > 0 ||
  unavailableRuntimeResult.hostStatus !== "Chrome拡張機能として開かれていません" ||
  !unavailableRuntimeResult.setupMessage.includes("拡張機能メニューから開き直してください")
) {
  throw new Error(
    `Missing Chrome runtime was not handled: ${JSON.stringify({ unavailableRuntimeResult, runtimeErrors })}`,
  );
}
await browser.close();
process.stdout.write("Extension panel, launcher, and setup wizard UI tests passed.\n");
