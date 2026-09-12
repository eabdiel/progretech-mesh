from __future__ import annotations

import os
from datetime import datetime, timezone

from flask import Flask, jsonify, render_template, send_from_directory
from werkzeug.middleware.proxy_fix import ProxyFix


def create_app() -> Flask:
    app = Flask(__name__)

    app.config.update(
        SECRET_KEY=os.environ.get("SECRET_KEY", "dev-only-change-me"),
        ENVIRONMENT=os.environ.get("APP_ENV", "development"),
        MESH_VERSION=os.environ.get("MESH_VERSION", "0.0.1-phase0"),
    )

    # Cloud Run terminates TLS before forwarding traffic to the container.
    # ProxyFix lets Flask correctly interpret forwarded scheme/host metadata.
    if os.environ.get("TRUST_PROXY_HEADERS", "1") == "1":
        app.wsgi_app = ProxyFix(
            app.wsgi_app,
            x_for=1,
            x_proto=1,
            x_host=1,
            x_port=1,
        )

    @app.after_request
    def apply_security_headers(response):
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault(
            "Permissions-Policy",
            "camera=(), geolocation=(), payment=(), usb=()"
        )
        # CSP intentionally allows the app's own inline style during Phase 0.
        # We will tighten this when CSS/JS modularization is finalized.
        response.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; "
            "style-src 'self' 'unsafe-inline'; "
            "script-src 'self'; "
            "img-src 'self' data:; "
            "font-src 'self'; "
            "connect-src 'self'; "
            "object-src 'none'; "
            "base-uri 'self'; "
            "frame-ancestors 'none';"
        )
        return response

    @app.get("/")
    def index():
        return render_template(
            "index.html",
            version=app.config["MESH_VERSION"],
            environment=app.config["ENVIRONMENT"],
        )

    @app.get("/healthz")
    def healthz():
        return jsonify(
            ok=True,
            service="progretech-mesh",
            version=app.config["MESH_VERSION"],
            timestamp=datetime.now(timezone.utc).isoformat(),
        )

    @app.get("/readyz")
    def readyz():
        # Phase 0 has no external dependencies.
        # Later phases can include dependency checks without making /healthz expensive.
        return jsonify(ok=True, ready=True)

    @app.get("/api/status")
    def api_status():
        # Mock fleet state for the Phase 0 UI only.
        # Future phases replace this with authenticated, ephemeral agent sessions.
        return jsonify(
            session={
                "active": True,
                "retention": "off",
                "transport": "phase0-demo",
            },
            agents=[
                {
                    "id": "rend",
                    "name": "Rend",
                    "role": "Primary workstation agent",
                    "state": "working",
                    "signed": True,
                    "task": "Autonomous recovery validation",
                    "phase": "Phase 4 · applying teacher-guided recovery",
                    "progress": 72,
                    "model": "Local senior",
                    "runtime": "00:18:42",
                },
                {
                    "id": "lyra",
                    "name": "Lyra",
                    "role": "Content & coordination agent",
                    "state": "online",
                    "signed": True,
                    "task": "Reviewing team knowledge backlog",
                    "phase": "2 recommendations ready for review",
                    "progress": 48,
                    "model": "Local worker",
                    "runtime": "00:07:14",
                },
                {
                    "id": "mak",
                    "name": "Mak",
                    "role": "Development agent",
                    "state": "idle",
                    "signed": True,
                    "task": "Available",
                    "phase": "No active task · last seen 2 min ago",
                    "progress": 8,
                    "model": "Standby",
                    "runtime": "0 tasks",
                },
            ],
        )

    @app.get("/manifest.webmanifest")
    def manifest():
        return send_from_directory(
            app.static_folder,
            "manifest.webmanifest",
            mimetype="application/manifest+json",
        )

    @app.get("/sw.js")
    def service_worker():
        response = send_from_directory(
            app.static_folder,
            "sw.js",
            mimetype="application/javascript",
        )
        response.headers["Cache-Control"] = "no-cache"
        return response

    return app


app = create_app()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    debug = os.environ.get("FLASK_DEBUG", "1") == "1"
    app.run(host="0.0.0.0", port=port, debug=debug)
