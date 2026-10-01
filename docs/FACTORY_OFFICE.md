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
