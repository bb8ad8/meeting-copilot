const launchView = document.querySelector("[data-launch-view]");
const setupView = document.querySelector("[data-setup-view]");
const startForm = document.querySelector("[data-start-form]");
const meetingInput = document.querySelector("#meeting-url");
const startButton = document.querySelector("[data-start]");
const message = document.querySelector("[data-message]");
const hostStatus = document.querySelector("[data-host-status]");
const statusDot = document.querySelector("[data-status-dot]");
const openSetupButton = document.querySelector("[data-open-setup]");
const launch = document.querySelector("[data-launch]");
const launchStatus = document.querySelector("[data-launch-status]");
const setupMessage = document.querySelector("[data-setup-message]");
const projectForm = document.querySelector("[data-project-form]");
const projectInput = document.querySelector("#project-url");
const previousButton = document.querySelector("[data-previous-step]");
const nextButton = document.querySelector("[data-next-step]");
const setupNav = document.querySelector(".setup-nav");
const bootstrapCommand = document.querySelector("[data-bootstrap-command]");

const extensionRuntime = globalThis.chrome?.runtime;
const extensionStorage = globalThis.chrome?.storage;
const extensionEnvironmentReady =
  typeof extensionRuntime?.sendMessage === "function" &&
  typeof extensionStorage?.local?.get === "function";
const extensionId = extensionRuntime?.id || "jlikakgdldiihhflkobhnpfegjlcakdd";
const automaticBootstrapCommand =
  `EXTENSION_DIR="$(for p in "$HOME/Library/Application Support/Google/Chrome"/*/"Secure Preferences"; do /usr/bin/plutil -extract extensions.settings.${extensionId}.path raw "$p" 2>/dev/null && break; done)" && REPO_DIR="$(dirname "$EXTENSION_DIR")" && cd "$REPO_DIR" && npm install && ./scripts/open-control-ui-setup.sh`;
bootstrapCommand.textContent = automaticBootstrapCommand;

let setupStatus = null;
let setupStep = 0;
let forceSetup = false;
let setupBusy = false;

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

function normalizeMeetingUrl(value) {
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }

  if (
    url.protocol !== "https:" ||
    url.hostname !== "meet.google.com" ||
    url.port ||
    url.username ||
    url.password ||
    !/^\/[a-z]{3}-[a-z]{4}-[a-z]{3}\/?$/i.test(url.pathname)
  ) {
    return null;
  }

  url.hash = "";
  return url.toString();
}

async function nativeRequest(type, payload = {}) {
  if (typeof extensionRuntime?.sendMessage !== "function") {
    throw new Error(
      "MeetronをChromeの拡張機能メニューから開き直してください。直らない場合はchrome://extensionsでMeetronを再読み込みしてください。",
    );
  }
  const response = await extensionRuntime.sendMessage({
    channel: "meeting-copilot",
    type: "native-request",
    request: { type, payload },
  });
  if (!response?.ok) {
    throw new Error(response?.error || "Native Host request failed.");
  }
  return response.data;
}

function setMessage(text, tone = "") {
  message.textContent = text;
  message.className = `message${tone ? ` ${tone}` : ""}`;
}

function setSetupMessage(text = "", tone = "") {
  setupMessage.textContent = text;
  setupMessage.className = `setup-message${tone ? ` ${tone}` : ""}`;
}

function renderLaunch(state) {
  if (!state?.status) {
    launch.hidden = true;
    return;
  }
  const labels = {
    starting: "起動準備中",
    running: "起動処理中",
    completed: "起動完了",
    failed: "起動失敗",
    stopped: "終了済み",
  };
  launch.hidden = false;
  launchStatus.textContent = labels[state.status] || state.status;
}

async function waitForLaunchCompletion(timeout = 150_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const status = await nativeRequest("status.get");
    const state = status.meetingLaunch;
    renderLaunch(state);
    if (state?.status === "completed") return state;
    if (state?.status === "failed") {
      throw new Error(state.error || "起動処理に失敗しました");
    }
    await new Promise((resolveDelay) => window.setTimeout(resolveDelay, 1_000));
  }
  throw new Error("起動処理が続いています。しばらくしてから状態を再確認してください");
}

function setCheck(indicator, label, ready, readyText = "完了", missingText = "未完了") {
  indicator.className = `check-indicator ${ready ? "good" : "bad"}`;
  label.textContent = ready ? readyText : missingText;
}

function firstIncompleteStep(status) {
  if (!status) return 0;
  if (!status.audio?.devicesReady) return 1;
  if (
    !status.dedicatedChrome?.extensionInstalled ||
    !status.confirmations?.googleLoginConfirmed
  ) return 2;
  if (!status.project?.configured || !status.confirmations?.chatgptLoginConfirmed) return 3;
  return 4;
}

