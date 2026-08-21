#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cdpConnectionOptions } from "../scripts/playwright-cdp.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

assert.deepEqual(cdpConnectionOptions(), { noDefaults: true });
assert.deepEqual(cdpConnectionOptions({ timeout: 3_000 }), {
  timeout: 3_000,
  noDefaults: true,
});
assert.equal(cdpConnectionOptions({ noDefaults: false }).noDefaults, true);

const productionScripts = [
  "native-host.mjs",
  "open-chrome-page.mjs",
  "prepare-chatgpt-live.mjs",
  "prepare-meet.mjs",
  "set-meet-mic.mjs",
];

for (const script of productionScripts) {
  const source = await readFile(resolve(repoRoot, "scripts", script), "utf8");
  assert.match(source, /connectToChromeOverCDP\(/, `${script} must use the shared CDP connector`);
  assert.doesNotMatch(source, /chromium\.connectOverCDP\(/, `${script} bypasses noDefaults`);
}

process.stdout.write("Playwright CDP compatibility checks passed.\n");
