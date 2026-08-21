#!/usr/bin/env node

import { getAudioStatus } from "./audio-backend.mjs";
import { connectToChromeOverCDP } from "./playwright-cdp.mjs";

const args = process.argv.slice(2);
const options = {
  cdp: "http://127.0.0.1:9223",
  projectUrl: "",
  replaceTab: false,
  inputDevice: "",
  inputDeviceUID: "",
  outputDevice: "",
  outputDeviceUID: "",
};

function usage() {
  process.stdout.write(`Usage: node scripts/prepare-chatgpt-live.mjs [options]\n\nOptions:\n  --cdp URL                Chrome DevTools endpoint (default: ${options.cdp})\n  --project-url URL        ChatGPT Project landing URL\n  --input-device NAME      Override the ChatGPT Voice input device\n  --input-device-uid UID   Core Audio UID used by the safety check\n  --output-device NAME     Override the ChatGPT Voice output device\n  --output-device-uid UID  Core Audio UID used by the safety check\n  --replace-tab            Close only existing ChatGPT tabs before starting Voice\n  -h, --help               Show this help\n`);
}

for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  switch (argument) {
    case "--cdp":
      options.cdp = args[++index] || "";
      break;
    case "--project-url":
      options.projectUrl = args[++index] || "";
      break;
    case "--input-device":
      options.inputDevice = args[++index] || "";
      break;
    case "--input-device-uid":
      options.inputDeviceUID = args[++index] || "";
      break;
    case "--output-device":
      options.outputDevice = args[++index] || "";
      break;
    case "--output-device-uid":
      options.outputDeviceUID = args[++index] || "";
      break;
    case "--replace-tab":
      options.replaceTab = true;
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

if (!/^https:\/\/chatgpt\.com\/g\/g-p-[^/]+\/project(?:[/?#]|$)/.test(options.projectUrl)) {
  process.stderr.write("A ChatGPT Project landing URL is required with --project-url.\n");
  process.exit(2);
}

if (!options.inputDevice || !options.outputDevice) {
  const audio = await getAudioStatus();
  if (!options.inputDevice) {
    options.inputDevice = audio.routing.chatgptInput.name;
    options.inputDeviceUID = audio.routing.chatgptInput.uid;
  }
  if (!options.outputDevice) {
    options.outputDevice = audio.routing.chatgptOutput.name;
    options.outputDeviceUID = audio.routing.chatgptOutput.uid;
  }
}

const browser = await connectToChromeOverCDP(options.cdp);
const contexts = browser.contexts();
if (contexts.length === 0) {
  throw new Error("Chrome did not expose a browser context.");
}

const context = contexts[0];
await context.grantPermissions(["microphone"], {
  origin: "https://chatgpt.com",
});

const existingChatgptPages = context
  .pages()
  .filter((candidate) => candidate.url().startsWith("https://chatgpt.com/"));

let routingProbe = existingChatgptPages[0];
let temporaryProbe = false;
if (!routingProbe) {
  routingProbe = await context.newPage();
  temporaryProbe = true;
  await routingProbe.goto(options.projectUrl, { waitUntil: "domcontentloaded" });
} else {
  await routingProbe.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {});
}

const routingDevices = await routingProbe.evaluate(async ({ inputName, outputName }) => {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const findDevice = (kind, targetName) => {
    const normalizedTarget = targetName.trim().toLowerCase();
    const target = devices.find((device) =>
      device.kind === kind && device.label.trim().toLowerCase().startsWith(normalizedTarget),
    );
    return target ? { deviceId: target.deviceId, label: target.label } : null;
  };
  return {
    input: findDevice("audioinput", inputName),
    output: findDevice("audiooutput", outputName),
  };
}, { inputName: options.inputDevice, outputName: options.outputDevice });

const inputDevice = routingDevices.input;
const outputDevice = routingDevices.output;

if (!inputDevice) {
  throw new Error(`ChatGPT Voice input device was not found: ${options.inputDevice}`);
}

if (!outputDevice) {
  throw new Error(`ChatGPT Voice output device was not found: ${options.outputDevice}`);
}

function normalizedDeviceName(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function inspectChromeAudioOutputs(
  browserInstance,
  browserContext,
  expectedDeviceLabel,
  expectedDeviceUID,
  expectedBrowserDeviceId,
) {
  const session = await browserInstance.newBrowserCDPSession();
  const pagePromise = browserContext.waitForEvent("page", {
    predicate: (candidate) => candidate.url().startsWith("chrome://media-internals"),
    timeout: 5_000,
  });
  let internalPage;
  try {
    await session.send("Target.createTarget", { url: "chrome://media-internals/" });
    internalPage = await pagePromise;
    await internalPage.locator("#audio-output-controller-list").waitFor({
      state: "attached",
      timeout: 5_000,
    });
    await internalPage.waitForTimeout(500);

    const controllerCount = await internalPage
      .locator("#audio-output-controller-list > .tree-item")
      .count();
    const controllers = [];
    for (let index = 0; index < controllerCount; index += 1) {
      const properties = await internalPage.evaluate((controllerIndex) => {
        const controller = document.querySelectorAll(
          "#audio-output-controller-list > .tree-item",
        )[controllerIndex];
        controller?.querySelector(".tree-item-header")?.click();
        return Object.fromEntries(
          [...document.querySelectorAll("#audio-property-table tbody tr")].map((row) => {
            const name = row.cells[0]?.innerText.trim() || "";
            const rawValue = row.cells[1]?.innerText.trim() || "";
            let value = rawValue;
            try {
              value = JSON.parse(rawValue);
            } catch {
              // Media Internals normally renders values as JSON, but retain raw text if it changes.
            }
            return [name, value];
          }),
        );
      }, index);
      controllers.push(properties);
    }

    const expectedDevices = [
      normalizedDeviceName(expectedBrowserDeviceId),
      normalizedDeviceName(expectedDeviceUID),
      normalizedDeviceName(expectedDeviceLabel).replace(/virtual$/, ""),
    ].filter(Boolean);
    const activeChatgptOutputs = controllers.filter(
      (controller) =>
        String(controller.status).toLowerCase() === "started" &&
        /chatgpt/i.test(String(controller.web_contents_title || "")),
    );
    const unexpectedOutputs = activeChatgptOutputs.filter((controller) => {
      const actualDevice = normalizedDeviceName(controller.device_id);
      return !expectedDevices.some((expectedDevice) =>
        actualDevice.includes(expectedDevice) || expectedDevice.includes(actualDevice));
    });

    return {
      checked: true,
      expectedDevice: expectedDeviceLabel,
      expectedDeviceUID,
      expectedBrowserDeviceId,
      activeChatgptOutputs: activeChatgptOutputs.map((controller) => ({
        deviceId: controller.device_id || "",
        status: controller.status || "",
        title: controller.web_contents_title || "",
      })),
      unexpectedOutputs: unexpectedOutputs.map((controller) => ({
        deviceId: controller.device_id || "",
        status: controller.status || "",
        title: controller.web_contents_title || "",
      })),
    };
  } finally {
    await internalPage?.close({ runBeforeUnload: false }).catch(() => {});
    await session.detach().catch(() => {});
  }
}

await context.addInitScript(({ inputDeviceId, inputLabel, sinkId, outputLabel }) => {
  const state = {
    inputDeviceId,
    inputLabel,
    sinkId,
    label: outputLabel,
    inputRequests: 0,
    inputTracks: [],
    contexts: new Set(),
    mediaElements: new Set(),
    routeAttempts: 0,
    failures: [],
  };
  Object.defineProperty(globalThis, "__meetingCopilotAudioRouting", {
    configurable: true,
    value: state,
  });

  if (
    location.origin === "https://chatgpt.com" &&
    globalThis.MediaDevices?.prototype?.getUserMedia
  ) {
    const nativeGetUserMedia = MediaDevices.prototype.getUserMedia;
    MediaDevices.prototype.getUserMedia = async function routedGetUserMedia(constraints = {}) {
      if (!constraints || typeof constraints !== "object" || !constraints.audio) {
        return nativeGetUserMedia.call(this, constraints);
      }
      const requestedAudio =
        constraints.audio === true || typeof constraints.audio !== "object"
          ? {}
          : constraints.audio;
      state.inputRequests += 1;
      const stream = await nativeGetUserMedia.call(this, {
        ...constraints,
        audio: {
          ...requestedAudio,
          deviceId: { exact: inputDeviceId },
        },
      });
      for (const track of stream.getAudioTracks()) {
        state.inputTracks.push({
          deviceId: track.getSettings?.().deviceId || "",
          label: track.label || "",
        });
      }
      return stream;
    };
  }

  const routeMediaElement = (element) => {
    state.mediaElements.add(element);
    state.routeAttempts += 1;
    if (typeof element.setSinkId !== "function" || element.sinkId === sinkId) {
      return Promise.resolve();
    }
    return element.setSinkId(sinkId);
  };
  const routeWithoutUnhandledRejection = (element) => {
    void routeMediaElement(element).catch(() => {});
  };

  const NativeAudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (NativeAudioContext && typeof NativeAudioContext.prototype.setSinkId === "function") {
    function RoutedAudioContext(contextOptions = {}) {
      const audioContext = new NativeAudioContext({ ...contextOptions, sinkId });
      state.contexts.add(audioContext);
      return audioContext;
    }
    Object.setPrototypeOf(RoutedAudioContext, NativeAudioContext);
    RoutedAudioContext.prototype = NativeAudioContext.prototype;
    if (globalThis.AudioContext === NativeAudioContext) globalThis.AudioContext = RoutedAudioContext;
    if (globalThis.webkitAudioContext === NativeAudioContext) globalThis.webkitAudioContext = RoutedAudioContext;
  }

  const NativeAudio = globalThis.Audio;
  if (typeof NativeAudio === "function") {
    function RoutedAudio(...audioArguments) {
      const element = new NativeAudio(...audioArguments);
      routeWithoutUnhandledRejection(element);
      return element;
    }
    Object.setPrototypeOf(RoutedAudio, NativeAudio);
    RoutedAudio.prototype = NativeAudio.prototype;
    globalThis.Audio = RoutedAudio;
  }

  const nativeCreateElement = Document.prototype.createElement;
  Document.prototype.createElement = function routedCreateElement(...createArguments) {
    const element = nativeCreateElement.apply(this, createArguments);
    if (element instanceof HTMLMediaElement) routeWithoutUnhandledRejection(element);
    return element;
  };

  const nativeCreateElementNS = Document.prototype.createElementNS;
  Document.prototype.createElementNS = function routedCreateElementNS(...createArguments) {
    const element = nativeCreateElementNS.apply(this, createArguments);
    if (element instanceof HTMLMediaElement) routeWithoutUnhandledRejection(element);
    return element;
  };

  const srcObjectDescriptor = Object.getOwnPropertyDescriptor(
    HTMLMediaElement.prototype,
    "srcObject",
  );
  if (srcObjectDescriptor?.get && srcObjectDescriptor?.set && srcObjectDescriptor.configurable) {
    Object.defineProperty(HTMLMediaElement.prototype, "srcObject", {
      ...srcObjectDescriptor,
      get: srcObjectDescriptor.get,
      set(value) {
        srcObjectDescriptor.set.call(this, value);
        routeWithoutUnhandledRejection(this);
      },
    });
  }

  const nativePlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function routedPlay(...playArguments) {
    return routeMediaElement(this).then(() => nativePlay.apply(this, playArguments));
  };

  const routeAddedMedia = (node) => {
    if (node instanceof HTMLMediaElement) routeWithoutUnhandledRejection(node);
    if (node instanceof Element) {
      for (const element of node.querySelectorAll("audio, video")) {
        routeWithoutUnhandledRejection(element);
      }
    }
  };
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) routeAddedMedia(node);
    }
  }).observe(document, { childList: true, subtree: true });
}, {
  inputDeviceId: inputDevice.deviceId,
  inputLabel: inputDevice.label,
  sinkId: outputDevice.deviceId,
  outputLabel: outputDevice.label,
});

