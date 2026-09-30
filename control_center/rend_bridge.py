"""Integration extension for the existing loopback Rend factory_host service.

Load this module after factory_host, then call install(factory_host).
Nothing is started or enabled by importing it.
"""
import json
from urllib.request import Request, urlopen
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
        allowlist = cfg.get('agents', {}).get('defaults', {}).get('models', {})
        configured = [provider + '/' + entry['id']
                      for provider, data in cfg.get('models', {}).get('providers', {}).items()
                      for entry in data.get('models', [])
                      if isinstance(entry, dict) and isinstance(entry.get('id'), str)]
        communication_models = list(dict.fromkeys([*models, *(allowlist.keys() if isinstance(allowlist, dict) and allowlist else configured)]))
        return {'runtime_id': runtime_id, 'name': agent.get('name', runtime_id),
                'role': agent.get('identity', {}).get('theme', ''), 'models': models,
                'communication_roles': [runtime_id], 'communication_models': communication_models,
                'models_meaning': 'Configured primary and fallbacks; installed models are a separate host inventory.',
                'voice_application': 'Per-agent saved voice is used for preview. The existing voice service remains shared.'}

    capabilities = {'voice.preview', 'host.system', 'models.list', 'audio.get', 'audio.set',
                    'voice.get', 'voice.start', 'voice.stop', 'vision.get', 'vision.analyze',
                    'skills.list', 'mail.status', 'orchestration.status', 'harness.status',
                    'grid.status', 'vllm.status', 'chatter.get', 'chatter.settings', 'chatter.test'}

    def execute(runtime_id, action, args, profile):
        # Verify the binding still refers to a real runtime before any host action.
        discover(runtime_id)
        if action.startswith('factory.'):
            from control_center.factory_jobs import dispatch_factory
            return dispatch_factory(home, runtime_id, action, args)
        if action == 'communication.chat':
            from control_center.management import preferences
            cfg = json.loads((home / '.openclaw/openclaw.json').read_text())
            communication = profile['communication']
            role = communication['role']
            if role != runtime_id or role not in cfg['agents']['entries']:
                raise ValueError('communication_role_unavailable')
            model = communication['model']
            if model != 'default' and model not in discover(runtime_id)['communication_models']:
                raise ValueError('communication_model_unavailable')
            gateway = cfg['gateway']
            if gateway.get('auth', {}).get('mode') != 'token':
                raise ValueError('gateway_token_required')
            port = gateway.get('port', 18789)
            if type(port) is not int or not 1 <= port <= 65535:
                raise ValueError('gateway_port_invalid')
            request_body = {'model': 'openclaw/' + role, 'stream': False,
                            'messages': [{'role': 'user', 'content': args['text']}],
                            'user': 'mesh-conversation-' + profile['agent_id']}
            # Runtime model overrides are sent only via the configured gateway;
            # they do not rewrite the agent's global primary/fallback settings.
            headers = {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + gateway['auth']['token'],
                       'x-openclaw-agent-id': role, 'x-openclaw-message-channel': 'mesh',
                       'x-openclaw-session-key': 'agent:' + role + ':mesh-chat:' + profile['agent_id']}
            if model != 'default':
                headers['x-openclaw-model'] = model
            req = Request(f'http://127.0.0.1:{port}/v1/chat/completions', data=json.dumps(request_body).encode(), headers=headers)
            with urlopen(req, timeout=35) as response:
                completion = json.loads(response.read(1048576))
            return {'reply': completion['choices'][0]['message']['content'], 'role': role, 'model': model}
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
