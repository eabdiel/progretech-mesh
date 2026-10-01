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

## Separate logins sharing a fleet

An administrator can bind verified Firebase UIDs to an existing fleet owner with
`MESH_OWNER_UID_BINDINGS`, a JSON object such as
`{"secondary-firebase-uid":"existing-owner-firebase-uid"}`. Both Firebase
accounts must first complete verified sign-in. Verify the exact UIDs through
Firebase administrative lookup and the existing gateway's owner binding before
applying the configuration; never derive ownership from an email alias.

The two accounts remain separate. Sessions and activity keep the authenticated
login UID and email; fleet operations and new enrollments resolve to the configured
owner UID. This grants full fleet owner access, including control and removal.
Existing gateway and agent ownership records and credentials retain their original
owner UID. Already-enrolled agents owned by a secondary UID require a separate
reviewed ownership migration; the binding does not migrate those records.

Only Firebase-authenticated sessions use these bindings. No browser field can
choose its owner. Unlisted logins retain their own ownership scope. Configuration
rejects malformed JSON, duplicate UIDs, email addresses, chains, cycles, self
bindings and more than 256 entries. Removing a binding restores the login's own
owner scope for existing sessions on subsequent requests. Cloud Run configuration
updates create a new revision; account for the existing process-local registry
and pending invitations when scheduling rollout and rollback.

## Automatic CodeSeal issuance

Configure `CODESEAL_MESH_ISSUER_TOKEN` in server secret storage and keep the existing
production CodeSeal verifier configuration. `CODESEAL_API_URL` is an administrator
setting, not a browser-supplied endpoint. Automatic issuance uses the configured
registry principal; Mesh's ownership binding remains the logged-in Mesh user.
The CodeSeal account option instead uses the owner's supplied API token for issuance.
Tokens are never persisted by this flow and the field is cleared after submission.

For an administrator-managed issuer, create a dedicated CodeSeal integration token
under a verified registry account using CodeSeal's existing token creation procedure.
Store it in Secret Manager and grant the Mesh runtime service account access to
that secret. Bind a reviewed secret version to `CODESEAL_MESH_ISSUER_TOKEN` with
Cloud Run's `--update-secrets` and set `CODESEAL_API_URL` to the production registry
API. Keep the token out of shell arguments, source control and job artifacts.
The token uses CodeSeal's existing account API permissions; there is currently no
identity-only token scope. Revoke it through CodeSeal when retiring the integration.
The deployment script updates existing environment and secret bindings so later
deployments preserve administrator-managed issuer and shared-fleet configuration.

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

If signed public bundles were prepared on the host, open **Add signed agent**,
expand **Import prepared signed identities**, select the bundle JSON and review
the listed names. **Verify and enroll** checks each identity against CodeSeal and
refreshes the fleet. Private keys are never included in this file or uploaded.
Failed imports stop at the failing identity and retain the earlier successful
enrollments; retrying skips exact identities already enrolled in the same fleet.

The updated gateway saves server-signed enrollment receipts locally before Mesh
reports success. It sends them on reconnect or roster refresh so Mesh can restore
explicitly approved signed identities after a server restart. Restoration rechecks
the original owner, gateway public key, live runtime membership and CodeSeal seal.
Discovery alone never creates signed enrollments. Removing a role through Mesh
disables the local binding and removes its cached receipt. Rotating the server
credential signing secret or gateway key requires renewed owner enrollment.

Open **Add signed agent**, then **Select identified agents from gateway**. The list contains public role identities announced by your connected, verified gateway and excludes individually enrolled roles. Choose one, generate its own PEM identity and obtain its own CodeSeal evidence, then submit. Each role retains its own owner binding, public key, seal and fingerprint; it does not inherit the host identity. Repeat for the remaining agents. The private PEM download and public evidence bundle must be installed on the intended agent by its owner. Mesh never stores private PEM files.

The host bridge must run the updated `control_center/rend_bridge.py` and Mesh OpenClaw plugin. Its administrator-owned gateway binding is required. It queries the authenticated loopback OpenClaw gateway for public agent identities, creates exact local runtime bindings within that gateway namespace, and refreshes the roster without automatically enrolling agents. Newly added runtime roles can appear without editing each child binding. Unavailable or removed roles cannot be controlled through an old selection. Per-role local permissions and removal preferences remain authoritative. Up to 256 identified agents are supported.

Offline Mesh offers the same one-at-a-time gateway selection in **Agent onboarding**, with ownership and intermediary acknowledgments and unsigned local runtime references. It does not require a hosted Mesh connection or account.

Signed roles communicate through their connected host; they do not need another
pairing step. Cards show host gateway availability and observed role activity.
Role conversations keep sent messages, pending status, replies and failures when
switching agents in the same open tab. Replies arriving while another agent is
selected stay with their original conversation. This browser view is held in
memory and clears on page reload; the agent runtime owns its separate Mesh session.
Chat allows up to five minutes for a local runtime reply, with longer adapter and
relay budgets. Other management actions retain their shorter timeouts. A failed
request is shown in the conversation and is not automatically retried.
