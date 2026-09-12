from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen

PREFIX = "PTM1:"
EXPECTED_TYPE = "PROGRETECH_MESH_ENROLL"
EXPECTED_MODE = "plug-and-monitor"
EXPECTED_OBSERVATION = "read-only"
EXPECTED_PACKAGE_ID = "progretech-mesh-openclaw"
MAX_PACKAGE_BYTES = 8 * 1024 * 1024

HOME = Path.home()
STATE = Path(os.environ.get("MESH_AGENT_STATE_DIR", HOME / ".progretech-mesh")).expanduser()
LOG_DIR = STATE / "logs"
STATUS_FILE = STATE / "enrollment-status.json"
EXT_ROOT = Path(os.environ.get("OPENCLAW_EXTENSIONS_DIR", HOME / ".openclaw" / "extensions")).expanduser()
PLUGIN_DST = EXT_ROOT / "progretech-mesh"
OPENCLAW = Path(os.environ.get("OPENCLAW", HOME / ".openclaw" / "bin" / "openclaw")).expanduser()

LOG_DIR.mkdir(parents=True, exist_ok=True)
STATE.mkdir(parents=True, exist_ok=True)
EXT_ROOT.mkdir(parents=True, exist_ok=True)


def log(message: str) -> None:
    line = f"[{time.strftime('%Y-%m-%dT%H:%M:%S%z')}] {message}"
    print(line, flush=True)
    with (LOG_DIR / "enrollment.log").open("a", encoding="utf-8") as handle:
        handle.write(line + "\n")


def status(state: str, detail: str) -> None:
    temp = STATUS_FILE.with_suffix(".tmp")
    temp.write_text(json.dumps({
        "state": state,
        "detail": detail,
        "updated_at": time.time(),
    }, indent=2), encoding="utf-8")
    temp.replace(STATUS_FILE)
    try:
        STATUS_FILE.chmod(0o600)
    except OSError:
        pass


def decode_payload(raw: str) -> dict:
    if not raw.startswith(PREFIX):
        raise ValueError("not a Mesh enrollment payload")
    token = raw[len(PREFIX):].strip()
    pad = "=" * ((4 - len(token) % 4) % 4)
    try:
        data = json.loads(base64.urlsafe_b64decode(token + pad))
    except Exception as exc:
        raise ValueError("invalid PTM1 encoding") from exc

    if data.get("type") != EXPECTED_TYPE:
        raise ValueError("unexpected enrollment type")
    if data.get("mode") != EXPECTED_MODE:
        raise ValueError("enrollment is not plug-and-monitor")
    if data.get("observation") != EXPECTED_OBSERVATION:
        raise ValueError("enrollment is not read-only observation")
    if data.get("conversation_scope") != "mesh-independent":
        raise ValueError("Mesh conversation isolation not requested")

    expires = data.get("expires_at")
    if expires is not None:
        # Current Mesh activation endpoints remain the authoritative expiry check.
        # We retain this field for local diagnostics and reject obviously empty values.
        if not str(expires).strip():
            raise ValueError("invalid enrollment expiry")

    return data


def fetch_json(url: str, payload: dict) -> dict:
    req = Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    with urlopen(req, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_package(package: dict) -> Path:
    if package.get("package_id") != EXPECTED_PACKAGE_ID:
        raise ValueError("unexpected plugin package id")
    if package.get("runtime") != "openclaw":
        raise ValueError("plugin package runtime mismatch")

    url = str(package.get("url") or "").strip()
    parsed = urlparse(url)
    if parsed.scheme != "https" and os.environ.get("MESH_ALLOW_INSECURE_PACKAGE_URL") != "1":
        raise ValueError("plugin package URL must use HTTPS")

    expected = str(package.get("sha256") or "").lower()
    if len(expected) != 64 or any(c not in "0123456789abcdef" for c in expected):
        raise ValueError("invalid plugin package SHA-256")

    signature = package.get("signature") or {}
    if signature.get("codeseal_verified") is True:
        raise ValueError(
            "CodeSeal package verification is asserted but the baseline verifier is not installed"
        )

    req = Request(url, headers={"Accept": "application/gzip", "User-Agent": "ProgreTech-Mesh-Enrollment/1"})
    with urlopen(req, timeout=30) as response:
        length = response.headers.get("Content-Length")
        if length and int(length) > MAX_PACKAGE_BYTES:
            raise ValueError("plugin package exceeds size limit")
        data = response.read(MAX_PACKAGE_BYTES + 1)

    if len(data) > MAX_PACKAGE_BYTES:
        raise ValueError("plugin package exceeds size limit")
    actual = hashlib.sha256(data).hexdigest()
    if actual != expected:
        raise ValueError("plugin package integrity verification failed")

    temp_root = Path(tempfile.mkdtemp(prefix="mesh-enrollment-", dir=STATE))
    try:
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tf:
            members = tf.getmembers()
            for member in members:
                path = Path(member.name)
                if path.is_absolute() or ".." in path.parts or member.issym() or member.islnk() or member.isdev():
                    raise ValueError("unsafe archive member")
            tf.extractall(temp_root, members=members)

        extracted = temp_root / "progretech-mesh"
        for required in ("openclaw.plugin.json", "package.json", "index.js"):
            if not (extracted / required).is_file():
                raise ValueError(f"plugin package missing {required}")

        oc_manifest = json.loads((extracted / "openclaw.plugin.json").read_text(encoding="utf-8"))
        pkg = json.loads((extracted / "package.json").read_text(encoding="utf-8"))
        if oc_manifest.get("id") != "progretech-mesh":
            raise ValueError("plugin manifest id mismatch")
        if pkg.get("name") != "@progretech/openclaw-mesh":
            raise ValueError("plugin package name mismatch")
        if str(pkg.get("version")) != str(package.get("version")):
            raise ValueError("plugin package version mismatch")

        staged = STATE / "packages" / EXPECTED_PACKAGE_ID / str(package.get("version"))
        if staged.exists():
            shutil.rmtree(staged)
        staged.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(extracted), str(staged))
        return staged
    finally:
        shutil.rmtree(temp_root, ignore_errors=True)


