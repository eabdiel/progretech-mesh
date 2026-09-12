from __future__ import annotations

import hashlib
import json
import os
import secrets
import threading
import time
import base64
import binascii
import hmac
import tempfile
import mimetypes
from pathlib import Path
from datetime import datetime, timezone
from functools import wraps
from typing import Any

from flask import (
    Flask,
    abort,
    jsonify,
    redirect,
    render_template,
    request,
    send_from_directory,
    send_file,
    session,
    url_for,
)
from flask_sock import Sock
from werkzeug.middleware.proxy_fix import ProxyFix


BUILD_ID = "v1-rc2-lifecycle-hardening-20260912"
PAIR_TOKEN_TTL_SECONDS = 600
DEVICE_CREDENTIAL_TTL_SECONDS = int(os.environ.get("MESH_DEVICE_CREDENTIAL_TTL_SECONDS", str(60 * 60 * 24 * 365)))
REVOKED_DEVICE_IDS: set[str] = set()

ACTIVATION_CODE_TTL_SECONDS = 900
MAX_WS_FILE_CHUNK = 256 * 1024
MAX_FILE_BYTES = int(os.environ.get("MESH_MAX_FILE_BYTES", str(20 * 1024 * 1024)))
MAX_SESSION_FILE_BYTES = int(os.environ.get("MESH_MAX_SESSION_FILE_BYTES", str(50 * 1024 * 1024)))
TRANSFER_TTL_SECONDS = int(os.environ.get("MESH_TRANSFER_TTL_SECONDS", "900"))
FILE_OFFER_TTL_SECONDS = int(os.environ.get("MESH_FILE_OFFER_TTL_SECONDS", "1800"))
MAX_ACTIVE_TRANSFERS_PER_AGENT = int(os.environ.get("MESH_MAX_ACTIVE_TRANSFERS_PER_AGENT", "3"))
TRANSFER_TEMP_ROOT = Path(os.environ.get("MESH_TRANSFER_TEMP_ROOT") or tempfile.gettempdir()) / "progretech-mesh-transfers"

SAFE_FILE_EXTENSIONS = {
    ".txt", ".md", ".json", ".yaml", ".yml", ".csv", ".log",
    ".html", ".htm", ".css", ".js", ".py", ".xml", ".pdf",
    ".png", ".jpg", ".jpeg", ".webp", ".gif", ".zip", ".tar", ".gz"
}
SENSITIVE_FILE_EXTENSIONS = {".exe", ".msi", ".bat", ".cmd", ".ps1", ".sh", ".dll", ".so", ".dylib"}

OPENCLAW_PLUGIN_PACKAGE_VERSION = "0.4.0"
OPENCLAW_PLUGIN_PACKAGE_FILENAME = "progretech-mesh-openclaw-0.4.0.tgz"
UNIVERSAL_ENROLLMENT_PROTOCOL_FILENAME = "universal-agent-enrollment-v1.json"
AGENT_ADAPTER_CATALOG_FILENAME = "agent-adapter-catalog-v1.json"
OPENCLAW_SELF_BOOTSTRAP_PLAN_FILENAME = "openclaw-self-bootstrap-plan-v1.json"
OPENCLAW_SELF_BOOTSTRAP_FILENAME = "openclaw-self-bootstrap-v1.sh"

def openclaw_plugin_package_path() -> Path:
    override = os.environ.get("MESH_OPENCLAW_PLUGIN_PACKAGE_PATH")
    if override:
        return Path(override).expanduser().resolve()
    return (Path(__file__).resolve().parent / "distribution" / OPENCLAW_PLUGIN_PACKAGE_FILENAME).resolve()

def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()

def distribution_file(name: str) -> Path:
    return (Path(__file__).resolve().parent / "distribution" / name).resolve()

def openclaw_enrollment_bootstrap_path() -> Path:
    override = os.environ.get("MESH_OPENCLAW_ENROLLMENT_BOOTSTRAP_PATH")
    if override:
        return Path(override).expanduser().resolve()
    return (
        Path(__file__).resolve().parent
        / "distribution"
        / OPENCLAW_ENROLLMENT_BOOTSTRAP_FILENAME
    ).resolve()



# Live operational state is deliberately ephemeral and process-local.
DEV_AGENT_REGISTRY: dict[str, dict[str, Any]] = {}
PAIRING_TOKENS: dict[str, dict[str, Any]] = {}
GATEWAY_SOCKETS: dict[str, Any] = {}
CLIENT_SOCKETS: dict[str, list[Any]] = {}
EVENT_BUFFERS: dict[str, list[dict[str, Any]]] = {}
FILE_OFFERS: dict[str, dict[str, Any]] = {}
FILE_DOWNLOAD_EXPECTED: dict[str, dict[str, Any]] = {}
ACTIVE_UPLOAD_TRANSFERS: dict[str, dict[str, Any]] = {}
ACTION_REQUESTS: dict[str, dict[str, Any]] = {}
SESSION_FILE_TOTALS: dict[str, int] = {}
ACTIVATION_CODES: dict[str, dict[str, Any]] = {}
LIVE_LOCK = threading.RLock()


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def unix_now() -> int:
    return int(time.time())


def fingerprint_for(agent_name: str, public_key: str, codeseal_key: str) -> str:
    payload = f"{agent_name.strip()}|{public_key.strip()}|{codeseal_key.strip()}".encode("utf-8")
    digest = hashlib.sha256(payload).hexdigest().upper()
    return ":".join(digest[i:i + 4] for i in range(0, 32, 4))


def verify_codeseal(agent_name: str, public_key: str, codeseal_key: str) -> dict[str, Any]:
    if not agent_name.strip() or not public_key.strip():
        return {"state": "invalid", "valid": False, "reason": "missing_identity_material"}

    normalized = codeseal_key.strip().upper()
    if normalized.startswith("CS-REVOKED"):
        return {"state": "revoked", "valid": False, "reason": "development_revocation_marker"}
    if normalized.startswith("CS-"):
        return {"state": "verified", "valid": True, "reason": "development_codeseal_adapter"}
    return {"state": "unsigned", "valid": False, "reason": "no_recognized_codeseal_signature"}


def seed_development_registry() -> None:
    if DEV_AGENT_REGISTRY:
        return

    examples = [
        {
            "id": "rend",
            "name": "Rend",
            "role": "Primary workstation agent",
            "public_key": "mesh-dev-rend-public-key",
            "codeseal_key": "CS-REND-DEV-001",
            "state": "offline",
            "task": "Awaiting gateway",
            "phase": "Connect the local gateway to establish live transport",
            "progress": 0,
            "model": "Unknown",
            "runtime": "—",
        },
        {
            "id": "lyra",
            "name": "Lyra",
            "role": "Content & coordination agent",
            "public_key": "mesh-dev-lyra-public-key",
            "codeseal_key": "CS-LYRA-DEV-001",
            "state": "offline",
            "task": "Awaiting gateway",
            "phase": "Not connected",
            "progress": 0,
            "model": "Unknown",
            "runtime": "—",
        },
        {
            "id": "mak",
            "name": "Mak",
            "role": "Development agent",
            "public_key": "mesh-dev-mak-public-key",
            "codeseal_key": "CS-MAK-DEV-001",
            "state": "offline",
            "task": "Awaiting gateway",
            "phase": "Not connected",
            "progress": 0,
            "model": "Unknown",
            "runtime": "—",
        },
    ]

    for item in examples:
        verification = verify_codeseal(item["name"], item["public_key"], item["codeseal_key"])
        DEV_AGENT_REGISTRY[item["id"]] = {
            **item,
            "fingerprint": fingerprint_for(item["name"], item["public_key"], item["codeseal_key"]),
            "trust_state": verification["state"],
            "trust_valid": verification["valid"],
            "trust_reason": verification["reason"],
            "enrolled_at": utcnow(),
            "transport": "not-connected",
            "last_heartbeat": None,
            "telemetry": {},
        }


def append_event(agent_id: str, event: dict[str, Any]) -> None:
    event = {
        "timestamp": event.get("timestamp") or utcnow(),
        "type": event.get("type", "event"),
        "message": event.get("message", ""),
        "payload": event.get("payload", {}),
    }
    with LIVE_LOCK:
        buffer = EVENT_BUFFERS.setdefault(agent_id, [])
        buffer.append(event)
        del buffer[:-100]


def broadcast_to_clients(agent_id: str, message: dict[str, Any]) -> None:
    payload = json.dumps(message)
    dead: list[Any] = []
    with LIVE_LOCK:
        clients = list(CLIENT_SOCKETS.get(agent_id, []))

    for ws in clients:
        try:
            ws.send(payload)
        except Exception:
            dead.append(ws)

    if dead:
        with LIVE_LOCK:
            current = CLIENT_SOCKETS.get(agent_id, [])
            CLIENT_SOCKETS[agent_id] = [ws for ws in current if ws not in dead]


