# ProgreTech Mesh v1 — Phase 7 of 7

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
