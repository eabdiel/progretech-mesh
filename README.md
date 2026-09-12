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


## Automatic post-install handoff

The OpenClaw Mesh adapter is now `0.3.0`. A PTM1-directed self-bootstrap writes a one-time
pending enrollment before managed installation. When OpenClaw loads the adapter, it automatically:

- redeems the pending activation;
- persists the signed device reconnect credential;
- deletes the one-time pending activation;
- establishes the outbound Mesh WebSocket;
- forwards passive observation activity;
- reconnects automatically on later runtime starts.

No second owner instruction is required.

Plugin SHA-256: `6eeffc110a025f77745a62415394df6c21141bf9edef818584e0f78133361ccc`  
Bootstrap helper SHA-256: `538f0e09ec9a61d26fc3d0a2a45830ef83633985a789fefbbaf096fbeb566b8c`

See `docs/POST_INSTALL_HANDOFF.md`.


## Lifecycle hardening

OpenClaw adapter `0.4.0` adds bounded reconnect backoff, expiry/revocation handling, re-enrollment,
same-version idempotence, downgrade rejection, and failure isolation. Mesh credential problems
stop Mesh only and never stop OpenClaw or Telegram.

Plugin SHA-256: `19de065094abc09a4c5a70ea6c2974d0d1ce1811bcd13195abd0641a74bb7261`  
Bootstrap helper SHA-256: `81cccfffc597bc82734713ce912c2c0d62986d8e8a5eb02e3999dc056345d3d2`

See `docs/LIFECYCLE_HARDENING.md`.


## RC2 acceptance candidate

This package is ready for the first live hands-off acceptance attempt against Rend.

The reference test deliberately treats Rend as a third-party agent:
- no Mesh component is preinstalled;
- no workstation access is allowed;
- Telegram is the only human-to-agent entrypoint;
- the agent must self-discover, verify, install, enroll, and connect.

Run `python tests/rc2_acceptance_preflight.py` before a live enrollment attempt.

See:
- `docs/REND_RC2_LIVE_ACCEPTANCE_CARD.md`
- `docs/AGENT_FACING_ACCEPTANCE_INSTRUCTION.md`
- `docs/RC2_ACCEPTANCE_CHECKLIST.md`


## RC2 pre-run cleanup

Removed the obsolete trusted-enrollment-bootstrap HTTP routes and stale constant references.
The universal PTM1/self-bootstrap flow remains the only enrollment architecture.

Also:
- current RC2 build/version labels are aligned;
- Flask template/static folders are explicit;
- broad exception handlers were narrowed where the failure domain is known;
- a regression test prevents the retired bootstrap API from returning.
