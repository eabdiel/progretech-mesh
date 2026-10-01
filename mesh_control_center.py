"""Per-agent control surface. Operational profiles stay on the agent host."""
import json
import secrets
import threading
from urllib.parse import urlsplit

from flask import jsonify, render_template, request

ACTIONS = {'profile.get', 'profile.save', 'voice.preview', 'host.system', 'models.list',
           'audio.get', 'audio.set', 'voice.get', 'voice.start', 'voice.stop',
           'vision.get', 'vision.analyze', 'skills.list', 'mail.status',
           'orchestration.status', 'harness.status', 'grid.status', 'vllm.status',
           'chatter.get', 'chatter.settings', 'chatter.test'}


class ControlRelay:
    def __init__(self, timeout=45):
        self.timeout = timeout
        self.pending = {}
        self.lock = threading.Lock()

    def resolve(self, agent_id, message):
        if message.get('type') != 'control_center_response':
            return False
        request_id = message.get('request_id')
        payload = message.get('payload')
        if not isinstance(request_id, str) or not isinstance(payload, dict) or type(payload.get('ok')) is not bool:
            return False
        with self.lock:
            entry = self.pending.get((agent_id, request_id))
            if not entry or entry['event'].is_set():
                return False
            entry['payload'] = payload
            entry['event'].set()
        return True

    def dispatch(self, agent_id, action, args, send, gateway_id=None):
        gateway_id = gateway_id or agent_id
        key = (gateway_id, secrets.token_urlsafe(24))
        entry = {'event': threading.Event(), 'payload': None}
        with self.lock:
            if len(self.pending) >= 128 or sum(k[0] == gateway_id for k in self.pending) >= 8:
                return {'ok': False, 'error': 'control_center_busy'}, 429
            self.pending[key] = entry
        try:
            ok, error = send(gateway_id, {'type': 'control_center_request', 'request_id': key[1],
                                      'payload': {'action': action, 'args': args, 'agent_id': agent_id}})
            if not ok:
                return {'ok': False, 'error': error or 'gateway_unavailable'}, 503
            if not entry['event'].wait(self.timeout):
                return {'ok': False, 'error': 'control_center_timeout',
                        'detail': 'The action may still finish. Check status before trying again.'}, 504
            return entry['payload'], 200 if entry['payload']['ok'] else 502
        finally:
            with self.lock:
                self.pending.pop(key, None)


control_relay = ControlRelay()


def register_gateway_agents(gateway_id, payload, registry):
    """Accept a bounded role roster only from an authenticated, owned gateway.

    Child IDs belong to this host's namespace. Existing independent enrollments
    cannot be overwritten or adopted by a roster message.
    """
    host = registry.get(gateway_id)
    if not host or not host.get('owner_id') or host.get('trust_state') != 'verified':
        return False
    agents = payload.get('agents') if isinstance(payload, dict) else None
    if not isinstance(agents, list) or len(agents) > 32:
        return False
    import re
    accepted = {}
    host_activity = None
    for item in agents:
        if not isinstance(item, dict):
            return False
        aid = item.get('id')
        if aid == gateway_id:
            host_activity = item
            continue
        if not isinstance(aid, str) or not aid.startswith(gateway_id + '--') or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', aid):
            return False
        if not isinstance(item.get('name'), str) or len(item['name']) > 80 or not isinstance(item.get('role', ''), str) or len(item.get('role', '')) > 160:
            return False
        existing = registry.get(aid)
        if existing and existing.get('control_center_gateway') != gateway_id:
            return False
        accepted[aid] = item
    # Retired bindings disappear; independently enrolled agents are untouched.
    for aid, record in list(registry.items()):
        if record.get('control_center_gateway') == gateway_id and aid not in accepted:
            del registry[aid]
    for aid, item in accepted.items():
        activity = item.get('activity') if isinstance(item.get('activity'), dict) else {}
        observed = activity.get('state', item.get('state', 'unknown'))
        state = {'active': 'working', 'idle': 'idle', 'paused': 'paused', 'stopped': 'paused',
                 'sleeping': 'paused', 'blocked': 'blocked', 'unknown': 'unknown'}.get(observed, 'unknown')
        registry[aid] = {
            'id': aid, 'name': item['name'], 'role': item.get('role', ''),
            'owner_id': host['owner_id'], 'control_center_gateway': gateway_id,
            'trust_state': 'verified', 'trust_valid': True, 'trust_reason': 'linked_through_verified_host',
            'state': state, 'transport': 'connected', 'task': str(activity.get('task_id') or 'Linked workstation role')[:160],
            'activity': {k: activity[k] for k in ('state', 'observed_at', 'source', 'task_id', 'session') if k in activity and isinstance(activity[k], (str, type(None)))},
            'phase': 'Agent-specific controls through verified host', 'progress': 0,
            'runtime': 'OpenClaw role', 'model': 'Load agent inventory',
            'fingerprint': host.get('fingerprint', ''),
        }
    if host_activity is not None:
        activity = host_activity.get('activity') if isinstance(host_activity.get('activity'), dict) else {}
        observed = activity.get('state', host_activity.get('state', 'unknown'))
        host['state'] = {'active':'working','idle':'idle','paused':'paused','stopped':'paused',
                         'sleeping':'paused','blocked':'blocked','unknown':'unknown'}.get(observed,'unknown')
        host['activity'] = {k:activity[k] for k in ('state','observed_at','source','task_id','session') if k in activity and isinstance(activity[k],(str,type(None)))}
    return True


