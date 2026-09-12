import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { definePluginEntry } from "openclaw/plugin-sdk/core";

const PLUGIN_ID = "progretech-mesh";
const ROUTE = "/plugins/progretech-mesh/message";
const MAX_BODY_BYTES = 256 * 1024;
const MAX_EVENT_TEXT = 4000;

const STATE_DIR = process.env.PROGRETECH_MESH_STATE_DIR?.trim()
  || path.join(os.homedir(), ".progretech-mesh");
const PENDING_ENROLLMENT_PATH = path.join(STATE_DIR, "pending-enrollment.json");
const DEVICE_CREDENTIAL_PATH = path.join(STATE_DIR, "device-credential.json");
const CONNECTION_STATUS_PATH = path.join(STATE_DIR, "connection-status.json");
const LIFECYCLE_STATE_PATH = path.join(STATE_DIR, "lifecycle-state.json");
const REVOKED_MARKER_PATH = path.join(STATE_DIR, "revoked.json");


let meshSocket = null;
let meshReconnectTimer = null;
let meshIdentity = null;
let meshReconnectAttempt = 0;
let meshReconnectDisabled = false;


function ensurePrivateStateDir() {
  fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
}

function atomicWriteJson(target, value) {
  ensurePrivateStateDir();
  const temp = `${target}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temp, target);
  try { fs.chmodSync(target, 0o600); } catch {}
}

function readJsonIfPresent(target) {
  try {
    return JSON.parse(fs.readFileSync(target, "utf8"));
  } catch {
    return null;
  }
}

function readLifecycleState() {
  return readJsonIfPresent(LIFECYCLE_STATE_PATH) || {};
}

function writeLifecycleState(patch) {
  const prior = readLifecycleState();
  atomicWriteJson(LIFECYCLE_STATE_PATH, {
    ...prior,
    ...patch,
    updated_at: new Date().toISOString(),
  });
}

function markRevoked(reason, record = null) {
  meshReconnectDisabled = true;
  atomicWriteJson(REVOKED_MARKER_PATH, {
    revoked: true,
    reason: reason || "credential_revoked",
    agent_id: record?.agent_id || meshIdentity?.agent_id || null,
    device_id: record?.device_id || meshIdentity?.device_id || null,
    updated_at: new Date().toISOString(),
  });
  writeLifecycleState({
    enrollment_state: "revoked",
    reconnect_enabled: false,
    revocation_reason: reason || "credential_revoked",
  });
}

function clearRevokedMarker() {
  try { fs.unlinkSync(REVOKED_MARKER_PATH); } catch {}
  meshReconnectDisabled = false;
  writeLifecycleState({
    enrollment_state: "enrolled",
    reconnect_enabled: true,
    revocation_reason: null,
  });
}

function writeConnectionStatus(state, detail = "", extra = {}) {
  atomicWriteJson(CONNECTION_STATUS_PATH, {
    state,
    detail,
    updated_at: new Date().toISOString(),
    ...extra,
  });
}

function parseMeshOrigin(value) {
  const url = new URL(String(value || ""));
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("invalid_mesh_origin");
  if (url.protocol !== "https:" && process.env.MESH_ALLOW_INSECURE_PACKAGE_URL !== "1") {
    throw new Error("mesh_https_required");
  }
  return url.origin;
}

async function redeemPendingEnrollment() {
  const pending = readJsonIfPresent(PENDING_ENROLLMENT_PATH);
  if (!pending) return null;

  const meshOrigin = parseMeshOrigin(pending.mesh);
  writeConnectionStatus("redeeming", "Redeeming pending Mesh enrollment");

  const response = await fetch(`${meshOrigin}/api/activation/redeem`, {
    method: "POST",
    headers: { "content-type": "application/json", "accept": "application/json" },
    body: JSON.stringify({
      agent_id: pending.agent_id,
      activation_code: pending.activation_code,
      activation_signature: pending.activation_signature,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.ok) {
    throw new Error(`mesh_activation_rejected:${body?.error || response.status}`);
  }

  const record = {
    mesh: meshOrigin,
    agent_id: body.agent_id || pending.agent_id,
    websocket_url: body.websocket_url,
    device_credential: body.device_credential,
    device_id: body.device_id,
    device_credential_expires_at: body.device_credential_expires_at,
    reconnect_mode: body.reconnect_mode,
    enrolled_at: new Date().toISOString(),
  };
  atomicWriteJson(DEVICE_CREDENTIAL_PATH, record);
  clearRevokedMarker();
  writeLifecycleState({
    enrollment_state: "enrolled",
    reconnect_enabled: true,
    agent_id: record.agent_id,
    device_id: record.device_id,
    credential_expires_at: record.device_credential_expires_at || null,
    adapter_version: "0.4.0",
  });

  try { fs.unlinkSync(PENDING_ENROLLMENT_PATH); } catch {}

  writeConnectionStatus("credential_ready", "Mesh reconnect credential stored", {
    agent_id: record.agent_id,
    device_id: record.device_id,
  });
  return record;
}

function credentialWebSocketUrl(record, initialPairing = false) {
  if (initialPairing && record.websocket_url) return record.websocket_url;
  const origin = new URL(record.mesh);
  const scheme = origin.protocol === "https:" ? "wss:" : "ws:";
  const url = new URL(`${scheme}//${origin.host}/ws/gateway/${encodeURIComponent(record.agent_id)}`);
  url.searchParams.set("credential", record.device_credential);
  return url.toString();
}