if (temporaryProbe) {
  await routingProbe.close();
}

if (options.replaceTab) {
  await Promise.all(existingChatgptPages.map((candidate) => candidate.close()));
}

let page = options.replaceTab ? null : existingChatgptPages[0];

if (!page) {
  page = await context.newPage();
}

await page.goto(options.projectUrl, { waitUntil: "domcontentloaded" });
await page.bringToFront();
page.setDefaultTimeout(10_000);

const loginButton = page.getByRole("button", { name: /^(ログイン|Log in)$/i });
const loginHeading = page.getByText(/ログインまたは新規登録|Log in or sign up/i);
const profileButton = page.getByRole("button", {
  name: /プロファイルメニューを開く|profile menu/i,
});

if (!page.url().includes("/auth/")) {
  await Promise.race([
    loginButton.first().waitFor({ state: "visible", timeout: 15_000 }),
    loginHeading.first().waitFor({ state: "visible", timeout: 15_000 }),
    profileButton.first().waitFor({ state: "visible", timeout: 15_000 }),
  ]).catch(() => {});
}

const loginRequired =
  page.url().includes("/auth/") ||
  ((await loginButton.count()) > 0 && (await loginButton.first().isVisible())) ||
  ((await loginHeading.count()) > 0 && (await loginHeading.first().isVisible()));