def openclaw_idle() -> bool:
    try:
        proc = subprocess.run(
            [str(OPENCLAW), "sessions", "--all-agents", "--json"],
            check=False, capture_output=True, text=True, timeout=20
        )
        if proc.returncode != 0:
            return False
        data = json.loads(proc.stdout)
    except Exception:
        return False

    busy = {"running", "processing", "active", "starting", "queued", "waiting_for_tool", "tool_running"}
    for session in data.get("sessions", []):
        state = str(session.get("status") or "").strip().lower()
        if state in busy:
            return False
    return True


def wait_for_idle() -> None:
    status("waiting_for_idle", "Waiting for OpenClaw to become idle")
    time.sleep(10)
    stable = 0
    while stable < 3:
        if openclaw_idle():
            stable += 1
            log(f"idle check {stable}/3 passed")
        else:
            stable = 0
            log("OpenClaw busy or uncertain; leaving runtime untouched")
        time.sleep(5)


def install_plugin(staged: Path) -> None:
    stage = EXT_ROOT / f".progretech-mesh.stage.{os.getpid()}"
    if stage.exists():
        shutil.rmtree(stage)
    shutil.copytree(staged, stage)

    previous = EXT_ROOT / "progretech-mesh.prev"
    if previous.exists():
        shutil.rmtree(previous)
    if PLUGIN_DST.exists():
        PLUGIN_DST.replace(previous)
    stage.replace(PLUGIN_DST)


def main() -> int:
    if len(sys.argv) != 2:
        raise SystemExit("usage: mesh-enrollment-helper.py PTM1:<payload>")

    try:
        envelope = decode_payload(sys.argv[1])
        package = envelope.get("plugin_package")
        if not isinstance(package, dict):
            raise ValueError("enrollment does not contain an OpenClaw plugin package")

        mesh = str(envelope.get("mesh") or "").rstrip("/")
        if not mesh:
            raise ValueError("Mesh origin missing")

        status("fetching", "Fetching pinned Mesh OpenClaw plugin package")
        staged = fetch_package(package)
        log(f"verified plugin package {package.get('version')}")

        # Redeem only after package verification. Activation remains server-authoritative
        # for expiry/replay/cancellation checks.
        redeem = fetch_json(
            mesh + "/api/activation/redeem",
            {
                "agent_id": envelope.get("agent_id"),
                "code": envelope.get("activation_code"),
                "signature": envelope.get("activation_signature"),
            },
        )
        if not redeem.get("ok"):
            raise ValueError("Mesh enrollment redemption rejected")

        device = redeem.get("device_credential") or redeem.get("credential")
        if device:
            cred_dir = STATE / "credentials"
            cred_dir.mkdir(parents=True, exist_ok=True)
            cred = cred_dir / f"{envelope.get('agent_id')}.json"
            cred.write_text(json.dumps(device, indent=2), encoding="utf-8")
            try:
                cred.chmod(0o600)
            except OSError:
                pass

        # Staging the files does not affect the live Gateway.
        status("staged", "Plugin verified and staged; waiting for idle")
        install_plugin(staged)

        wait_for_idle()
        status("activating", "OpenClaw idle; activating Mesh plugin")

        subprocess.run(
            [str(OPENCLAW), "plugins", "enable", "progretech-mesh", "--accept-capabilities"],
            check=False, capture_output=True, text=True, timeout=30
        )

        # Check again immediately before restart.
        wait_for_idle()
        subprocess.run(
            [str(OPENCLAW), "gateway", "restart", "--wait", "30s"],
            check=True, capture_output=True, text=True, timeout=60
        )

        # Read-only verification.
        inspect = subprocess.run(
            [str(OPENCLAW), "plugins", "inspect", "progretech-mesh", "--runtime", "--json"],
            check=False, capture_output=True, text=True, timeout=30
        )
        channels = subprocess.run(
            [str(OPENCLAW), "channels", "status", "--probe"],
            check=False, capture_output=True, text=True, timeout=30
        )

        (LOG_DIR / "plugin-runtime.json").write_text(inspect.stdout + inspect.stderr, encoding="utf-8")
        (LOG_DIR / "channel-probe.txt").write_text(channels.stdout + channels.stderr, encoding="utf-8")
        status("ready", "Mesh plugin active; local verification completed")
        log("Mesh enrollment completed")
        return 0

    except Exception as exc:
        status("error", str(exc))
        log(f"ERROR: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