def register_control_center_routes(app, require_session, user_id, registry, gateways, send):
    def owned(agent_id):
        record = registry.get(agent_id)
        if not record or not user_id() or record.get('owner_id') != user_id():
            return None
        return record

    def gateway_for(record):
        gateway_id = record.get('control_center_gateway') or record['id']
        gateway = registry.get(gateway_id)
        if not gateway or gateway.get('owner_id') != user_id() or gateway.get('trust_state') != 'verified':
            return None
        return gateway_id

    @app.get('/agents/<agent_id>/control-center')
    @require_session
    def control_center_page(agent_id):
        record = owned(agent_id)
        if not record:
            return jsonify(ok=False, error='agent_not_found'), 404
        return render_template('control_center.html', agent={
            'id': agent_id, 'name': record.get('name', agent_id), 'role': record.get('role', ''),
            'model': record.get('model', 'Not reported'), 'connected': gateway_for(record) in gateways,
            'verified': record.get('trust_state') == 'verified' and gateway_for(record) is not None})

    @app.post('/api/agents/<agent_id>/control-center')
    @require_session
    def control_center_command(agent_id):
        record = owned(agent_id)
        if not record:
            return jsonify(ok=False, error='agent_not_found'), 404
        gateway_id = gateway_for(record)
        if record.get('trust_state') != 'verified' or not gateway_id:
            return jsonify(ok=False, error='verified_agent_required'), 403
        if gateway_id not in gateways:
            return jsonify(ok=False, error='agent_offline'), 503
        origin, expected = urlsplit(request.headers.get('Origin', '')), urlsplit(request.host_url)
        if (origin.scheme, origin.netloc) != (expected.scheme, expected.netloc) or request.headers.get('Sec-Fetch-Site') == 'cross-site':
            return jsonify(ok=False, error='same_origin_required'), 403
        if request.content_length and request.content_length > 16384:
            return jsonify(ok=False, error='payload_too_large'), 413
        body = request.get_json(silent=True)
        if not isinstance(body, dict) or set(body) - {'action', 'args'}:
            return jsonify(ok=False, error='invalid_request'), 400
        action, args = body.get('action'), body.get('args', {})
        if not isinstance(action, str) or action not in ACTIONS or not isinstance(args, dict) or len(json.dumps(args)) > 8192:
            return jsonify(ok=False, error='invalid_action_or_args'), 400
        # Typed validation is shared with the workstation, before any request is sent.
        from control_center.provider import validate_args
        try:
            validate_args(action, args)
        except (ValueError, TypeError) as exc:
            return jsonify(ok=False, error=str(exc)), 400
        result, status = control_relay.dispatch(agent_id, action, args, send, gateway_id)
        return jsonify(result), status
