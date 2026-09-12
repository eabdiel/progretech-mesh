# ProgreTech Mesh — Phase 0 Flask/PWA Baseline

This package is the initial executable baseline for **ProgreTech Mesh**.

It preserves the approved home-screen direction while establishing a project structure that can be developed locally and later deployed to Google Cloud Run.

## What is included

- Flask application executable directly through `main.py`
- Responsive desktop, phone, and foldable UI
- PWA manifest and service worker
- 192px and 512px application icons
- PWA install prompt support
- Mock `/api/status` fleet endpoint
- `/healthz` liveness endpoint
- `/readyz` readiness endpoint
- Cloud Run-compatible `PORT` handling
- Gunicorn production entrypoint
- Dockerfile running as a non-root user
- `.dockerignore`, `.gcloudignore`, and `.gitignore`
- Basic security headers
- Cloud Run deployment helper
- Local smoke-test helper

## Deliberate Phase 0 limitations

Nothing in this package connects to Rend, Lyra, Mak, OpenClaw, terminals, microphones, CodeSeal, identity providers, or remote workstations yet.

The displayed fleet/activity information is mock data.

The PWA service worker caches **only the application shell**. Paths under `/api/` and health endpoints are network-only so live agent state will not accidentally become persistent browser-cache data.

The terminal is display-only.

These boundaries are intentional.

## Local start

### Windows PowerShell

```powershell
py -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python main.py
```

### Linux/macOS

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python main.py
```

Open:

`http://127.0.0.1:8080`

The Flask development server is used only when launching `main.py` directly.

## Production-like local start

Linux/macOS:

```bash
export PORT=8080
gunicorn --bind ":${PORT}" --workers 1 --threads 8 --timeout 0 main:app
```

For Windows development, continue to use `python main.py`. The production container uses Gunicorn inside Linux.

## Docker

```bash
docker build -t progretech-mesh .
docker run --rm -p 8080:8080 -e PORT=8080 progretech-mesh
```

Then open `http://127.0.0.1:8080`.

## Smoke test

```bash
./scripts/smoke-test.sh
```

or:

```bash
curl http://127.0.0.1:8080/healthz
curl http://127.0.0.1:8080/readyz
```

## Cloud Run preparation

The container listens on the `PORT` environment variable supplied by Cloud Run.

A deployment helper is included:

```bash
export PROJECT_ID="your-project-id"
export REGION="us-east1"
./scripts/deploy-cloud-run.sh
```

The script intentionally does **not** add `--allow-unauthenticated`. Mesh is intended to gain its own authenticated application experience, so public/private Cloud Run IAM should be chosen deliberately rather than being hard-coded into the baseline.

The intended public product hostname remains:

`mesh.progretech.com`

Custom-domain routing is intentionally outside Phase 0.

## Current project structure

```text
progretech-mesh-phase0/
├── main.py
├── requirements.txt
├── Dockerfile
├── README.md
├── .env.example
├── .gitignore
├── .dockerignore
├── .gcloudignore
├── templates/
│   └── index.html
├── static/
│   ├── manifest.webmanifest
│   ├── sw.js
│   ├── css/
│   │   └── app.css
│   ├── js/
│   │   └── app.js
│   └── icons/
│       ├── icon-192.png
│       └── icon-512.png
└── scripts/
    ├── deploy-cloud-run.sh
    └── smoke-test.sh
```

## Planned next layers

The baseline is structured so later phases can add these without replacing the front end:

1. Authentication and user sessions
2. Signed-agent enrollment and CodeSeal verification
3. Ephemeral live session broker
4. Heartbeat/event protocol
5. Individual agent messaging
6. Group rooms
7. Voice/WebRTC layer
8. Read-only terminal/event mirrors
9. Policy-gated actions
10. Customer-owned agent enrollment

The core architectural rule remains: **Mesh is the console, not the agent runtime or memory store.**
