from __future__ import annotations

import json
import os
import subprocess
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any

import mesh_media_router as router

ROOT = Path.home() / ".local" / "share" / "rend" / "media-runtime"
OUT_ROOT = Path("/mnt/rend-support/runtime-artifacts/PT-2026-049B")
SCRIPTS = Path(__file__).resolve().parent / "scripts"

@dataclass(frozen=True)
class MediaResult:
    ok: bool
    role: str | None
    capability_id: str | None
    artifact: str | None
    elapsed_seconds: float
    returncode: int
    stdout: str
    stderr: str
    metadata: dict[str, Any]

def _validate_prompt(prompt: str) -> str:
    p=str(prompt or "").strip()
    if not p:
        raise ValueError("prompt_required")
    if len(p) > 1200:
        raise ValueError("prompt_too_long")
    return p

def _script_for_role(role: str) -> Path:
    mapping={
      "image_generation": SCRIPTS/"media-image-generate.py",
      "video_generation": SCRIPTS/"media-video-generate.py",
      "music_generation": SCRIPTS/"media-music-generate.py",
    }
    p=mapping.get(role)
    if p is None:
        raise KeyError(f"unsupported_media_role:{role}")
    return p

def invoke_intent(intent: str, *, prompt: str | None=None, timeout: int=1800) -> MediaResult:
    route=router.resolve_media_intent(intent)
    if route is None:
        return MediaResult(False,None,None,None,0.0,2,"","",
                           {"error":"no_unambiguous_active_media_route"})

    # Resolve again through the explicit ACTIVE/owner-approved gate immediately before execution.
    checked=router.resolve_active_role(route.role)
    if checked is None or checked.capability_id != route.capability_id:
        raise PermissionError("media_capability_not_active_or_owner_approved")

    p=_validate_prompt(prompt or intent)
    script=_script_for_role(route.role)
    if not script.is_file():
        raise FileNotFoundError(str(script))

    OUT_ROOT.mkdir(parents=True,exist_ok=True)
    stamp=time.strftime("%Y%m%d-%H%M%S")
    outdir=OUT_ROOT/f"{route.capability_id}-{stamp}"
    outdir.mkdir(parents=True,exist_ok=True)

    cmd=[
      str(Path.home()/".local/share/rend/runtimes/comfyui-rocm/bin/python")
      if route.role in {"image_generation","video_generation"}
      else str(Path.home()/".local/share/rend/runtimes/ace-step15-rocm/venv/bin/python"),
      str(script),
      "--prompt",p,
      "--output-dir",str(outdir),
    ]

    t0=time.monotonic()
    proc=subprocess.run(cmd,text=True,capture_output=True,timeout=timeout,check=False)
    elapsed=time.monotonic()-t0

    artifact=None
    meta={}
    result_file=outdir/"result.json"
    if result_file.is_file():
        try:
            meta=json.loads(result_file.read_text())
            artifact=meta.get("artifact")
        except Exception:
            meta={"error":"invalid_result_json"}

    ok=proc.returncode==0 and bool(artifact) and Path(artifact).is_file() and Path(artifact).stat().st_size>0
    return MediaResult(
      ok=ok,
      role=route.role,
      capability_id=route.capability_id,
      artifact=artifact,
      elapsed_seconds=elapsed,
      returncode=proc.returncode,
      stdout=proc.stdout[-12000:],
      stderr=proc.stderr[-12000:],
      metadata=meta,
    )
