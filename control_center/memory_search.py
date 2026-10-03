"""Explicit host sharing of shared project records; no private scope or cloud copy."""
import json
import sqlite3
from pathlib import Path
from control_center.artifacts import ROLES

ACTIONS = {'memory.status', 'memory.share', 'memory.search'}


def validate(action, args):
    fields = {'memory.status': set(), 'memory.share': {'enabled'}, 'memory.search': {'query', 'project'}}
    if not isinstance(args, dict) or action not in fields or set(args) != fields[action]:
        raise ValueError('invalid_memory_args')
    if action == 'memory.share' and type(args['enabled']) is not bool:
        raise ValueError('invalid_memory_args')
    if action == 'memory.search':
        if any(not isinstance(args[k], str) or not args[k].strip() or '\x00' in args[k] for k in args):
            raise ValueError('invalid_memory_args')
        if len(args['query']) > 200 or args['project'] not in {'ProgreTech', 'Local-Workstation'}:
            raise ValueError('invalid_memory_args')


def database(home):
    config = Path(home) / '.local/share/progretech/mempalace-runtime/mempalace/config.example.json'
    try:
        path = Path(json.loads(config.read_text())['database_path']).expanduser()
        if not path.is_absolute() or not path.is_file(): return None
        return path
    except (OSError, ValueError, KeyError, TypeError):
        return None


def dispatch(provider, home, agent_id, action, args):
    from control_center.management import preferences, save_preferences
    validate(action, args)
    role = ROLES.get(provider.bindings[agent_id])
    path = database(home)
    available = role is not None and path is not None
    if action == 'memory.share':
        if args['enabled'] and not available: raise ValueError('mempalace_unavailable')
        save_preferences(provider, agent_id, {'memory_shared': args['enabled']})
    shared = preferences(provider, agent_id).get('memory_shared', False) is True
    status = {'available': available, 'shared': shared, 'author': role,
              'scope': 'shared-project', 'projects': ['ProgreTech', 'Local-Workstation'],
              'retention': 'host-only; ephemeral relay', 'private_included': False}
    if action != 'memory.search': return status
    if not shared: raise ValueError('memory_sharing_required')
    if not available: raise ValueError('mempalace_unavailable')
    # A service reader never assumes a role identity. SQL admits only active
    # project records by the bound author, before ranking/limit; private rows
    # cannot enter the response, even when their project/author match.
    query = ' '.join('"' + term.replace('"', '""') + '"' for term in args['query'].split())
    try:
        with sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True, timeout=3) as db:
            db.row_factory = sqlite3.Row
            db.execute('PRAGMA query_only = ON')
            rows = db.execute('''SELECT m.memory_id,m.title,m.content,m.author_id,m.project_id,
                m.scope,m.provenance_type,m.provenance_ref,m.created_at,m.confidence
                FROM memory_fts JOIN memories m ON m.memory_id=memory_fts.memory_id
                WHERE memory_fts MATCH ? AND m.scope='project' AND m.status='active'
                AND m.project_id=? AND m.author_id=? AND m.author_type='agent'
                ORDER BY bm25(memory_fts),m.created_at DESC LIMIT 10''',
                (query, args['project'], role)).fetchall()
            result = []
            for row in rows:
                record = dict(row)
                for key in record:
                    if isinstance(record[key], str): record[key] = record[key][:8000 if key == 'content' else 500]
                record['truncated'] = len(row['content']) > 8000
                result.append(record)
        if preferences(provider,agent_id).get('memory_shared',False) is not True:
            raise ValueError('memory_sharing_required')
        return {**status, 'records': result}
    except sqlite3.Error as exc:
        raise ValueError('mempalace_search_unavailable') from exc