function sendMeshGatewayMessage(message) {
  if (!meshSocket || meshSocket.readyState !== WebSocket.OPEN) return false;
  try {
    meshSocket.send(JSON.stringify(message));
    return true;
  } catch {
    return false;
  }
}

function heartbeatPayload() {
  return {
    type: "heartbeat",
    timestamp: new Date().toISOString(),
    payload: {
      state: "online",
      task: "Mesh connected",
      phase: "Passive monitoring active",
      progress: 100,
      model: "OpenClaw agent runtime",
      runtime: "OpenClaw",
      message: `${meshIdentity?.agent_id || "Agent"} connected to Mesh`,
      telemetry: {},
      runtime_adapter: "openclaw-plugin",
      observation_adapter: "openclaw-hooks",
      identity_mode: "enrolled-device",
    },
  };
}

function scheduleReconnect(api, explicitDelayMs = null) {
  if (meshReconnectDisabled || meshReconnectTimer) return;
  const delayMs = explicitDelayMs ?? Math.min(60000, 2000 * (2 ** Math.min(meshReconnectAttempt, 5)));
  meshReconnectAttempt += 1;
  meshReconnectTimer = setTimeout(() => {
    meshReconnectTimer = null;
    void ensureMeshConnection(api, false);
  }, delayMs);
  meshReconnectTimer.unref?.();
}

