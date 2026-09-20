(() => {
  const toast = document.getElementById("toast");
  const agentGrid = document.getElementById("agentGrid");
  const agentModal = document.getElementById("agentModal");
  const pairModal = document.getElementById("pairModal");
  const identityModal = document.getElementById("identityModal");
  const groupModal = document.getElementById("groupModal");
  const enrollmentForm = document.getElementById("agentEnrollmentForm");
  const groupMessageForm = document.getElementById("groupMessageForm");
  const groupAgentChoices = document.getElementById("groupAgentChoices");
  const identityDetails = document.getElementById("identityDetails");
  const pairCommand = document.getElementById("pairCommand");
  const copyPairCommandButton = document.getElementById("copyPairCommand");
  const eventList = document.getElementById("eventList");
  const liveTerminal = document.getElementById("liveTerminal");
  const telemetryGrid = document.getElementById("telemetryGrid");
  const installButton = document.getElementById("installButton");
  const messageComposer = document.getElementById("messageComposer");
  const messageInput = document.getElementById("messageInput");
  const attachButton = document.getElementById("attachButton");
  const fileInput = document.getElementById("fileInput");
  const attachmentTray = document.getElementById("attachmentTray");
  const eventSearch = document.getElementById("eventSearch");
  const severityFilter = document.getElementById("severityFilter");
  const channelFilter = document.getElementById("channelFilter");
  const pairStatus = document.getElementById("pairStatus");
  const pairCountdown = document.getElementById("pairCountdown");
  const advertisedAgentEndpoint = document.getElementById("advertisedAgentEndpoint");
  const routePolicySelect = document.getElementById("routePolicy");
  const routeStatus = document.getElementById("routeStatus");
  const cancelEnrollmentButton = document.getElementById("cancelEnrollmentButton");
  const guidedTrainingButton = document.getElementById("guidedTrainingButton");
  const trainingBackdrop = document.getElementById("trainingBackdrop");
  const trainingSpotlight = document.getElementById("trainingSpotlight");
  const trainingTitle = document.getElementById("trainingTitle");
  const trainingBody = document.getElementById("trainingBody");
  const trainingTip = document.getElementById("trainingTip");
  const trainingProgressBar = document.getElementById("trainingProgressBar");
  const trainingStepCount = document.getElementById("trainingStepCount");
  const approvalList = document.getElementById("approvalList");
  const fileOfferList = document.getElementById("fileOfferList");
  const voiceButton = document.getElementById("voiceButton");
  const voiceStatus = document.getElementById("voiceStatus");
  const speakRepliesToggle = document.getElementById("speakRepliesToggle");
  const streamPanel = document.getElementById("streamPanel");
  const telemetryPanel = document.getElementById("telemetryPanel");
  const buddySlot = document.getElementById("buddySlot");
  const buddyTile = document.getElementById("buddyTile");
  const buddyStage = document.getElementById("buddyStage");
  const buddySprite = document.getElementById("buddySprite");
  const buddyAgentLabel = document.getElementById("buddyAgentLabel");
  const buddyStateLabel = document.getElementById("buddyStateLabel");
  const buddyEnabledToggle = document.getElementById("buddyEnabledToggle");
  const buddySettingsButton = document.getElementById("buddySettingsButton");
  const buddyPopButton = document.getElementById("buddyPopButton");
  const buddyReturnButton = document.getElementById("buddyReturnButton");
  const buddyAnchorHome = document.getElementById("buddyAnchorHome");
  const buddyComposer = document.getElementById("buddyComposer");
  const buddyMessageInput = document.getElementById("buddyMessageInput");
  const buddySettingsModal = document.getElementById("buddySettingsModal");
  const buddyAgentSelect = document.getElementById("buddyAgentSelect");
  const buddyBackgroundColor = document.getElementById("buddyBackgroundColor");
  const buddySpriteGrid = document.getElementById("buddySpriteGrid");
  const buddySpeakingIndicator = document.getElementById("buddySpeakingIndicator");

  let installPrompt = null;
  let fleet = [];
  let selectedAgentId = null;
  let monitorSocket = null;
  let monitorReconnectTimer = null;
  let directPeer = null;
  let directChannel = null;
  let directPeerId = null;
  let directRouteState = "idle";
  let currentRoutePolicy = localStorage.getItem("mesh-route-policy") || "direct_preferred";
  let currentIceServers = [];
  const LOCAL_ROUTE_KEY = "mesh-local-routes-v1";
  const PAIRED_AGENTS_KEY = "mesh-paired-agents-v1";
  let pairedAgents = {};
  try { pairedAgents = JSON.parse(localStorage.getItem(PAIRED_AGENTS_KEY) || "{}"); } catch { pairedAgents = {}; }
  let localRoutes = {};
  let localSignalPollTimer = null;
  const pendingDirectMessages = new Map();
  let lastPairCommand = "";
  let activeEnrollment = null;
  let enrollmentPollTimer = null;
  let trainingStepIndex = 0;
  let pendingAttachment = null;
  let liveEvents = [];
  let recognition = null;
  let isListening = false;
  let speechSupported = false;
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  const BUDDY_SETTINGS_KEY = "mesh-buddy-settings-v1";
  const BUDDY_MAX_SPRITES = 10;
  const buddySpriteStates = [
    "Idle", "Idle 2", "Eyes open", "Eyes closed", "Mouth open",
    "Mouth closed", "Happy", "Thinking", "Listening", "Custom"
  ];
  const buddyDefaults = {
    enabled: false,
    floating: false,
    agentId: "",
    background: "#ffffff",
    sprites: {
      "Idle": "/static/buddy/default-progre/idle.png",
      "Idle 2": "/static/buddy/default-progre/mouth-closed.png",
      "Eyes open": "/static/buddy/default-progre/idle.png",
      "Eyes closed": "/static/buddy/default-progre/eyes-closed.png",
      "Mouth open": "/static/buddy/default-progre/mouth-open.png",
      "Mouth closed": "/static/buddy/default-progre/mouth-closed.png"
    }
  };
  let buddySettings = loadBuddySettings();
  let buddyAnimationTimer = null;
  let buddyBlinkTimer = null;
  let buddyTalkingTimer = null;
  let buddyState = "Idle";

  function loadBuddySettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(BUDDY_SETTINGS_KEY) || "{}");
      return {
        ...buddyDefaults,
        ...saved,
        sprites: {...buddyDefaults.sprites, ...(saved.sprites || {})}
      };
    } catch (_) {
      return {...buddyDefaults, sprites:{...buddyDefaults.sprites}};
    }
  }

  function saveBuddySettings() {
    try { localStorage.setItem(BUDDY_SETTINGS_KEY, JSON.stringify(buddySettings)); } catch (_) {}
  }

  function buddyAgent() {
    return fleet.find((agent) => agent.id === buddySettings.agentId) || null;
  }

  function buddySpriteFor(state) {
    return buddySettings.sprites[state] || buddySettings.sprites["Idle"] || buddyDefaults.sprites["Idle"];
  }

  function setBuddyState(state) {
    buddyState = state;
    if (buddySprite) buddySprite.src = buddySpriteFor(state);
    if (buddyStateLabel) buddyStateLabel.textContent = state;
  }

  function scheduleBuddyBlink() {
    clearTimeout(buddyBlinkTimer);
    if (!buddySettings.enabled) return;
    const delay = 3200 + Math.floor(Math.random() * 4200);
    buddyBlinkTimer = setTimeout(() => {
      const previous = buddyState;
      setBuddyState("Eyes closed");
      setTimeout(() => setBuddyState(previous === "Eyes closed" ? "Idle" : previous), 170);
      scheduleBuddyBlink();
    }, delay);
  }

  function scheduleBuddyIdle() {
    clearTimeout(buddyAnimationTimer);
    if (!buddySettings.enabled) return;
    const delay = 2200 + Math.floor(Math.random() * 2800);
    buddyAnimationTimer = setTimeout(() => {
      if (!buddyTile?.classList.contains("speaking")) {
        const next = buddySettings.sprites["Idle 2"] && Math.random() > .45 ? "Idle 2" : "Idle";
        setBuddyState(next);
        setTimeout(() => setBuddyState("Idle"), 420 + Math.floor(Math.random() * 450));
      }
      scheduleBuddyIdle();
    }, delay);
  }

  function startBuddyMotion() {
    clearTimeout(buddyAnimationTimer);
    clearTimeout(buddyBlinkTimer);
    if (!buddySettings.enabled) return;
    setBuddyState("Idle");
    scheduleBuddyIdle();
    scheduleBuddyBlink();
  }

  function stopBuddyMotion() {
    clearTimeout(buddyAnimationTimer);
    clearTimeout(buddyBlinkTimer);
    clearInterval(buddyTalkingTimer);
    buddyTile?.classList.remove("speaking");
    setBuddyState("Idle");
  }

  function updateBuddyUi() {
    if (!buddyTile) return;
    const agent = buddyAgent();
    buddyEnabledToggle.checked = Boolean(buddySettings.enabled);
    buddyTile.classList.toggle("is-off", !buddySettings.enabled);
    buddyTile.classList.toggle("is-floating", Boolean(buddySettings.floating));
    buddySlot?.classList.toggle("buddy-popped", Boolean(buddySettings.floating));
    if (buddyAnchorHome) buddyAnchorHome.hidden = !buddySettings.floating;
    buddyStage?.style.setProperty("--buddy-bg", buddySettings.background || "#ffffff");
    buddyAgentLabel.textContent = agent ? `${agent.name} · ${agent.transport === "connected" ? "connected" : "offline"}` : "Progre · not assigned";
    const usable = Boolean(buddySettings.enabled && agent && agent.transport === "connected");
    buddyMessageInput.disabled = !usable;
    buddyComposer?.querySelector("button")?.toggleAttribute("disabled", !usable);
    buddyMessageInput.placeholder = agent ? (usable ? `Message ${agent.name}…` : `${agent.name} is offline`) : "Assign an agent in settings…";
    buddyPopButton.textContent = buddySettings.floating ? "↙" : "↗";
    buddyPopButton.title = buddySettings.floating ? "Anchor buddy" : "Pop out buddy";
    if (!buddySettings.enabled) stopBuddyMotion();
    else startBuddyMotion();
  }

  function renderBuddyAgentOptions() {
    if (!buddyAgentSelect) return;
    buddyAgentSelect.innerHTML = '<option value="">Not assigned</option>' + fleet.map((agent) =>
      `<option value="${escapeHtml(agent.id)}">${escapeHtml(agent.name)}${agent.transport === "connected" ? " · connected" : " · offline"}</option>`
    ).join("");
    buddyAgentSelect.value = buddySettings.agentId || "";
  }

  function renderBuddySpriteSettings() {
    if (!buddySpriteGrid) return;
    buddySpriteGrid.innerHTML = buddySpriteStates.map((state, index) => `
      <div class="buddy-sprite-row">
        <label for="buddySprite${index}">${escapeHtml(state)}</label>
        <input id="buddySprite${index}" data-buddy-sprite="${escapeHtml(state)}" type="file" accept="image/png,image/jpeg,image/webp,image/gif" />
        <img class="buddy-sprite-preview" data-buddy-preview="${escapeHtml(state)}" src="${escapeHtml(buddySpriteFor(state))}" alt="${escapeHtml(state)} preview" />
      </div>`).join("");
    buddySpriteGrid.querySelectorAll("[data-buddy-sprite]").forEach((input) => {
      input.addEventListener("change", async () => {
        const file = input.files?.[0];
        if (!file) return;
        if (!/^image\/(png|jpeg|webp|gif)$/i.test(file.type || "")) { showToast("Use PNG, JPG, WebP, or GIF sprites."); input.value=""; return; }
        try {
          const dataUrl = await resizeBuddySprite(file);
          buddySettings.sprites[input.dataset.buddySprite] = dataUrl;
          const preview = buddySpriteGrid.querySelector(`[data-buddy-preview="${CSS.escape(input.dataset.buddySprite)}"]`);
          if (preview) preview.src = dataUrl;
        } catch (error) {
          showToast(`Sprite could not be loaded: ${error?.message || error}`);
        }
      });
    });
  }

  async function resizeBuddySprite(file) {
    const dataUrl = await fileToDataUrl(file);
    const image = await new Promise((resolve, reject) => {
      const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error("invalid image")); img.src = dataUrl;
    });
    const canvas = document.createElement("canvas"); canvas.width = 126; canvas.height = 126;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0,0,126,126);
    const scale = Math.min(126 / image.width, 126 / image.height);
    const w = Math.max(1, Math.round(image.width * scale));
    const h = Math.max(1, Math.round(image.height * scale));
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(image, Math.round((126-w)/2), Math.round((126-h)/2), w, h);
    return canvas.toDataURL("image/png");
  }

  function openBuddySettings() {
    renderBuddyAgentOptions();
    buddyBackgroundColor.value = buddySettings.background || "#ffffff";
    renderBuddySpriteSettings();
    buddySettingsModal.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeBuddySettings() {
    buddySettingsModal.hidden = true;
    document.body.style.overflow = "";
  }

  function setBuddyFloating(floating) {
    buddySettings.floating = Boolean(floating);
    saveBuddySettings();
    updateBuddyUi();
  }

  function animateBuddySpeaking(text) {
    if (!buddySettings.enabled || !buddyAgent()) return;
    buddyTile?.classList.add("speaking");
    clearInterval(buddyTalkingTimer);
    let open = false;
    setBuddyState("Mouth open");
    buddyTalkingTimer = setInterval(() => { open = !open; setBuddyState(open ? "Mouth open" : "Mouth closed"); }, 170);
    const duration = Math.max(900, Math.min(6500, String(text || "").length * 45));
    setTimeout(() => { clearInterval(buddyTalkingTimer); buddyTile?.classList.remove("speaking"); setBuddyState("Idle"); }, duration);
  }

  function configureVoice() {
    if (!SpeechRecognition) {
      voiceStatus.textContent = "Voice input unavailable in this browser";
      voiceStatus.className = "voice-status error";
      voiceButton.disabled = true;
      voiceButton.title = "Speech recognition unavailable";
      return;
    }

    speechSupported = true;
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";

    recognition.addEventListener("start", () => {
      isListening = true;
      voiceButton.classList.add("listening");
      voiceButton.textContent = "■";
      voiceStatus.textContent = "Listening… audio is not stored by Mesh";
      voiceStatus.className = "voice-status listening";
    });

    recognition.addEventListener("result", (event) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        transcript += event.results[i][0].transcript;
      }
      messageInput.value = transcript.trim();

      const last = event.results[event.results.length - 1];
      if (last?.isFinal) {
        voiceStatus.textContent = "Voice captured · review or Send";
        voiceStatus.className = "voice-status ready";
      }
    });

    recognition.addEventListener("error", (event) => {
      voiceStatus.textContent =
        event.error === "not-allowed"
          ? "Microphone permission was denied"
          : `Voice input error: ${event.error}`;
      voiceStatus.className = "voice-status error";
    });

    recognition.addEventListener("end", () => {
      isListening = false;
      voiceButton.classList.remove("listening");
      voiceButton.textContent = "🎙";
      if (!messageInput.value.trim() && !voiceStatus.classList.contains("error")) {
        voiceStatus.textContent = "Voice ready";
        voiceStatus.className = "voice-status ready";
      }
    });

    voiceStatus.textContent = "Voice ready · browser speech recognition";
    voiceStatus.className = "voice-status ready";
  }

  function toggleVoiceInput() {
    if (!speechSupported || !recognition) {
      showToast("Voice input is unavailable in this browser.");
      return;
    }

    if (!selectedAgentId) {
      showToast("Select a connected agent first.");
      return;
    }

    const agent = fleet.find((a) => a.id === selectedAgentId);
    if (!agent || agent.transport !== "connected") {
      showToast("The selected agent gateway is offline.");
      return;
    }

    try {
      if (isListening) {
        recognition.stop();
      } else {
        recognition.start();
      }
    } catch (error) {
      console.warn("Voice recognition state error:", error);
    }
  }

  function speakAgentReply(text) {
    const activeBuddy = buddyAgent();
    if (buddySettings.enabled && activeBuddy && activeBuddy.id === selectedAgentId) animateBuddySpeaking(text);
    if (!speakRepliesToggle?.checked || !("speechSynthesis" in window) || !text) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = navigator.language || "en-US";
    utterance.rate = 1.0;
    utterance.addEventListener("start", () => {
      if (buddySettings.enabled && activeBuddy && activeBuddy.id === selectedAgentId) buddyTile?.classList.add("speaking");
    });
    utterance.addEventListener("end", () => {
      if (buddySettings.enabled) { clearInterval(buddyTalkingTimer); buddyTile?.classList.remove("speaking"); setBuddyState("Idle"); }
    });
    window.speechSynthesis.speak(utterance);
  }

  function setMobileView(view) {
    document.querySelectorAll("[data-mobile-view]").forEach((button) => {
      button.classList.toggle("active", button.dataset.mobileView === view);
    });

    if (view === "telemetry") {
      streamPanel?.classList.add("mobile-hidden");
      telemetryPanel?.classList.remove("mobile-hidden");
    } else {
      telemetryPanel?.classList.add("mobile-hidden");
      streamPanel?.classList.remove("mobile-hidden");
    }
  }

  function formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  function fileExtension(name) {
    const value = String(name || "").toLowerCase();
    const dot = value.lastIndexOf(".");
    return dot >= 0 ? value.slice(dot) : "";
  }

  function isSensitiveFile(name) {
    return [".exe",".msi",".bat",".cmd",".ps1",".sh",".dll",".so",".dylib"].includes(fileExtension(name));
  }

  function renderAttachment() {
    if (!pendingAttachment) {
      attachmentTray.hidden = true;
      attachmentTray.innerHTML = "";
      return;
    }

    attachmentTray.hidden = false;
    attachmentTray.innerHTML = `
      <div class="attachment-chip">
        <div class="attachment-meta">
          <strong>${escapeHtml(pendingAttachment.file.name)}</strong>
          <span>${formatBytes(pendingAttachment.file.size)} · ${escapeHtml(pendingAttachment.file.type || "unknown type")}</span>
        </div>
        <div class="attachment-actions">
          <button class="ghost-btn compact" id="removeAttachment">Remove</button>
        </div>
      </div>
      <div class="transfer-progress"><i id="transferProgress"></i></div>
    `;

    document.getElementById("removeAttachment")?.addEventListener("click", () => {
      pendingAttachment = null;
      fileInput.value = "";
      renderAttachment();
    });
  }

  async function fileToDataUrl(file) {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(file);
    });
  }

  async function sendPendingAttachment() {
    if (!pendingAttachment || !selectedAgentId) return false;
    const agent = fleet.find((a) => a.id === selectedAgentId);
    if (!agent || agent.transport !== "connected") {
      showToast("Select a connected agent before sending a file.");
      return false;
    }

    const file = pendingAttachment.file;
    const progress = document.getElementById("transferProgress");

    let sensitiveApproved = false;
    if (isSensitiveFile(file.name)) {
      sensitiveApproved = window.confirm(
        `${file.name} is an executable/script type. Send it to ${agent.name} anyway?`
      );
      if (!sensitiveApproved) return false;
    }

    if (file.size > 20 * 1024 * 1024) {
      showToast("File exceeds the 20 MB file limit.");
      return false;
    }

    const form = new FormData();
    form.append("file", file);
    form.append("sensitive_approved", String(sensitiveApproved));

    if (progress) progress.style.width = "35%";

    const response = await fetch(`/api/agents/${encodeURIComponent(agent.id)}/files/send`, {
      method: "POST",
      body: form
    });

    if (progress) progress.style.width = "85%";

    const data = await response.json();
    if (!response.ok) {
      showToast(`File send failed: ${data.error || response.status}`);
      if (progress) progress.style.width = "0%";
      return false;
    }

    if (progress) progress.style.width = "100%";
    showToast(`Sent ${file.name} · ${formatBytes(file.size)}`);
    appendLiveEvent({type:"file_transfer",timestamp:new Date().toISOString(),message:`Attached file: ${file.name}`,payload:{direction:"outbound",filename:file.name,size:file.size,transfer_id:data.transfer_id,sha256:data.sha256}});
    pendingAttachment = null;
    fileInput.value = "";
    setTimeout(renderAttachment, 400);
    return true;
  }



  // -----------------------------
  // Per-agent browser notifications
  // -----------------------------
  const NOTIFICATION_STORAGE_KEY = "progretech.mesh.notifications.v1";
  const DEFAULT_NOTIFICATION_CATEGORIES = {
    reply: true,
    task_complete: true,
    approval_required: true,
    error_blocker: true,
    file_ready: true,
    gateway_offline: true,
    gateway_reconnected: true,
    progress: false,
    routine_status: false
  };

  let notificationDialogAgentId = null;
  const previousTransportState = new Map();

  function loadNotificationPreferences() {
    try {
      return JSON.parse(localStorage.getItem(NOTIFICATION_STORAGE_KEY) || "{}");
    } catch (_) {
      return {};
    }
  }

  function saveNotificationPreferences(value) {
    localStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify(value));
  }

  function notificationPreference(agentId) {
    const all = loadNotificationPreferences();
    return all[agentId] || {
      enabled: false,
      categories: { ...DEFAULT_NOTIFICATION_CATEGORIES }
    };
  }

  function updateNotificationPreference(agentId, patch) {
    const all = loadNotificationPreferences();
    const current = notificationPreference(agentId);
    all[agentId] = {
      ...current,
      ...patch,
      categories: {
        ...DEFAULT_NOTIFICATION_CATEGORIES,
        ...(current.categories || {}),
        ...((patch && patch.categories) || {})
      }
    };
    saveNotificationPreferences(all);
    return all[agentId];
  }

  function notificationSupported() {
    return "Notification" in window;
  }

  async function ensureNotificationPermission() {
    if (!notificationSupported()) return "unsupported";
    if (Notification.permission === "granted") return "granted";
    if (Notification.permission === "denied") return "denied";
    return await Notification.requestPermission();
  }

  function safeNotificationBody(category, agentName) {
    const bodies = {
      reply: `${agentName} has a new reply in Mesh.`,
      task_complete: `${agentName} completed a task.`,
      approval_required: `${agentName} needs your approval.`,
      error_blocker: `${agentName} encountered an error or blocker.`,
      file_ready: `${agentName} has a file ready.`,
      gateway_offline: `${agentName} is no longer connected to Mesh.`,
      gateway_reconnected: `${agentName} reconnected to Mesh.`,
      progress: `${agentName} reached a progress milestone.`,
      routine_status: `${agentName} has a status update.`
    };
    return bodies[category] || `${agentName} has a new Mesh event.`;
  }

  function notificationTitle(category, agentName) {
    const labels = {
      reply: "New reply",
      task_complete: "Task completed",
      approval_required: "Approval required",
      error_blocker: "Attention needed",
      file_ready: "File ready",
      gateway_offline: "Agent offline",
      gateway_reconnected: "Agent reconnected",
      progress: "Progress update",
      routine_status: "Status update"
    };
    return `${agentName} · ${labels[category] || "Mesh"}`;
  }

  function shouldSuppressVisibleNotification() {
    // Avoid noisy Telegram-like popups while the user is actively looking at Mesh.
    return document.visibilityState === "visible" && document.hasFocus();
  }

  function emitAgentNotification(agentId, category) {
    const pref = notificationPreference(agentId);
    if (!pref.enabled || !pref.categories?.[category]) return;
    if (!notificationSupported() || Notification.permission !== "granted") return;
    if (shouldSuppressVisibleNotification()) return;

    const agent = fleet.find((item) => item.id === agentId);
    const agentName = agent?.name || agentId;

    const notification = new Notification(
      notificationTitle(category, agentName),
      {
        body: safeNotificationBody(category, agentName),
        tag: `mesh-${agentId}-${category}`,
        renotify: category === "approval_required" || category === "error_blocker",
        icon: "/static/icons/icon-192.png"
      }
    );

    notification.onclick = () => {
      window.focus();
      notification.close();
      if (typeof selectAgent === "function") {
        selectAgent(agentId);
      }
    };
  }

  function classifyNotificationEvent(data) {
    const type = String(data?.type || "");
    const payload = data?.payload || {};
    const eventClass = String(payload.event_class || payload.type || "").toLowerCase();
    const state = String(payload.state || "").toLowerCase();
    const severity = String(payload.severity || "").toLowerCase();
    const message = String(data?.message || "").toLowerCase();

    if (type === "message_response") return "reply";
    if (type === "file_offer_ready" || type === "file_offer") return "file_ready";
    if (type === "approval_request") return "approval_required";

    if (
      severity === "error" ||
      eventClass === "error" ||
      eventClass === "blocker" ||
      state === "blocked" ||
      message.includes("blocked") ||
      message.includes("runtime error")
    ) return "error_blocker";

    if (
      eventClass === "task_complete" ||
      state === "completed" ||
      state === "complete" ||
      message.includes("task completed")
    ) return "task_complete";

    if (
      eventClass === "progress" ||
      state === "milestone"
    ) return "progress";

    if (type === "agent_activity") return "routine_status";
    return null;
  }

  function notificationAgentId(data) {
    return data?.agent_id || data?.payload?.agent_id || selectedAgentId || null;
  }

  function maybeNotifyFromLiveEvent(data) {
    const agentId = notificationAgentId(data);
    if (!agentId) return;
    const category = classifyNotificationEvent(data);
    if (category) emitAgentNotification(agentId, category);
  }

  function renderNotificationControls() {
    document.querySelectorAll("[data-agent-id]").forEach((card) => {
      const agentId = card.dataset.agentId;
      if (!agentId || card.querySelector(".agent-notification-row")) return;

      const actions =
        card.querySelector(".agent-actions") ||
        card.querySelector(".card-actions") ||
        card;

      const row = document.createElement("div");
      row.className = "agent-notification-row";
      row.innerHTML = `
        <label class="notification-toggle">
          <input type="checkbox" data-notification-toggle="${agentId}">
          <span>Notifications</span>
        </label>
        <button type="button"
                class="notification-settings-button"
                data-notification-settings="${agentId}"
                aria-label="Notification settings for this agent"
                title="Notification settings">⚙</button>
      `;
      actions.before(row);

      const toggle = row.querySelector("[data-notification-toggle]");
      toggle.checked = Boolean(notificationPreference(agentId).enabled);

      toggle.addEventListener("change", async () => {
        if (toggle.checked) {
          const permission = await ensureNotificationPermission();
          if (permission !== "granted") {
            toggle.checked = false;
            updateNotificationPreference(agentId, { enabled: false });
            showToast(
              permission === "denied"
                ? "Browser notifications are blocked for Mesh."
                : "This browser does not support notifications."
            );
            return;
          }
        }

        updateNotificationPreference(agentId, { enabled: toggle.checked });
        showToast(toggle.checked ? "Notifications enabled." : "Notifications disabled.");
      });
    });

    document.querySelectorAll("[data-notification-settings]").forEach((button) => {
      if (button.dataset.notificationBound === "true") return;
      button.dataset.notificationBound = "true";
      button.addEventListener("click", () => openNotificationSettings(button.dataset.notificationSettings));
    });
  }

  function openNotificationSettings(agentId) {
    notificationDialogAgentId = agentId;
    const dialog = document.getElementById("notificationSettingsDialog");
    if (!dialog) return;

    const agent = fleet.find((item) => item.id === agentId);
    const pref = notificationPreference(agentId);
    const title = document.getElementById("notificationDialogTitle");
    if (title) title.textContent = `${agent?.name || agentId} notifications`;

    dialog.querySelectorAll("[data-notification-category]").forEach((input) => {
      input.checked = Boolean(pref.categories?.[input.dataset.notificationCategory]);
    });

    const permission = document.getElementById("notificationPermissionStatus");
    if (permission) {
      permission.textContent = notificationSupported()
        ? `Browser permission: ${Notification.permission}`
        : "Browser notifications are not supported on this device.";
    }

    dialog.showModal();
  }

  const saveNotificationSettingsButton = document.getElementById("saveNotificationSettings");
  if (saveNotificationSettingsButton) {
    saveNotificationSettingsButton.addEventListener("click", async () => {
      if (!notificationDialogAgentId) return;

      const categories = {};
      document.querySelectorAll("[data-notification-category]").forEach((input) => {
        categories[input.dataset.notificationCategory] = input.checked;
      });

      const current = notificationPreference(notificationDialogAgentId);
      if (current.enabled) {
        const permission = await ensureNotificationPermission();
        if (permission !== "granted") {
          updateNotificationPreference(notificationDialogAgentId, {
            enabled: false,
            categories
          });
        } else {
          updateNotificationPreference(notificationDialogAgentId, { categories });
        }
      } else {
        updateNotificationPreference(notificationDialogAgentId, { categories });
      }

      document.getElementById("notificationSettingsDialog")?.close();
      renderNotificationControls();
      showToast("Notification preferences saved.");
    });
  }

  function detectGatewayNotificationTransitions(nextFleet) {
    nextFleet.forEach((agent) => {
      const previous = previousTransportState.get(agent.id);
      const current = agent.transport;
      if (previous && previous !== current) {
        if (current === "connected") {
          emitAgentNotification(agent.id, "gateway_reconnected");
        } else if (previous === "connected") {
          emitAgentNotification(agent.id, "gateway_offline");
        }
      }
      previousTransportState.set(agent.id, current);
    });
  }


  function severityFor(message) {
    return String(message?.payload?.severity || "info").toLowerCase();
  }
  function channelFor(message) {
    const raw = String(
      message?.payload?.channel ||
      message?.channel ||
      (message?.type === "message_response" ? "mesh" : "") ||
      ""
    ).toLowerCase();
    if (raw === "telegram") return "telegram";
    if (["mesh","direct","group"].includes(raw)) return "mesh";
    const type = String(message?.type || "").toLowerCase();
    const eventClass = String(message?.payload?.event_class || "").toLowerCase();
    if (["system","tools","tool"].includes(raw) ||
        type.includes("gateway") || type.includes("heartbeat") ||
        type.includes("approval") || type.includes("file") ||
        ["runtime","tool","system"].includes(eventClass)) return "system";
    return raw || "system";
  }


  function eventMatchesFilters(message) {
    const query = String(eventSearch?.value || "").trim().toLowerCase();
    const severity = String(severityFilter?.value || "all");
    const channel = String(channelFilter?.value || "all");
    const text = `${message.type || ""} ${message.message || ""} ${JSON.stringify(message.payload || {})}`.toLowerCase();

    if (query && !text.includes(query)) return false;
    if (severity !== "all" && severityFor(message) !== severity) return false;
    if (channel !== "all" && channelFor(message) !== channel) return false;
    return true;
  }

  function rerenderFilteredEvents() {
    eventList.innerHTML = "";
    const items = liveEvents.filter(eventMatchesFilters);
    if (!items.length) {
      eventList.innerHTML = '<div class="empty-stream">No events match the current filters.</div>';
      return;
    }
    items.slice(-30).forEach((message) => appendLiveEvent(message, false));
  }

  async function requestSafeAction(actionType) {
    if (!selectedAgentId) {
      showToast("Select an agent first.");
      return;
    }

    const response = await fetch(`/api/agents/${encodeURIComponent(selectedAgentId)}/actions/request`, {
      method: "POST",
      headers: {"Accept":"application/json","Content-Type":"application/json"},
      body: JSON.stringify({action_type: actionType, payload: {}})
    });

    const data = await response.json();
    if (!response.ok) {
      showToast(`Action request failed: ${data.error || response.status}`);
      return;
    }

    showToast("Action queued for approval.");
    refreshApprovals();
  }

  async function refreshApprovals() {
    if (!selectedAgentId) {
      approvalList.innerHTML = '<div class="empty-stream">Select an agent to view approvals.</div>';
      return;
    }

    const response = await fetch(`/api/agents/${encodeURIComponent(selectedAgentId)}/actions`);
    const data = await response.json();
    const items = data.actions || [];

    approvalList.innerHTML = items.length ? items.map((a) => `
      <div class="approval-item">
        <div class="approval-head">
          <strong>${escapeHtml(a.action_type)}</strong>
          <span class="trust-badge ${a.status === "pending" ? "unsigned" : "verified"}">${escapeHtml(a.status)}</span>
        </div>
        <div class="approval-meta">${escapeHtml(a.created_at)}</div>
        ${a.status === "pending" ? `
          <div class="approval-actions">
            <button class="approve" data-approve-action="${a.id}">Approve</button>
            <button class="reject" data-reject-action="${a.id}">Reject</button>
          </div>` : ""}
      </div>
    `).join("") : '<div class="empty-stream">No approval records for this agent.</div>';

    document.querySelectorAll("[data-approve-action]").forEach((b) => b.addEventListener("click", () => decideAction(b.dataset.approveAction, true)));
    document.querySelectorAll("[data-reject-action]").forEach((b) => b.addEventListener("click", () => decideAction(b.dataset.rejectAction, false)));
  }

  async function decideAction(actionId, approve) {
    const response = await fetch(`/api/actions/${encodeURIComponent(actionId)}/${approve ? "approve" : "reject"}`, {
      method:"POST"
    });
    const data = await response.json();
    showToast(response.ok ? (approve ? "Action approved." : "Action rejected.") : `Action failed: ${data.error || response.status}`);
    refreshApprovals();
  }

  async function refreshFileOffers() {
    if (!selectedAgentId) {
      fileOfferList.innerHTML = '<div class="empty-stream">Select an agent to view offered files.</div>';
      return;
    }

    const response = await fetch(`/api/files/offers?agent_id=${encodeURIComponent(selectedAgentId)}`);
    const data = await response.json();
    const files = data.files || [];

    fileOfferList.innerHTML = files.length ? files.map((f) => `
      <div class="file-offer">
        <div class="file-offer-head">
          <strong>${escapeHtml(f.filename)}</strong>
          <span class="trust-badge ${f.classification?.sensitive ? "unsigned" : "verified"}">${f.classification?.sensitive ? "Sensitive" : "Ready"}</span>
        </div>
        <div class="file-offer-meta">
          ${formatBytes(f.size)} · SHA-256 ${escapeHtml((f.sha256 || "").slice(0,16))}${f.sha256 ? "…" : ""}
        </div>
        <div class="file-offer-actions">
          <button data-download-file="${f.id}">Download</button>
        </div>
      </div>
    `).join("") : '<div class="empty-stream">No agent files offered yet.</div>';

    document.querySelectorAll("[data-download-file]").forEach((b) => {
      b.addEventListener("click", () => {
        window.location.href = `/api/files/${encodeURIComponent(b.dataset.downloadFile)}/download`;
      });
    });
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
      .replaceAll('"',"&quot;").replaceAll("'","&#039;");
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("show"), 2800);
  }

  function trustLabel(state) {
    return state === "verified" ? "Identity verified" :
      state === "unsigned" ? "Unsigned" :
      state === "revoked" ? "Revoked" : "Invalid";
  }

  function renderFleet() {
    if (!fleet.length) {
      agentGrid.innerHTML = '<div class="empty-fleet">No agents enrolled.</div>';
      return;
    }

    agentGrid.innerHTML = fleet.map((agent) => `
      <article class="agent-card ${selectedAgentId === agent.id ? "active" : ""}">
        <div class="agent-top">
          <div class="agent-id">
            <div class="avatar ${["rend","lyra","mak"].includes(agent.id) ? agent.id : "rend"}"></div>
            <div class="agent-name">
              <strong>${escapeHtml(agent.name)}</strong>
              <span>${escapeHtml(agent.role)}</span>
            </div>
          </div>
          <span class="agent-state ${agent.transport === "connected" ? (agent.state === "working" ? "busy" : "") : "idle"}"></span>
        </div>

        <div class="task">
          <label>${agent.transport === "connected" ? "Live activity" : "Status"}</label>
          <strong>${escapeHtml(agent.task)}</strong>
          <span>${escapeHtml(agent.phase)}</span>
        </div>

        <div class="progress"><i style="width:${Number(agent.progress || 0)}%"></i></div>

        <div class="agent-meta">
          <div class="meta-box"><span>Model</span><strong>${escapeHtml(agent.model || "Unknown")}</strong></div>
          <div class="meta-box"><span>Runtime</span><strong>${escapeHtml(agent.runtime || "—")}</strong></div>
        </div>

        <div class="agent-identity-row">
          <span class="trust-badge ${escapeHtml(agent.trust_state)}">${trustLabel(agent.trust_state)}</span>
          <span class="transport-pill ${escapeHtml(agent.transport)}">${agent.transport === "connected" ? "Gateway live" : "Gateway offline"}</span>
          <button class="identity-link" data-identity="${agent.id}">Identity</button>
        </div>

        <div class="agent-actions three">
          <button data-pair="${agent.id}" ${agent.trust_state !== "verified" ? "disabled" : ""}>Connect agent</button>
          <button data-monitor="${agent.id}" class="monitor">Monitor live</button>
          <button data-message="${agent.id}" ${agent.transport !== "connected" ? "disabled" : ""}>Message</button>
        </div>
      </article>
    `).join("");

    document.querySelectorAll("[data-pair]").forEach((b) => b.addEventListener("click", () => pairGateway(b.dataset.pair)));
    document.querySelectorAll("[data-monitor]").forEach((b) => b.addEventListener("click", () => monitorAgent(b.dataset.monitor)));
    document.querySelectorAll("[data-message]").forEach((b) => b.addEventListener("click", () => {
      monitorAgent(b.dataset.message);
      setTimeout(() => messageInput.focus(), 150);
    }));
    document.querySelectorAll("[data-identity]").forEach((b) => b.addEventListener("click", () => showIdentity(b.dataset.identity)));

    renderNotificationControls();
  }

  async function refreshFleet() {
    const response = await fetch("/api/status", {headers:{"Accept":"application/json"}});
    if (response.status === 401) { location.href = "/login"; return; }
    const data = await response.json();
    fleet = data.agents || [];

    document.getElementById("connectedCount").textContent = `${data.fleet.connected} gateways`;
    document.getElementById("signedCount").textContent = `${data.fleet.verified} / ${data.fleet.total}`;
    document.getElementById("gatewayCount").textContent = String(data.fleet.connected);
    document.getElementById("workingCount").textContent =
      String(fleet.filter((a) => a.transport === "connected").length);

    renderFleet();
    renderBuddyAgentOptions();
    updateBuddyUi();

    if (selectedAgentId) {
      const current = fleet.find((a) => a.id === selectedAgentId);
      if (current) renderTelemetry(current);
    }
  }

  function stopEnrollmentTimers() {
    clearInterval(enrollmentPollTimer);
    enrollmentPollTimer = null;
  }

  function renderEnrollmentStatus() {
    if (!activeEnrollment) return;
    pairCountdown.textContent = "Active until cancelled or connected";
  }

  function persistActiveEnrollment() {
    if (!activeEnrollment || !lastPairCommand) return;
    const safe = {
      agent_id: activeEnrollment.agent_id,
      request_id: activeEnrollment.request_id,
      issued_at: activeEnrollment.issued_at || null,
      lifecycle: activeEnrollment.lifecycle || "until_cancelled_or_redeemed",
      enrollment_message: lastPairCommand,
      advertised_origin: activeEnrollment.advertised_origin || null
    };
    localStorage.setItem("mesh-active-enrollment-v1", JSON.stringify(safe));
  }

  function clearPersistedActiveEnrollment() {
    localStorage.removeItem("mesh-active-enrollment-v1");
  }

  async function pollEnrollmentConnection() {
    if (!activeEnrollment) return;
    try {
      const response = await fetch("/api/status", {headers:{"Accept":"application/json"}});
      const data = await response.json();
      const agent = (data.agents || []).find((item) => item.id === activeEnrollment.agent_id);
      if (agent?.transport === "connected") {
        pairStatus.textContent = "Connected";
        pairStatus.className = "status-pill connected";
        pairCountdown.textContent = "Agent is live";
        pairCommand.textContent = `${agent.name || activeEnrollment.agent_id} accepted the request and connected to Mesh.`;
        copyPairCommandButton.hidden = true;
        cancelEnrollmentButton.hidden = true;
        stopEnrollmentTimers();
        clearPersistedActiveEnrollment();
        pairedAgents[activeEnrollment.agent_id] = {paired:true, last_connected_at:Date.now()};
        localStorage.setItem(PAIRED_AGENTS_KEY, JSON.stringify(pairedAgents));
        showToast(`${agent.name || activeEnrollment.agent_id} connected.`);
        await refreshFleet();
      }
    } catch (error) {
      console.warn("Enrollment status check failed:", error);
    }
  }

  async function pairGateway(agentId) {
    stopEnrollmentTimers();
    activeEnrollment = null;

    const response = await fetch(`/api/agents/${encodeURIComponent(agentId)}/enrollment-message`, {
      method:"POST",
      headers:{"Accept":"application/json"}
    });
    const data = await response.json();

    if (!response.ok) {
      const reason = data.error === "local_agent_reachable_origin_unavailable"
        ? "Mesh could not detect a LAN-reachable address for this computer."
        : (data.error || response.status);
      showToast(`Connection request unavailable: ${reason}`);
      return;
    }

    const agent = fleet.find((item) => item.id === agentId);
    activeEnrollment = {
      agent_id:agentId,
      request_id:data.request_id,
      issued_at:data.issued_at,
      lifecycle:data.activation_lifecycle || "until_cancelled_or_redeemed",
      advertised_origin:data.advertised_origin || null
    };
    lastPairCommand = data.enrollment_message;
    pairCommand.textContent = lastPairCommand;
    document.getElementById("pairModalTitle").textContent = `Connect ${agent?.name || agentId}`;
    document.getElementById("pairInstructions").textContent =
      `Copy this message and send it directly to ${agent?.name || "the agent"} through your existing chat. ` +
      (pairedAgents[agentId]?.paired
        ? "This agent was previously paired on this PWA. Its existing reconnect credential should be used first; the active PTM1 authorization is only a re-authorization fallback if that credential is unavailable."
        : "The agent handles the workstation side after its local policy approves the request.");
    if (advertisedAgentEndpoint) {
      advertisedAgentEndpoint.hidden = false;
      advertisedAgentEndpoint.textContent = `Agent-reachable endpoint: ${data.advertised_origin || "unavailable"}`;
    }
    pairStatus.textContent = "Waiting for agent";
    pairStatus.className = "status-pill waiting";
    copyPairCommandButton.textContent = "Copy enrollment message";
    copyPairCommandButton.hidden = false;
    copyPairCommandButton.disabled = false;
    cancelEnrollmentButton.hidden = false;
    cancelEnrollmentButton.disabled = false;
    pairModal.hidden = false;
    document.body.style.overflow = "hidden";

    renderEnrollmentStatus();
    persistActiveEnrollment();
    enrollmentPollTimer = setInterval(pollEnrollmentConnection, 2000);
  }

  async function cancelActiveEnrollment() {
    if (activeEnrollment) {
      const {agent_id, request_id} = activeEnrollment;
      try {
        await fetch(`/api/agents/${encodeURIComponent(agent_id)}/enrollment/${encodeURIComponent(request_id)}/cancel`, {
          method:"POST",
          headers:{"Accept":"application/json"}
        });
      } catch (_) {}
    }
    stopEnrollmentTimers();
    activeEnrollment = null;
    clearPersistedActiveEnrollment();
    pairModal.hidden = true;
    document.body.style.overflow = "";
    showToast("Connection request cancelled.");
  }


  function restorePersistedEnrollment() {
    try {
      const saved = JSON.parse(localStorage.getItem("mesh-active-enrollment-v1") || "null");
      if (!saved?.agent_id || !saved?.request_id || !saved?.enrollment_message) return;
      activeEnrollment = {
        agent_id: saved.agent_id,
        request_id: saved.request_id,
        issued_at: saved.issued_at || null,
        lifecycle: saved.lifecycle || "until_cancelled_or_redeemed",
        advertised_origin: saved.advertised_origin || null
      };
      lastPairCommand = saved.enrollment_message;
    } catch (_) { clearPersistedActiveEnrollment(); }
  }


  function loadLocalRoutes() {
    try { localRoutes=JSON.parse(localStorage.getItem(LOCAL_ROUTE_KEY) || "{}"); }
    catch (_) { localRoutes={}; }
  }

  function saveLocalRouteMessage(message) {
    if (!message?.agent_id || !Array.isArray(message.routes) || !message.local_access_token) return;
    localRoutes[message.agent_id]={routes:message.routes,token:message.local_access_token,updated_at:Date.now()};
    localStorage.setItem(LOCAL_ROUTE_KEY,JSON.stringify(localRoutes));
  }

  async function localFetch(url, options={}) {
    const opts={...options,mode:"cors",cache:"no-store",targetAddressSpace:"local"};
    try { return await fetch(url,opts); }
    catch (firstError) {
      // Older browsers may not understand targetAddressSpace; retry normally.
      const {targetAddressSpace,...fallback}=opts;
      return fetch(url,fallback);
    }
  }

  async function requestLocalNetworkPermission() {
    if (!navigator.permissions?.query) return "unknown";
    try { const result=await navigator.permissions.query({name:"local-network"}); return result.state || "unknown"; }
    catch (_) { return "unknown"; }
  }

  async function findReachableLocalRoute(agentId) {
    loadLocalRoutes();
    const saved=localRoutes[agentId];
    if (!saved?.routes?.length || !saved.token) return null;
    for (const route of saved.routes) {
      const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),1600);
      try {
        const response=await localFetch(`${route.origin}/mesh-local/status`,{headers:{"Accept":"application/json","X-Mesh-Local-Token":saved.token},signal:controller.signal});
        clearTimeout(timer); if (response.ok) return {...route,token:saved.token};
      } catch (_) { clearTimeout(timer); }
    }
    return null;
  }

  async function postLocalSignal(route, signal) {
    const response=await localFetch(`${route.origin}/mesh-local/signal`,{method:"POST",headers:{"Accept":"application/json","Content-Type":"application/json","X-Mesh-Local-Token":route.token},body:JSON.stringify({signal})});
    const data=await response.json(); if (!response.ok) throw new Error(data.error || `local_signal_${response.status}`); return data;
  }

  async function pollLocalSignals(agentId, route, peerId) {
    if (localSignalPollTimer) clearTimeout(localSignalPollTimer);
    const poll=async()=>{
      if (directPeerId!==peerId || directChannelReady()) return;
      try {
        const response=await localFetch(`${route.origin}/mesh-local/signals?peer_id=${encodeURIComponent(peerId)}`,{headers:{"Accept":"application/json","X-Mesh-Local-Token":route.token}});
        const data=await response.json();
        for (const signal of (data.signals || [])) await handleDirectSignalFromAgent(agentId,signal);
      } catch (_) {}
      if (directPeerId===peerId && !directChannelReady()) localSignalPollTimer=setTimeout(poll,250);
    };
    await poll();
  }

  function classifyCandidate(candidate) {
    const text = String(candidate || "");
    if (/\styp relay\s/i.test(text)) return "relay";
    if (/\styp srflx\s/i.test(text)) return "internet_p2p";
    if (/\styp host\s/i.test(text)) return "lan_direct";
    return "direct";
  }

  function setRouteStatus(label) {
    if (routeStatus) routeStatus.textContent = label;
  }

  function directChannelReady() { return directChannel && directChannel.readyState === "open"; }
  function closeDirectTransport(reason="closed") {
    if (directChannelReady()) { try { directChannel.send(JSON.stringify({type:"close",reason})); } catch (_) {} }
    try { directChannel?.close(); } catch (_) {} try { directPeer?.close(); } catch (_) {}
    directChannel=null; directPeer=null; directPeerId=null; directRouteState="idle";
  }
  async function postDirectSignal(agentId,type,payload) {
    const response=await fetch(`/api/agents/${encodeURIComponent(agentId)}/transport/signal`,{method:"POST",headers:{"Accept":"application/json","Content-Type":"application/json"},body:JSON.stringify({type,payload})});
    const data=await response.json(); if (!response.ok) throw new Error(data.error || `signal_${response.status}`); return data;
  }
  async function startDirectTransport(agentId, localRoute=null) {
    closeDirectTransport("replace"); if (!window.RTCPeerConnection) { directRouteState="unsupported"; return false; }
    const peerId=crypto?.randomUUID?.() || `peer-${Date.now()}-${Math.random().toString(16).slice(2)}`; directPeerId=peerId; directRouteState="negotiating";
    if (localRoute) {
      currentIceServers=[];
    } else {
      const configResponse = await fetch(`/api/transport/config?policy=${encodeURIComponent(currentRoutePolicy)}`, {headers:{"Accept":"application/json"}});
      const configData = await configResponse.json();
      if (!configResponse.ok) throw new Error(configData.error || `transport_config_${configResponse.status}`);
      currentIceServers = Array.isArray(configData.ice_servers) ? configData.ice_servers : [];
    }
    const peer = new RTCPeerConnection({iceServers:currentIceServers, iceTransportPolicy:"all"});
    directPeer=peer;
    const channel=peer.createDataChannel("progretech-mesh",{ordered:true}); directChannel=channel;
    channel.addEventListener("open",()=>{ directRouteState="lan_direct"; channel.send(JSON.stringify({type:"hello",peer_id:peerId,timestamp:new Date().toISOString()})); document.getElementById("eventStreamLabel").textContent=`${fleet.find((a)=>a.id===agentId)?.name || agentId} · direct`; showToast("Direct owner-to-agent connection established."); });
    channel.addEventListener("close",()=>{ if (directPeerId===peerId) directRouteState="closed"; });
    channel.addEventListener("message",(event)=>{ let data; try { data=JSON.parse(event.data); } catch (_) { return; }
      if (data.type==="message_response") { pendingDirectMessages.delete(data.request_id); appendLiveEvent({type:"message_response",timestamp:data.timestamp || new Date().toISOString(),message:data.text || "",payload:{transport:"webrtc-direct",cloud_data_path:false}}); return; }
      if (data.type==="heartbeat") { appendLiveEvent({type:"heartbeat",timestamp:data.timestamp || new Date().toISOString(),message:data.payload?.message || "Direct heartbeat received",payload:{...(data.payload||{}),transport:"webrtc-direct",cloud_data_path:false}}); return; }
      if (data.type==="hello_ack") { directRouteState=data.path || "lan_direct"; return; }
      if (data.type==="direct_error") showToast(`Direct connection error: ${data.error || "unknown error"}`);
    });
    peer.addEventListener("icecandidate",(event)=>{ if (!event.candidate || directPeerId!==peerId) return; void (localRoute
      ? postLocalSignal(localRoute,{type:"ice_candidate",payload:{peer_id:peerId,candidate:event.candidate.candidate,mid:event.candidate.sdpMid || "0"}})
      : postDirectSignal(agentId,"ice_candidate",{peer_id:peerId,candidate:event.candidate.candidate,mid:event.candidate.sdpMid || "0"})
    ).catch(()=>{}); });
    peer.addEventListener("connectionstatechange", async () => {
      if (peer.connectionState === "connected" && directPeerId === peerId) {
        try {
          const stats = await peer.getStats();
          let selectedPair = null;
          let localCandidate = null;
          for (const stat of stats.values()) {
            if (stat.type === "transport" && stat.selectedCandidatePairId) {
              selectedPair = stats.get(stat.selectedCandidatePairId);
            }
          }
          if (selectedPair?.localCandidateId) localCandidate = stats.get(selectedPair.localCandidateId);
          const candidateType = localCandidate?.candidateType || "";
          if (candidateType === "relay") {
            directRouteState = "relay";
            setRouteStatus("Encrypted relay");
          } else if (candidateType === "srflx" || candidateType === "prflx") {
            directRouteState = "internet_p2p";
            setRouteStatus("Direct internet");
          } else {
            directRouteState = "lan_direct";
            setRouteStatus("Direct local");
          }
        } catch (_) {
          setRouteStatus("Direct connected");
        }
      }
      if (["failed","closed"].includes(peer.connectionState) && directPeerId===peerId) {
        directRouteState=peer.connectionState;
        setRouteStatus(peer.connectionState === "failed" ? "Direct unavailable" : "Disconnected");
      }
    });
    const offer=await peer.createOffer(); await peer.setLocalDescription(offer); const offerSignal={type:"offer",payload:{peer_id:peerId,sdp:peer.localDescription.sdp,description_type:peer.localDescription.type,route_policy:localRoute ? "direct_only" : currentRoutePolicy,ice_servers:currentIceServers}};
    if (localRoute) {
      await postLocalSignal(localRoute,offerSignal);
      void pollLocalSignals(agentId,localRoute,peerId);
      setRouteStatus("Direct local · negotiating");
    } else {
      await postDirectSignal(agentId,"offer",offerSignal.payload);
    }
    return true;
  }
  async function handleDirectSignalFromAgent(agentId,signal) {
    if (!directPeer || !directPeerId || agentId!==selectedAgentId) return; const payload=signal?.payload || {}; if (payload.peer_id!==directPeerId) return;
    if (signal.type==="answer") { await directPeer.setRemoteDescription({type:"answer",sdp:payload.sdp}); return; }
    if (signal.type==="ice_candidate" && payload.candidate) { await directPeer.addIceCandidate({candidate:payload.candidate,sdpMid:payload.mid || "0"}); return; }
    if (signal.type==="direct_error") { directRouteState="error"; showToast(`Direct negotiation failed: ${payload.error || "unknown error"}`); }
  }

  function monitorAgent(agentId) {
    selectedAgentId = agentId;
    clearTimeout(monitorReconnectTimer);

    if (monitorSocket) {
      try { monitorSocket.close(); } catch (_) {}
    }

    renderFleet();
    const agent = fleet.find((a) => a.id === agentId);
    document.getElementById("selectedMonitor").textContent = agent?.name || agentId;
    document.getElementById("eventStreamLabel").textContent = `${agent?.name || agentId} · connecting`;
    document.getElementById("telemetryLabel").textContent = agent?.name || agentId;
    messageInput.placeholder = `Message ${agent?.name || agentId}…`;
    refreshApprovals();
    refreshFileOffers();

    eventList.innerHTML = '<div class="empty-stream">Connecting to live conversation/event stream…</div>';

    const scheme = location.protocol === "https:" ? "wss" : "ws";
    monitorSocket = new WebSocket(`${scheme}://${location.host}/ws/client/${encodeURIComponent(agentId)}`);

    monitorSocket.addEventListener("open", () => {
      document.getElementById("eventStreamLabel").textContent = `${agent?.name || agentId} · signaling`;
      void startDirectTransport(agentId).catch((error) => { directRouteState="error"; showToast(`Direct transport unavailable: ${error?.message || error}`); });
    });

    monitorSocket.addEventListener("message", (event) => {
      const data = JSON.parse(event.data);
      maybeNotifyFromLiveEvent(data);

      if (data.type === "snapshot") {
        fleet = fleet.map((item) => item.id === agentId ? data.agent : item);
        renderFleet();
        renderTelemetry(data.agent);
        renderEvents(data.events || []);
        return;
      }

      if (data.type === "gateway_message") {
        if (data.message?.type === "mesh_direct_signal") { void handleDirectSignalFromAgent(agentId,data.message.signal).catch((error)=>{ directRouteState="error"; showToast(`Direct signaling error: ${error?.message || error}`); }); return; }
        if (data.message?.type === "mesh_local_route") { saveLocalRouteMessage(data.message); return; }
        fleet = fleet.map((item) => item.id === agentId ? data.agent : item);
        renderFleet();
        renderTelemetry(data.agent);
        appendLiveEvent(data.message);

        if (data.message?.type === "terminal" && Array.isArray(data.message?.payload?.lines)) {
          liveTerminal.innerHTML = `
            <div class="muted">$ read-only terminal snapshot</div>
            ${data.message.payload.lines.map((line) => `<div>${escapeHtml(line)}</div>`).join("")}
            <div class="muted">No interactive shell is exposed.</div>
          `;
        }
        return;
      }

      if (
        data.type === "approval_request" ||
        data.type === "command_ack" ||
        data.type === "action_result" ||
        data.type === "file_offer_start" ||
        data.type === "file_offer_progress" ||
        data.type === "file_offer_ready"
      ) {
        if (["approval_request","command_ack","action_result"].includes(data.type)) refreshApprovals();
        if (data.type === "file_offer_ready") {
          showToast(`${data.file.filename} is ready to download.`);
          appendLiveEvent({type:"file_offer_ready", timestamp:new Date().toISOString(), message:`Agent offered file: ${data.file.filename}`, file:data.file, payload:{direction:"inbound", size:data.file.size, sha256:data.file.sha256}});
          refreshFileOffers();
        } else if (["command_ack","action_result"].includes(data.type)) {
          appendLiveEvent(data);
        }
        return;
      }

      if (["gateway_connected","gateway_disconnected"].includes(data.type)) {
        fleet = fleet.map((item) => item.id === agentId ? data.agent : item);
        renderFleet();
        renderTelemetry(data.agent);
        appendLiveEvent({
          type:"gateway",
          timestamp:new Date().toISOString(),
          message:data.type === "gateway_connected" ? "Gateway connected" : "Gateway disconnected",
          payload:{}
        });
      }
    });

    monitorSocket.addEventListener("close", () => {
      closeDirectTransport("signaling_closed");
      document.getElementById("eventStreamLabel").textContent = `${agent?.name || agentId} · reconnecting`;
      monitorReconnectTimer = setTimeout(() => {
        if (selectedAgentId === agentId) monitorAgent(agentId);
      }, 2500);
    });
  }

  function renderTelemetry(agent) {
    const telemetry = agent.telemetry || {};
    telemetryGrid.innerHTML = `
      <div class="metric"><span>CPU</span><strong>${telemetry.cpu_percent ?? "—"}${telemetry.cpu_percent != null ? "%" : ""}</strong></div>
      <div class="metric"><span>RAM</span><strong>${telemetry.memory_percent ?? "—"}${telemetry.memory_percent != null ? "%" : ""}</strong></div>
      <div class="metric"><span>Disk</span><strong>${telemetry.disk_percent ?? "—"}${telemetry.disk_percent != null ? "%" : ""}</strong></div>
      <div class="metric"><span>Heartbeat</span><strong>${agent.last_heartbeat ? new Date(agent.last_heartbeat).toLocaleTimeString() : "—"}</strong></div>
    `;

    liveTerminal.innerHTML = `
      <div class="muted">$ Mesh gateway status</div>
      <div>Agent: ${escapeHtml(agent.name)}</div>
      <div>Transport: ${escapeHtml(agent.transport)}</div>
      <div>Host: ${escapeHtml(telemetry.hostname || "—")}</div>
      <div>OS: ${escapeHtml(telemetry.platform || "—")} ${escapeHtml(telemetry.platform_release || "")}</div>
      <div class="${agent.transport === "connected" ? "ok" : "muted"}">${agent.transport === "connected" ? "✓ live messaging transport connected" : "gateway offline"}</div>
      <div class="muted">Arbitrary remote shell execution remains disabled.</div>
    `;
  }

  function renderEvents(events) {
    liveEvents = [...events];
    rerenderFilteredEvents();
  }

  function terminalDirection(message) {
    const type = String(message?.type || "event");
    const payload = message?.payload || {};
    const direction = String(payload.direction || "").toLowerCase();
    const severity = String(payload.severity || "").toLowerCase();
    if (severity === "error" || type === "direct_error") return {label:"ERR", cls:"dir-err"};
    if (type.startsWith("file_") || type === "file" || type === "file_transfer") return {label:"FILE", cls:"dir-file"};
    if (["user_message","group_message"].includes(type) || direction === "input" || direction === "out" || direction === "outbound") return {label:"OUT", cls:"dir-out"};
    if (type === "message_response" || direction === "output" || direction === "in" || direction === "inbound") return {label:"IN", cls:"dir-in"};
    if (type === "command_ack") return {label:"IN", cls:"dir-in"};
    return {label:"SYS", cls:"dir-sys"};
  }

  function safeDetailPayload(message) {
    const payload = {...(message?.payload || {})};
    delete payload.content_base64;
    delete payload.token;
    delete payload.credential;
    return payload;
  }

  function appendTerminalFileCard(item, file) {
    if (!file?.id || !file?.filename) return;
    const card = document.createElement("div");
    card.className = "mesh-file-card";
    card.innerHTML = `
      <div>
        <strong>${escapeHtml(file.filename)}</strong>
        <span>${formatBytes(file.size)}${file.sha256 ? ` · SHA-256 ${escapeHtml(String(file.sha256).slice(0,16))}…` : ""}</span>
      </div>
      <button type="button" data-terminal-download="${escapeHtml(file.id)}">Get file</button>
    `;
    card.querySelector("[data-terminal-download]")?.addEventListener("click", () => {
      window.location.href = `/api/files/${encodeURIComponent(file.id)}/download`;
    });
    item.appendChild(card);
  }

  function appendLiveEvent(message, track = true) {
    if (track) {
      liveEvents.push(message);
      if (liveEvents.length > 160) liveEvents = liveEvents.slice(-160);
      if (!eventMatchesFilters(message)) return;
    }
    if (eventList.querySelector(".empty-stream")) eventList.innerHTML = "";

    const type = message.type || "event";
    const payload = message.payload || {};
    const time = message.timestamp ? new Date(message.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();
    const direction = terminalDirection(message);
    const bodyText = message.message || (type === "file_offer_ready" ? `Agent offered ${message.file?.filename || "a file"}` : "Event received");
    const item = document.createElement("div");
    item.className = `mesh-line ${direction.cls} severity-${severityFor(message)}`;
    item.innerHTML = `
      <time>${escapeHtml(time)}</time>
      <span class="mesh-dir">${escapeHtml(direction.label)}</span>
      <span class="mesh-kind">${escapeHtml(type)}</span>
      <span class="mesh-body">${escapeHtml(bodyText)}</span>
    `;

    const detail = safeDetailPayload(message);
    if (Object.keys(detail).length) {
      const wrapper = document.createElement("div");
      wrapper.className = "mesh-detail";
      wrapper.innerHTML = `<details><summary>details</summary><pre>${escapeHtml(JSON.stringify(detail, null, 2))}</pre></details>`;
      item.appendChild(wrapper);
    }

    if (type === "file_offer_ready" && message.file) appendTerminalFileCard(item, message.file);
    eventList.appendChild(item);
    if (type === "message_response") speakAgentReply(message.message || "");

    while (eventList.children.length > 80) eventList.firstElementChild.remove();
    eventList.lastElementChild?.scrollIntoView({block:"nearest"});
  }

  async function sendDirectMessage(text) {
    const agent=fleet.find((a)=>a.id===selectedAgentId);
    if (!agent) { showToast("Select an agent first."); return; }
    if (agent.transport!=="connected") { showToast(`${agent.name}'s gateway is offline.`); return; }
    if (directChannelReady()) {
      const requestId=crypto?.randomUUID?.() || `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`; pendingDirectMessages.set(requestId,Date.now());
      directChannel.send(JSON.stringify({type:"message",request_id:requestId,agent_id:agent.id,room:"direct",sender:"Mesh user",text}));
      appendLiveEvent({type:"user_message",timestamp:new Date().toISOString(),message:text,payload:{sender:"You",transport:"webrtc-direct",cloud_data_path:false}}); messageInput.value=""; return;
    }
    const response=await fetch(`/api/agents/${encodeURIComponent(agent.id)}/message`,{method:"POST",headers:{"Accept":"application/json","Content-Type":"application/json"},body:JSON.stringify({text})});
    const data=await response.json(); if (!response.ok) { showToast(`Message failed: ${data.error || response.status}`); return; } messageInput.value="";
  }

  function openGroupRoom() {
    const connected = fleet.filter((a) => a.transport === "connected");
    groupAgentChoices.innerHTML = connected.length ? connected.map((a) => `
      <div class="group-choice">
        <label>
          <input type="checkbox" name="agent_ids" value="${escapeHtml(a.id)}" checked>
          <span>${escapeHtml(a.name)}</span>
        </label>
        <span class="transport-pill connected">Gateway live</span>
      </div>
    `).join("") : '<div class="empty-stream">No agent gateways are connected.</div>';

    groupModal.hidden = false;
    document.body.style.overflow = "hidden";
  }

  async function sendGroupMessage(event) {
    event.preventDefault();
    const form = new FormData(groupMessageForm);
    const text = String(form.get("text") || "").trim();
    const agentIds = form.getAll("agent_ids");

    if (!text || !agentIds.length) {
      showToast("Select at least one connected agent and enter a message.");
      return;
    }

    const response = await fetch("/api/rooms/group/message", {
      method:"POST",
      headers:{"Accept":"application/json","Content-Type":"application/json"},
      body:JSON.stringify({text, agent_ids:agentIds})
    });

    const data = await response.json();
    if (!response.ok) {
      showToast(`Group message failed: ${data.error || "no gateways available"}`);
      return;
    }

    showToast(`Delivered to ${data.delivered} of ${data.attempted} selected agents.`);
    groupMessageForm.reset();
    closeModal(groupModal);

    if (agentIds[0]) monitorAgent(agentIds[0]);
  }

  function showIdentity(agentId) {
    const agent = fleet.find((item) => item.id === agentId);
    if (!agent) return;
    identityDetails.innerHTML = `
      <dl class="identity-grid">
        <dt>Name</dt><dd>${escapeHtml(agent.name)}</dd>
        <dt>Role</dt><dd>${escapeHtml(agent.role)}</dd>
        <dt>Trust state</dt><dd><span class="trust-badge ${escapeHtml(agent.trust_state)}">${trustLabel(agent.trust_state)}</span></dd>
        <dt>Fingerprint</dt><dd><code>${escapeHtml(agent.fingerprint)}</code></dd>
        <dt>Transport</dt><dd>${escapeHtml(agent.transport)}</dd>
        <dt>Last heartbeat</dt><dd>${escapeHtml(agent.last_heartbeat || "Never")}</dd>
      </dl>
    `;
    identityModal.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeModal(modal) {
    modal.hidden = true;
    document.body.style.overflow = "";
  }

  document.getElementById("addAgentButton")?.addEventListener("click", () => { agentModal.hidden=false; document.body.style.overflow="hidden"; });
  document.getElementById("closeAgentModal")?.addEventListener("click", () => closeModal(agentModal));
  document.getElementById("cancelAgentEnrollment")?.addEventListener("click", () => closeModal(agentModal));
  document.getElementById("closePairModal")?.addEventListener("click", () => closeModal(pairModal));
  document.getElementById("donePairModal")?.addEventListener("click", () => closeModal(pairModal));
  document.getElementById("closeIdentityModal")?.addEventListener("click", () => closeModal(identityModal));
  document.getElementById("closeGroupModal")?.addEventListener("click", () => closeModal(groupModal));
  document.getElementById("cancelGroupRoom")?.addEventListener("click", () => closeModal(groupModal));

  async function copyTextCompatible(text) {
    // The modern Clipboard API is normally restricted to secure contexts.
    // Local Mesh acceptance intentionally supports private-LAN HTTP, so keep
    // a bounded legacy fallback instead of silently failing on http://192.168.x.x.
    if (window.isSecureContext && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (_) {
        // Fall through to the private-LAN compatible path below.
      }
    }

    const helper = document.createElement("textarea");
    helper.value = text;
    helper.setAttribute("readonly", "");
    helper.setAttribute("aria-hidden", "true");
    helper.style.position = "fixed";
    helper.style.left = "-9999px";
    helper.style.top = "0";
    helper.style.opacity = "0";
    document.body.appendChild(helper);
    helper.focus();
    helper.select();
    helper.setSelectionRange(0, helper.value.length);

    let copied = false;
    try {
      copied = Boolean(document.execCommand?.("copy"));
    } catch (_) {
      copied = false;
    } finally {
      helper.remove();
    }
    return copied;
  }

  function selectEnrollmentMessageForManualCopy() {
    if (!pairCommand) return;
    try {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(pairCommand);
      selection.removeAllRanges();
      selection.addRange(range);
      pairCommand.scrollIntoView({block:"nearest"});
    } catch (_) {}
  }

  copyPairCommandButton?.addEventListener("click", async () => {
    const copied = await copyTextCompatible(lastPairCommand);
    if (copied) {
      copyPairCommandButton.textContent = "Copied ✓";
      copyPairCommandButton.classList.add("copy-success");
      showToast("Enrollment message copied to clipboard.");
      setTimeout(() => {
        copyPairCommandButton.textContent = "Copy enrollment message";
        copyPairCommandButton.classList.remove("copy-success");
      }, 2200);
      return;
    }

    selectEnrollmentMessageForManualCopy();
    showToast("Clipboard access is unavailable. The enrollment message is selected — press Ctrl+C.");
  });

  enrollmentForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(enrollmentForm);
    const response = await fetch("/api/agents/enroll", {
      method:"POST",
      headers:{"Accept":"application/json","Content-Type":"application/json"},
      body:JSON.stringify({
        name:form.get("name"),
        role:form.get("role"),
        public_key:form.get("public_key"),
        codeseal_key:form.get("codeseal_key")
      })
    });
    const data = await response.json();
    if (!response.ok) { showToast(`Enrollment rejected: ${data.error || response.status}`); return; }
    enrollmentForm.reset();
    closeModal(agentModal);
    showToast(`${data.agent.name} enrolled.`);
    refreshFleet();
  });

  messageComposer?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = messageInput.value.trim();
    const hadAttachment = Boolean(pendingAttachment);

    if (pendingAttachment) {
      const sent = await sendPendingAttachment();
      if (!sent) return;
    }

    if (text) {
      await sendDirectMessage(text);
    } else if (!pendingAttachment) {
      showToast("Enter a message or attach a file.");
    }
  });

  groupMessageForm?.addEventListener("submit", sendGroupMessage);

  document.getElementById("groupRoomButton")?.addEventListener("click", openGroupRoom);
  document.getElementById("mobileRoomsButton")?.addEventListener("click", openGroupRoom);
  document.getElementById("heartbeatButton")?.addEventListener("click", async () => {
    if (!selectedAgentId) { showToast("Select Monitor live on an agent first."); return; }
    const response = await fetch(`/api/agents/${encodeURIComponent(selectedAgentId)}/heartbeat-request`, {method:"POST"});
    const data = await response.json();
    showToast(response.ok ? "Heartbeat requested." : `Heartbeat failed: ${data.error || response.status}`);
  });

  document.getElementById("openFleetButton")?.addEventListener("click", () => document.getElementById("agents")?.scrollIntoView({behavior:"smooth"}));
  document.getElementById("mobileAgentsButton")?.addEventListener("click", () => document.getElementById("agents")?.scrollIntoView({behavior:"smooth"}));
  document.getElementById("manageAgentsButton")?.addEventListener("click", () => showToast("Lifecycle management is not available in this build."));
  document.querySelectorAll("[data-later]").forEach((b) => b.addEventListener("click", () => showToast("This capability is not currently available.")));

  [agentModal,pairModal,identityModal,groupModal,buddySettingsModal].forEach((modal) => modal?.addEventListener("click", (event) => {
    if (event.target === modal) closeModal(modal);
  }));

  voiceButton?.addEventListener("click", toggleVoiceInput);

  document.querySelectorAll("[data-mobile-view]").forEach((button) => {
    button.addEventListener("click", () => setMobileView(button.dataset.mobileView));
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 760) {
      streamPanel?.classList.remove("mobile-hidden");
      telemetryPanel?.classList.remove("mobile-hidden");
    } else if (
      !streamPanel?.classList.contains("mobile-hidden") &&
      !telemetryPanel?.classList.contains("mobile-hidden")
    ) {
      setMobileView("stream");
    }
  });

  attachButton?.addEventListener("click", () => {
    if (!selectedAgentId) {
      showToast("Select a connected agent first.");
      return;
    }
    fileInput.click();
  });

  fileInput?.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;

    if (file.size > 20 * 1024 * 1024) {
      showToast("File limit is 20 MB per file.");
      fileInput.value = "";
      return;
    }

    pendingAttachment = {file};
    renderAttachment();
  });

  eventSearch?.addEventListener("input", rerenderFilteredEvents);
  severityFilter?.addEventListener("change", rerenderFilteredEvents);
  channelFilter?.addEventListener("change", rerenderFilteredEvents);
  cancelEnrollmentButton?.addEventListener("click", cancelActiveEnrollment);

  document.getElementById("requestTaskSnapshot")?.addEventListener("click", () => requestSafeAction("request_task_snapshot"));
  document.getElementById("requestTerminalSnapshot")?.addEventListener("click", () => requestSafeAction("request_terminal_snapshot"));

  document.getElementById("requestDemoFileButton")?.addEventListener("click", async () => {
    if (!selectedAgentId) {
      showToast("Select an agent first.");
      return;
    }
    const response = await fetch(`/api/agents/${encodeURIComponent(selectedAgentId)}/files/request-demo`, {method:"POST"});
    const data = await response.json();
    showToast(response.ok ? "Asked agent for a demo artifact." : `Request failed: ${data.error || response.status}`);
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    installButton.hidden = false;
  });

  installButton?.addEventListener("click", async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    installButton.hidden = true;
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {scope:"/"});
        registration.update();
      } catch (error) {
        console.warn("Service worker registration failed:", error);
      }
    });
  }


  const TRAINING_STORAGE_KEY = "progretech.mesh.guided-training.completed.v1";
  const trainingSteps = [
    ["Welcome to ProgreTech Mesh","Mesh is a live front end for your local agents. Their runtime, memory, and active work stay on their own machine.","Cloud retention is off for live operational history.",".hero"],
    ["Your agent fleet","Each card shows identity, connection state, current activity, runtime details, and the controls available for that agent.","A verified identity is separate from whether the local gateway is currently online.","#agentGrid"],
    ["Connect without workstation access","Choose Connect agent, copy the active enrollment request, and send it through your existing direct chat with the agent. The agent handles the local setup.","You should not need SSH, RDP, a terminal, or filesystem access to the agent computer.","#agentGrid"],
    ["Plug-and-monitor","Connecting Mesh does not take over a running agent. Existing Telegram work can continue while Mesh observes the same agent independently.","Refreshing or disconnecting Mesh must not stop the agent's current task.","#dashboard"],
    ["Filter activity by channel","The live stream can show all activity or narrow it to Telegram, Mesh, or system/tool activity.","A Mesh conversation remains independent from the Telegram conversation even though both can appear in the monitor.",".observability-toolbar"],
    ["Message and speak","Use the composer for a separate Mesh conversation. Where supported, the microphone can capture speech into the editable message field.","Speech recognition is a browser capability and may depend on the browser vendor.","#messageComposer"],
    ["Notifications","Enable notifications independently for the agents you care about. Choose replies, task completion, approvals, blockers, files, and connection changes.","Notification text stays brief and avoids copying sensitive event contents.","#agentGrid"],
    ["Safe actions and files","Policy-gated actions require approval. File exchange is bidirectional, bounded, verified, and relayed ephemerally.","Mesh does not expose an arbitrary remote shell.",".ops-grid"],
    ["You're ready","Monitor agents from desktop, phone, or foldable, install Mesh as a PWA, and restart Guided Training whenever you want a refresher.","Agent activity belongs to the agent; Mesh is the live console around it.",".topbar"]
  ];

  function clearTrainingHighlight() {
    document.querySelectorAll(".training-highlight").forEach((el) => el.classList.remove("training-highlight"));
  }


  function hideTrainingSpotlight() {
    if (!trainingSpotlight) return;
    trainingSpotlight.hidden = true;
    trainingSpotlight.style.removeProperty("left");
    trainingSpotlight.style.removeProperty("top");
    trainingSpotlight.style.removeProperty("width");
    trainingSpotlight.style.removeProperty("height");
  }

  function positionTrainingSpotlight(target) {
    if (!trainingSpotlight || !target) {
      hideTrainingSpotlight();
      return;
    }
    const rect = target.getBoundingClientRect();
    const pad = 8;
    const left = Math.max(8, rect.left - pad);
    const top = Math.max(8, rect.top - pad);
    const right = Math.min(window.innerWidth - 8, rect.right + pad);
    const bottom = Math.min(window.innerHeight - 8, rect.bottom + pad);
    trainingSpotlight.hidden = false;
    trainingSpotlight.style.left = `${left}px`;
    trainingSpotlight.style.top = `${top}px`;
    trainingSpotlight.style.width = `${Math.max(24, right - left)}px`;
    trainingSpotlight.style.height = `${Math.max(24, bottom - top)}px`;
  }

  function renderTrainingStep() {
    clearTrainingHighlight();
    const step = trainingSteps[trainingStepIndex];
    if (!step) return;
    trainingTitle.textContent = step[0];
    trainingBody.textContent = step[1];
    trainingTip.textContent = step[2];
    trainingStepCount.textContent = `${trainingStepIndex + 1} / ${trainingSteps.length}`;
    trainingProgressBar.style.width = `${((trainingStepIndex + 1) / trainingSteps.length) * 100}%`;
    document.getElementById("trainingBack").disabled = trainingStepIndex === 0;
    document.getElementById("trainingNext").textContent =
      trainingStepIndex === trainingSteps.length - 1 ? "Finish" : "Next";
    const target = document.querySelector(step[3]);
    if (target) {
      target.classList.add("training-highlight");
      try { target.scrollIntoView({behavior:"smooth", block:"nearest"}); } catch (_) {}
      requestAnimationFrame(() => positionTrainingSpotlight(target));
    } else {
      hideTrainingSpotlight();
    }
    // Always keep the training card above the highlighted page target.
    const card = trainingBackdrop?.querySelector(".training-card");
    if (card) {
      card.scrollTop = 0;
      card.focus?.({preventScroll:true});
    }
  }

  function startGuidedTraining() {
    trainingStepIndex = 0;
    clearTrainingHighlight();
    if (!trainingBackdrop) {
      showToast("Guided Training is unavailable. Refresh Mesh and try again.");
      return;
    }
    trainingBackdrop.hidden = false;
    trainingBackdrop.setAttribute("aria-hidden", "false");
    document.body.classList.add("training-open");
    document.body.style.overflow = "hidden";
    renderTrainingStep();
  }

  function closeGuidedTraining(markComplete=false) {
    clearTrainingHighlight();
    hideTrainingSpotlight();
    if (trainingBackdrop) {
      trainingBackdrop.hidden = true;
      trainingBackdrop.setAttribute("aria-hidden", "true");
    }
    document.body.classList.remove("training-open");
    document.body.style.overflow = "";
    if (markComplete) {
      localStorage.setItem(TRAINING_STORAGE_KEY, "true");
      showToast("Guided Training complete.");
    }
  }

  function refreshTrainingSpotlight() {
    if (!trainingBackdrop || trainingBackdrop.hidden) return;
    const step = trainingSteps[trainingStepIndex];
    const target = step ? document.querySelector(step[3]) : null;
    if (target) positionTrainingSpotlight(target);
  }

  window.addEventListener("resize", refreshTrainingSpotlight);
  window.addEventListener("scroll", refreshTrainingSpotlight, true);

  guidedTrainingButton?.addEventListener("click", startGuidedTraining);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && trainingBackdrop && !trainingBackdrop.hidden) {
      event.preventDefault();
      closeGuidedTraining(false);
    }
  });

  document.getElementById("trainingSkip")?.addEventListener("click", () => closeGuidedTraining(false));
  document.getElementById("trainingBack")?.addEventListener("click", () => {
    if (trainingStepIndex > 0) { trainingStepIndex -= 1; renderTrainingStep(); }
  });
  document.getElementById("trainingNext")?.addEventListener("click", () => {
    if (trainingStepIndex >= trainingSteps.length - 1) { closeGuidedTraining(true); return; }
    trainingStepIndex += 1;
    renderTrainingStep();
  });


  buddyEnabledToggle?.addEventListener("change", () => {
    buddySettings.enabled = buddyEnabledToggle.checked;
    saveBuddySettings();
    updateBuddyUi();
  });
  buddySettingsButton?.addEventListener("click", openBuddySettings);
  document.getElementById("closeBuddySettings")?.addEventListener("click", closeBuddySettings);
  buddyPopButton?.addEventListener("click", () => setBuddyFloating(!buddySettings.floating));
  buddyReturnButton?.addEventListener("click", () => setBuddyFloating(false));
  buddyAnchorHome?.addEventListener("click", () => setBuddyFloating(false));
  buddySlot?.addEventListener("click", (event) => {
    if (buddySettings.floating && event.target === buddySlot) setBuddyFloating(false);
  });
  document.getElementById("buddySaveSettings")?.addEventListener("click", () => {
    buddySettings.agentId = buddyAgentSelect.value || "";
    buddySettings.background = buddyBackgroundColor.value || "#ffffff";
    saveBuddySettings();
    closeBuddySettings();
    updateBuddyUi();
    showToast("Buddy settings saved.");
  });
  document.getElementById("buddyResetDefaults")?.addEventListener("click", () => {
    buddySettings = {...buddyDefaults, enabled:buddySettings.enabled, floating:buddySettings.floating, agentId:buddySettings.agentId, sprites:{...buddyDefaults.sprites}};
    saveBuddySettings();
    renderBuddySpriteSettings();
    buddyBackgroundColor.value = buddySettings.background;
    updateBuddyUi();
    showToast("Buddy sprites reset to Progre.");
  });
  buddyComposer?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = buddyMessageInput.value.trim();
    const agent = buddyAgent();
    if (!buddySettings.enabled) { showToast("Turn Buddy mode on first."); return; }
    if (!agent) { showToast("Assign Buddy mode to an agent first."); return; }
    if (agent.transport !== "connected") { showToast(`${agent.name}'s gateway is offline.`); return; }
    if (!text) return;
    if (selectedAgentId !== agent.id) monitorAgent(agent.id);
    buddyMessageInput.value = "";
    await new Promise((resolve) => setTimeout(resolve, 80));
    await sendDirectMessage(text);
  });

  updateBuddyUi();
  configureVoice();
  if (window.innerWidth <= 760) setMobileView("stream");
  refreshFleet();
  refreshApprovals();
  refreshFileOffers();
  renderNotificationControls();
  setInterval(refreshFleet, 5000);

  restorePersistedEnrollment();
  if (activeEnrollment) {
    renderEnrollmentStatus();
    enrollmentPollTimer = setInterval(pollEnrollmentConnection, 2000);
  }
  loadLocalRoutes();
  window.addEventListener("offline",()=>{
    if (!selectedAgentId) return;
    setRouteStatus("Offline · looking for local agent");
    void (async()=>{
      const permission=await requestLocalNetworkPermission();
      const route=await findReachableLocalRoute(selectedAgentId);
      if (!route) { setRouteStatus(permission === "denied" ? "Local network permission denied" : "Offline · local agent unavailable"); return; }
      try { await startDirectTransport(selectedAgentId,route); }
      catch (_) { setRouteStatus("Offline · direct connection failed"); }
    })();
  });
  window.addEventListener("online",()=>{ if (selectedAgentId) setRouteStatus("Network restored"); });

  if (routePolicySelect) {
    if (!["direct_preferred","direct_only","relay_allowed"].includes(currentRoutePolicy)) {
      currentRoutePolicy = "direct_preferred";
    }
    routePolicySelect.value = currentRoutePolicy;
    routePolicySelect.addEventListener("change", () => {
      currentRoutePolicy = routePolicySelect.value;
      localStorage.setItem("mesh-route-policy", currentRoutePolicy);
      const labels = {
        direct_preferred:"Direct preferred",
        direct_only:"Direct only",
        relay_allowed:"Relay allowed",
      };
      setRouteStatus(labels[currentRoutePolicy] || "Direct preferred");
      if (selectedAgentId && monitorSocket?.readyState === WebSocket.OPEN) {
        void startDirectTransport(selectedAgentId).catch((error) => {
          directRouteState = "error";
          showToast(`Route update failed: ${error?.message || error}`);
        });
      }
    });
  }

})();

