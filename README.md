# ProgreTech Mesh v1 — RC1 Integration candidate 1

## Target

**Release Candidate + Customer Workflow Validation**

This is the first consolidated Mesh v1 release-candidate package.

The application frontend contains no internal development phase/revision terminology.

## Completed customer-facing work

### Connect Agent
The normal UI no longer shows a workstation command. It generates a user-controlled
agent-led enrollment message for the user to send through the agent's existing chat.

The modal includes copy confirmation, explicit cancel, active/waiting state, automatic
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


## Universal website-prompt enrollment

The website-generated enrollment message is the only required bootstrap input. No ProgreTech software, PTM1 recognizer, or Mesh plugin is assumed to be preinstalled. The agent decodes PTM1, reads the Mesh-hosted protocol/catalog, matches its known runtime identity against Mesh's bounded adapter catalog and self-installs the single compatible adapter using authority it already has. Human workstation access is a failure path, not normal onboarding.

## OpenClaw self-bootstrap path

The universal enrollment catalog now exposes an executable OpenClaw installation plan plus an optional agent-run helper. No preinstalled Mesh bootstrap is assumed.

The supported managed install operation is:

`openclaw plugins install <verified-local-archive> --force --accept-capabilities`

The helper downloads/verifies while work may still be active, but refuses to invoke managed installation until OpenClaw has been idle across multiple checks.

Helper SHA-256: `7a309839f409cc67199536b28c08e7659c777c9b1b584e76f668db45b9b877d6`

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


## IDE warning cleanup

Final pre-run cleanup consolidates duplicate transfer-expiry logic, restores literal Flask
template/static directory declarations for PyCharm/Jinja resolution, and scopes IDE suppressions
only to intentionally repeated defensive route guards and the local Flask app factory name.
No runtime or enrollment behavior was changed.


## Public-origin hotfix

RC2 now supports `MESH_PUBLIC_ORIGIN`, separating the browser address from the canonical
agent-reachable address. This fixes cross-device LAN enrollment and aligns with Cloud Run/custom
domain deployment. Production requires HTTPS and derives WSS automatically.


## Direct-first transport priority
Mesh now treats the owner and agent as the intended data endpoints. This build adds automatic LAN origin discovery for local enrollment, an ephemeral signaling API/contract, and owner-authorized enrollment stop boundaries. Production still requires an explicit HTTPS `MESH_PUBLIC_ORIGIN`.

This is the transport foundation. Agent-side WebRTC/direct data-channel support and live route negotiation are intentionally not claimed complete in this build.


## Direct data channel
The browser and enrolled OpenClaw agent can negotiate a same-LAN WebRTC DataChannel. Cloud Mesh is signaling-only during negotiation; one-to-one messages prefer the direct channel once open. Adapter 0.5.0 pins `node-datachannel` 0.33.3.

Adapter SHA-256: `f5059a3ea3db5a0b6ae84dd712d81756a8d5d84c579d03635abcb1146028f882`
Bootstrap SHA-256: `b0ef1f9921ff840a6fb5d584d4dc0f247c678150af47e62cec9b89fa992705d6`


## Internet P2P and route policy

Mesh now exposes `direct_preferred`, `direct_only`, and `relay_allowed` owner policies. The browser
fetches ephemeral ICE configuration from Mesh; STUN enables NAT discovery and optional TURN
configuration provides a fallback for restrictive networks. The agent receives the same ICE
configuration through ephemeral signaling and applies the owner's relay policy.

Static TURN environment credentials are only an integration baseline. Production should vend
short-lived TURN credentials.

Adapter: 0.6.0
Adapter SHA-256: `abecddc7f0e9f889ac5ec4426a8523a436621ea6e7c13a01ac8454a8fd63f4a4`
Bootstrap SHA-256: `dad422185eef24be736860d0122866900c0de6bf7b97a04cc251e8fcddccaf07`


## Offline PWA and acceptance readiness

