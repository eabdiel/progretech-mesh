# ProgreTech Mesh v1 — RC1 Integration candidate 1

## Target

**Release Candidate + Customer Workflow Validation**

This is the first consolidated Mesh v1 release-candidate package.

The application frontend contains no internal development phase/revision terminology.

## Completed customer-facing work

### Connect Agent
The normal UI no longer shows a workstation command. It generates a short-lived
agent-led enrollment message for the user to send through the agent's existing chat.

The modal includes copy confirmation, expiry countdown, cancel, waiting, automatic
connection polling, connected state, and plug-and-monitor assurance.

### Channel activity
Live activity supports:

- All activity
- Telegram
- Mesh
- System & tools

### Guided Training
Guided Training is now built into Mesh and can be restarted from the top bar.

### Release candidate
All earlier foundations remain included: notifications, passive observation,
channel-isolated Mesh conversation, persistent local reconnect credentials, identity
boundaries, Cloud Run staging baseline, approvals/safe actions, bidirectional files,
transfer hardening, PWA support, and mobile/foldable responsiveness.

## Deployment

Cloud deployment remains intentionally deferred until after local release-candidate
testing. When ready, perform the Cloud Run/service/IAM/secrets/OIDC/CodeSeal/domain/DNS
setup as a separate guided activity.

## Validation documents

- `docs/RELEASE_CANDIDATE_VALIDATION.md`
- `docs/V1_PRODUCT_ACCEPTANCE.md`
- `docs/GUIDED_TRAINING.md`

## Next activity

Run the release candidate locally against a real Rend session before cloud deployment.


## RC1 Integration candidate 1

Fixed a real runtime defect in `main.py` where `device_credential_secret()` referenced
an undefined `app_secret_key()` helper.

The helper now resolves the same `SECRET_KEY` fallback used by the Flask app without
requiring a Flask application context.

No user-facing behavior was changed.


## RC2 OpenClaw integration candidate

Adds a native OpenClaw plugin observer and loopback isolated-conversation bridge. See `docs/OPENCLAW_RC2_INTEGRATION.md`. The legacy `openclaw` CLI adapter remains available only for comparison; the target adapter is `openclaw_bridge`.


## RC2 Integration 2 — agent-led bootstrap

The OpenClaw enrollment flow now defaults to `openclaw_bridge` + `openclaw_hooks` and schedules an agent-operated bootstrap that stages the plugin immediately but waits for OpenClaw to be idle before activation/restart. See `SEND_THIS_TO_REND.txt` and `docs/AGENT_LED_ENROLLMENT.md`.


## RC2 package-flow update

Mesh now serves a versioned OpenClaw plugin package itself. PTM1 v2 includes the package URL and SHA-256 pin, and the agent enrollment helper verifies and stages that package before activation. This removes the intended ZIP-transfer/workstation-login step. See `docs/PLUGIN_PACKAGE_PROTOCOL.md`.

Current package: `progretech-mesh-openclaw-0.2.0.tgz`  
SHA-256: `3e22b589fdb8409cef680e49cd2f34f4a401b9fb04a171a5c9f6f81cbd618271`

CodeSeal package verification is still a production gate and is not simulated.




## RC2 universal agent enrollment

Mesh no longer assumes an enrollment bootstrap or any other ProgreTech component is already
present on an agent. PTM1 v3 contains discovery URLs for a machine-readable enrollment protocol
and adapter catalog. The user's existing conversation with the agent is the only guaranteed
entry point.

Rend must pass the same enrollment test as a third-party agent: Telegram-only instruction,
self-discovery, self-install using existing authority, idle-safe activation, and outbound Mesh
connection with no owner workstation access.

See:
- `docs/UNIVERSAL_AGENT_ENROLLMENT.md`
- `docs/REND_UNIVERSAL_ENROLLMENT_ACCEPTANCE.md`
- `docs/ADR_UNIVERSAL_AGENT_ONBOARDING.md`


## OpenClaw self-bootstrap path

The universal enrollment catalog now exposes an executable OpenClaw installation plan plus an optional agent-run helper. No preinstalled Mesh bootstrap is assumed.

The supported managed install operation is:

`openclaw plugins install <verified-local-archive> --force --accept-capabilities`

The helper downloads/verifies while work may still be active, but refuses to invoke managed installation until OpenClaw has been idle across multiple checks.

Helper SHA-256: `3e991a4846ea397d413277b26a2d1cdf3de2e5ac379eaf3c5fcf736839862f40`

See `docs/OPENCLAW_SELF_BOOTSTRAP.md`.