async function ensureMeshConnection(api, preferInitialPairing = true) {
  if (meshReconnectDisabled || readJsonIfPresent(REVOKED_MARKER_PATH)?.revoked) {
    writeConnectionStatus("revoked", "Mesh credential revoked; reconnect disabled");
    return;
  }
  if (typeof WebSocket === "undefined") {
    writeConnectionStatus("error", "Node WebSocket API unavailable");
    return;
  }
  if (meshSocket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(meshSocket.readyState)) return;

  let record = readJsonIfPresent(DEVICE_CREDENTIAL_PATH);
  let justRedeemed = false;
  if (!record) {
    try {
      record = await redeemPendingEnrollment();
      justRedeemed = Boolean(record);
    } catch (error) {
      writeConnectionStatus("error", error?.message || String(error));
      api.logger?.error?.(`[mesh] enrollment handoff failed: ${error?.message || String(error)}`);
      return;
    }
  }
  if (!record?.agent_id || !record?.device_credential || !record?.mesh) return;

  if (record.device_credential_expires_at) {
    const expires = Date.parse(record.device_credential_expires_at);
    if (Number.isFinite(expires) && Date.now() >= expires) {
      writeConnectionStatus("expired", "Mesh reconnect credential expired; re-enrollment required", {
        agent_id: record.agent_id,
        device_id: record.device_id,
      });
      writeLifecycleState({
        enrollment_state: "expired",
        reconnect_enabled: false,
      });
      meshReconnectDisabled = true;
      return;
    }
  }

  meshIdentity = record;
  const url = credentialWebSocketUrl(record, preferInitialPairing && justRedeemed);

  writeConnectionStatus("connecting", "Connecting outbound to Mesh", {
    agent_id: record.agent_id,
    device_id: record.device_id,
  });

  const socket = new WebSocket(url);
  meshSocket = socket;

  socket.addEventListener("open", () => {
    meshReconnectAttempt = 0;
    writeConnectionStatus("connected", "Passive monitoring connected", {
      agent_id: record.agent_id,
      device_id: record.device_id,
    });
    sendMeshGatewayMessage(heartbeatPayload());
    appendEvent({
      event_type: "gateway",
      channel: "mesh",
      state: "connected",
      direction: null,
      summary: "Mesh passive monitoring connected",
      payload: { device_id: record.device_id },
    });
  });

  socket.addEventListener("message", (event) => {
    try {
      const msg = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
      if (msg?.type === "heartbeat_request") {
        sendMeshGatewayMessage(heartbeatPayload());
      }
      if (msg?.type === "credential_revoked" || msg?.type === "device_revoked") {
        markRevoked(msg?.reason || "server_revoked", record);
        writeConnectionStatus("revoked", "Mesh credential revoked; reconnect disabled", {
          agent_id: record.agent_id,
          device_id: record.device_id,
        });
        try { socket.close(4003, "revoked"); } catch {}
      }
    } catch {}
  });

  socket.addEventListener("close", (event) => {
    if (meshSocket === socket) meshSocket = null;

    if ([4001, 4003, 4401, 4403].includes(Number(event?.code))) {
      markRevoked(`gateway_auth_${event.code}`, record);
      writeConnectionStatus("revoked", "Mesh authentication rejected; re-enrollment required", {
        agent_id: record.agent_id,
        device_id: record.device_id,
      });
      return;
    }

    writeConnectionStatus("reconnecting", "Mesh connection closed; reconnect scheduled", {
      agent_id: record.agent_id,
      device_id: record.device_id,
      reconnect_attempt: meshReconnectAttempt + 1,
    });
    scheduleReconnect(api);
  });

  socket.addEventListener("error", () => {
    // Close event owns retry scheduling.
  });
}

function eventPath() {
  const configured = process.env.PROGRETECH_MESH_EVENT_PATH?.trim();
  if (configured) return configured;

  const runtimeDir = process.env.XDG_RUNTIME_DIR?.trim();
  const base = runtimeDir && path.isAbsolute(runtimeDir)
    ? path.join(runtimeDir, "progretech-mesh")
    : path.join(os.tmpdir(), `progretech-mesh-${process.getuid?.() ?? "user"}`);
  return path.join(base, "openclaw-activity.jsonl");
}

function trimText(value, limit = MAX_EVENT_TEXT) {
  const text = typeof value === "string" ? value : value == null ? "" : String(value);
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

function safeValue(value, depth = 0) {
  if (depth > 3) return "[depth-limited]";
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return trimText(value, 1000);
  if (Array.isArray(value)) return value.slice(0, 16).map((item) => safeValue(item, depth + 1));
  if (typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value).slice(0, 32)) {
      if (/token|secret|password|credential|authorization|cookie/i.test(key)) {
        out[key] = "<redacted>";
      } else {
        out[key] = safeValue(item, depth + 1);
      }
    }
    return out;
  }
  return trimText(String(value), 500);
}