def update_from_gateway(agent_id: str, message: dict[str, Any]) -> None:
    record = DEV_AGENT_REGISTRY.get(agent_id)
    if not record:
        return

    msg_type = message.get("type", "event")
    now = utcnow()

    if msg_type == "heartbeat":
        payload = message.get("payload", {})
        record.update(
            state=payload.get("state", record.get("state", "online")),
            task=payload.get("task", record.get("task", "Connected")),
            phase=payload.get("phase", record.get("phase", "Live gateway connected")),
            progress=max(0, min(100, int(payload.get("progress", record.get("progress", 0)) or 0))),
            model=payload.get("model", record.get("model", "Unknown")),
            runtime=payload.get("runtime", record.get("runtime", "—")),
            transport="connected",
            last_heartbeat=now,
            telemetry=payload.get("telemetry", {}),
        )
        append_event(agent_id, {
            "type": "heartbeat",
            "message": payload.get("message", "Heartbeat received"),
            "payload": payload,
        })
    elif msg_type == "event":
        append_event(agent_id, message)
    elif msg_type == "terminal":
        append_event(agent_id, message)
    elif msg_type == "agent_activity":
        payload = message.get("payload", {})
        channel = str(payload.get("channel", "system"))
        direction = payload.get("direction")
        state = str(payload.get("state", "active"))
        summary = message.get("message") or payload.get("summary") or "Agent activity"

        append_event(agent_id, {
            "type": "agent_activity",
            "message": summary,
            "payload": {
                **payload,
                "channel": channel,
                "direction": direction,
                "state": state,
                "read_only": True,
            },
        })
        broadcast_to_clients(agent_id, {
            "type": "agent_activity",
            "agent_id": agent_id,
            "timestamp": message.get("timestamp") or utcnow(),
            "message": summary,
            "payload": {
                **payload,
                "channel": channel,
                "direction": direction,
                "state": state,
                "read_only": True,
            },
        })
    elif msg_type == "file_offer_start":
        cleanup_expired_transfer_state()
        payload = message.get("payload", {})
        offer_id = str(payload.get("offer_id") or secrets.token_urlsafe(10))
        filename = sanitize_filename(payload.get("filename", "agent-output"))
        size = int(payload.get("size", 0) or 0)
        classification = classify_file(filename)

        if active_reverse_transfer_count(agent_id) >= MAX_ACTIVE_TRANSFERS_PER_AGENT:
            append_event(agent_id, {
                "type": "file",
                "message": f"Rejected file offer: {filename}",
                "payload": {"severity": "error", "reason": "too_many_active_transfers"},
            })
        elif size <= 0 or size > MAX_FILE_BYTES:
            append_event(agent_id, {
                "type": "file",
                "message": f"Rejected file offer: {filename}",
                "payload": {"severity": "error", "reason": "invalid_size"},
            })
        elif not classification["allowed"] and not classification["sensitive"]:
            append_event(agent_id, {
                "type": "file",
                "message": f"Rejected file offer: {filename}",
                "payload": {"severity": "error", "reason": "file_type_not_allowed"},
            })
        else:
            temp_path = transfer_temp_dir() / f"offer-{offer_id}.part"
            temp_path.write_bytes(b"")
            FILE_DOWNLOAD_EXPECTED[offer_id] = {
                "agent_id": agent_id,
                "filename": filename,
                "size": size,
                "mime": payload.get("mime", "application/octet-stream"),
                "sha256": payload.get("sha256"),
                "classification": classification,
                "created_at": utcnow(),
                "created_epoch": time.time(),
                "temp_path": str(temp_path),
                "received": 0,
                "next_index": 0,
                "hasher": hashlib.sha256(),
                "first_bytes": bytearray(),
            }
            broadcast_to_clients(agent_id, {
                "type": "file_offer_start",
                "agent_id": agent_id,
                "file": {
                    "id": offer_id,
                    "filename": filename,
                    "size": size,
                    "mime": payload.get("mime", "application/octet-stream"),
                    "classification": classification,
                },
            })

    elif msg_type == "file_offer_chunk":
        payload = message.get("payload", {})
        offer_id = str(payload.get("offer_id", ""))
        encoded = str(payload.get("content_base64", ""))
        index = int(payload.get("index", 0) or 0)
        meta = FILE_DOWNLOAD_EXPECTED.get(offer_id)

        if meta is not None:
            try:
                chunk = base64.b64decode(encoded, validate=True)
                if index != meta["next_index"]:
                    raise ValueError("chunk_sequence_mismatch")
                if len(chunk) > MAX_WS_FILE_CHUNK:
                    raise ValueError("chunk_too_large")
                if meta["received"] + len(chunk) > meta["size"]:
                    raise ValueError("transfer_overflow")

                if len(meta["first_bytes"]) < 64:
                    meta["first_bytes"].extend(chunk[: 64 - len(meta["first_bytes"])])

                with Path(meta["temp_path"]).open("ab") as handle:
                    handle.write(chunk)

                meta["hasher"].update(chunk)
                meta["received"] += len(chunk)
                meta["next_index"] += 1

                broadcast_to_clients(agent_id, {
                    "type": "file_offer_progress",
                    "agent_id": agent_id,
                    "file": {
                        "id": offer_id,
                        "filename": meta["filename"],
                        "received": meta["received"],
                        "size": meta["size"],
                    },
                })
            except Exception as exc:
                try:
                    Path(meta["temp_path"]).unlink(missing_ok=True)
                except Exception:
                    pass
                FILE_DOWNLOAD_EXPECTED.pop(offer_id, None)
                append_event(agent_id, {
                    "type": "file",
                    "message": f"Agent file transfer failed: {meta['filename']}",
                    "payload": {"severity": "error", "reason": str(exc)},
                })

    elif msg_type == "file_offer_end":
        payload = message.get("payload", {})
        offer_id = str(payload.get("offer_id", ""))
        meta = FILE_DOWNLOAD_EXPECTED.get(offer_id)
        if meta is not None:
            digest = meta["hasher"].hexdigest()
            mime_ok, mime_details = validate_mime_claim(
                meta["filename"], meta["mime"], bytes(meta["first_bytes"])
            )
            verified = (
                meta["received"] == meta["size"]
                and (not meta.get("sha256")
                     or digest.lower() == str(meta["sha256"]).lower())
                and mime_ok
            )

            if verified:
                record = {
                    "id": offer_id,
                    "agent_id": meta["agent_id"],
                    "filename": meta["filename"],
                    "size": meta["size"],
                    "mime": meta["mime"],
                    "sha256": digest,
                    "classification": meta["classification"],
                    "created_at": meta["created_at"],
                    "created_epoch": meta["created_epoch"],
                    "temp_path": meta["temp_path"],
                    "status": "ready",
                    "mime_validation": mime_details,
                }
                FILE_OFFERS[offer_id] = record
                FILE_DOWNLOAD_EXPECTED.pop(offer_id, None)

                append_event(agent_id, {
                    "type": "file_offer",
                    "message": f"Agent offered file: {meta['filename']}",
                    "payload": {
                        "offer_id": offer_id,
                        "filename": meta["filename"],
                        "size": meta["size"],
                        "sha256": digest,
                        "severity": "info",
                    },
                })
                broadcast_to_clients(agent_id, {
                    "type": "file_offer_ready",
                    "agent_id": agent_id,
                    "file": {
                        key: value for key, value in record.items()
                        if key not in {"temp_path", "created_epoch"}
                    },
                })
            else:
                try:
                    Path(meta["temp_path"]).unlink(missing_ok=True)
                except Exception:
                    pass
                FILE_DOWNLOAD_EXPECTED.pop(offer_id, None)
                append_event(agent_id, {
                    "type": "file",
                    "message": f"Agent file verification failed: {meta['filename']}",
                    "payload": {
                        "severity": "error",
                        "reason": "verification_failed",
                        "mime_validation": mime_details,
                    },
                })

    elif msg_type == "file_offer_cancel":
        payload = message.get("payload", {})
        offer_id = str(payload.get("offer_id", ""))
        meta = FILE_DOWNLOAD_EXPECTED.pop(offer_id, None)
        if meta:
            try:
                Path(meta["temp_path"]).unlink(missing_ok=True)
            except Exception:
                pass
            append_event(agent_id, {
                "type": "file",
                "message": f"Agent cancelled file transfer: {meta['filename']}",
                "payload": {"severity": "warn"},
            })
    elif msg_type == "action_result":
        payload = message.get("payload", {})
        action_id = payload.get("action_id")
        action = ACTION_REQUESTS.get(str(action_id))
        if action:
            action["status"] = payload.get("status", "completed")
            action["completed_at"] = utcnow()
        append_event(agent_id, message)
        broadcast_to_clients(agent_id, {
            "type": "action_result",
            "agent_id": agent_id,
            "message": message,
            "action": action,
        })
    else:
        append_event(agent_id, {
            "type": msg_type,
            "message": message.get("message", f"{msg_type} received"),
            "payload": message.get("payload", {}),
        })

    broadcast_to_clients(agent_id, {
        "type": "gateway_message",
        "agent_id": agent_id,
        "message": message,
        "agent": public_agent(record),
    })


def public_agent(record: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in record.items()
        if key != "codeseal_key"
    }



def send_gateway_message(agent_id: str, message: dict[str, Any]) -> tuple[bool, str | None]:
    with LIVE_LOCK:
        gateway = GATEWAY_SOCKETS.get(agent_id)

    if gateway is None:
        return False, "gateway_not_connected"

    try:
        gateway.send(json.dumps(message))
        return True, None
    except Exception:
        return False, "gateway_send_failed"




