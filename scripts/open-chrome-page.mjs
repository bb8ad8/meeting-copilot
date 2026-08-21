#!/usr/bin/env node

import { connectToChromeOverCDP } from "./playwright-cdp.mjs";

const args = process.argv.slice(2);
let cdp = "http://127.0.0.1:9223";
let targetUrl = "";

function usage() {
  process.stdout.write(`Usage: node scripts/open-chrome-page.mjs --url URL [--cdp URL]\n`);
}

for (let index = 0; index < args.length; index += 1) {
  switch (args[index]) {
    case "--cdp":
      cdp = args[++index] || "";
      break;
    case "--url":
      targetUrl = args[++index] || "";
      break;
    case "-h":
    case "--help":
      usage();
      process.exit(0);
      break;
    default:
      process.stderr.write(`Unknown argument: ${args[index]}\n`);
      usage();
      process.exit(2);
  }
}

let parsedUrl;
try {
  parsedUrl = new URL(targetUrl);
} catch {
  process.stderr.write("A valid URL is required with --url.\n");
  process.exit(2);
}
if (!new Set(["https:", "chrome:"]).has(parsedUrl.protocol)) {
  process.stderr.write("Only HTTPS and Chrome internal URLs are supported.\n");
  process.exit(2);
}

const browser = await connectToChromeOverCDP(cdp);
const session = await browser.newBrowserCDPSession();
const { targetId } = await session.send("Target.createTarget", { url: targetUrl });
await session.send("Target.activateTarget", { targetId });
await session.detach();
process.stdout.write(`${JSON.stringify({ opened: true, url: targetUrl, targetId })}\n`);
process.exit(0);