function appendEvent(event) {
  const target = eventPath();
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const row = {
    timestamp: new Date().toISOString(),
    observer: "openclaw-plugin",
    read_only: true,
    ...event,
  };
  fs.appendFileSync(target, `${JSON.stringify(row)}\n`, { encoding: "utf8", mode: 0o600 });

  if (meshSocket && meshSocket.readyState === WebSocket.OPEN) {
    try {
      meshSocket.send(JSON.stringify({
        type: "agent_activity",
        timestamp: row.timestamp,
        message: row.summary || row.event_type || "Agent activity",
        payload: {
          channel: row.channel || "system",
          direction: row.direction ?? null,
          state: row.state || "active",
          summary: row.summary || "",
          event_type: row.event_type,
          read_only: true,
          observer: row.observer,
          ...safeValue(row.payload || {}),
        },
      }));
    } catch {}
  }
}

function channelFromContext(ctx, fallback = "system") {
  return trimText(ctx?.channelId || ctx?.channel || fallback, 80).toLowerCase();
}

function sessionLooksMesh(ctx) {
  const key = String(ctx?.sessionKey || "");
  return key.includes(":mesh:") || key.startsWith("mesh:");
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw new Error("request_too_large");
    chunks.push(buf);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function isLoopback(req) {
  const address = req?.socket?.remoteAddress || "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function localTokenOk(req) {
  const expected = process.env.PROGRETECH_MESH_LOCAL_TOKEN?.trim();
  if (!expected) return true;
  const actual = String(req.headers?.["x-progretech-mesh-local-token"] || "");
  if (!actual || actual.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
  } catch {
    return false;
  }
}

function extractResultText(result) {
  const visible = result?.meta?.finalAssistantVisibleText;
  if (typeof visible === "string" && visible.trim()) return visible.trim();
  const raw = result?.meta?.finalAssistantRawText;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (Array.isArray(result?.payloads)) {
    const text = result.payloads
      .map((payload) => (typeof payload?.text === "string" ? payload.text : ""))
      .filter(Boolean)
      .join("\n")
      .trim();
    if (text) return text;
  }
  return "";
}

function stableConversationId({ agentId, room, sender }) {
  const digest = crypto
    .createHash("sha256")
    .update(`${agentId}\u0000${room}\u0000${sender}`)
    .digest("hex")
    .slice(0, 24);
  return `mesh-${agentId}-${digest}`;
}

function registerObservationHooks(api) {
  api.on("message_received", (event, ctx) => {
    appendEvent({
      event_type: "message",
      channel: channelFromContext(ctx, event?.channel || "unknown"),
      state: "received",
      direction: "input",
      summary: trimText(event?.content || "Incoming message"),
      payload: {
        session_key: ctx?.sessionKey,
        run_id: ctx?.runId,
        message_id: event?.messageId || ctx?.messageId,
        sender_id: event?.senderId || ctx?.senderId,
      },
    });
  });

  api.on("message_sent", (event, ctx) => {
    appendEvent({
      event_type: "message",
      channel: sessionLooksMesh(ctx) ? "mesh" : channelFromContext(ctx, "unknown"),
      state: "sent",
      direction: "output",
      summary: trimText(event?.content || event?.text || "Outgoing message"),
      payload: {
        session_key: ctx?.sessionKey,
        message_id: event?.messageId || ctx?.messageId,
      },
    });
  });

  api.on("model_call_started", (event, ctx) => {
    appendEvent({
      event_type: "model",
      channel: sessionLooksMesh(ctx) ? "mesh" : channelFromContext(ctx, "system"),
      state: "processing",
      direction: null,
      summary: "Model call started",
      payload: {
        session_key: ctx?.sessionKey,
        run_id: ctx?.runId,
        provider: event?.provider,
        model: event?.model || event?.modelId,
      },
    });
  });

  api.on("model_call_ended", (event, ctx) => {
    appendEvent({
      event_type: "model",
      channel: sessionLooksMesh(ctx) ? "mesh" : channelFromContext(ctx, "system"),
      state: "processing",
      direction: null,
      summary: "Model call completed",
      payload: {
        session_key: ctx?.sessionKey,
        run_id: ctx?.runId,
      },
    });
  });

  api.on("after_tool_call", (event, ctx) => {
    appendEvent({
      event_type: "tool",
      channel: sessionLooksMesh(ctx) ? "mesh" : channelFromContext(ctx, "system"),
      state: "processing",
      direction: null,
      summary: `Tool completed: ${trimText(event?.toolName || "tool", 120)}`,
      payload: {
        session_key: ctx?.sessionKey,
        run_id: ctx?.runId,
        tool_name: event?.toolName,
        // Deliberately do not mirror tool result bodies.
        error: event?.error ? trimText(event.error, 500) : undefined,
      },
    });
  });

  api.on("agent_end", (event, ctx) => {
    appendEvent({
      event_type: "agent",
      channel: sessionLooksMesh(ctx) ? "mesh" : channelFromContext(ctx, "system"),
      state: event?.error ? "error" : "idle",
      direction: null,
      summary: event?.error ? "Agent turn ended with an error" : "Agent turn completed",
      payload: {
        session_key: ctx?.sessionKey,
        run_id: ctx?.runId,
        error: event?.error ? trimText(event.error, 500) : undefined,
      },
    });
  });
}

function registerConversationBridge(api) {
  api.registerHttpRoute({
    path: ROUTE,
    auth: "plugin",
    handler: async (req, res) => {
      try {
        if (!isLoopback(req)) {
          res.statusCode = 403;
          res.end("loopback_only");
          return true;
        }
        if (!localTokenOk(req)) {
          res.statusCode = 401;
          res.end("unauthorized");
          return true;
        }
        if (String(req.method || "POST").toUpperCase() !== "POST") {
          res.statusCode = 405;
          res.end("method_not_allowed");
          return true;
        }

        const body = await readJsonBody(req);
        const agentId = trimText(body.agent_id || "rend", 80);
        const text = trimText(body.text || "", 32000);
        const room = trimText(body.room || "direct", 120);
        const sender = trimText(body.sender || "Mesh user", 200);
        if (!text.trim()) throw new Error("empty_message");

        const sessionId = stableConversationId({ agentId, room, sender });
        const sessionKey = `agent:${agentId}:mesh:${sessionId}`;
        const runId = crypto.randomUUID();

        appendEvent({
          event_type: "message",
          channel: "mesh",
          state: "received",
          direction: "input",
          summary: text,
          payload: { session_key: sessionKey, run_id: runId },
        });

        const result = await api.runtime.agent.runEmbeddedAgent({
          agentId,
          sessionId,
          sessionKey,
          runId,
          prompt: text,
        });

        const responseText = extractResultText(result);
        appendEvent({
          event_type: "message",
          channel: "mesh",
          state: "sent",
          direction: "output",
          summary: responseText || "Mesh agent turn completed",
          payload: { session_key: sessionKey, run_id: runId },
        });

        res.statusCode = 200;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(JSON.stringify({
          ok: true,
          text: responseText,
          session_id: sessionId,
          session_key: sessionKey,
          run_id: runId,
        }));
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        appendEvent({
          event_type: "bridge",
          channel: "mesh",
          state: "error",
          direction: null,
          summary: "Mesh conversation bridge error",
          payload: { error: trimText(message, 500) },
        });
        res.statusCode = 500;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ ok: false, error: message }));
        return true;
      }
    },
  });
}

export default definePluginEntry({
  id: PLUGIN_ID,
  name: "ProgreTech Mesh",
  description: "Passive OpenClaw observation plus isolated Mesh conversation bridge.",
  register(api) {
    registerObservationHooks(api);
    registerConversationBridge(api);
    writeLifecycleState({
      adapter_version: "0.4.0",
      runtime: "openclaw",
      observation_mode: "read-only",
      conversation_scope: "mesh-independent",
    });

    queueMicrotask(() => {
      void ensureMeshConnection(api, true);
    });

    api.on("gateway_start", () => {
      void ensureMeshConnection(api, false);
    });

    api.on("gateway_stop", () => {
      if (meshReconnectTimer) {
        clearTimeout(meshReconnectTimer);
        meshReconnectTimer = null;
      }
      if (meshSocket) {
        try { meshSocket.close(); } catch {}
        meshSocket = null;
      }
    });
  },
});
