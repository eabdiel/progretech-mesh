import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const PLUGIN_ID = "progretech-mesh-enrollment";
const PREFIX = "PTM1:";
const running = new Set();

function extractEnrollment(content) {
  if (typeof content !== "string") return null;
  const idx = content.indexOf(PREFIX);
  if (idx < 0) return null;
  const rest = content.slice(idx).trim();
  const match = rest.match(/^PTM1:([A-Za-z0-9_-]+)/);
  return match ? `PTM1:${match[1]}` : null;
}

function shouldHandle(event) {
  const channel = String(event?.channel || "").toLowerCase();
  if (!["telegram", "mesh"].includes(channel)) return false;

  // Enrollment is accepted only from an owner-authorized inbound message.
  // OpenClaw's inbound_claim event supplies both senderIsOwner and
  // commandAuthorized. Requiring one of these prevents arbitrary DM senders
  // from provisioning Mesh.
  if (event?.senderIsOwner !== true && event?.commandAuthorized !== true) {
    return false;
  }

  if (event?.isGroup === true) return false;
  return true;
}

function runEnrollment(payload, api) {
  if (running.has(payload)) return;
  running.add(payload);

  const here = path.dirname(fileURLToPath(import.meta.url));
  const helper = path.join(here, "mesh-enrollment-helper.py");
  const child = spawn("python3", [helper, payload], {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      MESH_ENROLLMENT_SOURCE: "openclaw-inbound",
    },
  });
  child.unref();

  setTimeout(() => running.delete(payload), 60_000).unref?.();
  api.logger?.info?.("[mesh-enrollment] enrollment helper scheduled");
}

export default {
  id: PLUGIN_ID,
  name: "ProgreTech Mesh Enrollment",
  description: "Trusted baseline Mesh enrollment recognizer",
  register(api) {
    api.on("inbound_claim", (event) => {
      try {
        if (!shouldHandle(event)) return;
        const payload = extractEnrollment(event?.content || event?.body || "");
        if (!payload) return;
        runEnrollment(payload, api);
      } catch (error) {
        api.logger?.error?.(`[mesh-enrollment] ${error?.message || String(error)}`);
      }
    });
  },
};