if (loginRequired) {
  process.stdout.write(
    `${JSON.stringify(
      {
        status: "login-required",
        url: page.url(),
        message: "Sign in to ChatGPT in this dedicated browser, then run the launcher again.",
      },
      null,
      2,
    )}\n`,
  );
  process.exit(10);
}

const newChat = page
  .getByRole("textbox", {
    name: /内の新しいチャット|new chat in|ChatGPT とチャットする/i,
  })
  .first();
await newChat.waitFor({ state: "visible", timeout: 20_000 });

const startVoice = page.getByRole("button", {
  name: /^(音声を開始する|Start voice)$/i,
});
await startVoice.waitFor({ state: "visible", timeout: 10_000 });
let voiceStartAttempted = false;
let endVoice;
let microphoneOn;
let audioInput;
let audioOutput;
let internalAudioOutput;
try {
  voiceStartAttempted = true;
  await startVoice.click();

  endVoice = page.getByRole("button", {
    name: /^(音声を終了する|End voice)$/i,
  });
  await endVoice.waitFor({ state: "visible", timeout: 30_000 });

  microphoneOn = page.getByRole("button", {
    name: /^(マイクをオフにする|Turn off microphone)$/i,
  });

  await page.waitForTimeout(750);
  await page.waitForFunction(() => {
    const state = globalThis.__meetingCopilotAudioRouting;
    return state?.inputRequests > 0 && state.inputTracks.length > 0;
  }, undefined, { timeout: 5_000 });
  audioInput = await page.evaluate(() => {
    const state = globalThis.__meetingCopilotAudioRouting;
    if (!state) return { routed: false, error: "Audio routing was not initialized." };
    const matchingTracks = state.inputTracks.filter(
      (track) => track.deviceId === state.inputDeviceId,
    );
    return {
      routed: state.inputRequests > 0 && matchingTracks.length > 0,
      device: state.inputLabel,
      inputRequests: state.inputRequests,
      tracks: state.inputTracks,
    };
  });
  if (!audioInput.routed) {
    throw new Error(
      `ChatGPT Voice input could not be routed to ${inputDevice.label}.`,
    );
  }

  audioOutput = await page.evaluate(async () => {
    const state = globalThis.__meetingCopilotAudioRouting;
    if (!state) return { routed: false, error: "Audio routing was not initialized." };
    const mediaElements = [...state.mediaElements];
    const activeContexts = [...state.contexts].filter(
      (audioContext) => audioContext.state !== "closed",
    );
    const results = await Promise.allSettled([
      ...activeContexts.map((audioContext) => audioContext.setSinkId(state.sinkId)),
      ...mediaElements.map((element) => element.setSinkId(state.sinkId)),
    ]);
    const failures = results
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason?.message || String(result.reason));
    state.failures = failures;
    return {
      routed: failures.length === 0,
      device: state.label,
      audioContexts: activeContexts.length,
      closedAudioContexts: state.contexts.size - activeContexts.length,
      mediaElements: mediaElements.length,
      detachedMediaElements: mediaElements.filter((element) => !element.isConnected).length,
      routeAttempts: state.routeAttempts,
      failures,
    };
  });

  if (!audioOutput.routed) {
    throw new Error(
      `ChatGPT Voice output could not be routed to ${outputDevice.label}: ${audioOutput.failures?.join(" / ") || audioOutput.error}`,
    );
  }

  internalAudioOutput = await inspectChromeAudioOutputs(
    browser,
    context,
    outputDevice.label,
    options.outputDeviceUID,
    outputDevice.deviceId,
  );
  await page.evaluate((validation) => {
    const state = globalThis.__meetingCopilotAudioRouting;
    if (state) state.internalAudioOutput = validation;
  }, internalAudioOutput);
  if (internalAudioOutput.unexpectedOutputs.length > 0) {
    const devices = internalAudioOutput.unexpectedOutputs
      .map((output) => output.deviceId || "unknown device")
      .join(", ");
    throw new Error(
      `Chrome detected active ChatGPT audio outside ${outputDevice.label}: ${devices}`,
    );
  }
} catch (error) {
  if (voiceStartAttempted && !page.isClosed()) {
    const stopButton = page.getByRole("button", {
      name: /^(音声を終了する|End voice)$/i,
    });
    if ((await stopButton.count().catch(() => 0)) > 0) {
      await stopButton.first().click({ force: true, timeout: 5_000 }).catch(() => {});
      await stopButton.first().waitFor({ state: "hidden", timeout: 5_000 }).catch(() => {});
    }
    await page.close({ runBeforeUnload: false }).catch(() => {});
  }
  throw error;
}

const result = {
  status: "voice-active",
  url: page.url(),
  projectUrl: options.projectUrl,
  newChatCreated: true,
  replacedTab: options.replaceTab,
  microphoneOn: await microphoneOn.isVisible(),
  audioInput,
  audioOutput,
  internalAudioOutput,
  title: await page.title(),
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exit(0);