def file_extension(filename: str) -> str:
    name = str(filename or "").strip().lower()
    dot = name.rfind(".")
    return name[dot:] if dot >= 0 else ""


def sanitize_filename(filename: str) -> str:
    name = os.path.basename(str(filename or "").strip())
    safe = "".join(ch for ch in name if ch.isalnum() or ch in "._- ()")
    safe = safe.strip(" .")
    return safe[:180] or "mesh-file"


def classify_file(filename: str) -> dict[str, Any]:
    ext = file_extension(filename)
    return {
        "extension": ext,
        "sensitive": ext in SENSITIVE_FILE_EXTENSIONS,
        "allowed": ext in SAFE_FILE_EXTENSIONS or ext == "",
    }


def session_file_key() -> str:
    user = session.get("mesh_user") or {}
    return str(user.get("id") or "anonymous")


def session_file_total() -> int:
    return SESSION_FILE_TOTALS.get(session_file_key(), 0)


def add_session_file_bytes(size: int) -> None:
    key = session_file_key()
    SESSION_FILE_TOTALS[key] = SESSION_FILE_TOTALS.get(key, 0) + size


def transfer_temp_dir() -> Path:
    TRANSFER_TEMP_ROOT.mkdir(parents=True, exist_ok=True)
    return TRANSFER_TEMP_ROOT


def detect_content_signature(first_bytes: bytes) -> str | None:
    head = first_bytes[:32]
    if head.startswith(b"%PDF-"):
        return "application/pdf"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if head.startswith(b"PK\x03\x04"):
        return "application/zip"
    if head.startswith(b"\x1f\x8b"):
        return "application/gzip"
    return None


def validate_mime_claim(filename: str, claimed_mime: str, first_bytes: bytes) -> tuple[bool, dict[str, str | None]]:
    extension_guess = mimetypes.guess_type(filename)[0]
    signature = detect_content_signature(first_bytes)
    claimed = (claimed_mime or "application/octet-stream").split(";", 1)[0].strip().lower()
    reliable = {
        ".pdf": "application/pdf",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".zip": "application/zip",
        ".gz": "application/gzip",
    }
    expected = reliable.get(file_extension(filename))
    ok = True
    if expected and signature != expected:
        ok = False
    if signature and claimed not in ("application/octet-stream", signature):
        aliases = {
            "application/x-zip-compressed": "application/zip",
            "application/x-gzip": "application/gzip",
        }
        ok = aliases.get(claimed, claimed) == signature
    return ok, {
        "claimed": claimed,
        "extension_guess": extension_guess,
        "signature": signature,
        "expected": expected,
    }


def cleanup_expired_transfer_state() -> None:
    now = time.time()

    for offer_id, meta in list(FILE_DOWNLOAD_EXPECTED.items()):
        created = float(meta.get("created_epoch") or 0)
        if created and now - created > TRANSFER_TTL_SECONDS:
            try:
                Path(meta["temp_path"]).unlink(missing_ok=True)
            except Exception:
                pass
            FILE_DOWNLOAD_EXPECTED.pop(offer_id, None)

    for offer_id, meta in list(FILE_OFFERS.items()):
        created = float(meta.get("created_epoch") or 0)
        if created and now - created > FILE_OFFER_TTL_SECONDS:
            try:
                Path(meta["temp_path"]).unlink(missing_ok=True)
            except Exception:
                pass
            FILE_OFFERS.pop(offer_id, None)


def active_reverse_transfer_count(agent_id: str) -> int:
    return sum(
        1 for meta in FILE_DOWNLOAD_EXPECTED.values()
        if meta.get("agent_id") == agent_id
    )


def decode_data_url_payload(value: str) -> bytes:
    if not value or "," not in value:
        raise ValueError("invalid_data_url")
    header, encoded = value.split(",", 1)
    if ";base64" not in header:
        raise ValueError("base64_required")
    try:
        return base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("invalid_base64") from exc


def issue_action_request(agent_id: str, action_type: str, payload: dict[str, Any]) -> dict[str, Any]:
    action_id = secrets.token_urlsafe(10)
    record = {
        "id": action_id,
        "agent_id": agent_id,
        "action_type": action_type,
        "payload": payload,
        "status": "pending",
        "created_at": utcnow(),
        "approved_at": None,
        "completed_at": None,
    }
    ACTION_REQUESTS[action_id] = record
    append_event(agent_id, {
        "type": "approval",
        "message": f"Approval requested: {action_type}",
        "payload": {"action_id": action_id, **payload},
    })
    broadcast_to_clients(agent_id, {
        "type": "approval_request",
        "agent_id": agent_id,
        "action": record,
    })
    return record




def production_auth_mode() -> str:
    return os.environ.get("MESH_AUTH_MODE", "development").strip().lower()



def app_secret_key() -> str:
    """Return the Flask/session signing secret without depending on an app context."""
    return os.environ.get("SECRET_KEY", "dev-only-change-me")


def device_credential_secret() -> bytes:
    value = os.environ.get("MESH_DEVICE_CREDENTIAL_SECRET") or os.environ.get(
        "MESH_ACTIVATION_SECRET"
    ) or app_secret_key()
    return str(value).encode("utf-8")


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode((value + padding).encode("ascii"))


def issue_device_credential(agent_id: str) -> dict[str, Any]:
    issued_at = unix_now()
    expires_at = issued_at + DEVICE_CREDENTIAL_TTL_SECONDS
    device_id = secrets.token_urlsafe(18)

    payload = {
        "v": 1,
        "agent_id": agent_id,
        "device_id": device_id,
        "issued_at": issued_at,
        "expires_at": expires_at,
        "scope": "mesh-gateway",
        "mode": "plug-and-monitor",
    }
    encoded = _b64url_encode(
        json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    )
    signature = hmac.new(
        device_credential_secret(),
        encoded.encode("ascii"),
        hashlib.sha256,
    ).hexdigest()

    return {
        "credential": f"PTMDC1.{encoded}.{signature}",
        "device_id": device_id,
        "issued_at": issued_at,
        "expires_at": expires_at,
    }


