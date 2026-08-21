import { chromium } from "playwright-core";

export function cdpConnectionOptions(options = {}) {
  return {
    ...options,
    // Chrome 151's dedicated-profile CDP endpoint does not support the browser
    // context overrides Playwright normally applies (for example downloads).
    // Keep the existing Chrome context untouched when attaching to it.
    noDefaults: true,
  };
}

export function connectToChromeOverCDP(endpoint, options = {}) {
  return chromium.connectOverCDP(endpoint, cdpConnectionOptions(options));
}
