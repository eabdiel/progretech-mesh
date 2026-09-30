"""Integration extension for the existing loopback Rend factory_host service.

Load this module after factory_host, then call install(factory_host).
Nothing is started or enabled by importing it.
"""
import json
from pathlib import Path

from control_center.provider import AgentControlProvider, register_provider_routes


def install(host, home=None):
    home = Path(home or Path.home())
    state = home / '.progretech-mesh'
    # Explicit local bindings are mandatory, including for Rend. Random enrollment
    # IDs must not be guessed from names or silently bound to the main role.
    bindings = json.loads((state / 'control-center-bindings.json').read_text())
    if not isinstance(bindings, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in bindings.items()):
        raise ValueError('invalid_control_center_bindings')

    def discover(runtime_id):
        cfg = json.loads((home / '.openclaw/openclaw.json').read_text())
        agent = cfg['agents']['entries'].get(runtime_id)
        if not agent:
            raise ValueError('runtime_agent_not_found')
        model = agent.get('model', cfg['agents'].get('defaults', {}).get('model', {}))
        primary = model if isinstance(model, str) else model.get('primary')
        fallbacks = [] if isinstance(model, str) else model.get('fallbacks', [])
        models = [m for m in [primary, *fallbacks] if isinstance(m, str)]
        return {'runtime_id': runtime_id, 'name': agent.get('name', runtime_id),
                'role': agent.get('identity', {}).get('theme', ''), 'models': models,
                'models_meaning': 'Configured primary and fallbacks; installed models are a separate host inventory.',
                'voice_application': 'Per-agent saved voice is used for preview. The existing voice service remains shared.'}

    capabilities = {'voice.preview', 'host.system', 'models.list', 'audio.get', 'audio.set',
                    'voice.get', 'voice.start', 'voice.stop', 'vision.get', 'vision.analyze',
                    'skills.list', 'mail.status', 'orchestration.status', 'harness.status',
                    'grid.status', 'vllm.status', 'chatter.get', 'chatter.settings', 'chatter.test'}

    def execute(runtime_id, action, args, profile):
        # Verify the binding still refers to a real runtime before any host action.
        discover(runtime_id)
        mutation = action in {'voice.preview', 'audio.set', 'voice.start', 'voice.stop', 'vision.analyze', 'chatter.settings', 'chatter.test'}
        if mutation and not host.MUTATION_LOCK.acquire(blocking=False):
            raise ValueError('shared_workstation_busy')
        try:
            if action == 'voice.preview':
                return host.dispatch(action, {**profile['voice'], **args})
            if action == 'mail.status':
                role = {'main': 'rend', 'researcher': 'lyra', 'coder': 'mak'}.get(runtime_id)
                if not role:
                    raise ValueError('mailbox_unavailable')
                return host.dispatch(action, {'agent': role})
            if action == 'skills.list':
                return host.dispatch(action, {}).get(runtime_id, {'available': False})
            return host.dispatch(action, args)
        finally:
            if mutation:
                host.MUTATION_LOCK.release()

    provider = AgentControlProvider(state / 'agent-profiles', bindings, discover, execute, capabilities)
    register_provider_routes(host.app, provider, host.token)
    return provider
