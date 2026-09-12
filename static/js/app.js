(() => {
  const toast = document.getElementById("toast");
  const heartbeatButton = document.getElementById("heartbeatButton");
  const meshState = document.getElementById("meshState");
  const installButton = document.getElementById("installButton");
  const composer = document.getElementById("messageComposer");
  const messageInput = document.getElementById("messageInput");

  let installPrompt = null;

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2400);
  }

  async function refreshStatus() {
    try {
      const response = await fetch("/api/status", {
        headers: { "Accept": "application/json" }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      document.getElementById("connectedCount").textContent =
        `${data.agents.length} connected`;
    } catch (error) {
      console.warn("Phase 0 status endpoint unavailable:", error);
    }
  }

  heartbeatButton?.addEventListener("click", () => {
    meshState.innerHTML = '<span class="dot"></span> Heartbeat session requested';
    showToast("Phase 0 demo: live heartbeat transport is not connected yet.");
  });

  composer?.addEventListener("submit", (event) => {
    event.preventDefault();
    const message = messageInput.value.trim();
    if (!message) return;
    showToast(`Phase 0 demo: "${message}" was not sent to an agent.`);
    messageInput.value = "";
  });

  document.querySelectorAll("[data-demo-action]").forEach((button) => {
    button.addEventListener("click", () => {
      showToast("Phase 0 UI baseline — this control will be wired in a later phase.");
    });
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

  window.addEventListener("appinstalled", () => {
    installButton.hidden = true;
    showToast("ProgreTech Mesh installed.");
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", async () => {
      try {
        await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      } catch (error) {
        console.warn("Service worker registration failed:", error);
      }
    });
  }

  refreshStatus();
})();