function canAdvance(step) {
  if (step === 0) return Boolean(setupStatus?.hostConnected);
  if (step === 1) return Boolean(setupStatus?.audio?.devicesReady);
  if (step === 2) {
    return Boolean(
      setupStatus?.dedicatedChrome?.extensionInstalled &&
      setupStatus?.confirmations?.googleLoginConfirmed,
    );
  }
  if (step === 3) {
    return Boolean(
      setupStatus?.project?.configured &&
      setupStatus?.confirmations?.chatgptLoginConfirmed,
    );
  }
  return true;
}

function showLaunchView() {
  launchView.hidden = false;
  setupView.hidden = true;
  openSetupButton.hidden = false;
}

function showSetupView() {
  launchView.hidden = true;
  setupView.hidden = false;
  openSetupButton.hidden = true;
}

function renderSetup() {
  showSetupView();
  document.querySelectorAll("[data-step]").forEach((step) => {
    step.hidden = Number(step.dataset.step) !== setupStep;
  });

  document.querySelector("[data-step-count]").textContent =
    setupStep === 4 ? "完了" : `${setupStep + 1} / 4`;
  document.querySelector("[data-progress]").style.width =
    `${setupStep === 4 ? 100 : ((setupStep + 1) / 4) * 100}%`;
  previousButton.disabled = setupStep === 0 || setupBusy;
  nextButton.disabled = !canAdvance(setupStep) || setupBusy;
  setupNav.hidden = setupStep === 4;

  const connected = Boolean(setupStatus?.hostConnected);
  setCheck(
    document.querySelector("[data-host-check]"),
    document.querySelector("[data-host-check-label]"),
    connected,
    "接続済み",
    "未接続",
  );
  const bootstrap = document.querySelector("[data-bootstrap]");
  bootstrap.hidden = connected;
  if (connected && setupStatus.repoRoot) {
    bootstrapCommand.textContent =
      `cd ${shellQuote(setupStatus.repoRoot)} && npm install && ./scripts/open-control-ui-setup.sh`;
  } else {
    bootstrapCommand.textContent = automaticBootstrapCommand;
  }

  const requiredDevices = setupStatus?.audio?.requiredDevices || {};
  const requiredDeviceNames = setupStatus?.audio?.requiredDeviceNames || Object.keys(requiredDevices);
  for (const [index, name] of requiredDeviceNames.slice(0, 2).entries()) {
    document.querySelector(`[data-device-name="${index}"]`).textContent = name;
    setCheck(
      document.querySelector(`[data-device-index="${index}"]`),
      document.querySelector(`[data-device-label-index="${index}"]`),
      requiredDevices[name] === true,
      "検出済み",
      "未検出",
    );
  }
  setCheck(
    document.querySelector("[data-route-check]"),
    document.querySelector("[data-route-label]"),
    setupStatus?.audio?.ready === true,
    "設定済み",
    "未設定",
  );
  document.querySelector("[data-configure-audio]").disabled =
    !setupStatus?.audio?.devicesReady || setupBusy;

  if (!projectInput.dataset.edited && setupStatus?.project?.url) {
    projectInput.value = setupStatus.project.url;
  }
  document.querySelector("[data-confirm-chatgpt]").checked =
    setupStatus?.confirmations?.chatgptLoginConfirmed === true;
  document.querySelector("[data-open-chatgpt]").disabled =
    !setupStatus?.project?.configured || setupBusy;

  setCheck(
    document.querySelector("[data-extension-check]"),
    document.querySelector("[data-extension-label]"),
    setupStatus?.dedicatedChrome?.extensionInstalled === true,
    "読込済み",
    "未読込",
  );
  document.querySelector("[data-confirm-google]").checked =
    setupStatus?.confirmations?.googleLoginConfirmed === true;
  if (setupStatus?.repoRoot) {
    document.querySelector("[data-extension-path]").textContent =
      `${setupStatus.repoRoot}/extension`;
  }
}

async function refresh({ preserveStep = false } = {}) {
  try {
    setupStatus = await nativeRequest("setup.status");
    hostStatus.textContent = "ローカルホスト接続済み";
    statusDot.className = "status-dot ready";
    if (!preserveStep) {
      setupStep = firstIncompleteStep(setupStatus);
    }

    if (setupStatus.complete && !forceSetup) {
      showLaunchView();
      const status = await nativeRequest("status.get");
      renderLaunch(status.meetingLaunch);
    } else {
      renderSetup();
    }
  } catch (error) {
    setupStatus = null;
    forceSetup = true;
    setupStep = 0;
    hostStatus.textContent = "ローカルホスト未接続";
    statusDot.className = "status-dot error";
    setSetupMessage(error.message || "表示されたコマンドを実行してから再確認してください", "error");
    renderSetup();
  }
}

async function runSetupAction(button, type, payload, pendingText, successText) {
  setupBusy = true;
  button.disabled = true;
  setSetupMessage(pendingText);
  try {
    await nativeRequest(type, payload);
    setSetupMessage(successText, "success");
    setupStatus = await nativeRequest("setup.status");
  } catch (error) {
    setSetupMessage(error.message, "error");
  } finally {
    setupBusy = false;
    button.disabled = false;
    renderSetup();
  }
}

startForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const meetingUrl = normalizeMeetingUrl(meetingInput.value);
  meetingInput.classList.toggle("invalid", !meetingUrl);
  if (!meetingUrl) {
    setMessage("有効なGoogle Meet URLを入力してください", "error");
    meetingInput.focus();
    return;
  }

  startButton.disabled = true;
  meetingInput.disabled = true;
  setMessage("起動処理を開始しています");
  try {
    const result = await nativeRequest("meeting.start", { meetingUrl });
    await chrome.storage.local.set({ lastMeetingUrl: meetingUrl });
    renderLaunch(result);
    setMessage("起動処理中です。専用Chromeを準備しています");
    await waitForLaunchCompletion();
    setMessage("開始しました。専用ChromeがMeetを開きました", "success");
  } catch (error) {
    setMessage(error.message, "error");
  } finally {
    startButton.disabled = false;
    meetingInput.disabled = false;
  }
});

meetingInput.addEventListener("input", () => meetingInput.classList.remove("invalid"));
projectInput.addEventListener("input", () => {
  projectInput.dataset.edited = "true";
  projectInput.classList.remove("invalid");
});

projectForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = document.querySelector("[data-save-project]");
  await runSetupAction(
    button,
    "setup.project.save",
    { projectUrl: projectInput.value },
    "Project URLを保存しています",
    "Project URLを保存しました",
  );
  if (!setupStatus?.project?.configured) {
    projectInput.classList.add("invalid");
  } else {
    delete projectInput.dataset.edited;
  }
});

document.querySelector("[data-configure-audio]").addEventListener("click", (event) =>
  runSetupAction(event.currentTarget, "setup.audio.configure", {}, "ChatGPT入力を設定しています", "ChatGPT入力を設定しました"),
);
document.querySelector("[data-open-chatgpt]").addEventListener("click", (event) =>
  runSetupAction(event.currentTarget, "setup.open.chatgpt", {}, "同じ専用ChromeでChatGPTを開いています", "専用ChromeでChatGPTを開きました"),
);
document.querySelector("[data-open-dedicated]").addEventListener("click", (event) =>
  runSetupAction(event.currentTarget, "setup.open.dedicated-chrome", {}, "専用Chromeを開いています", "専用Chromeを開きました"),
);

document.querySelector("[data-confirm-chatgpt]").addEventListener("change", async (event) => {
  await runSetupAction(
    event.currentTarget,
    "setup.confirm",
    { step: "chatgptLogin", complete: event.currentTarget.checked },
    "ログイン状態を保存しています",
    "ログイン状態を保存しました",
  );
});
document.querySelector("[data-confirm-google]").addEventListener("change", async (event) => {
  await runSetupAction(
    event.currentTarget,
    "setup.confirm",
    { step: "googleLogin", complete: event.currentTarget.checked },
    "ログイン状態を保存しています",
    "ログイン状態を保存しました",
  );
});

document.querySelectorAll("[data-refresh-setup]").forEach((button) => {
  button.addEventListener("click", async () => {
    setSetupMessage("状態を確認しています");
    await refresh({ preserveStep: true });
    if (setupStatus) setSetupMessage("状態を更新しました", "success");
  });
});

document.querySelector("[data-copy-bootstrap]").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(
      bootstrapCommand.textContent,
    );
    setSetupMessage("コマンドをコピーしました", "success");
  } catch {
    setSetupMessage("コマンドを選択してコピーしてください", "error");
  }
});

document.querySelector("[data-copy-extension]").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(
      document.querySelector("[data-extension-path]").textContent,
    );
    setSetupMessage("拡張機能パスをコピーしました", "success");
  } catch {
    setSetupMessage("パスを選択してコピーしてください", "error");
  }
});

previousButton.addEventListener("click", () => {
  setupStep = Math.max(0, setupStep - 1);
  setSetupMessage();
  renderSetup();
});

nextButton.addEventListener("click", () => {
  if (!canAdvance(setupStep)) return;
  setupStep = Math.min(4, setupStep + 1);
  setSetupMessage();
  renderSetup();
});

openSetupButton.addEventListener("click", () => {
  forceSetup = true;
  setupStep = 0;
  setSetupMessage();
  renderSetup();
});

document.querySelector("[data-finish-setup]").addEventListener("click", async () => {
  forceSetup = false;
  await refresh();
});

if (extensionEnvironmentReady) {
  extensionStorage.local.get(["lastMeetingUrl"]).then(({ lastMeetingUrl }) => {
    if (lastMeetingUrl) meetingInput.value = lastMeetingUrl;
  });
  refresh();
} else {
  forceSetup = true;
  setupStep = 0;
  hostStatus.textContent = "Chrome拡張機能として開かれていません";
  statusDot.className = "status-dot error";
  setSetupMessage(
    "MeetronをChromeの拡張機能メニューから開き直してください。直らない場合はchrome://extensionsでMeetronを再読み込みしてください。",
    "error",
  );
  renderSetup();
}
