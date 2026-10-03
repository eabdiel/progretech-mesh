# Agent onboarding

The fleet always includes an **Agent onboarding** tile with a plus sign, including
when the account has no agents. The owner confirms personal hosting and accepts
Mesh's intermediary role, names the agent, and copies an invitation into an existing
authorized agent conversation.

The invitation contains an authenticated encrypted, one-use capsule valid for
15 minutes. Owner/session identifiers and its nonce are not merely base64 encoded.
The origin and helper verification digest are public. Treat the capsule as a
temporary capability; never put it in a public issue, log or repository.

The agent verifies the helper digest and uses its existing Python/cryptography
tools to create a temporary onboarding connection. The helper does not install
dependencies, invoke a model, restart the runtime or invent an identity answer.
The owner sees the red pulse become green when that temporary channel is live,
sends an identification question, and reviews the signed reply from the agent.
The agent uses its own existing tools to read the helper's question file and write
its answer file. It can run the helper as a background process while answering.

Only after a live reply and owner confirmation does Mesh issue and verify CodeSeal
evidence, bind the public identity to that logged-in owner, and produce the adapter's
permanent enrollment instructions. The helper stores the private Ed25519 PEM,
public PEM and evidence on the agent's machine and tells the agent to follow those
instructions. No private key is sent to Mesh or stored in the browser.

The green pulse proves temporary onboarding connectivity. Completion of that flow
is distinct from the permanent gateway connection shown on the fleet tile. Adapter
installation follows the existing bounded, verified, runtime-specific enrollment
protocol. Unsupported runtimes fail closed instead of receiving invented adapters.

## Automatic CodeSeal issuance

Configure `CODESEAL_MESH_ISSUER_TOKEN` in server secret storage and keep the existing
production CodeSeal verifier configuration. `CODESEAL_API_URL` is an administrator
setting, not a browser-supplied endpoint. Automatic issuance uses the configured
registry principal; Mesh's ownership binding remains the logged-in Mesh user.
The CodeSeal account option instead uses the owner's supplied API token for issuance.
Tokens are never persisted by this flow and the field is cleared after submission.

An unavailable issuer or failed verification leaves the agent pending; it never
manufactures a seal or upgrades trust. Confirmation is idempotent after successful
completion. The agent refreshes its signed issuance proof while awaiting review.
Cancellation and expiry invalidate the temporary channel. Pending invitations use
Mesh's existing single-process ephemeral state convention and do not survive a
gateway restart; already-enrolled agents retain their local reconnect mechanism.

The host helper requires HTTPS, refuses redirects, creates private files with mode
0600 and refuses to overwrite existing identity material. The caller must keep
enrollment within its existing local authority.

Tests cover consent, cross-owner access, replay, cancellation, invalid key proofs,
question/answer signatures, confirmation gating and CodeSeal failures. A live
production enrollment has not been implied by fixture-based browser validation.

## Add agents identified by a gateway

Open **Add signed agent**, then **Select identified agents from gateway**. The list contains public role identities announced by your connected, verified gateway and excludes individually enrolled roles. Choose one, generate its own PEM identity and obtain its own CodeSeal evidence, then submit. Each role retains its own owner binding, public key, seal and fingerprint; it does not inherit the host identity. Repeat for the remaining agents. The private PEM download and public evidence bundle must be installed on the intended agent by its owner. Mesh never stores private PEM files.

The host bridge must run the updated `control_center/rend_bridge.py` and Mesh OpenClaw plugin. Its administrator-owned gateway binding is required. It queries the authenticated loopback OpenClaw gateway for public agent identities, creates exact local runtime bindings within that gateway namespace, and refreshes the roster without automatically enrolling agents. Newly added runtime roles can appear without editing each child binding. Unavailable or removed roles cannot be controlled through an old selection. Per-role local permissions and removal preferences remain authoritative. Up to 256 identified agents are supported.

Offline Mesh offers the same one-at-a-time gateway selection in **Agent onboarding**, with ownership and intermediary acknowledgments and unsigned local runtime references. It does not require a hosted Mesh connection or account.

## Enrollment persistence across web releases and gateway reconnects

Signed gateway roles are reconstructed from owner-bound PTMGE1 receipts retained by the local gateway in `gateway-agent-enrollments.json`. A cloud process restart may clear the live registry, but the next authenticated roster restores independently verified roles with their original owner, public key and seal. Roster discovery alone never enrolls an agent. New production enrollments require a receipt-capable adapter and a durable save acknowledgement; failure returns an explicit error instead of a temporary success.

`MESH_DEVICE_CREDENTIAL_SECRET` must remain stable across revisions. A rotated signing secret requires an explicit receipt migration/reissuance plan; do not regenerate it on startup. Back up the gateway application state securely, including its receipt cache. Do not copy receipt contents into logs or tickets. Deliberate enrollment removal forgets the relevant local receipt; invalid or revoked identities are not restored.

Web and desktop releases must both retain `mesh_gateway_receipts.py` and its route integration. `cloudbuild.yaml` runs `test_gateway*.py` inside the built image before push/deployment. Those tests exercise repeated clean-registry restores, reconnect idempotence, owner/key binding, revoked identities, save acknowledgement and bounded avatar-bearing discovery. A deployment is not complete until the actual gateway reconnects and recovery logs show the expected restored count without rejected receipts. Cloud retention remains off for chats/runtime memory; identity continuity is backed by gateway-held receipts.
