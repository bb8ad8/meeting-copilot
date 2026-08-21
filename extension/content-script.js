(() => {
  const HOST_ID = "meeting-copilot-controls-root";
  const MEETING_PATH = /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}(?:[/?#]|$)/i;

  if (!MEETING_PATH.test(window.location.pathname) || document.getElementById(HOST_ID)) {
    return;
  }

  const iconPaths = {
    activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    chevronUp: '<path d="m18 15-6-6-6 6"/>',
    mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>',
    micOff: '<line x1="2" x2="22" y1="2" y2="22"/><path d="M18.89 13.23A7 7 0 0 0 19 12v-2"/><path d="M5 10v2a7 7 0 0 0 12 4.9"/><path d="M8.7 8.7V12a3.3 3.3 0 0 0 5.7 2.3"/><path d="M9 5a3 3 0 0 1 5.68-1.36"/><line x1="12" x2="12" y1="19" y2="22"/>',
    refresh: '<path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5"/><path d="M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5"/>',
    rotate: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    square: '<rect width="14" height="14" x="5" y="5" rx="1"/>',
    terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>',
    volume: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>',
  };

  function icon(name, size = 16) {
    return `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconPaths[name]}</svg>`;
  }

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.position = "fixed";
  host.style.zIndex = "2147483647";
  host.style.right = "16px";
  host.style.bottom = "88px";
  document.documentElement.append(host);

  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; color-scheme: light dark; }
      * { box-sizing: border-box; letter-spacing: 0; }
      button { font: inherit; }
      .panel {
        width: 304px;
        color: #202124;
        background: #fff;
        border: 1px solid #dadce0;
        border-radius: 8px;
        box-shadow: 0 4px 18px rgba(32, 33, 36, .22);
        font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        overflow: hidden;
      }
      .panel.collapsed { width: auto; min-width: 156px; }
      .header {
        height: 44px;
        display: flex;
        align-items: center;
        gap: 9px;
        padding: 0 8px 0 12px;
        background: #f8f9fa;
        border-bottom: 1px solid #e8eaed;
        cursor: grab;
        user-select: none;
      }
      .collapsed .header { border-bottom: 0; }
      .brand { flex: 1; display: flex; align-items: center; gap: 8px; min-width: 0; }
      .brand-icon { color: #1a73e8; display: grid; place-items: center; }
      .brand-text { font-weight: 600; white-space: nowrap; }
      .status-dot { width: 8px; height: 8px; border-radius: 50%; background: #f9ab00; flex: 0 0 auto; }
      .status-dot.ready { background: #188038; }
      .status-dot.error { background: #d93025; }
      .icon-button {
        width: 30px; height: 30px; border: 0; border-radius: 50%;
        display: grid; place-items: center; color: #3c4043; background: transparent;
        cursor: pointer;
      }
      .icon-button:hover { background: #e8eaed; }
      .icon-button.danger { color: #d93025; }
      .body { padding: 10px 12px 12px; }
      .collapsed .body { display: none; }
      .section-title { margin: 2px 0 6px; color: #5f6368; font-size: 11px; font-weight: 600; text-transform: uppercase; }
      .status-list { margin: 0 0 10px; }
      .status-row { min-height: 28px; display: grid; grid-template-columns: 20px minmax(0, 1fr) auto; align-items: center; gap: 7px; }
      .status-row svg { color: #5f6368; }
      .status-value { color: #5f6368; max-width: 142px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .status-value.good { color: #137333; }
      .status-value.bad { color: #c5221f; }
      .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .command {
        min-height: 36px; border: 1px solid #dadce0; border-radius: 6px;
        display: inline-flex; align-items: center; justify-content: center; gap: 7px;
        padding: 6px 9px; color: #1f1f1f; background: #fff; cursor: pointer;
        white-space: nowrap;
      }
      .command:hover { background: #f8f9fa; }
      .command.primary { color: #fff; border-color: #1a73e8; background: #1a73e8; }
      .command.primary:hover { background: #1765cc; }
      .command:disabled { opacity: .55; cursor: default; }
      .footer { margin-top: 9px; display: flex; align-items: center; gap: 6px; min-height: 22px; }
      .message { flex: 1; color: #5f6368; font-size: 11px; overflow-wrap: anywhere; }
      .message.error { color: #c5221f; }
      .diagnostics {
        display: none; margin: 8px 0 0; max-height: 120px; overflow: auto;
        padding: 8px; border-radius: 4px; color: #3c4043; background: #f1f3f4;
        font: 10px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap;
      }
      .diagnostics.visible { display: block; }
      @media (prefers-color-scheme: dark) {
        .panel { color: #e8eaed; background: #202124; border-color: #5f6368; }
        .header { background: #292a2d; border-color: #3c4043; }
        .icon-button { color: #e8eaed; }
        .icon-button:hover, .command:hover { background: #3c4043; }
        .command { color: #e8eaed; background: #292a2d; border-color: #5f6368; }
        .diagnostics { color: #e8eaed; background: #292a2d; }
      }
    </style>
    <section class="panel" aria-label="Meetron controls">
      <header class="header">
        <div class="brand">
          <span class="brand-icon">${icon("activity", 17)}</span>
          <span class="status-dot" data-status-dot></span>
          <span class="brand-text">Meetron</span>
        </div>
        <button class="icon-button" data-mic-quick type="button" title="GPT参加者のマイクを切り替える" aria-label="GPT参加者のマイクを切り替える">${icon("micOff")}</button>
        <button class="icon-button" data-expand type="button" title="パネルを折りたたむ" aria-label="パネルを折りたたむ">${icon("chevronDown")}</button>
      </header>
      <div class="body">
        <div class="section-title">接続状況</div>
        <div class="status-list">
          <div class="status-row"><span>${icon("activity")}</span><span>GPT参加者</span><span class="status-value" data-meet-status>確認中</span></div>
          <div class="status-row"><span>${icon("volume")}</span><span>ChatGPT Voice</span><span class="status-value" data-voice-status>確認中</span></div>
          <div class="status-row"><span>${icon("terminal")}</span><span>音声経路</span><span class="status-value" data-audio-status>確認中</span></div>
        </div>
        <div class="section-title">操作</div>
        <div class="actions">
          <button class="command primary" data-mic type="button">${icon("micOff")}<span>ミュート解除</span></button>
          <button class="command" data-restart type="button">${icon("rotate")}<span>Voice再起動</span></button>
          <button class="command" data-stop type="button">${icon("square")}<span>セッション終了</span></button>
          <button class="command" data-diagnostics type="button">${icon("terminal")}<span>診断</span></button>
        </div>
        <div class="footer">
          <span class="message" data-message>ローカルホストへ接続しています</span>
          <button class="icon-button" data-refresh type="button" title="状態を更新" aria-label="状態を更新">${icon("refresh")}</button>
        </div>
        <pre class="diagnostics" data-diagnostics-output></pre>
      </div>
    </section>
  `;

  const elements = {
    panel: shadow.querySelector(".panel"),
    header: shadow.querySelector(".header"),
    dot: shadow.querySelector("[data-status-dot]"),
    expand: shadow.querySelector("[data-expand]"),
    micQuick: shadow.querySelector("[data-mic-quick]"),
    mic: shadow.querySelector("[data-mic]"),
    restart: shadow.querySelector("[data-restart]"),
    stop: shadow.querySelector("[data-stop]"),
    diagnostics: shadow.querySelector("[data-diagnostics]"),
    diagnosticsOutput: shadow.querySelector("[data-diagnostics-output]"),
    refresh: shadow.querySelector("[data-refresh]"),
    message: shadow.querySelector("[data-message]"),
    meetStatus: shadow.querySelector("[data-meet-status]"),
    voiceStatus: shadow.querySelector("[data-voice-status]"),
    audioStatus: shadow.querySelector("[data-audio-status]"),
  };

  let hostStatus = null;
  let busy = false;
  let microphoneOverride = null;
  let participantMeetingKey = "";

  function meetingKey(value) {
    try {
      const url = new URL(value);
      return `${url.origin}${url.pathname.replace(/\/$/, "")}`;
    } catch {
      return "";
    }
  }

  function getParticipantState() {
    const live = hostStatus?.dedicatedMeet || {};
    const launch = hostStatus?.meetingLaunch || {};
    const tracked = hostStatus?.meetMicrophone || {};
    const currentMeetingKey = meetingKey(live.url || launch.meetingUrl);
    if (currentMeetingKey !== participantMeetingKey) {
      participantMeetingKey = currentMeetingKey;
      microphoneOverride = null;
    }
    const trackedMatchesLaunch =
      meetingKey(tracked.meetingUrl) &&
      meetingKey(tracked.meetingUrl) === meetingKey(launch.meetingUrl);

    let connection = live.connection || "not-running";
    if (connection === "not-running") {
      if (["starting", "running"].includes(launch.status)) {
        connection = "starting";
      } else if (launch.status === "failed") {
        connection = "failed";
      }
    }

    const detectedMicrophone = ["muted", "unmuted"].includes(live.microphone)
      ? live.microphone
      : "unavailable";
    if (detectedMicrophone !== "unavailable") {
      microphoneOverride = detectedMicrophone;
    } else if (trackedMatchesLaunch && ["muted", "unmuted"].includes(tracked.state)) {
      microphoneOverride = tracked.state;
    }

    return {
      connection,
      microphone:
        detectedMicrophone === "unavailable"
          ? microphoneOverride || "unavailable"
          : detectedMicrophone,
    };
  }

  function setValue(element, text, tone = "") {
    element.textContent = text;
    element.className = `status-value${tone ? ` ${tone}` : ""}`;
  }

  function setMessage(text, error = false) {
    elements.message.textContent = text;
    elements.message.className = `message${error ? " error" : ""}`;
  }

  function render() {
    const meet = getParticipantState();
    const joinedLabel =
      meet.microphone === "muted"
        ? ["参加中・ミュート", "good"]
        : meet.microphone === "unmuted"
          ? ["参加中・送話中", "good"]
          : ["参加中・状態不明", ""];
    const meetLabels = {
      joined: joinedLabel,
      waiting: ["承認待ち", ""],
      rejected: ["参加拒否", "bad"],
      prejoin: ["参加前", ""],
      starting: ["起動中", ""],
      failed: ["起動失敗", "bad"],
      stopped: ["終了済み", ""],
      "not-running": ["未起動", ""],
    };
    setValue(elements.meetStatus, ...(meetLabels[meet.connection] || ["状態不明", ""]));

    const muted = meet.microphone === "muted";
    const microphoneKnown = ["muted", "unmuted"].includes(meet.microphone);
    const micLabel = muted ? "ミュート解除" : "ミュート";
    elements.mic.innerHTML = `${icon(muted ? "micOff" : "mic")}<span>${micLabel}</span>`;
    elements.mic.classList.toggle("primary", muted);
    const nativeToggleAvailable =
      meet.connection === "joined" && microphoneKnown && Boolean(hostStatus);
    elements.mic.disabled = !nativeToggleAvailable || busy;
    elements.micQuick.innerHTML = icon(muted ? "micOff" : "mic");
    elements.micQuick.classList.toggle("danger", meet.microphone === "unmuted");
    elements.micQuick.disabled = !nativeToggleAvailable || busy;
    elements.micQuick.title = muted
      ? "GPT参加者のミュートを解除"
      : "GPT参加者をミュート";
    elements.micQuick.setAttribute("aria-label", elements.micQuick.title);

    if (!hostStatus) {
      setValue(elements.voiceStatus, "未接続", "bad");
      setValue(elements.audioStatus, "未確認", "bad");
      elements.dot.className = "status-dot error";
      return;
    }

    const voice = hostStatus.chatgpt || {};
    const voiceRoutingReady = voice.audioOutput?.routed === true;
    const voiceHealthy = voice.voiceActive && voiceRoutingReady;
    setValue(
      elements.voiceStatus,
      voice.voiceActive
        ? voiceRoutingReady
          ? "起動中"
          : "出力異常"
        : voice.browserConnected
          ? "停止中"
          : "未接続",
      voiceHealthy ? "good" : "bad",
    );
    const audio = hostStatus.audio || {};
    const audioReady = audio.ready && (!voice.voiceActive || voiceRoutingReady);
    setValue(elements.audioStatus, audioReady ? "正常" : "要確認", audioReady ? "good" : "bad");

    const ready = meet.connection === "joined" && voiceHealthy && audioReady;
    elements.dot.className = `status-dot ${ready ? "ready" : ""}`;
  }

  async function nativeRequest(type, payload = {}) {
    if (typeof globalThis.chrome?.runtime?.sendMessage !== "function") {
      throw new Error("Meetron拡張機能を再読み込みしてからページを更新してください");
    }
    const response = await globalThis.chrome.runtime.sendMessage({
      channel: "meeting-copilot",
      type: "native-request",
      request: { type, payload },
    });
    if (!response?.ok) {
      throw new Error(response?.error || "Native Host request failed.");
    }
    return response.data;
  }

  async function refreshStatus({ quiet = false } = {}) {
    if (!quiet) {
      setMessage("状態を更新しています");
    }
    try {
      hostStatus = await nativeRequest("status.get");
      setMessage("接続済み");
    } catch (error) {
      hostStatus = null;
      setMessage(error.message, true);
    }
    render();
  }

  async function toggleMicrophone() {
    const meet = getParticipantState();
    busy = true;
    render();
    try {
      if (!hostStatus || meet.connection !== "joined") {
        throw new Error("GPT参加者はMeetに参加していません");
      }
      const result = await nativeRequest("meet.mic.toggle");
      if (result?.verified !== true) {
        throw new Error("Meetのマイク状態を確認できませんでした");
      }
      if (["muted", "unmuted"].includes(result.after)) {
        microphoneOverride = result.after;
        hostStatus.meetMicrophone = {
          meetingUrl: result.url || hostStatus.meetingLaunch?.meetingUrl,
          state: result.after,
        };
        hostStatus.dedicatedMeet = {
          ...(hostStatus.dedicatedMeet || {}),
          connection: "joined",
          microphone: result.after,
          url: result.url || hostStatus.dedicatedMeet?.url,
        };
        setMessage(
          result.after === "muted"
            ? "GPT参加者をミュートしました"
            : "GPT参加者のミュートを解除しました",
        );
      }
    } catch (error) {
      setMessage(error.message, true);
    } finally {
      busy = false;
      render();
    }
  }

  async function runCommand(type, pendingMessage, successMessage) {
    busy = true;
    setMessage(pendingMessage);
    elements.restart.disabled = true;
    elements.stop.disabled = true;
    try {
      const result = await nativeRequest(type);
      if (result?.warnings?.length) {
        setMessage(`${successMessage}: ${result.warnings.join(" / ")}`, true);
      } else {
        setMessage(successMessage);
      }
      await refreshStatus({ quiet: true });
    } catch (error) {
      setMessage(error.message, true);
    } finally {
      busy = false;
      elements.restart.disabled = false;
      elements.stop.disabled = false;
      render();
    }
  }

  function onTrustedClick(element, handler) {
    element.addEventListener("click", (event) => {
      if (!event.isTrusted) {
        return;
      }
      handler(event);
    });
  }

  onTrustedClick(elements.mic, toggleMicrophone);
  onTrustedClick(elements.micQuick, toggleMicrophone);
  onTrustedClick(elements.refresh, () => refreshStatus());
  onTrustedClick(elements.restart, () =>
    runCommand("voice.restart", "Voiceを再起動しています", "Voiceを再起動しました"),
  );
  onTrustedClick(elements.stop, () =>
    runCommand("session.stop", "セッションを終了しています", "セッションを終了しました"),
  );
  onTrustedClick(elements.diagnostics, async () => {
    busy = true;
    setMessage("環境を診断しています");
    try {
      const result = await nativeRequest("diagnostics.run");
      elements.diagnosticsOutput.textContent = result.output;
      elements.diagnosticsOutput.classList.add("visible");
      setMessage(result.ok ? "診断が完了しました" : "診断で問題が見つかりました", !result.ok);
    } catch (error) {
      setMessage(error.message, true);
    } finally {
      busy = false;
    }
  });

  function setCollapsed(collapsed) {
    elements.panel.classList.toggle("collapsed", collapsed);
    elements.expand.innerHTML = icon(collapsed ? "chevronUp" : "chevronDown");
    elements.expand.title = collapsed ? "パネルを開く" : "パネルを折りたたむ";
    elements.expand.setAttribute("aria-label", elements.expand.title);
  }

  onTrustedClick(elements.expand, async () => {
    const collapsed = !elements.panel.classList.contains("collapsed");
    setCollapsed(collapsed);
    await chrome.storage.local.set({ controlsCollapsed: collapsed });
  });

  let drag = null;
  elements.header.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button")) {
      return;
    }
    const rect = host.getBoundingClientRect();
    drag = { offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
    elements.header.setPointerCapture(event.pointerId);
  });
  elements.header.addEventListener("pointermove", (event) => {
    if (!drag) {
      return;
    }
    const maxX = Math.max(8, window.innerWidth - host.offsetWidth - 8);
    const maxY = Math.max(8, window.innerHeight - host.offsetHeight - 8);
    const left = Math.min(maxX, Math.max(8, event.clientX - drag.offsetX));
    const top = Math.min(maxY, Math.max(8, event.clientY - drag.offsetY));
    host.style.left = `${left}px`;
    host.style.top = `${top}px`;
    host.style.right = "auto";
    host.style.bottom = "auto";
  });
  elements.header.addEventListener("pointerup", async (event) => {
    if (!drag) {
      return;
    }
    drag = null;
    elements.header.releasePointerCapture(event.pointerId);
    await chrome.storage.local.set({
      controlsPosition: { left: host.style.left, top: host.style.top },
    });
  });

  chrome.storage.local.get(["controlsCollapsed", "controlsPosition"]).then((stored) => {
    if (stored.controlsCollapsed) {
      setCollapsed(true);
    }
    if (stored.controlsPosition?.left && stored.controlsPosition?.top) {
      host.style.left = stored.controlsPosition.left;
      host.style.top = stored.controlsPosition.top;
      host.style.right = "auto";
      host.style.bottom = "auto";
    }
  });

  chrome.storage.onChanged?.addListener((changes, areaName) => {
    if (areaName === "local" && changes.controlsCollapsed) {
      setCollapsed(changes.controlsCollapsed.newValue === true);
    }
  });

  render();
  refreshStatus();
  window.setInterval(() => refreshStatus({ quiet: true }), 10_000);
})();
