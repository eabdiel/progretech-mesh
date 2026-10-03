# Mesh Factory office

`/mission-control` retains the workstation, voice, resource and controller controls.
`/factory` is the Mesh-owned office. Connected agents remain independently hosted;
the cloud browser relays office requests to an owned, verified local execution host.

The office integrates CrewAI hierarchical crews with the complete Munder Difflin
HiveManager coordination component, plus ControlRegistry and CircuitBreaker.
The visual floor replaces desktop avatars with accessible circles, live activity
rings and message paths. Hiring, per-worker inboxes and reviewed memory, mission
dependencies, owner approvals, results and coordination history use the real hive.
It does not embed the Munder Difflin Electron desktop or claim desktop feature parity.

## Host setup

Install the Mesh control-center code from the same release as the web application.
Keep the host's existing enrollment-to-runtime bindings. Office state is namespaced
by both the bound runtime and the enrolled Mesh agent ID, so sharing a runtime
does not expose another enrollment's office.

The host needs Node 20+ and Git for HiveManager. `office/engine.mjs` is already
bundled; no npm install is needed at runtime. To rebuild it, run `npm install`
then `npm run build` in `office/`. Upstream source, notices and commit are retained
under `vendor/munder-difflin/`. No pixel-art assets are redistributed.

Use a separate Python 3.10–3.13 environment for CrewAI:

```sh
python3.12 -m venv /absolute/path/mesh-factory-env
/absolute/path/mesh-factory-env/bin/pip install -r requirements-office.txt
```

Configure `~/.progretech-mesh/factory-runtimes.json` on the host:

```json
{
  "crewai": {
    "enabled": true,
    "roles": ["main"],
    "python": "/absolute/path/mesh-factory-env/bin/python",
    "workspace": "/absolute/path/approved-workspace",
    "model": "openai/local-model",
    "base_url": "http://127.0.0.1:11434/v1",
    "api_key_env": "MESH_FACTORY_API_KEY"
  }
}
```

Only the administrator chooses executable paths, model endpoints, workspace and
credential environment names. Browser requests cannot supply them. Replace `main`
with the runtime ID in the host's existing control-center bindings. Local model
endpoints and credentials remain host-local. Crew tracing and telemetry are disabled
by default in the worker.

## Using the office

Choose an execution host, hire at least one worker, then create a mission and its
acceptance criteria. Assign it to the director for hierarchical delegation or to a
specific worker. Dependencies hold a mission until preceding work is delivered.
An approval requirement holds it in **Needs you** until the owner approves it.
Start a ready mission to execute it through the configured CrewAI environment.

The director uses CrewAI's actual coworker delegation tools. Worker execution events
and mailbox traffic update the hive and floor. Messages sent between missions are
read as context on the next mission; sending a message alone does not invoke a model.
Reviewed office memory is explicitly saved, separate from factory-role MemPalace.

Pausing applies at the next agent step; it cannot retract an already-running model
request. Per-agent iterations are bounded to 2–20, default 8. Factory admission
serializes execution on the host. Model or execution failures block the mission for
owner review; automatic command retries are not sent. Five agent errors in the recent
event window trigger the upstream error-storm stop and pause the office.

Office state stays under `~/.progretech-mesh/factory-offices/`; job state and outputs
stay under `~/.progretech-mesh/factory-jobs/`. Cloud API responses and operational
state are excluded from the PWA cache. A stopped host reports offline rather than
continuing simulated activity.

## Validation

`tests/test_office_engine.py` exercises the real bundled HiveManager, including
mail delivery, dependency gates, owner approval and memory isolation. Route tests
exercise session, origin, owner, trust and connection checks. Run the real CrewAI
delegation test using its separate environment:

```sh
CREWAI_TELEMETRY_DISABLED=true OTEL_SDK_DISABLED=true \
  /absolute/path/mesh-factory-env/bin/python -m unittest discover \
  -s tests -p test_office_crewai.py
```

That test uses the actual framework with a deterministic offline LLM; it proves
delegation/event wiring without spending API credits. Model quality and live
production acceptance require testing with the owner's selected host and model.

## Owner work inspection