def validate_device_credential(agent_id: str, credential: str) -> tuple[bool, str, dict[str, Any] | None]:
    try:
        prefix, encoded, signature = credential.split(".", 2)
        if prefix != "PTMDC1":
            return False, "device_credential_prefix_invalid", None

        expected = hmac.new(
            device_credential_secret(),
            encoded.encode("ascii"),
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(signature, expected):
            return False, "device_credential_signature_invalid", None

        payload = json.loads(_b64url_decode(encoded).decode("utf-8"))
    except Exception:
        return False, "device_credential_malformed", None

    if payload.get("agent_id") != agent_id:
        return False, "device_credential_agent_mismatch", None
    if payload.get("scope") != "mesh-gateway":
        return False, "device_credential_scope_invalid", None
    if payload.get("mode") != "plug-and-monitor":
        return False, "device_credential_mode_invalid", None
    if int(payload.get("expires_at", 0)) < unix_now():
        return False, "device_credential_expired", None
    if str(payload.get("device_id", "")) in REVOKED_DEVICE_IDS:
        return False, "device_credential_revoked", None

    return True, "ok", payload


def activation_secret() -> bytes:
    value = os.environ.get("MESH_ACTIVATION_SECRET", "")
    if not value:
        value = os.environ.get("SECRET_KEY", "dev-only-change-me")
    return value.encode("utf-8")


def activation_signature(agent_id: str, code: str, expires_at: int) -> str:
    payload = f"{agent_id}|{code}|{expires_at}".encode("utf-8")
    return hmac.new(activation_secret(), payload, hashlib.sha256).hexdigest()


def issue_activation_code(agent_id: str) -> dict[str, Any]:
    code = secrets.token_urlsafe(18)
    expires_at = unix_now() + ACTIVATION_CODE_TTL_SECONDS
    signature = activation_signature(agent_id, code, expires_at)
    record = {
        "agent_id": agent_id,
        "code": code,
        "expires_at": expires_at,
        "signature": signature,
        "used": False,
    }
    ACTIVATION_CODES[code] = record
    return record


def validate_activation_code(agent_id: str, code: str, signature: str) -> tuple[bool, str]:
    record = ACTIVATION_CODES.get(code)
    if not record:
        return False, "activation_code_not_found"
    if record["used"]:
        return False, "activation_code_used"
    if record["expires_at"] < unix_now():
        return False, "activation_code_expired"
    if record["agent_id"] != agent_id:
        return False, "activation_agent_mismatch"

    expected = activation_signature(agent_id, code, record["expires_at"])
    if not hmac.compare_digest(expected, signature):
        return False, "activation_signature_invalid"
    return True, "ok"




def deployment_tier() -> str:
    return os.environ.get("MESH_DEPLOYMENT_TIER", "development").strip().lower()


def production_configuration_status() -> dict[str, Any]:
    tier = deployment_tier()
    checks: list[dict[str, Any]] = []

    def add(name: str, ok: bool, detail: str) -> None:
        checks.append({"name": name, "ok": bool(ok), "detail": detail})

    secret_key = os.environ.get("SECRET_KEY", "")
    activation_secret_value = os.environ.get("MESH_ACTIVATION_SECRET", "")
    device_secret = os.environ.get("MESH_DEVICE_CREDENTIAL_SECRET", "")
    auth_mode = os.environ.get("MESH_AUTH_MODE", "development").strip().lower()
    identity_mode = os.environ.get("MESH_AGENT_IDENTITY_MODE", "development").strip().lower()
    codeseal_mode = os.environ.get("CODESEAL_VERIFIER_MODE", "unconfigured").strip().lower()

    add("session_secret", bool(secret_key) and secret_key != "dev-only-change-me",
        "SECRET_KEY must be supplied from production secret storage.")
    add("activation_secret", bool(activation_secret_value),
        "MESH_ACTIVATION_SECRET must be independently configured.")
    add("device_credential_secret", bool(device_secret),
        "MESH_DEVICE_CREDENTIAL_SECRET must be independently configured.")
    add("development_auth_disabled", os.environ.get("DEV_AUTH_ENABLED", "1") == "0",
        "DEV_AUTH_ENABLED must be 0 outside development.")
    add("development_agents_disabled", os.environ.get("DEV_SEED_AGENTS", "1") == "0",
        "DEV_SEED_AGENTS must be 0 outside development.")
    add("oidc_selected", auth_mode == "oidc",
        "Production user authentication must use the configured OIDC provider.")
    add("codeseal_selected", identity_mode == "codeseal",
        "Production agent identity must use CodeSeal mode.")
    add("codeseal_verifier_configured", codeseal_mode == "configured",
        "Real cryptographic CodeSeal verification must be configured.")
    add("oidc_provider_ready", os.environ.get("MESH_OIDC_READY", "0") == "1",
        "Set MESH_OIDC_READY=1 only after the real provider login/callback is tested.")
    add("codeseal_adapter_ready", os.environ.get("MESH_CODESEAL_READY", "0") == "1",
        "Set MESH_CODESEAL_READY=1 only after real signature verification is tested.")

    required = checks if tier == "production" else []
    return {
        "deployment_tier": tier,
        "ready": all(item["ok"] for item in required),
        "checks": checks,
    }


def create_app() -> Flask:
    app = Flask(__name__)
    sock = Sock(app)

    environment = os.environ.get("APP_ENV", "development").lower()
    dev_auth_default = "1" if environment == "development" else "0"
    dev_seed_default = "1" if environment == "development" else "0"

    app.config.update(
        SECRET_KEY=os.environ.get("SECRET_KEY", "dev-only-change-me"),
        ENVIRONMENT=environment,
        MESH_VERSION=os.environ.get("MESH_VERSION", "1.8.0-v1-rc2-integration1"),
        BUILD_ID=os.environ.get("BUILD_ID", BUILD_ID),
        DEV_AUTH_ENABLED=os.environ.get("DEV_AUTH_ENABLED", dev_auth_default) == "1",
        DEV_SEED_AGENTS=os.environ.get("DEV_SEED_AGENTS", dev_seed_default) == "1",
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=environment == "production",
    )

    if app.config["DEV_SEED_AGENTS"]:
        seed_development_registry()

    if os.environ.get("TRUST_PROXY_HEADERS", "1") == "1":
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_port=1)

    @app.after_request
    def add_security_headers(response):
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "same-origin")
        response.headers.setdefault(
            "Permissions-Policy",
            "camera=(), geolocation=(), payment=(), usb=()",
        )
        response.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; "
            "script-src 'self'; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: blob:; "
            "font-src 'self'; "
            "connect-src 'self' ws: wss:; "
            "media-src 'self' blob:; "
            "object-src 'none'; "
            "base-uri 'self'; "
            "frame-ancestors 'none';",
        )
        if request.is_secure:
            response.headers.setdefault(
                "Strict-Transport-Security",
                "max-age=31536000; includeSubDomains",
            )
        if request.path.startswith("/api/") or request.path.startswith("/ws/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    def require_session(view):
        @wraps(view)
        def wrapped(*args, **kwargs):
            if not session.get("mesh_user"):
                if request.path.startswith("/api/"):
                    return jsonify(ok=False, error="authentication_required"), 401
                return redirect(url_for("login", next=request.path))
            return view(*args, **kwargs)
        return wrapped

    @app.after_request
    def apply_headers(response):
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault(
            "Permissions-Policy",
            "camera=(), geolocation=(), payment=(), usb=()",
        )
        response.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; "
            "style-src 'self' 'unsafe-inline'; "
            "script-src 'self'; "
            "img-src 'self' data:; "
            "font-src 'self'; "
            "connect-src 'self' ws: wss:; "
            "object-src 'none'; "
            "base-uri 'self'; "
            "frame-ancestors 'none';",
        )
        if response.mimetype == "text/html":
            response.headers["Cache-Control"] = "no-cache, must-revalidate"
        return response

    @app.get("/login")
    def login():
        if session.get("mesh_user"):
            return redirect(url_for("index"))

        auth_mode = production_auth_mode()
        return render_template(
            "login.html",
            dev_auth_enabled=app.config["DEV_AUTH_ENABLED"],
            environment=app.config["ENVIRONMENT"],
            version=app.config["MESH_VERSION"],
            build_id=app.config["BUILD_ID"],
            auth_mode=auth_mode,
        )

    @app.post("/login/dev")
    def login_dev():
        if not app.config["DEV_AUTH_ENABLED"]:
            abort(404)
        session.clear()
        session["mesh_user"] = {
            "id": "local-edwin",
            "display_name": "Edwin",
            "auth_source": "local-development",
        }
        target = request.args.get("next") or url_for("index")
        if not target.startswith("/"):
            target = url_for("index")
        return redirect(target)

    @app.post("/logout")
    def logout():
        session.clear()
        return redirect(url_for("login"))

    @app.get("/")
    @require_session
    def index():
        return render_template(
            "index.html",
            version=app.config["MESH_VERSION"],
            environment=app.config["ENVIRONMENT"],
            build_id=app.config["BUILD_ID"],
            user=session["mesh_user"],
        )

    @app.get("/healthz")
    def healthz():
        return jsonify(
            ok=True,
            service="progretech-mesh",
            version=app.config["MESH_VERSION"],
            build=app.config["BUILD_ID"],
            timestamp=utcnow(),
        )

    @app.get("/startupz")
    def startupz():
        return jsonify(ok=True, started=True, service="progretech-mesh", timestamp=utcnow())

    @app.get("/readyz")
    def readyz():
        status = production_configuration_status()
        code = 200 if status["ready"] else 503
        return jsonify(
            ok=status["ready"],
            ready=status["ready"],
            deployment_tier=status["deployment_tier"],
            failed_checks=[
                item["name"] for item in status["checks"] if not item["ok"]
            ] if status["deployment_tier"] == "production" else [],
        ), code

    @app.get("/api/product/contract")
    @require_session
    def product_contract():
        return jsonify(
            ok=True,
            product="ProgreTech Mesh",
            integration_mode="plug-and-monitor",
            channel_isolation=True,
            supported_activity_filters=["all", "telegram", "mesh", "system"],
            guided_training=True,
            guided_training_storage="browser-local",
            workstation_access_required_for_user=False,
            cloud_operational_history=False,
            arbitrary_remote_shell=False,
            pwa=True,
        )

    @app.get("/api/activation/contract")
    @require_session
    def activation_contract():
        return jsonify(
            ok=True,
            user_workstation_access_required=False,
            enrollment_delivery="existing-agent-chat",
            agent_led_setup=True,
            reconnect="signed-local-device-credential",
            integration_mode="plug-and-monitor",
            observation="read-only",
            channel_isolation=True,
            credential_storage="agent-local",
            operational_history_storage="none",
            revocation_supported=True,
            production_revocation_registry_required=True,
        )

    @app.get("/api/identity/contract")
    @require_session
    def identity_contract():
        auth_mode = os.environ.get("MESH_AUTH_MODE", "development").strip().lower()
        agent_identity_mode = os.environ.get(
            "MESH_AGENT_IDENTITY_MODE", "development"
        ).strip().lower()
        codeseal_configured = (
            os.environ.get("CODESEAL_VERIFIER_MODE", "unconfigured").strip().lower()
            == "configured"
        )

        return jsonify(
            ok=True,
            user_auth={
                "mode": auth_mode,
                "production_ready": auth_mode == "oidc",
                "provider_specific_callback_configured": False,
            },
            agent_identity={
                "mode": agent_identity_mode,
                "production_ready": (
                    agent_identity_mode == "codeseal" and codeseal_configured
                ),
                "cryptographic_verification": (
                    agent_identity_mode == "codeseal" and codeseal_configured
                ),
                "fail_closed": agent_identity_mode == "codeseal",
            },
            trust_rule=(
                "Development identity must never be represented as production "
                "cryptographic CodeSeal verification."
            ),
        )

    @app.get("/api/notifications/contract")
    @require_session
    def notification_contract():
        return jsonify(
            ok=True,
            preference_storage="browser-local",
            browser_notifications=True,
            background_web_push=False,
            sensitive_content_in_notifications=False,
            default_categories={
                "reply": True,
                "task_complete": True,
                "approval_required": True,
                "error_blocker": True,
                "file_ready": True,
                "gateway_offline": True,
                "gateway_reconnected": True,
                "progress": False,
                "routine_status": False,
            },
        )

    @app.get("/api/runtime/contract")
    @require_session
    def runtime_contract():
        return jsonify(
            ok=True,
            protocol="mesh-message-v1",
            gateway_runtime_selection="MESH_RUNTIME_ADAPTER",
            supported_adapters=["demo", "openclaw"],
            observation_adapters=["none", "jsonl"],
            message_types=["message_request", "message_response"],
            file_context="local staged paths may be supplied to the runtime adapter",
            integration_mode="plug-and-monitor",
            channel_isolation=True,
            passive_observation=True,
        )

    @app.get("/api/auth/status")
    def auth_status():
        mode = production_auth_mode()
        return jsonify(
            ok=True,
            mode=mode,
            configured=(
                app.config["DEV_AUTH_ENABLED"]
                if mode == "development"
                else bool(os.environ.get("MESH_OIDC_ISSUER"))
            ),
            oidc_issuer=os.environ.get("MESH_OIDC_ISSUER") if mode == "oidc" else None,
        )



    @app.get("/api/distribution/openclaw/enrollment-bootstrap")
    def openclaw_enrollment_bootstrap_metadata():
        package = openclaw_enrollment_bootstrap_path()
        if not package.is_file():
            return jsonify(ok=False, error="enrollment_bootstrap_unavailable"), 503
        return jsonify(
            ok=True,
            package_id="progretech-mesh-enrollment-bootstrap",
            version=OPENCLAW_ENROLLMENT_BOOTSTRAP_VERSION,
            role="trusted-baseline",
            auto_update=False,
            filename=package.name,
            sha256=sha256_file(package),
            signature={
                "mode": os.environ.get("MESH_CODESEAL_PACKAGE_MODE", "unconfigured"),
                "codeseal_verified": False,
            },
        )

    @app.get("/api/distribution/openclaw/enrollment-bootstrap/<version>/package")
    def download_openclaw_enrollment_bootstrap(version: str):
        if version != OPENCLAW_ENROLLMENT_BOOTSTRAP_VERSION:
            return jsonify(ok=False, error="enrollment_bootstrap_version_not_found"), 404
        package = openclaw_enrollment_bootstrap_path()
        if not package.is_file():
            return jsonify(ok=False, error="enrollment_bootstrap_unavailable"), 503
        response = send_file(
            package,
            mimetype="application/gzip",
            as_attachment=True,
            download_name=package.name,
            conditional=True,
        )
        response.headers["Cache-Control"] = "public, max-age=300, immutable"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.get("/api/enrollment/protocol")
    def universal_agent_enrollment_protocol():
        path = distribution_file(UNIVERSAL_ENROLLMENT_PROTOCOL_FILENAME)
        if not path.is_file():
            return jsonify(ok=False, error="enrollment_protocol_unavailable"), 503
        return send_file(
            path,
            mimetype="application/json",
            as_attachment=False,
            conditional=True,
        )

    @app.get("/api/enrollment/adapters")
    def universal_agent_adapter_catalog():
        path = distribution_file(AGENT_ADAPTER_CATALOG_FILENAME)
        if not path.is_file():
            return jsonify(ok=False, error="adapter_catalog_unavailable"), 503
        return send_file(
            path,
            mimetype="application/json",
            as_attachment=False,
            conditional=True,
        )

    @app.get("/api/enrollment/adapters/openclaw/install-plan")
    def openclaw_self_bootstrap_plan():
        path = distribution_file(OPENCLAW_SELF_BOOTSTRAP_PLAN_FILENAME)
        if not path.is_file():
            return jsonify(ok=False, error="openclaw_install_plan_unavailable"), 503
        response = send_file(path, mimetype="application/json", as_attachment=False, conditional=True)
        response.headers["Cache-Control"] = "public, max-age=300"
        return response

    @app.get("/api/enrollment/adapters/openclaw/bootstrap")
    def openclaw_self_bootstrap_helper():
        path = distribution_file(OPENCLAW_SELF_BOOTSTRAP_FILENAME)
        if not path.is_file():
            return jsonify(ok=False, error="openclaw_bootstrap_unavailable"), 503
        response = send_file(path, mimetype="text/x-shellscript", as_attachment=False, conditional=True)
        response.headers["Cache-Control"] = "public, max-age=300"
        response.headers["X-Mesh-SHA256"] = sha256_file(path)
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.get("/api/distribution/openclaw/progretech-mesh")
    def openclaw_plugin_distribution_metadata():
        package = openclaw_plugin_package_path()
        if not package.is_file():
            return jsonify(ok=False, error="plugin_package_unavailable"), 503
        return jsonify(
            ok=True,
            package_id="progretech-mesh-openclaw",
            version=OPENCLAW_PLUGIN_PACKAGE_VERSION,
            filename=package.name,
            sha256=sha256_file(package),
            signature={
                "mode": os.environ.get("MESH_CODESEAL_PACKAGE_MODE", "unconfigured"),
                "codeseal_verified": False,
            },
        )

    @app.get("/api/distribution/openclaw/progretech-mesh/<version>/package")
    def download_openclaw_plugin_distribution(version: str):
        if version != OPENCLAW_PLUGIN_PACKAGE_VERSION:
            return jsonify(ok=False, error="plugin_version_not_found"), 404
        package = openclaw_plugin_package_path()
        if not package.is_file():
            return jsonify(ok=False, error="plugin_package_unavailable"), 503
        response = send_file(
            package,
            mimetype="application/gzip",
            as_attachment=True,
            download_name=package.name,
            conditional=True,
        )
        response.headers["Cache-Control"] = "public, max-age=300, immutable"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.post("/api/agents/<agent_id>/enrollment-message")
    @require_session
    def create_agent_enrollment_message(agent_id: str):
        record = DEV_AGENT_REGISTRY.get(agent_id)
        if not record:
            return jsonify(ok=False, error="agent_not_found"), 404
        if record.get("trust_state") != "verified":
            return jsonify(ok=False, error="verified_identity_required"), 403

        activation = issue_activation_code(agent_id)
        mesh_origin = request.host_url.rstrip("/")

        package = openclaw_plugin_package_path()
        if not package.is_file():
            return jsonify(ok=False, error="plugin_package_unavailable"), 503

        package_sha256 = sha256_file(package)
        package_url = (
            f"{mesh_origin}/api/distribution/openclaw/progretech-mesh/"
            f"{OPENCLAW_PLUGIN_PACKAGE_VERSION}/package"
        )

        envelope = {
            "type": "PROGRETECH_MESH_ENROLL",
            "version": 3,
            "mesh": mesh_origin,
            "discovery": {
                "protocol_url": f"{mesh_origin}/api/enrollment/protocol",
                "adapter_catalog_url": f"{mesh_origin}/api/enrollment/adapters",
                "preinstalled_progretech_component_required": False,
                "workstation_access_required": False,
                "agent_self_bootstrap_preferred": True,
                "runtime_hints": {
                    "openclaw": {
                        "install_plan_url": (
                            f"{mesh_origin}/api/enrollment/adapters/openclaw/install-plan"
                        ),
                        "bootstrap_helper_url": (
                            f"{mesh_origin}/api/enrollment/adapters/openclaw/bootstrap"
                        ),
                        "bootstrap_helper_sha256": "81cccfffc597bc82734713ce912c2c0d62986d8e8a5eb02e3999dc056345d3d2",
                    }
                },
            },
            "agent_id": agent_id,
            "activation_code": activation["code"],
            "activation_signature": activation["signature"],
            "expires_at": activation["expires_at"],
            "mode": "plug-and-monitor",
            "observation": "read-only",
            "conversation_scope": "mesh-independent",
            "plugin_package": {
                "package_id": "progretech-mesh-openclaw",
                "runtime": "openclaw",
                "version": OPENCLAW_PLUGIN_PACKAGE_VERSION,
                "url": package_url,
                "sha256": package_sha256,
                "signature": {
                    "mode": os.environ.get("MESH_CODESEAL_PACKAGE_MODE", "unconfigured"),
                    "codeseal_verified": False,
                },
            },
        }

        compact = base64.urlsafe_b64encode(
            json.dumps(envelope, separators=(",", ":")).encode("utf-8")
        ).decode("ascii").rstrip("=")

        human_message = (
            "ProgreTech Mesh enrollment request. "
            "Please validate and accept this request only if your local policy permits it. "
            "Do not interrupt, restart, reset, replace, or reconfigure any current work or "
            "existing conversation. Connect using passive plug-and-monitor mode and keep "
            "You are being asked by your owner to connect yourself to ProgreTech Mesh. "
            "No ProgreTech software is assumed to be preinstalled. Read the discovery URLs in "
            "the enrollment payload, inspect your own runtime and capabilities, choose the "
            "compatible adapter, and perform the installation yourself using only authority "
            "you already have. Do not interrupt current work, bypass local policy, or ask the "
            "owner to log into the workstation unless your environment truly lacks the required "
            "capability. Mesh observation must remain read-only and Mesh conversation state "
            "must remain independent from existing channels. Verify every package before "
            "installation and fail closed on verification errors. "
            f"Enrollment payload: PTM1:{compact}"
        )

        return jsonify(
            ok=True,
            agent_id=agent_id,
            request_id=activation["code"],
            expires_at=activation["expires_at"],
            expires_in=max(0, activation["expires_at"] - unix_now()),
            enrollment_message=human_message,
            payload_prefix="PTM1:",
            delivery="existing-agent-chat",
            user_workstation_access_required=False,
        )

    @app.post("/api/agents/<agent_id>/enrollment/<request_id>/cancel")
    @require_session
    def cancel_agent_enrollment(agent_id: str, request_id: str):
        activation = ACTIVATION_CODES.get(request_id)
        if not activation or activation.get("agent_id") != agent_id:
            return jsonify(ok=False, error="enrollment_not_found"), 404
        if activation.get("used"):
            return jsonify(ok=False, error="enrollment_already_used"), 409
        ACTIVATION_CODES.pop(request_id, None)
        return jsonify(ok=True, cancelled=True, agent_id=agent_id)

    @app.post("/api/agents/<agent_id>/activation-code")
    @require_session
    def create_activation_code(agent_id: str):
        record = DEV_AGENT_REGISTRY.get(agent_id)
        if not record:
            return jsonify(ok=False, error="agent_not_found"), 404
        if record.get("trust_state") != "verified":
            return jsonify(ok=False, error="verified_identity_required"), 403

        activation = issue_activation_code(agent_id)
        return jsonify(
            ok=True,
            agent_id=agent_id,
            code=activation["code"],
            signature=activation["signature"],
            expires_at=activation["expires_at"],
            bootstrap_command=(
                f'python install/mesh_agent_bootstrap.py '
                f'--mesh "{request.host_url.rstrip("/")}" '
                f'--agent "{agent_id}" '
                f'--activation-code "{activation["code"]}" '
                f'--activation-signature "{activation["signature"]}"'
            ),
        )

    @app.post("/api/activation/redeem")
    def redeem_activation_code():
        payload = request.get_json(silent=True) or {}
        agent_id = str(payload.get("agent_id", "")).strip()
        code = str(payload.get("activation_code", "")).strip()
        signature = str(payload.get("activation_signature", "")).strip()

        valid, reason = validate_activation_code(agent_id, code, signature)
        if not valid:
            return jsonify(ok=False, error=reason), 403

        activation = ACTIVATION_CODES[code]
        activation["used"] = True

        token = secrets.token_urlsafe(32)
        expires_at = unix_now() + PAIR_TOKEN_TTL_SECONDS
        with LIVE_LOCK:
            PAIRING_TOKENS[token] = {
                "agent_id": agent_id,
                "expires_at": expires_at,
                "used": False,
            }

        scheme = "wss" if request.is_secure else "ws"
        ws_url = f"{scheme}://{request.host}/ws/gateway/{agent_id}?token={token}"

        device = issue_device_credential(agent_id)

        return jsonify(
            ok=True,
            agent_id=agent_id,
            pairing_token=token,
            pairing_expires_in=PAIR_TOKEN_TTL_SECONDS,
            websocket_url=ws_url,
            device_credential=device["credential"],
            device_id=device["device_id"],
            device_credential_expires_at=device["expires_at"],
            reconnect_mode="signed-device-credential",
        )

    @app.post("/api/agents/<agent_id>/devices/<device_id>/revoke")
    @require_session
    def revoke_agent_device(agent_id: str, device_id: str):
        record = DEV_AGENT_REGISTRY.get(agent_id)
        if not record:
            return jsonify(ok=False, error="agent_not_found"), 404

        REVOKED_DEVICE_IDS.add(device_id)

        with LIVE_LOCK:
            gateway = GATEWAY_SOCKETS.get(agent_id)
        if gateway is not None:
            try:
                gateway.close()
            except Exception:
                pass

        append_event(agent_id, {
            "type": "device_revoked",
            "message": "Mesh device access revoked",
            "payload": {
                "device_id": device_id,
                "severity": "warn",
                "event_class": "identity",
            },
        })

        return jsonify(ok=True, agent_id=agent_id, device_id=device_id, revoked=True)

    @app.get("/api/session")
    @require_session
    def api_session():
        return jsonify(ok=True, user=session["mesh_user"], retention="none")

    @app.get("/api/status")
    @require_session
    def api_status():
        agents = [public_agent(a) for a in DEV_AGENT_REGISTRY.values()]
        return jsonify(
            session={
                "active": True,
                "retention": "off",
                "transport": "live-gateway",
            },
            fleet={
                "connected": sum(1 for a in agents if a["transport"] == "connected"),
                "verified": sum(1 for a in agents if a["trust_state"] == "verified"),
                "total": len(agents),
            },
            agents=agents,
        )

    @app.get("/api/agents")
    @require_session
    def list_agents():
        agents = [public_agent(a) for a in DEV_AGENT_REGISTRY.values()]
        agents.sort(key=lambda a: (a["name"].lower(), a["id"]))
        return jsonify(ok=True, storage="ephemeral-in-process", agents=agents)

    @app.post("/api/agents/enroll")
    @require_session
    def enroll_agent():
        payload = request.get_json(silent=True) or {}
        name = str(payload.get("name", "")).strip()
        role = str(payload.get("role", "ProgreTech Agent")).strip() or "ProgreTech Agent"
        public_key = str(payload.get("public_key", "")).strip()
        codeseal_key = str(payload.get("codeseal_key", "")).strip()

        if not name or not public_key:
            return jsonify(ok=False, error="name_and_public_key_required"), 400

        verification = verify_codeseal(name, public_key, codeseal_key)
        if verification["state"] in {"invalid", "revoked"}:
            return jsonify(ok=False, error="agent_identity_rejected", verification=verification), 400

        agent_id = secrets.token_hex(6)
        record = {
            "id": agent_id,
            "name": name,
            "role": role,
            "public_key": public_key,
            "codeseal_key": codeseal_key,
            "fingerprint": fingerprint_for(name, public_key, codeseal_key),
            "trust_state": verification["state"],
            "trust_valid": verification["valid"],
            "trust_reason": verification["reason"],
            "state": "offline",
            "task": "Awaiting gateway",
            "phase": "Enrollment complete · connecting agent",
            "progress": 0,
            "model": "Unknown",
            "runtime": "—",
            "enrolled_at": utcnow(),
            "transport": "not-connected",
            "last_heartbeat": None,
            "telemetry": {},
        }
        DEV_AGENT_REGISTRY[agent_id] = record
        return jsonify(ok=True, agent=public_agent(record)), 201

    @app.post("/api/agents/<agent_id>/pair-token")
    @require_session
    def create_pair_token(agent_id: str):
        record = DEV_AGENT_REGISTRY.get(agent_id)
        if not record:
            return jsonify(ok=False, error="agent_not_found"), 404
        if record.get("trust_state") != "verified":
            return jsonify(ok=False, error="verified_identity_required"), 403

        token = secrets.token_urlsafe(32)
        expires_at = unix_now() + PAIR_TOKEN_TTL_SECONDS

        with LIVE_LOCK:
            PAIRING_TOKENS[token] = {
                "agent_id": agent_id,
                "expires_at": expires_at,
                "used": False,
            }

        scheme = "wss" if request.is_secure else "ws"
        ws_url = f"{scheme}://{request.host}/ws/gateway/{agent_id}?token={token}"

        return jsonify(
            ok=True,
            agent_id=agent_id,
            token=token,
            expires_in=PAIR_TOKEN_TTL_SECONDS,
            websocket_url=ws_url,
            gateway_command=(
                f'python gateway/mesh_gateway.py --mesh "{request.host_url.rstrip("/")}" '
                f'--agent "{agent_id}" --token "{token}"'
            ),
        )

    @app.get("/api/agents/<agent_id>/events")
    @require_session
    def get_events(agent_id: str):
        if agent_id not in DEV_AGENT_REGISTRY:
            return jsonify(ok=False, error="agent_not_found"), 404
        with LIVE_LOCK:
            events = list(EVENT_BUFFERS.get(agent_id, []))
        return jsonify(ok=True, events=events)

    @app.post("/api/agents/<agent_id>/heartbeat-request")
    @require_session
    def request_heartbeat(agent_id: str):
        record = DEV_AGENT_REGISTRY.get(agent_id)
        if not record:
            return jsonify(ok=False, error="agent_not_found"), 404

        with LIVE_LOCK:
            gateway = GATEWAY_SOCKETS.get(agent_id)

        if gateway is None:
            return jsonify(ok=False, error="gateway_not_connected"), 409

        try:
            gateway.send(json.dumps({
                "type": "heartbeat_request",
                "timestamp": utcnow(),
                "requested_by": session["mesh_user"]["id"],
            }))
        except Exception:
            return jsonify(ok=False, error="gateway_send_failed"), 502

        return jsonify(ok=True, requested=True)

    @app.post("/api/agents/<agent_id>/message")
    @require_session
    def send_agent_message(agent_id: str):
        record = DEV_AGENT_REGISTRY.get(agent_id)
        if not record:
            return jsonify(ok=False, error="agent_not_found"), 404

        payload = request.get_json(silent=True) or {}
        text = str(payload.get("text", "")).strip()
        if not text:
            return jsonify(ok=False, error="message_required"), 400

        if len(text) > 4000:
            return jsonify(ok=False, error="message_too_long"), 400

        request_id = secrets.token_urlsafe(10)

        append_event(agent_id, {
            "type": "user_message",
            "message": text,
            "payload": {
                "request_id": request_id,
                "sender": session["mesh_user"]["display_name"],
            },
        })

        ok, error = send_gateway_message(agent_id, {
            "type": "message_request",
            "request_id": request_id,
            "timestamp": utcnow(),
            "payload": {
                "text": text,
                "sender": session["mesh_user"]["display_name"],
                "room": "direct",
            },
        })

        if not ok:
            return jsonify(ok=False, error=error), 409 if error == "gateway_not_connected" else 502

        broadcast_to_clients(agent_id, {
            "type": "gateway_message",
            "agent_id": agent_id,
            "message": {
                "type": "user_message",
                "timestamp": utcnow(),
                "message": text,
                "payload": {
                    "request_id": request_id,
                    "sender": session["mesh_user"]["display_name"],
                },
            },
            "agent": public_agent(record),
        })

        return jsonify(ok=True, request_id=request_id)

    @app.post("/api/rooms/group/message")
    @require_session
    def send_group_message():
        payload = request.get_json(silent=True) or {}
        text = str(payload.get("text", "")).strip()
        requested_ids = payload.get("agent_ids") or []

        if not text:
            return jsonify(ok=False, error="message_required"), 400
        if len(text) > 4000:
            return jsonify(ok=False, error="message_too_long"), 400
        if not isinstance(requested_ids, list) or not requested_ids:
            return jsonify(ok=False, error="agent_ids_required"), 400

        request_id = secrets.token_urlsafe(10)
        results = []

        for agent_id in requested_ids:
            record = DEV_AGENT_REGISTRY.get(str(agent_id))
            if not record:
                results.append({"agent_id": agent_id, "ok": False, "error": "agent_not_found"})
                continue

            append_event(str(agent_id), {
                "type": "group_message",
                "message": text,
                "payload": {
                    "request_id": request_id,
                    "sender": session["mesh_user"]["display_name"],
                },
            })

            ok, error = send_gateway_message(str(agent_id), {
                "type": "message_request",
                "request_id": request_id,
                "timestamp": utcnow(),
                "payload": {
                    "text": text,
                    "sender": session["mesh_user"]["display_name"],
                    "room": "group",
                    "participants": requested_ids,
                },
            })

            results.append({"agent_id": agent_id, "ok": ok, "error": error})

            if ok:
                broadcast_to_clients(str(agent_id), {
                    "type": "gateway_message",
                    "agent_id": str(agent_id),
                    "message": {
                        "type": "group_message",
                        "timestamp": utcnow(),
                        "message": text,
                        "payload": {
                            "request_id": request_id,
                            "sender": session["mesh_user"]["display_name"],
                        },
                    },
                    "agent": public_agent(record),
                })

        delivered = sum(1 for r in results if r["ok"])
        return jsonify(
            ok=delivered > 0,
            request_id=request_id,
            delivered=delivered,
            attempted=len(results),
            results=results,
        ), 200 if delivered > 0 else 409

    @app.get("/api/agents/<agent_id>/actions")
    @require_session
    def list_actions(agent_id: str):
        if agent_id not in DEV_AGENT_REGISTRY:
            return jsonify(ok=False, error="agent_not_found"), 404
        items = [a for a in ACTION_REQUESTS.values() if a["agent_id"] == agent_id]
        items.sort(key=lambda x: x["created_at"], reverse=True)
        return jsonify(ok=True, actions=items[:50])

    @app.post("/api/agents/<agent_id>/actions/request")
    @require_session
    def request_agent_action(agent_id: str):
        record = DEV_AGENT_REGISTRY.get(agent_id)
        if not record:
            return jsonify(ok=False, error="agent_not_found"), 404

        payload = request.get_json(silent=True) or {}
        action_type = str(payload.get("action_type", "")).strip()
        action_payload = payload.get("payload") or {}

        allowed_actions = {"request_status", "request_task_snapshot", "request_terminal_snapshot"}
        if action_type not in allowed_actions:
            return jsonify(ok=False, error="action_not_allowed"), 403

        action = issue_action_request(agent_id, action_type, action_payload)
        return jsonify(ok=True, action=action), 201

    @app.post("/api/actions/<action_id>/approve")
    @require_session
    def approve_action(action_id: str):
        action = ACTION_REQUESTS.get(action_id)
        if not action:
            return jsonify(ok=False, error="action_not_found"), 404
        if action["status"] != "pending":
            return jsonify(ok=False, error="action_not_pending"), 409

        action["status"] = "approved"
        action["approved_at"] = utcnow()

        ok, error = send_gateway_message(action["agent_id"], {
            "type": "approved_action",
            "timestamp": utcnow(),
            "payload": {
                "action_id": action["id"],
                "action_type": action["action_type"],
                "payload": action["payload"],
            },
        })

        if not ok:
            action["status"] = "approved_waiting_for_gateway"
            return jsonify(ok=False, error=error, action=action), 409

        append_event(action["agent_id"], {
            "type": "approval",
            "message": f"Approved action: {action['action_type']}",
            "payload": {"action_id": action["id"]},
        })
        return jsonify(ok=True, action=action)

    @app.post("/api/actions/<action_id>/reject")
    @require_session
    def reject_action(action_id: str):
        action = ACTION_REQUESTS.get(action_id)
        if not action:
            return jsonify(ok=False, error="action_not_found"), 404
        if action["status"] != "pending":
            return jsonify(ok=False, error="action_not_pending"), 409

        action["status"] = "rejected"
        action["completed_at"] = utcnow()
        append_event(action["agent_id"], {
            "type": "approval",
            "message": f"Rejected action: {action['action_type']}",
            "payload": {"action_id": action["id"]},
        })
        return jsonify(ok=True, action=action)

    @app.post("/api/agents/<agent_id>/files/send")
    @require_session
    def send_file_to_agent(agent_id: str):
        cleanup_expired_transfer_state()

        record = DEV_AGENT_REGISTRY.get(agent_id)
        if not record:
            return jsonify(ok=False, error="agent_not_found"), 404
        if record.get("transport") != "connected":
            return jsonify(ok=False, error="gateway_not_connected"), 409

        uploaded = request.files.get("file")
        if uploaded is None or not uploaded.filename:
            return jsonify(ok=False, error="file_required"), 400

        filename = sanitize_filename(uploaded.filename)
        classification = classify_file(filename)
        sensitive_approved = request.form.get("sensitive_approved", "false").lower() == "true"

        if classification["sensitive"] and not sensitive_approved:
            return jsonify(ok=False, error="sensitive_file_requires_approval",
                           extension=classification["extension"]), 428
        if not classification["allowed"] and not classification["sensitive"]:
            return jsonify(ok=False, error="file_type_not_allowed",
                           extension=classification["extension"]), 415

        transfer_id = secrets.token_urlsafe(10)
        hasher = hashlib.sha256()
        total = 0
        first_bytes = bytearray()
        temp_path = transfer_temp_dir() / f"upload-{transfer_id}.part"

        try:
            with temp_path.open("wb") as handle:
                while True:
                    chunk = uploaded.stream.read(MAX_WS_FILE_CHUNK)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > MAX_FILE_BYTES:
                        return jsonify(ok=False, error="file_too_large",
                                       max_bytes=MAX_FILE_BYTES), 413
                    if session_file_total() + total > MAX_SESSION_FILE_BYTES:
                        return jsonify(ok=False, error="session_file_limit_exceeded",
                                       max_bytes=MAX_SESSION_FILE_BYTES), 413
                    if len(first_bytes) < 64:
                        first_bytes.extend(chunk[: 64 - len(first_bytes)])
                    hasher.update(chunk)
                    handle.write(chunk)

            if total <= 0:
                return jsonify(ok=False, error="empty_file"), 400

            mime = uploaded.mimetype or "application/octet-stream"
            mime_ok, mime_details = validate_mime_claim(filename, mime, bytes(first_bytes))
            if not mime_ok:
                return jsonify(ok=False, error="mime_content_mismatch",
                               details=mime_details), 415

            digest = hasher.hexdigest()
            ACTIVE_UPLOAD_TRANSFERS[transfer_id] = {
                "agent_id": agent_id,
                "filename": filename,
                "size": total,
                "started_epoch": time.time(),
            }

            ok, error = send_gateway_message(agent_id, {
                "type": "file_transfer_start",
                "timestamp": utcnow(),
                "payload": {
                    "transfer_id": transfer_id,
                    "filename": filename,
                    "mime": mime,
                    "size": total,
                    "sha256": digest,
                    "sensitive": classification["sensitive"],
                },
            })
            if not ok:
                return jsonify(ok=False, error=error), 502

            sent = 0
            with temp_path.open("rb") as handle:
                index = 0
                while True:
                    chunk = handle.read(MAX_WS_FILE_CHUNK)
                    if not chunk:
                        break
                    ok, error = send_gateway_message(agent_id, {
                        "type": "file_transfer_chunk",
                        "timestamp": utcnow(),
                        "payload": {
                            "transfer_id": transfer_id,
                            "index": index,
                            "content_base64": base64.b64encode(chunk).decode("ascii"),
                        },
                    })
                    if not ok:
                        send_gateway_message(agent_id, {
                            "type": "file_transfer_cancel",
                            "timestamp": utcnow(),
                            "payload": {
                                "transfer_id": transfer_id,
                                "reason": "relay_interrupted",
                            },
                        })
                        return jsonify(ok=False, error=error), 502
                    sent += len(chunk)
                    index += 1

            ok, error = send_gateway_message(agent_id, {
                "type": "file_transfer_end",
                "timestamp": utcnow(),
                "payload": {
                    "transfer_id": transfer_id,
                    "size": sent,
                    "sha256": digest,
                },
            })
            if not ok:
                return jsonify(ok=False, error=error), 502

            add_session_file_bytes(total)
            append_event(agent_id, {
                "type": "file_transfer",
                "message": f"Sent file to agent: {filename}",
                "payload": {
                    "transfer_id": transfer_id,
                    "size": total,
                    "sha256": digest,
                    "severity": "info",
                },
            })
            return jsonify(ok=True, transfer_id=transfer_id, filename=filename,
                           size=total, sha256=digest)
        finally:
            ACTIVE_UPLOAD_TRANSFERS.pop(transfer_id, None)
            try:
                temp_path.unlink(missing_ok=True)
            except Exception:
                pass

    @app.get("/api/files/offers")
    @require_session
    def list_file_offers():
        agent_id = request.args.get("agent_id")
        items = list(FILE_OFFERS.values())
        if agent_id:
            items = [f for f in items if f["agent_id"] == agent_id]
        items.sort(key=lambda x: x["created_at"], reverse=True)
        safe_items = [{k: v for k, v in item.items() if k != "content_base64"} for item in items]
        return jsonify(ok=True, files=safe_items[:50])

    @app.get("/api/files/<offer_id>/download")
    @require_session
    def download_file_offer(offer_id: str):
        cleanup_expired_transfer_state()
        record = FILE_OFFERS.get(offer_id)
        if not record or record.get("status") != "ready":
            return jsonify(ok=False, error="file_offer_not_ready"), 404

        temp_path = Path(record["temp_path"])
        if not temp_path.exists():
            FILE_OFFERS.pop(offer_id, None)
            return jsonify(ok=False, error="file_offer_expired"), 410

        response = send_file(
            temp_path,
            mimetype=record.get("mime") or "application/octet-stream",
            as_attachment=True,
            download_name=record["filename"],
            conditional=False,
            max_age=0,
        )
        response.headers["Cache-Control"] = "no-store"
        response.call_on_close(lambda: _cleanup_download_offer(offer_id))
        return response


    def _cleanup_download_offer(offer_id: str) -> None:
        record = FILE_OFFERS.pop(offer_id, None)
        if not record:
            return
        try:
            Path(record["temp_path"]).unlink(missing_ok=True)
        except Exception:
            pass

    @app.post("/api/agents/<agent_id>/files/request-demo")
    @require_session
    def request_demo_file(agent_id: str):
        if agent_id not in DEV_AGENT_REGISTRY:
            return jsonify(ok=False, error="agent_not_found"), 404
        ok, error = send_gateway_message(agent_id, {
            "type": "demo_file_offer_request",
            "timestamp": utcnow(),
        })
        if not ok:
            return jsonify(ok=False, error=error), 409
        return jsonify(ok=True, requested=True)

    @app.post("/api/agents/<agent_id>/verify")
    @require_session
    def reverify_agent(agent_id: str):
        record = DEV_AGENT_REGISTRY.get(agent_id)
        if not record:
            return jsonify(ok=False, error="agent_not_found"), 404

        verification = verify_codeseal(
            record["name"],
            record["public_key"],
            record.get("codeseal_key", ""),
        )
        record.update(
            trust_state=verification["state"],
            trust_valid=verification["valid"],
            trust_reason=verification["reason"],
            verified_at=utcnow(),
        )
        return jsonify(ok=True, agent=public_agent(record))

    @app.delete("/api/agents/<agent_id>")
    @require_session
    def remove_agent(agent_id: str):
        if agent_id not in DEV_AGENT_REGISTRY:
            return jsonify(ok=False, error="agent_not_found"), 404
        with LIVE_LOCK:
            gateway = GATEWAY_SOCKETS.pop(agent_id, None)
            CLIENT_SOCKETS.pop(agent_id, None)
            EVENT_BUFFERS.pop(agent_id, None)
        try:
            if gateway:
                gateway.close()
        except Exception:
            pass
        removed = DEV_AGENT_REGISTRY.pop(agent_id)
        return jsonify(ok=True, removed={"id": removed["id"], "name": removed["name"]})

    @sock.route("/ws/gateway/<agent_id>")
    def gateway_socket(ws, agent_id: str):
        token = request.args.get("token", "")
        credential = request.args.get("credential", "")
        record = DEV_AGENT_REGISTRY.get(agent_id)

        if not record or record.get("trust_state") != "verified":
            ws.close(reason="untrusted_agent")
            return

        auth_mode = None
        device_payload = None

        with LIVE_LOCK:
            if credential:
                valid_device, reason, device_payload = validate_device_credential(
                    agent_id, credential
                )
                if not valid_device:
                    ws.close(reason=reason)
                    return
                auth_mode = "device_credential"
            else:
                token_record = PAIRING_TOKENS.get(token)
                if (
                    not token_record
                    or token_record["agent_id"] != agent_id
                    or token_record["used"]
                    or token_record["expires_at"] < unix_now()
                ):
                    ws.close(reason="invalid_pairing_token")
                    return
                token_record["used"] = True
                auth_mode = "pairing_token"

            GATEWAY_SOCKETS[agent_id] = ws
            record["transport"] = "connected"
            record["state"] = "online"
            record["last_heartbeat"] = utcnow()

        append_event(agent_id, {
            "type": "gateway",
            "message": "Agent gateway connected",
            "payload": {"transport": "websocket"},
        })
        broadcast_to_clients(agent_id, {
            "type": "gateway_connected",
            "agent_id": agent_id,
            "agent": public_agent(record),
        })

        try:
            ws.send(json.dumps({
                "type": "paired",
                "agent_id": agent_id,
                "timestamp": utcnow(),
                "auth_mode": auth_mode,
                "device_id": (device_payload or {}).get("device_id"),
                "integration_mode": "plug-and-monitor",
            }))

            while True:
                raw = ws.receive()
                if raw is None:
                    break
                try:
                    message = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                update_from_gateway(agent_id, message)
        finally:
            with LIVE_LOCK:
                if GATEWAY_SOCKETS.get(agent_id) is ws:
                    GATEWAY_SOCKETS.pop(agent_id, None)
                record["transport"] = "not-connected"
                record["state"] = "offline"
            append_event(agent_id, {
                "type": "gateway",
                "message": "Agent gateway disconnected",
            })
            broadcast_to_clients(agent_id, {
                "type": "gateway_disconnected",
                "agent_id": agent_id,
                "agent": public_agent(record),
            })

    @sock.route("/ws/client/<agent_id>")
    def client_socket(ws, agent_id: str):
        if not session.get("mesh_user"):
            ws.close(reason="authentication_required")
            return

        record = DEV_AGENT_REGISTRY.get(agent_id)
        if not record:
            ws.close(reason="agent_not_found")
            return

        with LIVE_LOCK:
            CLIENT_SOCKETS.setdefault(agent_id, []).append(ws)
            recent = list(EVENT_BUFFERS.get(agent_id, []))

        try:
            ws.send(json.dumps({
                "type": "snapshot",
                "agent_id": agent_id,
                "agent": public_agent(record),
                "events": recent,
            }))

            # Browser doesn't need to send commands through this socket in Phase 3.
            # Keep the connection open and accept lightweight ping messages.
            while True:
                raw = ws.receive()
                if raw is None:
                    break
                try:
                    incoming = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if incoming.get("type") == "ping":
                    ws.send(json.dumps({"type": "pong", "timestamp": utcnow()}))
        finally:
            with LIVE_LOCK:
                clients = CLIENT_SOCKETS.get(agent_id, [])
                CLIENT_SOCKETS[agent_id] = [client for client in clients if client is not ws]

    @app.get("/manifest.webmanifest")
    def manifest():
        response = send_from_directory(
            app.static_folder,
            "manifest.webmanifest",
            mimetype="application/manifest+json",
        )
        response.headers["Cache-Control"] = "no-cache"
        return response

    @app.get("/sw.js")
    def service_worker():
        response = send_from_directory(
            app.static_folder,
            "sw.js",
            mimetype="application/javascript",
        )
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        return response

    return app


app = create_app()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    debug = os.environ.get("FLASK_DEBUG", "1") == "1"
    app.run(host="0.0.0.0", port=port, debug=debug, threaded=True)
