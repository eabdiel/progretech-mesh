import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { definePluginEntry } from "openclaw/plugin-sdk/core";

const PLUGIN_ID = "progretech-mesh";
const ROUTE = "/plugins/progretech-mesh/message";
const MAX_BODY_BYTES = 256 * 1024;
const MAX_EVENT_TEXT = 4000;

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
  },
});