Selecting the Director shows recorded mission assignments and delegation events.
Selecting a native role shows its current scheduled work and bounded queue from
the workday controller, with scheduled times as the ordering source. Native
scheduled work and CrewAI office missions remain distinct execution systems.
Relationships display recorded handoffs or concurrent assignments, never assumed
collaborators. A pending mailbox item can prefill a new mission for owner review;
creating a mission does not execute it. The host must have its execution runtime
configured and workers hired before Start mission is available.

Native role inspectors provide Pause activity, Resume activity, and a host status
summary. Pause requests cancellation of that selected role across channels; it
cannot undo completed actions. Resume restores admission and leaves interrupted
work visible for review. Add context to active work targets the locally observed
role session through OpenClaw chat.send with queueMode=steer and a fresh
idempotency key. The browser supplies only text; session identity is host-derived.
An accepted receipt confirms runtime admission, not agent execution or task
completion. Idle, stale, unavailable and cross-role observations are rejected.
Unconfirmed delivery is never automatically replayed.

Lights explain their source and timestamp in the selected inspector. Current
monitoring is purple, work blue, sleep amber, idle gray, completed turns green,
and recorded errors red. Native failures outside a Mesh chat are identified as
such without exposing private session transcripts or provider payloads.

## Error recovery and memory receipts

Red native roles expose Try to resolve in the Factory inspector and signed fleet
cards. Recovery checks canonical controls and gateway availability. It preserves
active work, defers model preparation when busy, and never replays the failed
task or restarts the gateway. When idle, it checks the configured local model and
attempts its supported preload. A recorded Mesh context-limit error prepares a
fresh conversation while retaining earlier runtime history. Unsupported request
format failures and generic native failures receive explicit next steps rather
than a fabricated repair. Passing diagnostics does not clear a failed turn; a
later successful agent result replaces the error signal.

The selected agent's MemPalace label reads bounded completion receipt metadata.
It distinguishes a failed write, a verified continuity checkpoint, an automatic
runtime activity receipt and a reviewed technical activity. Metadata-only capture
is not evidence of reviewed learning. Memory content, private transcripts, tool
arguments and provider payloads never cross this status endpoint. The local
MemPalace hook 1.2.1 provides explicitly enabled, host-scoped automatic completion
logging for registered unsandboxed roles; model-requested lesson writes retain
their separate permission and invocation checks.

## Unified identity and orchestrator assignment

Fleet and Factory share a host-local office roster. Native entries bind to runtime
IDs; the gateway's intake runtime appears on its existing gateway card. Existing
signed credentials and archived history are retained. Legacy office aliases are
bound explicitly through `~/.progretech-mesh/office-runtime-bindings.json`, keyed by
gateway ID and office ID; display names are never used as identity keys.

**Make Orchestrator** transfers open assignments and pending coordination mail to
one selected agent. Specialist roles, private memory and completed-task attribution
stay unchanged. An interrupted handoff is replayed under the office lock. A running
model invocation finishes with its original execution context; result delivery uses
the current orchestrator. Archived workers remain archived through discovery and
redeployment; **Hire worker → Return to office** restores them. Office-only hires
are shown as host-owned Factory workers in Fleet, not as separately signed runtimes.

**Terminal view** opens scoped agent input/output and delivered mission results.
It does not attach to an existing CLI process. Reviewed cross-client context can be
published with `scripts/share-agent-context.py --gateway HOST --runtime RUNTIME
--author AUTHOR --file REVIEWED_FILE`. These notes stay on the host and are included
in the selected agent's next Mesh chat along with its relevant mission results.
Only explicitly reviewed notes are published; CLI transcripts are not automatically
imported. Unknown runtime activity remains unknown when no observation is available.

The host's office, runtime bindings, communication preferences and enrollment
receipts are application data and must survive release installation. Cloud roster
projections are rebuilt by the authenticated gateway; they are not the identity or
memory authority. Local and hosted UI must use the same release plus host adapter.

For installations managed by the local release updater, the host service can use
`install/mesh-host-server.py` with its existing host Python interpreter. It reads
the installed release manifest instead of pinning an older development worktree.
Restart the host bridge after updating its release; wait for active requests to
finish before restarting the gateway adapter.
