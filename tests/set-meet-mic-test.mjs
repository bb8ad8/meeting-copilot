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
const profileDir = await mkdtemp(resolve(tmpdir(), "meetron-mic-control-"));
const runtimeDir = await mkdtemp(resolve(tmpdir(), "meetron-mic-state-"));

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
  await context.route("https://meet.google.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><head><style>
        @keyframes moving { from { transform: translateX(0); } to { transform: translateX(2px); } }
        #active-mic { animation: moving 50ms alternate infinite; }
      </style></head><body>
        <button hidden aria-label="Turn off microphone" data-is-muted="false">Hidden duplicate</button>
        <button id="active-mic" aria-label="Turn off microphone" data-is-muted="false">Mic</button>
        <script>
          const mic = document.querySelector('#active-mic');
          const toggle = () => {
            const muted = mic.dataset.isMuted === 'true';
            mic.dataset.isMuted = String(!muted);
            mic.setAttribute('aria-label', muted ? 'Turn off microphone' : 'Turn on microphone');
          };
          mic.addEventListener('click', toggle);
          addEventListener('keydown', (event) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd') toggle();
          });
        </script>
      </body></html>`,
    }),
  );

  const page = await context.newPage();
  await page.goto("https://meet.google.com/abc-defg-hij");

  const { stdout } = await execFileAsync(
    process.execPath,
    [
      resolve(repoRoot, "scripts/set-meet-mic.mjs"),
      "--cdp",
      `http://127.0.0.1:${port}`,
      "--state",
      "muted",
    ],
    {
      cwd: repoRoot,
      env: { ...process.env, MEETING_COPILOT_RUNTIME_DIR: runtimeDir },
      timeout: 15_000,
    },
  );
  const result = JSON.parse(stdout);
  const state = await page.locator("#active-mic").getAttribute("data-is-muted");
  if (
    result.status !== "ok" ||
    result.before !== "unmuted" ||
    result.after !== "muted" ||
    result.verified !== true ||
    !new Set(["click", "force-click"]).has(result.interaction) ||
    result.usedKeyboardShortcut !== false ||
    state !== "true"
  ) {
    throw new Error(`Meet microphone was not controlled reliably: ${stdout}`);
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
  await Promise.all([
    rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
    rm(runtimeDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
  ]);
}

process.stdout.write("Meet microphone control ignores hidden duplicates and unstable controls.\n");
