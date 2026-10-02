"""Relationships from recorded work, never inferred from node proximity."""
import json
import time
from pathlib import Path
from itertools import combinations


def interactions(snapshot, home):
    output=[]
    for m in snapshot.get('messages',[])[:40]:
        if m.get('archived'):continue
        output.append({'id':'mail-'+m['id'],'kind':'instruction','from':m['from'],'to':'orchestrator' if m['to']=='god' else m['to'], 'title':m.get('subject') or 'Mailbox handoff','task_id':None,'parts':{},'source':'office mailbox','at':m.get('created_at')})
    active={}
    for e in snapshot.get('events',[]):
        if e.get('kind')=='agent.start':active[e.get('agentId')]=e.get('taskId')
        elif e.get('kind') in {'agent.complete','agent.error'}:active.pop(e.get('agentId'),None)
    known={a['id']:a for a in snapshot.get('agents',[])}
    tasks={t['id']:t for t in snapshot.get('tasks',[])}
    groups={}
    for aid,task in active.items():
        if task and tasks.get(task,{}).get('status')=='doing':groups.setdefault(task,[]).append((aid,known.get(aid,{}).get('goal')))
    for a in snapshot.get('factoryAgents',[]):
        if a.get('state') in {'active','working'} and a.get('task_id'):
            groups.setdefault(a['task_id'],[]).append(('factory-'+a['id'],a.get('part')))
    for task,people in groups.items():
        for (a,parta),(b,partb) in combinations(people,2):
            output.append({'id':'task-'+task+'-'+a+'-'+b,'kind':'collaboration','from':a,'to':b,'task_id':task,'title':tasks.get(task,{}).get('title') or task,'parts':{a:parta,b:partb},'source':'active task assignment'})
    try:
        rows=json.loads((Path(home)/'.progretech-mesh/agent-interactions.json').read_text())
        for row in rows[-40:]:
            if 0<=time.time()-row['at']<180:
                output.append({**row,'from':'factory-'+row['from'],'to':'factory-'+row['to']})
    except (OSError,ValueError,KeyError,TypeError):pass
    try:
        state=json.loads((Path(home)/'.progretech-mesh/artifact-handoffs.json').read_text())
        for r in state.get('rules',[])[-20:]:
            # Terminal receipts remain in handoff history, not on the live floor.
            if r['state']!='running':continue
            source='factory-'+r['source'];target='factory-'+r['target_role']
            output.append({'id':'artifact-'+r['id'],'kind':'instruction','from':source,'to':target,'title':'Artifact handoff: '+r.get('artifact',{}).get('name','unreported'),'task_id':None,'parts':{source:'Published '+r.get('artifact',{}).get('name','artifact'),target:r['text']},'source':'Owner-authorized conditional instruction · '+r['state']})
        for c in state.get('chatter',{}).get('conversations',[])[-10:]:
            if c['state'] not in {'queued','approaching','first','reply_wait','second','third'}:continue
            roles=[c['a_role'],c['b_role']]+([c['c_role']] if c.get('c_role') else [])
            for left,right in combinations(roles,2):
                a='factory-'+left;b='factory-'+right
                output.append({'id':'chatter-'+c['id']+'-'+left+'-'+right,'chatter_id':c['id'],'topic_editable':True,'kind':'conversation','from':a,'to':b,'title':c['topic'],'task_id':None,'parts':{a:'\n'.join(m['text'] for m in c['messages'] if m['agent']==left) or 'Reply pending',b:'\n'.join(m['text'] for m in c['messages'] if m['agent']==right) or 'Reply pending'},'source':('Experimental group chatter · ' if c.get('c_role') else 'Office chatter · ')+c['state']})
    except (OSError,ValueError,KeyError,TypeError):pass
    return output[-80:]