The PWA now caches only the application shell, never operational APIs or transfer/signaling routes.
It remembers trusted local agent endpoint metadata in browser-local storage and can probe that endpoint
when internet connectivity disappears. Same-LAN reconnect uses the remembered local endpoint rather than
requiring the cloud origin.

A user-facing `/how-it-works` page documents the direct/local, internet P2P, and optional encrypted relay
routes for future guided training.

The transport track is implementation-complete but still requires live acceptance with Rend before it can
be considered production-proven.

Adapter: 0.7.7
Adapter SHA-256: `8edc0e81bc09600c17bbb9b77db642d158d0223440973cd736b8913432dde435`
Bootstrap SHA-256: `f7f8438916e679db9410fae3e5591386c93d274666c40a25afc9eb069f6e9267`


## UI hotfix

- Guided Training dialog now always stays above highlighted page content.
- Training navigation remains visible in tall/short viewports and Escape exits safely.
- Connection-route option menus use the dark UI palette.
- “How it works” is now a proper header button immediately beside Guided Training.
- Header actions remain grouped and right-aligned instead of creating a third header column.


## Guided Training overlay correction
The highlighted page target no longer receives an elevated stacking layer or full-screen shadow. The training card is mounted directly under `body`, uses the browser's highest practical z-index, docks to the lower-right on desktop, and keeps its navigation actions sticky and visible.


## Guided Training spotlight correction
The backdrop itself is now transparent. A separate fixed spotlight layer creates the dimmed surround and leaves the active target visible inside a blue cutout, while the training card stays above it.


### Enrollment/reconnect timing
- Website enrollment activations are single-use and remain active until the user cancels the request or the agent successfully redeems it.
- Enrollment has no normal countdown. The PWA shows an active request until cancellation or successful connection; reconnect credentials handle future sessions.
- Existing compatible installations reconnect with their durable agent-local credential and skip discovery/reinstallation.
- If only the reconnect credential is unavailable, the active PTM1 authorization re-authorizes the existing installation without repeating adapter discovery/install.


## RC2 hot-safe enrollment upgrade

The OpenClaw adapter install plan no longer waits for generic runtime idle merely because the enrollment conversation itself is active. After package verification, the declared managed install may run during the enrollment turn and must not automatically restart OpenClaw. If the runtime explicitly requires a reload/restart before activation, enrollment stops with `activation_reload_required` and preserves current work.

Bootstrap SHA-256: `8da4e01c369983ce3dd1c0d05bbb884ad320e3c5d5b63b3703d464c7b5433b42`

## RC2 outbound command dispatch fix

Adapter 0.7.7 completes the server-to-agent half of the enrolled WebSocket protocol. The OpenClaw plugin now consumes `message_request` and approved safe-action commands directly from the authenticated Mesh gateway connection, returns `message_response` / `action_result`, and emits `command_ack` delivery acknowledgement before execution. Safe terminal snapshots remain bounded and read-only; no arbitrary remote shell is exposed. Action state now progresses from approval to dispatched, acknowledged, and completed/failed instead of treating local approval as proof of agent execution.

### RC2 terminal and file exchange acceptance update
Adapter 0.7.7 keeps the proven reconnect/outbound-dispatch behavior and changes the live monitor into a terminal-style activity view with explicit IN / OUT / SYS / ERR / FILE direction markers, wrapped message bodies, and expandable full payload details. Browser attachments now traverse the authenticated Mesh gateway into a non-executable `~/.progretech-mesh/inbox` staging area with size and SHA-256 verification. Agent file offers render inline with a Get file action; the demo artifact request now exercises the real reverse-transfer path. Arbitrary remote shell remains disabled.

The Mesh conversation runner continues to use OpenClaw's documented `api.runtime.agent.runEmbeddedAgent(...)` helper. Provider/auth-profile cooldown or model unavailability is reported as a runtime blocker rather than bypassing the owner's configured model/auth policy.
