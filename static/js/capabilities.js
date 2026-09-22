(() => {
  const grid = document.getElementById("capGrid");
  const search = document.getElementById("capSearch");
  const agent = document.getElementById("capAgent");
  const state = document.getElementById("capState");
  const dialog = document.getElementById("capDialog");
  const detail = document.getElementById("capDetail");
  let items = [];

  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[ch]));

  async function loadLiveProvider() {
    const status = document.getElementById("liveProviderStatus");
    if (!status) return;
    try {
      const agentsRes = await fetch("/api/agents", {credentials:"same-origin"});
      const agentsBody = await agentsRes.json();
      const connected = (agentsBody.agents || []).find(a =>
        a.transport === "connected" && String(a.name || "").toLowerCase() === "rend"
      ) || (agentsBody.agents || []).find(a => a.transport === "connected");
      if (!connected) {
        status.textContent = "No connected agent is currently reporting a host capability provider.";
        return;
      }

      const providerRes = await fetch(`/api/agents/${encodeURIComponent(connected.id)}/capability-provider`, {credentials:"same-origin"});
      const body = await providerRes.json();
      if (!providerRes.ok || !body.ok) {
        status.textContent = `${connected.name} is connected, but no capability-provider snapshot has been reported yet.`;
        return;
      }

      const provider = body.capability_provider || {};
      const healthRows = provider.health?.capabilities || [];
      const available = healthRows.filter(row => row.available).length;
      const total = (provider.capabilities || []).length || healthRows.length;
      status.textContent = `${connected.name} · ${provider.name || provider.provider_id || "provider"} · ${available}/${total} capabilities available · ${provider.scope || "agent-local"}`;
    } catch (error) {
      status.textContent = `Live provider status unavailable: ${error.message}`;
    }
  }

  async function activateQualifiedCapability(item) {
    if (!item || item.state !== "QUALIFIED") return;

    const approved = window.confirm(
      `Activate capability?\n\n${item.name}\n\nThis records explicit owner approval and moves the capability from QUALIFIED to ACTIVE.`
    );
    if (!approved) return;

    const response = await fetch(
      `/api/capability-registry/${encodeURIComponent(item.id)}/transition`,
      {
        method: "POST",
        credentials: "same-origin",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          target: "ACTIVE",
          reason: "Explicit owner approval from Mesh capability control plane.",
          owner_approved: true
        })
      }
    );
    const body = await response.json();
    if (!response.ok || !body.ok) {
      window.alert(`Activation failed: ${body.error || response.status}`);
      return;
    }

    await loadRegistryState();
    window.alert(`${item.name} is now ACTIVE.`);
  }

  async function loadRegistryState() {
    try {
      const response = await fetch("/api/capability-registry", {credentials:"same-origin"});
      const body = await response.json();
      if (!response.ok || !body.ok) return;
      const byId = new Map((body.capabilities || []).map(item => [item.id, item]));
      items = items.map(item => {
        const durable = byId.get(item.id);
        if (!durable) return item;
        return {...item, state: durable.state, version: durable.pin?.version || item.version, source: durable.pin?.source || item.source, license: durable.pin?.license || item.license, pinned_commit: durable.pin?.commit || null, qualification: durable.qualification || null};
      });
      render();
    } catch (_) {}
  }

  async function load() {
    const [listRes, sumRes] = await Promise.all([
      fetch("/api/capabilities", {credentials:"same-origin"}),
      fetch("/api/capabilities/summary", {credentials:"same-origin"})
    ]);
    const list = await listRes.json();
    const summary = await sumRes.json();
    if (!list.ok) throw new Error(list.error || "capability_list_failed");
    items = list.capabilities || [];
    document.getElementById("sumTotal").textContent = summary.total ?? "—";
    document.getElementById("sumQualified").textContent = summary.qualified ?? "—";
    document.getElementById("sumCandidates").textContent = summary.candidates ?? "—";
    document.getElementById("sumHealth").textContent = summary.health_checked ?? "—";
    render();
    await loadLiveProvider();
    await loadRegistryState();
  }

  function matches(item) {
    const q = search.value.trim().toLowerCase();
    if (agent.value && !(item.supported_agents || []).includes(agent.value)) return false;
    if (state.value && item.state !== state.value) return false;
    if (!q) return true;
    return [item.name,item.classification,item.intended_use,item.source,...(item.supported_agents||[])]
      .join(" ").toLowerCase().includes(q);
  }

  function render() {
    const filtered = items.filter(matches);
    grid.innerHTML = filtered.length ? filtered.map(item => `
      <article class="cap-card" tabindex="0" data-id="${esc(item.id)}">
        <div class="cap-card-head">
          <div><h2>${esc(item.name)}</h2><div class="cap-class">${esc(item.classification)}</div></div>
          <span class="cap-state">${esc(item.state)}</span>
        </div>
        <p class="cap-use">${esc(item.intended_use)}</p>
        <div class="cap-meta">
          ${(item.supported_agents||[]).map(a=>`<span class="cap-chip">${esc(a)}</span>`).join("")}
          <span class="cap-chip">health: ${esc(item.health)}</span>
          <span class="cap-chip">${esc(item.version)}</span>
        </div>
        ${item.state === "QUALIFIED"
          ? `<button type="button" class="cap-activate" data-activate="${esc(item.id)}">Activate</button>`
          : item.state === "ACTIVE"
            ? `<div class="cap-active-note">ACTIVE · owner approved</div>`
            : ""}
      </article>`).join("") : `<p>No capabilities match the current filters.</p>`;

    grid.querySelectorAll(".cap-card").forEach(card => {
      const open = () => showDetail(items.find(i => i.id === card.dataset.id));
      card.addEventListener("click", (event) => {
        if (event.target.closest("[data-activate]")) return;
        open();
      });
      card.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }});
    });

    grid.querySelectorAll("[data-activate]").forEach(button => {
      button.addEventListener("click", async (event) => {
        event.stopPropagation();
        const item = items.find(i => i.id === button.dataset.activate);
        await activateQualifiedCapability(item);
      });
    });
  }

  function showDetail(item) {
    if (!item) return;
    const fields = [
      ["State", item.state],["Classification", item.classification],["Source", item.source],
      ["Version", item.version],["Pinned commit", item.pinned_commit],["License", item.license],["Agents",(item.supported_agents||[]).join(", ")],
      ["Authority", item.authority_boundary],["Network",item.network],["Data egress",item.data_egress],
      ["Filesystem",item.filesystem],["Subprocess",item.subprocess],["Compute",item.compute],
      ["Credentials",item.credentials],["Health",item.health],["Rollback",item.rollback],["Notes",item.notes]
    ];
    detail.innerHTML = `<p class="cap-eyebrow">Capability record</p><h1>${esc(item.name)}</h1>
      <p>${esc(item.intended_use)}</p><dl class="cap-detail-grid">${
      fields.map(([k,v])=>`<dt>${esc(k)}</dt><dd>${esc(v || "—")}</dd>`).join("")}</dl>`;
    dialog.showModal();
  }

  [search, agent, state].forEach(el => el.addEventListener("input", render));
  load().catch(err => {
    grid.innerHTML = `<p>Capability registry unavailable: ${esc(err.message)}</p>`;
  });
})();
