"""Host-local Mesh office; upstream HiveManager is the coordination authority."""
import fcntl
import hashlib
import json
import re
import shutil
import subprocess
from pathlib import Path

PUBLIC_OPERATIONS = {'snapshot', 'hire', 'archive', 'task.create', 'task.approve', 'message', 'pause', 'settings', 'memory', 'memory.save', 'run'}


def validate_office(args):
    if not isinstance(args, dict) or set(args) != {'operation', 'args'} or args['operation'] not in PUBLIC_OPERATIONS:
        raise ValueError('invalid_office_operation')
    op, body = args['operation'], args['args']
    fields = {'hire': {'name', 'role', 'goal'}, 'archive': {'id'}, 'task.create': {'title', 'description', 'assignee', 'dependsOn', 'needsApproval'},
        'task.approve': {'id', 'answer'}, 'message': {'to', 'text'}, 'pause': {'paused'}, 'settings': {'maxIterations'},
        'memory': {'id'}, 'memory.save': {'id', 'text'}, 'run': {'id'}}.get(op, set())
    if not isinstance(body, dict) or set(body) != fields:
        raise ValueError('invalid_office_args')
    for key, value in body.items():
        if key in {'paused', 'needsApproval'}:
            if type(value) is not bool: raise ValueError('invalid_office_args')
        elif key == 'maxIterations':
            if type(value) is not int or not 2 <= value <= 20: raise ValueError('invalid_office_args')
        elif key == 'dependsOn':
            if not isinstance(value, list) or len(value) > 20 or any(not isinstance(x, str) or not re.fullmatch('task-[a-f0-9]{12}', x) for x in value):
                raise ValueError('invalid_dependency')
        elif not isinstance(value, str) or '\x00' in value or len(value) > (6000 if key == 'text' else 4000 if key in {'description', 'goal'} else 160):
            raise ValueError('invalid_office_args')
        elif key not in {'assignee', 'description'} and not value.strip():
            raise ValueError('invalid_office_args')
    if len(json.dumps(args)) > 16384: raise ValueError('invalid_office_args')


def office_root(home, role):
    if not re.fullmatch('[A-Za-z0-9_-]{1,80}', role): raise ValueError('invalid_office_role')
    return Path(home) / '.progretech-mesh/factory-offices' / role


def engine(home, role, operation, args=None):
    root = office_root(home, role)
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    root.chmod(0o700)
    node = shutil.which('node')
    if not node: raise ValueError('office_node_runtime_required')
    script = Path(__file__).resolve().parent.parent / 'office/engine.mjs'
    with (root / 'mesh-engine.lock').open('a') as guard:
        fcntl.flock(guard, fcntl.LOCK_EX)
        result = subprocess.run([node, str(script)], input=json.dumps({'home': str(root), 'operation': operation, 'args': args or {}}),
            text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30, check=False)
    if result.returncode:
        # Only known machine codes cross the relay; full runtime diagnostics stay local.
        for code in ('task_not_ready', 'office_paused', 'office_capacity', 'agent_has_open_tasks', 'director_required', 'office_agent_not_found', 'dependency_not_found', 'approval_not_pending', 'office_role_already_exists'):
            if code in result.stderr: raise ValueError(code)
        raise ValueError('office_coordination_failed')
    return json.loads(result.stdout)


def namespace(role, agent_id=None):
    return role if not agent_id else role + "--" + hashlib.sha256(agent_id.encode()).hexdigest()[:16]


def dispatch_office(home, role, args, agent_id=None):
    validate_office(args)
    if args['operation'] == 'run':
        from control_center.factory_jobs import dispatch_factory
        return dispatch_factory(home, role, 'factory.run', {'provider': 'crewai', 'task': '', 'office_task': args['args']['id']}, office_id=agent_id)
    result = engine(home, namespace(role, agent_id), args['operation'], args['args'])
    from control_center.factory_jobs import _config
    settings = _config(home).get('crewai', {})
    result['snapshot']['runtimeReady'] = bool(settings.get('enabled') and role in settings.get('roles', []) and Path(settings.get('python', '')).is_file())
    return result
